// A4 EXIT GATE: "poison job replayed clean" — a real end-to-end drill tying together
// the real outbox retry/dead-letter path (outbox.ts, pre-existing), A4.T3's auto-triage
// (dlq-triage.ts), and the pre-existing owner-gated replay route: a job that genuinely
// fails 3 times for real (not simulated status flips) dead-letters for real, triage
// correctly recommends "escalate" (not a naive "replay" — it already exhausted 3 real
// attempts, matching dlq-triage.ts's own REPEATED_ATTEMPTS_ESCALATE_THRESHOLD), an owner
// replays it anyway once the underlying cause is fixed, and — with a NOW-succeeding
// deliverer — the replayed event actually delivers clean. Every step here is the real
// code path, nothing hand-waved.

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import pg from "pg";
import { randomUUID } from "node:crypto";
import { migrate } from "../../packages/db/migrate";
import { withTenant, closePool, tenants, outboxEvents, deadLetters } from "@finnor/db";
import { eq } from "drizzle-orm";
import { relayOutboxEvents, triageOpenDeadLetters, type OutboxDeliverer } from "@finnor/workflow-runtime";
import { POST as replayDlq } from "../../apps/api/app/api/dlq/[id]/replay/route";

const DB_URL = process.env.DATABASE_URL ?? "postgres://finnor:finnor@localhost:5432/finnor";
const TENANT_ID = "00000000-0000-4000-8000-0000000000f3";

async function dbUp(): Promise<boolean> {
  const c = new pg.Client({ connectionString: DB_URL, connectionTimeoutMillis: 2000 });
  try {
    await c.connect();
    await c.end();
    return true;
  } catch {
    return false;
  }
}
const available = await dbUp();

function req(url: string): Request {
  return new Request(`http://localhost${url}`, {
    method: "POST",
    headers: { "x-tenant-id": TENANT_ID, "x-user-role": "owner" },
  });
}

/** Clears the jittered backoff so the very next relayOutboxEvents() call can reclaim
 *  the row immediately, instead of waiting out real backoff milliseconds — deterministic,
 *  not a sleep. */
async function clearBackoff(): Promise<void> {
  await withTenant(TENANT_ID, (db) => db.update(outboxEvents).set({ nextAttemptAt: null }));
}

describe.skipIf(!available)("poison job -> dead-letter -> triage -> replay clean (A4 exit gate)", () => {
  let eventId: string;

  beforeAll(async () => {
    process.env.DATABASE_URL = DB_URL;
    process.env.AUTH_DEV_BYPASS = "1";
    await migrate(DB_URL);
    await withTenant(TENANT_ID, (db) => db.insert(tenants).values({ id: TENANT_ID, name: "Poison Job Drill Dealer" }).onConflictDoNothing());

    const [row] = await withTenant(TENANT_ID, (db) =>
      db.insert(outboxEvents).values({ tenantId: TENANT_ID, eventType: `poison.drill.${randomUUID()}`, payload: {}, status: "pending" }).returning(),
    );
    eventId = row!.id;
  });

  afterAll(async () => {
    await withTenant(TENANT_ID, async (db) => {
      await db.delete(deadLetters).where(eq(deadLetters.tenantId, TENANT_ID));
      await db.delete(outboxEvents).where(eq(outboxEvents.tenantId, TENANT_ID));
    });
    await closePool();
  });

  it("a real 3x-failing deliverer genuinely dead-letters the event", async () => {
    const poisonDeliverer: OutboxDeliverer = {
      async deliver() {
        throw new Error("simulated poison — downstream always 500s");
      },
    };

    // 3 real attempts, exactly MAX_DELIVER_ATTEMPTS in outbox.ts — clearing backoff
    // between calls so each one genuinely reclaims and re-attempts immediately.
    for (let i = 0; i < 3; i++) {
      await clearBackoff();
      await relayOutboxEvents(TENANT_ID, poisonDeliverer);
    }

    const [afterEvent] = await withTenant(TENANT_ID, (db) => db.select().from(outboxEvents).where(eq(outboxEvents.id, eventId)));
    expect(afterEvent!.status).toBe("failed");
    expect(afterEvent!.attempts).toBe(3);

    const [dl] = await withTenant(TENANT_ID, (db) => db.select().from(deadLetters).where(eq(deadLetters.relatedOutboxEventId, eventId)));
    expect(dl).toBeTruthy();
    expect(dl!.status).toBe("open");
    expect(dl!.attempts).toBe(3);
  });

  it("triage correctly recommends escalate (already exhausted 3 real attempts, not a naive replay suggestion)", async () => {
    await triageOpenDeadLetters(TENANT_ID);
    const [dl] = await withTenant(TENANT_ID, (db) => db.select().from(deadLetters).where(eq(deadLetters.relatedOutboxEventId, eventId)));
    expect(dl!.suggestedDisposition).toBe("escalate");
  });

  it("an owner replays it anyway once the underlying cause is fixed, and it delivers clean this time — for real", async () => {
    const [dl] = await withTenant(TENANT_ID, (db) => db.select().from(deadLetters).where(eq(deadLetters.relatedOutboxEventId, eventId)));

    const replayRes = await replayDlq(req(`/api/dlq/${dl!.id}/replay`), { params: { id: dl!.id } });
    expect(replayRes.status).toBe(200);

    const [resetEvent] = await withTenant(TENANT_ID, (db) => db.select().from(outboxEvents).where(eq(outboxEvents.id, eventId)));
    expect(resetEvent!.status).toBe("pending"); // reset by the real replay route

    // The "underlying cause is fixed" — a deliverer that now succeeds. Real
    // relayOutboxEvents call, not a status flip.
    const fixedDeliverer: OutboxDeliverer = { async deliver() {} };
    await clearBackoff();
    const result = await relayOutboxEvents(TENANT_ID, fixedDeliverer);
    expect(result.delivered).toBe(1);

    const [finalEvent] = await withTenant(TENANT_ID, (db) => db.select().from(outboxEvents).where(eq(outboxEvents.id, eventId)));
    expect(finalEvent!.status).toBe("delivered"); // replayed clean, for real

    const [finalDl] = await withTenant(TENANT_ID, (db) => db.select().from(deadLetters).where(eq(deadLetters.relatedOutboxEventId, eventId)));
    expect(finalDl!.status).toBe("replayed");
  });
});
