import { withTenant, businessEffects, compensationCases, decisionReceipts, workflowSteps } from "@finnor/db";
import { evaluateAuthority } from "@finnor/authority";
import { and, eq, sql } from "drizzle-orm";
import { createHash, randomUUID } from "node:crypto";
import type { BusinessEffectSet, Role } from "@finnor/shared-types";
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
  recovery?: { id: string; semanticHash: string },
): Promise<void> {
  const receipt = await findReceiptByStep(tenantId, stepId);
  if (receipt) await finalizeReceipt(tenantId, receipt.id, { actualResult: { ...record(receipt.actualResult), compensation: result }, recoveryEffectId: recovery?.id });
  if (compensationReceiptId) {
    const evidence = [{ source: "compensation_case", ref: result.caseId, timestamp: new Date().toISOString() }];
    await finalizeReceipt(
      tenantId,
      compensationReceiptId,
      result.status === "compensated"
        ? { actualResult: result, evidence, executedEffectHash: recovery?.semanticHash, effectVerification: { state: "verified", basis: "Compensation binding completed", checkedAt: new Date().toISOString(), observed: result } }
        : { failure: { errorKind: "terminal", message: result.error, recoveryPath: "Review the compensation case and perform a controlled manual recovery." }, evidence, executedEffectHash: recovery?.semanticHash, effectVerification: { state: "unverified", basis: result.error, checkedAt: new Date().toISOString() } },
    );
  }
}

