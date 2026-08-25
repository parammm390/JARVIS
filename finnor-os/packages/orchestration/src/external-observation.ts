import {
  businessEffects,
  decisionReceipts,
  domainActions,
  externalOperations,
  externalRefs,
  integrationOperations,
  reconciliationCases,
  reconcileWorkStatus,
  tenantIntegrations,
  withTenant,
  workflowSteps,
} from "@finnor/db";
import type { ExternalEffectObservation } from "@finnor/shared-types";
import { advanceWorkflow, completeStep, failStep } from "@finnor/workflow-runtime";
import { and, eq, inArray } from "drizzle-orm";
import { resumeObjectiveForAction } from "./objective-loop";
import { ingestIntegrationEvent } from "./event-waits";

export interface ExternalObservationReferences {
  integrationOperationId?: string;
  domainActionId?: string;
  externalOperationKey?: string;
  providerEventId?: string;
}

/** The one terminal boundary for provider read-back/events. Provider acknowledgement
 * cannot call this. Only a normalized observation tied to the exact tenant account
 * and immutable EffectSet can settle the action/step/receipt/objective together. */
export async function settleExternalEffectObservation(
  observation: ExternalEffectObservation,
  refs: ExternalObservationReferences = {},
): Promise<void> {
  const [loaded] = await withTenant(observation.tenantId, (db) => db.select({
    effectId: businessEffects.id,
    effectStatus: businessEffects.status,
    semanticHash: businessEffects.semanticHash,
    effectActionId: businessEffects.domainActionId,
    actionWorkId: domainActions.workId,
  }).from(businessEffects).innerJoin(domainActions, and(
    eq(domainActions.tenantId, observation.tenantId),
    eq(domainActions.id, businessEffects.domainActionId),
  )).where(and(
    eq(businessEffects.tenantId, observation.tenantId),
    eq(businessEffects.id, observation.businessEffectId),
  )).limit(1));
  if (!loaded || !loaded.effectActionId) throw new Error("External observation does not match a tenant Business Effect/action");
  if (refs.domainActionId && refs.domainActionId !== loaded.effectActionId) throw new Error("External observation action/effect mismatch");
  // Verification is monotonic. A delayed, duplicated, or out-of-order provider
  // event may heal an uncertain result, but it may never regress proven truth.
  if (loaded.effectStatus === "verified" && observation.classification !== "present") return;

  const [integration] = await withTenant(observation.tenantId, (db) => db.select({
    id: tenantIntegrations.id,
    binding: tenantIntegrations.binding,
  }).from(tenantIntegrations).where(and(
    eq(tenantIntegrations.tenantId, observation.tenantId),
    eq(tenantIntegrations.id, observation.integrationId),
  )).limit(1));
  if (!integration || integration.binding !== observation.provider) {
    throw new Error("External observation does not match the configured tenant integration/account");
  }

  const checkedAt = new Date(observation.observedAt);
  if (Number.isNaN(checkedAt.getTime())) throw new Error("External observation timestamp is invalid");
  const terminal = observation.classification;
  const effectStatus = terminal === "present" ? "verified"
    : terminal === "divergent" ? "divergent"
      : terminal === "absent" ? "failed" : "reconciliation_required";
  const actionStatus = terminal === "present" ? "completed"
    : terminal === "absent" ? "failed" : "needs_human_review";
  const verification = {
    state: terminal === "present" ? "verified"
      : terminal === "divergent" ? "divergent"
        : terminal === "unknown" ? "reconciliation_required" : "unverified",
    basis: terminal === "present" ? "Observed external state matches the exact authorized EffectSet"
      : terminal === "divergent" ? "Observed external state differs from the exact authorized EffectSet"
        : terminal === "absent" ? "Provider truth proves the attempted effect is absent"
          : "Provider truth is still inconclusive; retry remains prohibited",
    checkedAt: checkedAt.toISOString(),
    observed: observation as unknown as Record<string, unknown>,
  } as const;

  const steps = await withTenant(observation.tenantId, async (db) => {
    await db.update(businessEffects).set({
      status: effectStatus,
      observedResult: observation.observed ?? {},
      verification,
      observedAt: checkedAt,
    }).where(and(eq(businessEffects.tenantId, observation.tenantId), eq(businessEffects.id, observation.businessEffectId)));
    await db.update(domainActions).set({ status: actionStatus, executionStartedAt: null }).where(and(
      eq(domainActions.tenantId, observation.tenantId),
      eq(domainActions.id, loaded.effectActionId!),
      inArray(domainActions.status, ["executing", "needs_human_review"]),
    ));
    await db.update(decisionReceipts).set({ executedEffectHash: loaded.semanticHash, verification }).where(and(
      eq(decisionReceipts.tenantId, observation.tenantId),
      eq(decisionReceipts.businessEffectId, observation.businessEffectId),
    ));

    const operationPatch = {
      externalObservedAt: checkedAt,
      verificationStatus: terminal === "present" ? "verified" as const
        : terminal === "divergent" ? "divergent" as const : "unknown" as const,
      observation,
      updatedAt: new Date(),
    };
    if (refs.integrationOperationId) await db.update(integrationOperations).set(operationPatch).where(and(
      eq(integrationOperations.tenantId, observation.tenantId),
      eq(integrationOperations.id, refs.integrationOperationId),
      eq(integrationOperations.integrationId, observation.integrationId),
      eq(integrationOperations.businessEffectId, observation.businessEffectId),
    ));
    if (refs.externalOperationKey) await db.update(externalOperations).set(operationPatch).where(and(
      eq(externalOperations.tenantId, observation.tenantId),
      eq(externalOperations.domainActionId, loaded.effectActionId!),
      eq(externalOperations.operationKey, refs.externalOperationKey),
      eq(externalOperations.integrationId, observation.integrationId),
      eq(externalOperations.businessEffectId, observation.businessEffectId),
    ));
    if (observation.externalId) await db.update(externalRefs).set({
      lastEffectId: observation.businessEffectId,
      updatedAt: new Date(),
    }).where(and(
      eq(externalRefs.tenantId, observation.tenantId),
      eq(externalRefs.integrationId, observation.integrationId),
      eq(externalRefs.externalObjectType, observation.externalObjectType),
      eq(externalRefs.externalId, observation.externalId),
    ));

    if (terminal === "present") {
      await db.update(reconciliationCases).set({
        status: "resolved",
        resolution: { classification: terminal, observedAt: checkedAt.toISOString() },
        resolvedAt: new Date(),
      }).where(and(
        eq(reconciliationCases.tenantId, observation.tenantId),
        eq(reconciliationCases.businessEffectId, observation.businessEffectId),
        eq(reconciliationCases.status, "open"),
      ));
    } else if (terminal === "divergent" || terminal === "unknown") {
      const [open] = await db.select({ id: reconciliationCases.id }).from(reconciliationCases).where(and(
        eq(reconciliationCases.tenantId, observation.tenantId),
        eq(reconciliationCases.businessEffectId, observation.businessEffectId),
        eq(reconciliationCases.status, "open"),
      )).limit(1);
      if (!open) await db.insert(reconciliationCases).values({
        tenantId: observation.tenantId,
        caseType: terminal === "divergent" ? "external_drift" : "unknown_delivery",
        businessEffectId: observation.businessEffectId,
        integrationId: observation.integrationId,
        classification: terminal === "divergent" ? "effect_after_state_mismatch" : "observation_inconclusive",
        authoritativeSide: "external",
        details: { observation },
      });
    }
    return db.select({
      id: workflowSteps.id,
      runId: workflowSteps.workflowRunId,
      status: workflowSteps.status,
    }).from(workflowSteps).where(and(
      eq(workflowSteps.tenantId, observation.tenantId),
      eq(workflowSteps.businessEffectId, observation.businessEffectId),
    ));
  });

  for (const step of steps) {
    if (step.status !== "waiting_observation" && step.status !== "leased") continue;
    if (terminal === "present") {
      await completeStep(observation.tenantId, step.id, { observation, verification });
    } else {
      await withTenant(observation.tenantId, (db) => db.update(workflowSteps).set({
        executionState: terminal === "absent" ? "failed_after_possible_effect" : "reconciling",
        updatedAt: new Date(),
      }).where(and(eq(workflowSteps.tenantId, observation.tenantId), eq(workflowSteps.id, step.id))));
      await failStep(
        observation.tenantId,
        step.id,
        verification.basis,
        terminal === "divergent" ? "conflict" : terminal === "unknown" ? "unknown_outcome" : "retryable",
      );
    }
    await advanceWorkflow(observation.tenantId, step.runId);
  }

  await ingestIntegrationEvent({
    tenantId: observation.tenantId,
    source: String(observation.provider),
    provider: String(observation.provider),
    sourceEventId: refs.providerEventId ?? `effect-observation:${observation.businessEffectId}:${observation.observedAt}`,
    eventType: `effect.${terminal}`,
    occurredAt: checkedAt,
    domainActionId: loaded.effectActionId,
    applicationRef: observation.integrationId,
    correlationId: observation.businessEffectId,
    payload: { businessEffectId: observation.businessEffectId, classification: terminal, externalObjectType: observation.externalObjectType },
    evidenceRefs: observation.externalId ? [{ kind: "provider_object", ref: observation.externalId }] : [],
    trustClass: "trusted_runtime",
  }).catch(() => undefined);
  if (loaded.actionWorkId) await reconcileWorkStatus(observation.tenantId, loaded.actionWorkId);
  await resumeObjectiveForAction(observation.tenantId, loaded.effectActionId).catch(() => false);
}
