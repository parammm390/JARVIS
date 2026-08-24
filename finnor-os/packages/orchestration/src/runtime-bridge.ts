// Universal durable decision boundary. Consequential plugin execution is authorized
// here, but never performed here: final approval/policy authorization and the first
// executable workflow job are committed in one database transaction. Pure reads keep
// their synchronous path and therefore do not pay queue latency.

import { withTenant, domainActions, actionLog, businessEffects, type Db } from "@finnor/db";
import { submitCommand } from "@finnor/workflow-runtime";
import { and, eq, inArray, or } from "drizzle-orm";
import type { BusinessEffectSet, DraftAction, ExecutionResult, ErrorKind } from "@finnor/shared-types";
import type { ToolRegistry } from "@finnor/tools";
import type { DomainEnginePlugin } from "@finnor/plugins-shared";

export interface ExecutePluginViaRuntimeParams {
  tenantId: string;
  actionId: string;
  actionType: string;
  correlationId?: string;
  draft: DraftAction;
  plugin: DomainEnginePlugin;
  tools: ToolRegistry;
}

export interface DurableActionAuthorization {
  commandId: string;
  workflowRunId: string;
  workflowStepId: string;
  alreadyExisted: boolean;
}

export interface AuthorizeActionExecutionTxParams {
  tenantId: string;
  actionId: string;
  approvedBy?: string;
  authorityDecisionId?: string;
  authorityRevision?: number;
  authorizationSource: "human_approval" | "policy";
}

export function classifyExecutionFailure(result: ExecutionResult): { reason: string; errorKind: ErrorKind } {
  if (result.errorKind) return { reason: result.error ?? "execution failed", errorKind: result.errorKind };
  if (result.status === "integration_unavailable") {
    return { reason: result.error ?? "integration unavailable", errorKind: "provider_down" };
  }
  if (result.status === "not_implemented") {
    return { reason: result.error ?? "action not implemented", errorKind: "terminal" };
  }
  return { reason: result.error ?? "execution failed", errorKind: "terminal" };
}

/** Runs inside the caller's transaction. This is the atomic seam used by decide()
 * after its conditional final-approval winner and by the policy-authorized path.
 * Repeated/concurrent calls converge on the command's EffectSet-derived key. */
