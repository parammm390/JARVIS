// Inbound provider events, deduplicated by (provider, event_id) — unlike
// webhook_receipts (transport-level dedup only, insert-once, no status column), this
// additionally tracks whether the event was matched and applied to an open
// workflow_step, or needs a reconciliation_case.

import { withTenant, inboxEvents, workflowSteps } from "@finnor/db";
import { and, eq } from "drizzle-orm";
import { createHash } from "node:crypto";
import { openReconciliationCase } from "./reconciliation";

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

export async function receiveInboxEvent(params: ReceiveInboxEventParams): Promise<ReceiveInboxEventResult> {
  const payloadHash = createHash("sha256").update(JSON.stringify(params.payload)).digest("hex");

  const result = await withTenant(params.tenantId, async (db) => {
    const [row] = await db
      .insert(inboxEvents)
      .values({ tenantId: params.tenantId, provider: params.provider, eventId: params.eventId, payloadHash, status: "received" })
      .onConflictDoNothing({ target: [inboxEvents.provider, inboxEvents.eventId] })
      .returning();

    if (!row) {
      const [existing] = await db
        .select()
        .from(inboxEvents)
        .where(and(eq(inboxEvents.provider, params.provider), eq(inboxEvents.eventId, params.eventId)));
      await db.update(inboxEvents).set({ status: "duplicate" }).where(eq(inboxEvents.id, existing!.id));
      return { status: "duplicate" as const, inboxEventId: existing!.id };
    }

    if (params.matchStepId) {
      const [step] = await db.select().from(workflowSteps).where(eq(workflowSteps.id, params.matchStepId));
      if (step) {
        await db.update(inboxEvents).set({ status: "matched", matchedStepId: step.id }).where(eq(inboxEvents.id, row.id));
        return { status: "matched" as const, inboxEventId: row.id, stepId: step.id };
      }
    }

    await db.update(inboxEvents).set({ status: "unmatched" }).where(eq(inboxEvents.id, row.id));
    return { status: "unmatched" as const, inboxEventId: row.id };
  });

  if (result.status === "unmatched") {
    await openReconciliationCase(params.tenantId, {
      caseType: "unmatched_inbox_event",
      relatedInboxEventId: result.inboxEventId,
      details: { provider: params.provider, eventId: params.eventId },
    });
  }

  return result;
}
