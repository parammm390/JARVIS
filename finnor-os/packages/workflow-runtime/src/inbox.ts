// Inbound provider events, deduplicated by (provider, event_id) — unlike
// webhook_receipts (transport-level dedup only, insert-once, no status column), this
// additionally tracks whether the event was matched and applied to an open
// workflow_step, or needs a reconciliation_case.

import { withTenant, inboxEvents, reconciliationCases, workflowSteps, type Db } from "@finnor/db";
import { and, eq } from "drizzle-orm";
import { createHash } from "node:crypto";

export interface ReceiveInboxEventParams {
  tenantId: string;
  provider: string;
  eventId: string;
  payload: Record<string, unknown>;
  /** Correlates this inbound event to an open workflow_step — e.g. a provider's own
   *  reference id stashed in the step's evidence/payload at call time. */
  matchStepId?: string;
}

export type ReceiveInboxEventResult =
  | { status: "duplicate"; inboxEventId: string }
  | { status: "matched"; inboxEventId: string; stepId: string }
  | { status: "unmatched"; inboxEventId: string };

export async function receiveInboxEventTx(db: Db, params: ReceiveInboxEventParams): Promise<ReceiveInboxEventResult> {
  const payloadHash = createHash("sha256").update(JSON.stringify(params.payload)).digest("hex");
    const [row] = await db
      .insert(inboxEvents)
      .values({ tenantId: params.tenantId, provider: params.provider, eventId: params.eventId, payloadHash, status: "received" })
      .onConflictDoNothing({ target: [inboxEvents.tenantId, inboxEvents.provider, inboxEvents.eventId] })
      .returning();

    if (!row) {
      const [existing] = await db
        .select()
        .from(inboxEvents)
        .where(and(eq(inboxEvents.tenantId, params.tenantId), eq(inboxEvents.provider, params.provider), eq(inboxEvents.eventId, params.eventId)));
      if (!existing) throw new Error("Inbox replay claim resolved outside the authenticated tenant");
      return { status: "duplicate" as const, inboxEventId: existing!.id };
    }

    if (params.matchStepId) {
      const [step] = await db.select().from(workflowSteps).where(and(eq(workflowSteps.tenantId, params.tenantId), eq(workflowSteps.id, params.matchStepId)));
      if (step) {
        await db.update(inboxEvents).set({ status: "matched", matchedStepId: step.id }).where(eq(inboxEvents.id, row.id));
        return { status: "matched" as const, inboxEventId: row.id, stepId: step.id };
      }
    }

    await db.update(inboxEvents).set({ status: "unmatched" }).where(eq(inboxEvents.id, row.id));
    await db.insert(reconciliationCases).values({
      tenantId: params.tenantId,
      caseType: "unmatched_inbox_event",
      relatedInboxEventId: row.id,
      details: { provider: params.provider, eventId: params.eventId },
    });
    return { status: "unmatched" as const, inboxEventId: row.id };
}

export async function receiveInboxEvent(params: ReceiveInboxEventParams): Promise<ReceiveInboxEventResult> {
  return withTenant(params.tenantId, (db) => receiveInboxEventTx(db, params));
}
