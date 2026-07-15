import { withTenant, outboxEvents, type Db } from "@finnor/db";
import { and, eq } from "drizzle-orm";
import { openReconciliationCase } from "./reconciliation";

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

export interface OutboxDeliverer {
  deliver(eventType: string, payload: Record<string, unknown>): Promise<void>;
}

const MAX_DELIVER_ATTEMPTS = 3;

/** Relays pending outbox events for a tenant. Call periodically (registered as a job,
 *  like the existing proactive scan handlers). */
export async function relayOutboxEvents(
  tenantId: string,
  deliverer: OutboxDeliverer,
): Promise<{ delivered: number; reconciled: number }> {
  const pending = await withTenant(tenantId, (db) =>
    db.select().from(outboxEvents).where(and(eq(outboxEvents.tenantId, tenantId), eq(outboxEvents.status, "pending"))),
  );

  let delivered = 0;
  let reconciled = 0;

  for (const event of pending) {
    const attempts = event.attempts + 1;
    await withTenant(tenantId, (db) => db.update(outboxEvents).set({ status: "delivering", attempts }).where(eq(outboxEvents.id, event.id)));
    try {
      await deliverer.deliver(event.eventType, event.payload as Record<string, unknown>);
      await withTenant(tenantId, (db) =>
        db.update(outboxEvents).set({ status: "delivered", deliveredAt: new Date() }).where(eq(outboxEvents.id, event.id)),
      );
      delivered++;
    } catch (err) {
      if (attempts >= MAX_DELIVER_ATTEMPTS) {
        await withTenant(tenantId, (db) => db.update(outboxEvents).set({ status: "unknown" }).where(eq(outboxEvents.id, event.id)));
        await openReconciliationCase(tenantId, {
          caseType: "unknown_delivery",
          relatedOutboxEventId: event.id,
          details: { eventType: event.eventType, error: (err as Error).message },
        });
        reconciled++;
      } else {
        await withTenant(tenantId, (db) => db.update(outboxEvents).set({ status: "pending" }).where(eq(outboxEvents.id, event.id)));
      }
    }
  }

  return { delivered, reconciled };
}