async function openCompensationReceipt(tenantId: string, stepId: string, caseId: string, reason: string, requestedBy?: string, recovery?: BusinessEffectSet): Promise<string | null> {
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
    proposedAction: recovery ? recovery as unknown as Record<string, unknown> : { operation: "compensate", workflowStepId: stepId, compensationCaseId: caseId, reason },
    approval: { required: Boolean(requestedBy), ...(requestedBy ? { approvedBy: requestedBy, at: new Date().toISOString() } : {}) },
    expectedResult: { status: "compensated", originalReceiptId: original.id },
    businessEffectId: recovery?.id,
    intendedEffectHash: recovery?.semanticHash,
    authorizedEffectHash: recovery?.semanticHash,
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
  requestedRole: Role = "owner",
): Promise<{ caseId: string; succeeded: boolean }> {
  const claim = await withTenant(tenantId, async (db) => {
    await db.execute(sql`SELECT pg_advisory_xact_lock(hashtextextended(${stepId}, 905))`);
    const [existing] = await db.select().from(compensationCases).where(and(eq(compensationCases.tenantId, tenantId), eq(compensationCases.workflowStepId, stepId))).limit(1);
    if (existing) return { caseRow: existing, claimed: false as const };
    const [step] = await db.select({ status: workflowSteps.status, stepType: workflowSteps.stepType, businessEffectId: workflowSteps.businessEffectId }).from(workflowSteps).where(and(eq(workflowSteps.tenantId, tenantId), eq(workflowSteps.id, stepId))).limit(1);
    if (!step || step.status !== "completed") throw new Error("Only a completed compensatable workflow step may be compensated");
    const [caseRow] = await db.insert(compensationCases).values({ tenantId, workflowStepId: stepId, reason }).returning();
    let recovery: BusinessEffectSet | undefined;
    if (step.businessEffectId) {
      const [original] = await db.select().from(businessEffects).where(and(eq(businessEffects.tenantId, tenantId), eq(businessEffects.id, step.businessEffectId))).limit(1);
      if (original) {
        const originalEffect = original.effect as BusinessEffectSet;
        const id = randomUUID();
        const delta = { operation: `compensate:${step.stepType}`, values: { originalEffectId: original.id, compensationCaseId: caseRow!.id, reason, capability: _contract.capability, binding: binding.name } };
        const scopeHash = createHash("sha256").update(JSON.stringify({ targets: [{ kind: "resource", type: "business_effect", id: original.id }], delta })).digest("hex");
        const semanticHash = createHash("sha256").update(JSON.stringify({ id, scopeHash, compensationForEffectId: original.id })).digest("hex");
        recovery = {
          id, schemaVersion: 1, semanticHash, scopeHash,
          source: { domainActionId: originalEffect.source.domainActionId, actionType: `compensate:${step.stepType}`, workId: originalEffect.source.workId ?? null, objectiveStepId: originalEffect.source.objectiveStepId ?? null },
          mode: "consequential", operation: { name: `compensate:${step.stepType}`, class: original.operationClass as BusinessEffectSet["operation"]["class"], external: originalEffect.operation.external },
          targets: [{ kind: "resource", type: "business_effect", id: original.id, sourcePath: "compensationForEffectId" }], bindings: originalEffect.bindings,
          preconditions: [], before: [], delta,
          expected: { observation: originalEffect.expected.observation, state: { status: "compensated", originalEffectId: original.id } }, exposure: null,
          authority: { ...originalEffect.authority, capability: `action:compensate:${step.stepType}`, risk: "high" },
          approval: { required: true, typedConfirmation: false, summary: `Compensate ${step.stepType} for Business Effect ${original.id}: ${reason}` },
          reversibility: { classification: "irreversible", compensationCapability: null },
          uncertainty: { unknownOutcome: "reconcile_before_retry", stalePrecondition: "block_and_recompile" },
          provenance: { compiler: "finnor_effect_compiler", compilerVersion: 1, compiledAt: new Date().toISOString(), replacementForEffectId: null, compensationForEffectId: original.id },
        };
        await db.insert(businessEffects).values({ id, tenantId, version: 1, semanticHash, scopeHash, operationClass: recovery.operation.class, effect: recovery, status: "compiled", compensationForEffectId: original.id });
        await db.update(compensationCases).set({ businessEffectId: original.id, compensationEffectId: id }).where(eq(compensationCases.id, caseRow!.id));
      }
    }
    return { caseRow: caseRow!, claimed: true as const, recovery };
  });
  const caseRow = claim.caseRow;
  if (!claim.claimed) return { caseId: caseRow.id, succeeded: caseRow.status === "succeeded" };
  const recovery = "recovery" in claim ? claim.recovery : undefined;
  const compensationReceiptId = await openCompensationReceipt(tenantId, stepId, caseRow.id, reason, requestedBy, recovery);
  if (recovery) {
    if (!requestedBy) {
      const error = "A separately identified approver is required for a compensation Business Effect";
      await withTenant(tenantId, async (db) => {
        await db.update(compensationCases).set({ status: "failed", details: { error }, resolvedAt: new Date() }).where(eq(compensationCases.id, caseRow.id));
        await db.update(businessEffects).set({ status: "cancelled", verification: { state: "unverified", basis: error, checkedAt: new Date().toISOString() }, observedAt: new Date() }).where(eq(businessEffects.id, recovery.id));
      });
      await finalizeCompensationReceipt(tenantId, stepId, compensationReceiptId, { status: "compensation_failed", caseId: caseRow.id, reason, error }, recovery);
      return { caseId: caseRow.id, succeeded: false };
    }
    const authority = await evaluateAuthority(
      { tenantId, userId: requestedBy, role: requestedRole },
      {
        operation: "action",
        capability: recovery.authority.capability,
        resources: recovery.targets.map((target) => ({ type: target.type, id: target.id })),
        risk: "high",
        policyRequiresApproval: false,
        domainActionId: recovery.source.domainActionId,
        businessEffectId: recovery.id,
        businessEffectHash: recovery.semanticHash,
      },
    );
    if (authority.outcome !== "allowed") {
      await withTenant(tenantId, async (db) => {
        await db.update(compensationCases).set({ status: "failed", details: { error: `authority denied: ${authority.reasonCode}`, authorityDecisionId: authority.id }, resolvedAt: new Date() }).where(eq(compensationCases.id, caseRow.id));
        await db.update(businessEffects).set({ status: "cancelled", verification: { state: "unverified", basis: `Compensation authority denied: ${authority.reasonCode}`, checkedAt: new Date().toISOString() }, observedAt: new Date() }).where(eq(businessEffects.id, recovery.id));
      });
      await finalizeCompensationReceipt(tenantId, stepId, compensationReceiptId, { status: "compensation_failed", caseId: caseRow.id, reason, error: `Compensation authority denied: ${authority.reasonCode}` }, recovery);
      return { caseId: caseRow.id, succeeded: false };
    }
    await withTenant(tenantId, (db) => db.update(businessEffects).set({ status: "authorized", authorizedAt: new Date() }).where(and(eq(businessEffects.tenantId, tenantId), eq(businessEffects.id, recovery.id), eq(businessEffects.status, "compiled"))));
  }
  await withTenant(tenantId, (db) => db.update(workflowSteps).set({ status: "compensating", updatedAt: new Date() }).where(and(eq(workflowSteps.tenantId, tenantId), eq(workflowSteps.id, stepId), eq(workflowSteps.status, "completed"))));
  if (recovery) await withTenant(tenantId, (db) => db.update(businessEffects).set({ status: "executing", executionStartedAt: new Date() }).where(and(eq(businessEffects.tenantId, tenantId), eq(businessEffects.id, recovery.id))));

  if (!binding.compensate) {
    await withTenant(tenantId, (db) =>
      db
        .update(compensationCases)
        .set({ status: "failed", details: { error: "binding has no compensate() procedure" }, resolvedAt: new Date() })
        .where(and(eq(compensationCases.tenantId, tenantId), eq(compensationCases.id, caseRow.id))),
    );
    if (recovery) await withTenant(tenantId, (db) => db.update(businessEffects).set({ status: "failed", verification: { state: "unverified", basis: "binding has no compensate() procedure", checkedAt: new Date().toISOString() }, observedAt: new Date() }).where(eq(businessEffects.id, recovery.id)));
    await finalizeCompensationReceipt(tenantId, stepId, compensationReceiptId, { status: "compensation_failed", caseId: caseRow.id, reason, error: "binding has no compensate() procedure" }, recovery);
    return { caseId: caseRow.id, succeeded: false };
  }

  try {
    await binding.compensate(input, output);
    await withTenant(tenantId, async (db) => {
      await db.update(compensationCases).set({ status: "succeeded", resolvedAt: new Date() }).where(and(eq(compensationCases.tenantId, tenantId), eq(compensationCases.id, caseRow.id)));
      await db.update(workflowSteps).set({ status: "compensated", updatedAt: new Date() }).where(and(eq(workflowSteps.tenantId, tenantId), eq(workflowSteps.id, stepId)));
      if (recovery) {
        await db.update(businessEffects).set({ status: "verified", observedResult: { compensated: true, compensationCaseId: caseRow.id }, verification: { state: "verified", basis: "Compensation binding completed", checkedAt: new Date().toISOString() }, observedAt: new Date() }).where(eq(businessEffects.id, recovery.id));
        await db.update(businessEffects).set({ status: "compensated" }).where(eq(businessEffects.id, recovery.provenance.compensationForEffectId!));
        await db.update(decisionReceipts).set({ recoveryEffectId: recovery.id }).where(and(eq(decisionReceipts.tenantId, tenantId), eq(decisionReceipts.workflowStepId, stepId)));
      }
    });
    await finalizeCompensationReceipt(tenantId, stepId, compensationReceiptId, { status: "compensated", caseId: caseRow.id, reason }, recovery);
    return { caseId: caseRow.id, succeeded: true };
  } catch (err) {
    const error = (err as Error).message;
    await withTenant(tenantId, (db) =>
      db
        .update(compensationCases)
        .set({ status: "failed", details: { error }, resolvedAt: new Date() })
        .where(and(eq(compensationCases.tenantId, tenantId), eq(compensationCases.id, caseRow.id))),
    );
    if (recovery) await withTenant(tenantId, (db) => db.update(businessEffects).set({ status: "failed", verification: { state: "unverified", basis: error, checkedAt: new Date().toISOString() }, observedAt: new Date() }).where(eq(businessEffects.id, recovery.id)));
    await finalizeCompensationReceipt(tenantId, stepId, compensationReceiptId, { status: "compensation_failed", caseId: caseRow.id, reason, error }, recovery);
    return { caseId: caseRow.id, succeeded: false };
  }
}