export async function authorizeActionExecutionTx(
  db: Db,
  params: AuthorizeActionExecutionTxParams,
): Promise<DurableActionAuthorization> {
  const [loaded] = await db
    .select({ action: domainActions, effect: businessEffects })
    .from(domainActions)
    .innerJoin(businessEffects, and(
      eq(businessEffects.tenantId, params.tenantId),
      eq(businessEffects.id, domainActions.businessEffectId),
    ))
    .where(and(eq(domainActions.tenantId, params.tenantId), eq(domainActions.id, params.actionId)))
    .limit(1);
  if (!loaded) throw new Error("Durable execution refused: the action has no tenant-scoped Business Effect");

  const effect = loaded.effect.effect as BusinessEffectSet;
  if (effect.id !== loaded.effect.id || effect.semanticHash !== loaded.effect.semanticHash
      || effect.source.domainActionId !== loaded.action.id || effect.source.actionType !== loaded.action.actionType) {
    throw new Error("Durable execution refused: Business Effect identity does not match the action");
  }
  if (!["compiled", "authorized", "executing"].includes(loaded.effect.status)) {
    throw new Error(`Durable execution refused: Business Effect is ${loaded.effect.status}`);
  }
  const authorityDecisionId = params.authorityDecisionId ?? loaded.action.authorityDecisionId ?? undefined;
  const authorityRevision = params.authorityRevision ?? loaded.action.authorityRevision ?? undefined;

  if (params.authorizationSource === "policy") {
    await db.insert(actionLog).values({
      tenantId: params.tenantId,
      domainActionId: params.actionId,
      step: "policy_ungated_authorized",
      input: { policyId: effect.authority.policyId, policyVersion: effect.authority.policyVersion },
      output: { businessEffectId: effect.id, authorizedEffectHash: effect.semanticHash },
    });
  } else {
    const [approval] = await db.select({ id: actionLog.id, output: actionLog.output }).from(actionLog).where(and(
      eq(actionLog.tenantId, params.tenantId),
      eq(actionLog.domainActionId, params.actionId),
      eq(actionLog.step, "confirmed"),
    )).limit(1);
    const output = approval?.output && typeof approval.output === "object" ? approval.output as Record<string, unknown> : {};
    if (!approval || output.businessEffectId !== effect.id || output.authorizedEffectHash !== effect.semanticHash) {
      throw new Error("Durable execution refused: final approval did not authorize this exact Business Effect");
    }
  }

  await db.update(businessEffects).set({ status: "authorized", authorizedAt: new Date() })
    .where(and(eq(businessEffects.tenantId, params.tenantId), eq(businessEffects.id, effect.id), eq(businessEffects.status, "compiled")));

  const submitted = await submitCommand(db, {
    tenantId: params.tenantId,
    commandType: loaded.action.actionType,
    // Only governed references are needed here. The worker executes effect.delta,
    // never mutable DomainAction/planner payload stored after authorization.
    payload: { domainActionId: loaded.action.id, businessEffectId: effect.id, businessEffectHash: effect.semanticHash },
    workflowType: "single_action",
    steps: [{
      stepType: "execute_authorized_effect",
      payload: { domainActionId: loaded.action.id, businessEffectId: effect.id, businessEffectHash: effect.semanticHash },
    }],
    idempotencyKey: `business-effect:${effect.id}:${effect.semanticHash}`,
    requestedBy: params.approvedBy,
    correlationId: undefined,
    domainActionId: loaded.action.id,
    businessEffectId: effect.id,
    authorizedEffectHash: effect.semanticHash,
    authorityDecisionId,
    authorityRevision,
    policyId: effect.authority.policyId ?? undefined,
    policyVersion: effect.authority.policyVersion ?? undefined,
    executionClass: effect.operation.class,
    authorizedAt: new Date(),
    workId: loaded.action.workId ?? undefined,
  });
  if (!submitted.workflowRunId || !submitted.stepIds[0]) {
    throw new Error("Durable execution refused: command exists without a runnable step");
  }

  const [claimedAction] = await db.update(domainActions).set({ status: "executing", executionStartedAt: new Date() })
    .where(and(
      eq(domainActions.tenantId, params.tenantId),
      eq(domainActions.id, params.actionId),
      inArray(domainActions.status, params.authorizationSource === "human_approval" ? ["approved", "executing"] : ["draft", "approved", "executing"]),
    )).returning({ id: domainActions.id });
  if (!claimedAction) throw new Error("Durable execution refused: action is no longer executable");

  await db.insert(actionLog).values({
    tenantId: params.tenantId,
    domainActionId: params.actionId,
    step: "execution_authorized",
    input: {
      source: params.authorizationSource,
      approvedBy: params.approvedBy ?? null,
      authorityDecisionId: authorityDecisionId ?? null,
      authorityRevision: authorityRevision ?? null,
    },
    output: {
      businessEffectId: effect.id,
      authorizedEffectHash: effect.semanticHash,
      commandId: submitted.commandId,
      workflowRunId: submitted.workflowRunId,
      workflowStepId: submitted.stepIds[0],
      queued: true,
    },
  });
  return {
    commandId: submitted.commandId,
    workflowRunId: submitted.workflowRunId,
    workflowStepId: submitted.stepIds[0],
    alreadyExisted: submitted.alreadyExisted,
  };
}

export async function authorizeActionExecution(params: AuthorizeActionExecutionTxParams): Promise<DurableActionAuthorization> {
  return withTenant(params.tenantId, (db) => authorizeActionExecutionTx(db, params));
}

/** Executor compatibility seam. A consequential draft returns durable queued truth;
 * a deterministic read executes synchronously and never creates mutation work. */
export async function executePluginViaRuntime(params: ExecutePluginViaRuntimeParams): Promise<ExecutionResult> {
  if (params.draft.businessEffect) {
    const authorized = await authorizeActionExecution({
      tenantId: params.tenantId,
      actionId: params.actionId,
      approvedBy: params.draft.approvedBy,
      authorizationSource: params.draft.approvedBy ? "human_approval" : "policy",
    });
    return {
      status: "success",
      output: {
        authorized: true,
        durable: true,
        queued: true,
        durableWorkerExecution: true,
        businessEffectId: params.draft.businessEffect.id,
        ...authorized,
      },
      expected: { durableWorkerExecution: true },
    };
  }

  const authorized = await withTenant(params.tenantId, async (db) => {
    const [action] = await db.select({ status: domainActions.status }).from(domainActions)
      .where(and(eq(domainActions.id, params.actionId), eq(domainActions.tenantId, params.tenantId))).limit(1);
    if (action?.status !== "executing") return false;
    const [authorization] = await db.select({ id: actionLog.id }).from(actionLog).where(and(
      eq(actionLog.domainActionId, params.actionId),
      eq(actionLog.tenantId, params.tenantId),
      or(eq(actionLog.step, "confirmed"), eq(actionLog.step, "policy_ungated_authorized")),
    )).limit(1);
    return Boolean(authorization);
  });
  if (!authorized) {
    return { status: "failure", output: {}, error: "Execution refused: action lacks an audited authorization." };
  }
  try {
    return await params.plugin.execute(params.draft, params.tools);
  } catch (error) {
    return {
      status: "failure",
      output: {},
      error: error instanceof Error ? error.message : "execution failed",
      errorKind: (error as { kind?: ErrorKind })?.kind,
    };
  }
}
