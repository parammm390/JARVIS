import { withTenant, compensationCases, workflowSteps } from "@finnor/db";
import { eq } from "drizzle-orm";
import type { CapabilityBinding, CapabilityContract } from "./capability";

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
    return { caseId: caseRow!.id, succeeded: false };
  }

  try {
    await binding.compensate(input, output);
    await withTenant(tenantId, async (db) => {
      await db.update(compensationCases).set({ status: "succeeded", resolvedAt: new Date() }).where(eq(compensationCases.id, caseRow!.id));
      await db.update(workflowSteps).set({ status: "compensated" }).where(eq(workflowSteps.id, stepId));
    });
    return { caseId: caseRow!.id, succeeded: true };
  } catch (err) {
    await withTenant(tenantId, (db) =>
      db
        .update(compensationCases)
        .set({ status: "failed", details: { error: (err as Error).message }, resolvedAt: new Date() })
        .where(eq(compensationCases.id, caseRow!.id)),
    );
    return { caseId: caseRow!.id, succeeded: false };
  }
}
