// DecisionReceipt persistence (§2.2 contracts / §2.4 wiring). One row per
// workflow_step, created at proposal time and finalized in place at completion — see
// packages/db/schema.ts's decisionReceipts table and its unique(workflowStepId).

import { withTenant, decisionReceipts } from "@finnor/db";
import { eq } from "drizzle-orm";
import type { ReceiptEvidence, ReceiptApproval, ReceiptFailure } from "@finnor/shared-types";

export interface OpenReceiptParams {
  tenantId: string;
  workflowRunId?: string;
  workflowStepId?: string;
  domainActionId?: string;
  objective: string;
  evidence: ReceiptEvidence[];
  policyApplied: { id: string; version: number } | null;
  riskTier: "low" | "medium" | "high";
  proposedAction: Record<string, unknown>;
  approval: ReceiptApproval;
  expectedResult?: Record<string, unknown>;
  correlationId?: string;
}

/** Called before the step's external effect runs — the receipt exists whether or not
 *  the effect ultimately succeeds, so "no receipt" can never mean "nothing happened,
 *  we just didn't record it." */
export async function openReceipt(params: OpenReceiptParams): Promise<{ receiptId: string }> {
  const [row] = await withTenant(params.tenantId, (db) =>
    db
      .insert(decisionReceipts)
      .values({
        tenantId: params.tenantId,
        workflowRunId: params.workflowRunId ?? null,
        workflowStepId: params.workflowStepId ?? null,
        domainActionId: params.domainActionId ?? null,
        objective: params.objective,
        evidence: params.evidence,
        policyApplied: params.policyApplied,
        riskTier: params.riskTier,
        proposedAction: params.proposedAction,
        approval: params.approval,
        expectedResult: params.expectedResult ?? null,
        correlationId: params.correlationId ?? null,
      })
      .returning({ id: decisionReceipts.id }),
  );
  return { receiptId: row!.id };
}

/** Finalizes a receipt with what actually happened. Idempotent to call twice with the
 *  same result (a recovered/resumed step re-finalizing) — it's a plain UPDATE, not an
 *  append, so the second call just overwrites with the same values. */
export async function finalizeReceipt(
  tenantId: string,
  receiptId: string,
  result: { actualResult: Record<string, unknown> } | { failure: ReceiptFailure },
): Promise<void> {
  await withTenant(tenantId, (db) =>
    db
      .update(decisionReceipts)
      .set({
        actualResult: "actualResult" in result ? result.actualResult : null,
        failure: "failure" in result ? result.failure : null,
        finalizedAt: new Date(),
      })
      .where(eq(decisionReceipts.id, receiptId)),
  );
}

/** Looks up the receipt already opened for a step (finalizeReceipt needs the id;
 *  recovery paths that resume a step need to find its existing receipt rather than
 *  opening a second one — workflowStepId is unique in the table). Carries objective/
 *  domainActionId/workflowRunId too (§5.2: completeStep's auto-ingest hook needs real
 *  provenance for the chunk it writes, not just the id). */
export async function findReceiptByStep(
  tenantId: string,
  workflowStepId: string,
): Promise<{ id: string; objective: string; domainActionId: string | null; workflowRunId: string | null } | null> {
  const [row] = await withTenant(tenantId, (db) =>
    db
      .select({
        id: decisionReceipts.id,
        objective: decisionReceipts.objective,
        domainActionId: decisionReceipts.domainActionId,
        workflowRunId: decisionReceipts.workflowRunId,
      })
      .from(decisionReceipts)
      .where(eq(decisionReceipts.workflowStepId, workflowStepId)),
  );
  return row ?? null;
}
