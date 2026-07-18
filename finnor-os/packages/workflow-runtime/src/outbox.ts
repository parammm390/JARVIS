// Outbox dispatch (§2.3 hardening). Claims a batch atomically via SELECT ... FOR UPDATE
// SKIP LOCKED so N concurrent relayers never double-claim the same row — this, not a
// bigger MAX_DELIVER_ATTEMPTS or a mutex, is what makes delivery exactly-once under
// concurrency. Terminal failures land in dead_letters (queryable, replayable) instead
// of silently becoming an unresolvable "unknown" status.

import { withTenant, outboxEvents, deadLetters, type Db } from "@finnor/db";
import { and, eq, inArray, sql } from "drizzle-orm";
import type { ErrorKind } from "@finnor/shared-types";
import { checkEnvelopeVersion } from "./envelope";

export interface EnqueueOutboxEventParams {
  tenantId: string;
  workflowStepId?: string;
  eventType: string;
  payload: Record<string, unknown>;
}

/** Call this INSIDE the same withTenant(db => ...) transaction as the state change that
 *  produced the event — pass the already-open `db` handle, don't open a new one. */
export async function enqueueOutboxEvent(db: Db, params: EnqueueOutboxEventParams): Promise<{ outboxEventId: string }> {
  const [row] = await db
    .insert(outboxEvents)
    .values({
      tenantId: params.tenantId,
      workflowStepId: params.workflowStepId ?? null,
      eventType: params.eventType,
      payload: params.payload,
    })
    .returning();
  return { outboxEventId: row!.id };
}

/** A deliverer may throw a plain Error (treated as `retryable`) or attach a `kind`
 *  (matching packages/tools/src/errors.ts's IntegrationError convention) for finer
 *  control — e.g. a 4xx from the destination should be `terminal`, not retried 3 times
 *  before landing in the DLQ anyway. `idempotencyKey` lets a real destination (a
 *  webhook, a queue) dedup on its own side too — DB-side exactly-once claiming isn't a
 *  substitute for that when the destination is itself unreliable/at-least-once. */
export interface OutboxDeliverer {
  deliver(eventType: string, payload: Record<string, unknown>, opts: { idempotencyKey: string }): Promise<void>;
}

const MAX_DELIVER_ATTEMPTS = 3;
const BASE_BACKOFF_MS = 500;

function classifyErrorKind(err: unknown): ErrorKind {
  const kind = (err as { kind?: ErrorKind }).kind;
  return kind ?? "retryable";
}

/** Full jitter backoff, exponential in the attempt number — same shape as
 *  packages/tools/src/wrap.ts's retry delay, just with randomness so many rows that
 *  fail at once don't all retry in the same instant. */
function jitteredBackoffMs(attempt: number): number {
  const cap = BASE_BACKOFF_MS * 2 ** (attempt - 1);
  return Math.floor(Math.random() * cap);
}

type OutboxEventRow = typeof outboxEvents.$inferSelect;

/** Atomically claims up to `limit` pending, claimable (backoff elapsed) rows for a
 *  tenant. SELECT ... FOR UPDATE SKIP LOCKED takes the lock; the UPDATE that follows,
 *  inside the same withTenant transaction, only ever touches rows this call itself just
 *  locked — no other concurrent caller can have grabbed them in between. */
async function claimPendingBatch(tenantId: string, limit: number): Promise<OutboxEventRow[]> {
  return withTenant(tenantId, async (db) => {
    const locked = await db
      .select()
      .from(outboxEvents)
      .where(
        and(
          eq(outboxEvents.tenantId, tenantId),
          eq(outboxEvents.status, "pending"),
          sql`(${outboxEvents.nextAttemptAt} IS NULL OR ${outboxEvents.nextAttemptAt} <= now())`,
        ),
      )
      .orderBy(outboxEvents.createdAt)
      .limit(limit)
      .for("update", { skipLocked: true });
    if (locked.length === 0) return [];

    const ids = locked.map((r) => r.id);
    await db
      .update(outboxEvents)
      .set({ status: "delivering", attempts: sql`${outboxEvents.attempts} + 1` })
      .where(inArray(outboxEvents.id, ids));
    return locked.map((r) => ({ ...r, status: "delivering" as const, attempts: r.attempts + 1 }));
  });
}

async function sendToDeadLetter(
  tenantId: string,
  event: OutboxEventRow,
  errorKind: ErrorKind,
  lastError: string,
): Promise<void> {
  await withTenant(tenantId, async (db) => {
    await db.insert(deadLetters).values({
      tenantId,
      relatedOutboxEventId: event.id,
      envelope: { type: event.eventType, version: event.envelopeVersion, tenantId, occurredAt: new Date().toISOString(), payload: event.payload },
      errorKind,
      attempts: event.attempts,
      lastError,
      // A validation/auth/terminal failure will never succeed on replay without a code
      // or config fix; a provider outage might, once the provider recovers.
      replayable: errorKind !== "validation" && errorKind !== "terminal",
      status: "open",
    });
    await db.update(outboxEvents).set({ status: "failed", lastErrorKind: errorKind }).where(eq(outboxEvents.id, event.id));
  });
}

/** Relays pending outbox events for a tenant. Call periodically (registered as a job,
 *  like the existing proactive scan handlers) — safe to call concurrently from multiple
 *  worker processes, which is the whole point of the SKIP LOCKED claim above. */
export async function relayOutboxEvents(
  tenantId: string,
  deliverer: OutboxDeliverer,
  opts: { batchSize?: number } = {},
): Promise<{ delivered: number; deadLettered: number; retried: number }> {
  const claimed = await claimPendingBatch(tenantId, opts.batchSize ?? 25);

  let delivered = 0;
  let deadLettered = 0;
  let retried = 0;

  for (const event of claimed) {
    const versionCheck = checkEnvelopeVersion({ version: event.envelopeVersion });
    if (!versionCheck.ok) {
      await sendToDeadLetter(tenantId, event, versionCheck.errorKind!, versionCheck.reason!);
      deadLettered++;
      continue;
    }

    try {
      await deliverer.deliver(event.eventType, event.payload as Record<string, unknown>, { idempotencyKey: event.id });
      await withTenant(tenantId, (db) =>
        db.update(outboxEvents).set({ status: "delivered", deliveredAt: new Date() }).where(eq(outboxEvents.id, event.id)),
      );
      delivered++;
    } catch (err) {
      const errorKind = classifyErrorKind(err);
      const message = (err as Error).message ?? String(err);
      const exhausted = event.attempts >= MAX_DELIVER_ATTEMPTS;
      const terminal = errorKind === "terminal" || errorKind === "validation" || errorKind === "auth";
      if (exhausted || terminal) {
        await sendToDeadLetter(tenantId, event, errorKind, message);
        deadLettered++;
      } else {
        await withTenant(tenantId, (db) =>
          db
            .update(outboxEvents)
            .set({
              status: "pending",
              lastErrorKind: errorKind,
              nextAttemptAt: new Date(Date.now() + jitteredBackoffMs(event.attempts)),
            })
            .where(eq(outboxEvents.id, event.id)),
        );
        retried++;
      }
    }
  }

  return { delivered, deadLettered, retried };
}
