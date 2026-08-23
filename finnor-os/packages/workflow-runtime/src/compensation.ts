import { withTenant, compensationCases, workflowSteps } from "@finnor/db";
import { and, eq, sql } from "drizzle-orm";
import type { CapabilityBinding, CapabilityContract } from "./capability";
import { finalizeReceipt, findReceiptByStep, openReceipt } from "./receipts";

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

/** A compensation is its own terminal fact, not an invisible implementation
 * detail. The original effect receipt retains its actual result plus a compensation
 * field, while a separate run-level receipt records the compensation operation. */
async function finalizeCompensationReceipt(
  tenantId: string,
  stepId: string,
  compensationReceiptId: string | null,
  result: { status: "compensated"; caseId: string; reason: string } | { status: "compensation_failed"; caseId: string; reason: string; error: string },
): Promise<void> {
  const receipt = await findReceiptByStep(tenantId, stepId);
  if (receipt) await finalizeReceipt(tenantId, receipt.id, { actualResult: { ...record(receipt.actualResult), compensation: result } });
  if (compensationReceiptId) {
    const evidence = [{ source: "compensation_case", ref: result.caseId, timestamp: new Date().toISOString() }];
    await finalizeReceipt(
      tenantId,
      compensationReceiptId,
      result.status === "compensated"
        ? { actualResult: result, evidence }
        : { failure: { errorKind: "terminal", message: result.error, recoveryPath: "Review the compensation case and perform a controlled manual recovery." }, evidence },
    );
  }
}

async function openCompensationReceipt(tenantId: string, stepId: string, caseId: string, reason: string, requestedBy?: string): Promise<string | null> {
  const original = await findReceiptByStep(tenantId, stepId);
  if (!original) return null;
  const policy = record(original.policyApplied);
  const { receiptId } = await openReceipt({
    tenantId,
    workflowRunId: original.workflowRunId ?? undefined,
    domainActionId: original.domainActionId ?? undefined,
    workId: original.workId ?? undefined,
    objective: `Compensate ${original.objective}`,
    evidence: [{ source: "decision_receipt", ref: original.id, timestamp: new Date().toISOString() }],
    policyApplied: typeof policy.id === "string" && typeof policy.version === "number" ? { id: policy.id, version: policy.version } : null,
    riskTier: original.riskTier,
    proposedAction: { operation: "compensate", workflowStepId: stepId, compensationCaseId: caseId, reason },
    approval: { required: Boolean(requestedBy), ...(requestedBy ? { approvedBy: requestedBy, at: new Date().toISOString() } : {}) },
    expectedResult: { status: "compensated", originalReceiptId: original.id },
  });
  return receiptId;
}

export async function compensateStep<TIn, TOut>(
  tenantId: string,
  stepId: string,
  reason: string,
  _contract: CapabilityContract<TIn, TOut>,
  binding: CapabilityBinding<TIn, TOut>,
  input: TIn,
  output: TOut,
  requestedBy?: string,
): Promise<{ caseId: string; succeeded: boolean }> {
  const claim = await withTenant(tenantId, async (db) => {
    await db.execute(sql`SELECT pg_advisory_xact_lock(hashtextextended(${stepId}, 905))`);
    const [existing] = await db.select().from(compensationCases).where(and(eq(compensationCases.tenantId, tenantId), eq(compensationCases.workflowStepId, stepId))).limit(1);
    if (existing) return { caseRow: existing, claimed: false as const };
    const [step] = await db.select({ status: workflowSteps.status }).from(workflowSteps).where(and(eq(workflowSteps.tenantId, tenantId), eq(workflowSteps.id, stepId))).limit(1);
    if (!step || step.status !== "completed") throw new Error("Only a completed compensatable workflow step may be compensated");
    const [caseRow] = await db.insert(compensationCases).values({ tenantId, workflowStepId: stepId, reason }).returning();
    await db.update(workflowSteps).set({ status: "compensating", updatedAt: new Date() }).where(and(eq(workflowSteps.tenantId, tenantId), eq(workflowSteps.id, stepId), eq(workflowSteps.status, "completed")));
    return { caseRow: caseRow!, claimed: true as const };
  });
  const caseRow = claim.caseRow;
  if (!claim.claimed) return { caseId: caseRow.id, succeeded: caseRow.status === "succeeded" };
  const compensationReceiptId = await openCompensationReceipt(tenantId, stepId, caseRow.id, reason, requestedBy);

  if (!binding.compensate) {
    await withTenant(tenantId, (db) =>
      db
        .update(compensationCases)
        .set({ status: "failed", details: { error: "binding has no compensate() procedure" }, resolvedAt: new Date() })
        .where(and(eq(compensationCases.tenantId, tenantId), eq(compensationCases.id, caseRow.id))),
    );
    await finalizeCompensationReceipt(tenantId, stepId, compensationReceiptId, { status: "compensation_failed", caseId: caseRow.id, reason, error: "binding has no compensate() procedure" });
    return { caseId: caseRow.id, succeeded: false };
  }

  try {
    await binding.compensate(input, output);
    await withTenant(tenantId, async (db) => {
      await db.update(compensationCases).set({ status: "succeeded", resolvedAt: new Date() }).where(and(eq(compensationCases.tenantId, tenantId), eq(compensationCases.id, caseRow.id)));
      await db.update(workflowSteps).set({ status: "compensated", updatedAt: new Date() }).where(and(eq(workflowSteps.tenantId, tenantId), eq(workflowSteps.id, stepId)));
    });
    await finalizeCompensationReceipt(tenantId, stepId, compensationReceiptId, { status: "compensated", caseId: caseRow.id, reason });
    return { caseId: caseRow.id, succeeded: true };
  } catch (err) {
    const error = (err as Error).message;
    await withTenant(tenantId, (db) =>
      db
        .update(compensationCases)
        .set({ status: "failed", details: { error }, resolvedAt: new Date() })
        .where(and(eq(compensationCases.tenantId, tenantId), eq(compensationCases.id, caseRow.id))),
    );
    await finalizeCompensationReceipt(tenantId, stepId, compensationReceiptId, { status: "compensation_failed", caseId: caseRow.id, reason, error });
    return { caseId: caseRow.id, succeeded: false };
  }
}
