import { withTenant, compensationCases, workflowSteps } from "@finnor/db";
import { eq } from "drizzle-orm";
import type { CapabilityBinding, CapabilityContract } from "./capability";
import { finalizeReceipt, findReceiptByStep } from "./receipts";

/** A compensation is its own terminal fact, not an invisible implementation
 * detail. It updates the receipt already opened for this step; it never creates a
 * second receipt for the rollback. */
async function finalizeCompensationReceipt(
  tenantId: string,
  stepId: string,
  result: { status: "compensated"; caseId: string; reason: string } | { status: "compensation_failed"; caseId: string; reason: string; error: string },
): Promise<void> {
  const receipt = await findReceiptByStep(tenantId, stepId);
  if (!receipt) return;
  await finalizeReceipt(tenantId, receipt.id, { actualResult: { compensation: result } });
}

export async function compensateStep<TIn, TOut>(
  tenantId: string,
  stepId: string,
  reason: string,
  _contract: CapabilityContract<TIn, TOut>,
  binding: CapabilityBinding<TIn, TOut>,
  input: TIn,
  output: TOut,
): Promise<{ caseId: string; succeeded: boolean }> {
  const [caseRow] = await withTenant(tenantId, (db) =>
    db.insert(compensationCases).values({ tenantId, workflowStepId: stepId, reason }).returning(),
  );
  await withTenant(tenantId, (db) => db.update(workflowSteps).set({ status: "compensating" }).where(eq(workflowSteps.id, stepId)));

  if (!binding.compensate) {
    await withTenant(tenantId, (db) =>
      db
        .update(compensationCases)
        .set({ status: "failed", details: { error: "binding has no compensate() procedure" }, resolvedAt: new Date() })
        .where(eq(compensationCases.id, caseRow!.id)),
    );
    await finalizeCompensationReceipt(tenantId, stepId, { status: "compensation_failed", caseId: caseRow!.id, reason, error: "binding has no compensate() procedure" });
    return { caseId: caseRow!.id, succeeded: false };
  }

  try {
    await binding.compensate(input, output);
    await withTenant(tenantId, async (db) => {
      await db.update(compensationCases).set({ status: "succeeded", resolvedAt: new Date() }).where(eq(compensationCases.id, caseRow!.id));
      await db.update(workflowSteps).set({ status: "compensated" }).where(eq(workflowSteps.id, stepId));
    });
    await finalizeCompensationReceipt(tenantId, stepId, { status: "compensated", caseId: caseRow!.id, reason });
    return { caseId: caseRow!.id, succeeded: true };
  } catch (err) {
    const error = (err as Error).message;
    await withTenant(tenantId, (db) =>
      db
        .update(compensationCases)
        .set({ status: "failed", details: { error }, resolvedAt: new Date() })
        .where(eq(compensationCases.id, caseRow!.id)),
    );
    await finalizeCompensationReceipt(tenantId, stepId, { status: "compensation_failed", caseId: caseRow!.id, reason, error });
    return { caseId: caseRow!.id, succeeded: false };
  }
}
