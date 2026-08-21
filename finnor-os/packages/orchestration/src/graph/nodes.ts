// Graph nodes — each one mirrors a step of GatedExecutor.execute() exactly, calling
// the SAME unchanged plugin validate/draft/execute methods and the SAME unchanged
// appendEpisode/advanceWorkflowForAction/voice helpers. LangGraph is the engine
// driving these; the plugins and their contract never change.

import { interrupt } from "@langchain/langgraph";
import { withTenant, domainActions, enqueueJob } from "@finnor/db";
import { appendEpisode } from "@finnor/memory";
import { eq, and } from "drizzle-orm";
import type { DomainAction } from "@finnor/shared-types";
import { ScopedToolRegistry, tenantProviderConfigured, type ToolRegistry } from "@finnor/tools";
import type { PluginRegistry } from "../plugin-registry";
import { diagnoseFailure, buildConfirmationScript } from "../voice";
import { advanceWorkflowForAction } from "../workflow";
import { executePluginViaRuntime } from "../runtime-bridge";
import type { GateState } from "./state";
import { evaluateActionAuthorityBoundary } from "../authority-runtime";
import { revalidateActionExecution } from "@finnor/authority";

async function setStatus(tenantId: string, actionId: string, status: DomainAction["status"]): Promise<void> {
  await withTenant(tenantId, async (db) => {
    await db
      .update(domainActions)
      .set({
        status,
        ...(status === "executing" ? { executionStartedAt: new Date() } : {}),
        ...(status === "completed" || status === "failed" || status === "blocked_integration_unavailable" ? { executionStartedAt: null } : {}),
      })
      .where(and(eq(domainActions.id, actionId), eq(domainActions.tenantId, tenantId)));
  });
}

export function makeValidateNode(plugins: PluginRegistry) {
  return async (state: GateState): Promise<Partial<GateState>> => {
    const plugin = plugins.resolve(state.actionType);
    const validation = plugin
      ? plugin.validate(state.actionType, state.payload, state.policy)
      : { valid: false, errors: [`No plugin handles ${state.actionType}`] };
    await appendEpisode(state.tenantId, state.actionId, "validate", { payload: state.payload }, { ...validation });
    return { validation };
  };
}

export function routeAfterValidate(state: GateState): "draft" | "failed" {
  return state.validation?.valid ? "draft" : "failed";
}

export function makeDraftNode(plugins: PluginRegistry) {
  return async (state: GateState): Promise<Partial<GateState>> => {
    const plugin = plugins.resolve(state.actionType)!;
    const draft = await plugin.draft(state.actionType, state.payload, state.policy);
    draft.correlationId = state.correlationId;
    draft.domainActionId = state.actionId;
    await appendEpisode(state.tenantId, state.actionId, "draft", {}, { summary: draft.summary });
    return { draft };
  };
}

export function makeGateNode() {
  return async (state: GateState): Promise<Partial<GateState>> => {
    const authority = await evaluateActionAuthorityBoundary({
      id: state.actionId,
      tenantId: state.tenantId,
      actionType: state.actionType,
      payload: state.payload,
      policyId: state.policy.id,
      policyVersion: state.policy.version,
      status: state.alreadyApproved ? "approved" : "draft",
      createdAt: new Date().toISOString(),
      initiatedBy: state.initiatedBy ?? null,
    }, state.policy, state.draft!);
    if (authority.decision.outcome === "denied") return {
      authorityOutcome: "denied",
      authorityDecisionId: authority.decision.id,
      authorityReasonCode: authority.decision.reasonCode,
    };
    const needsGate = Boolean((state.policy.requiresConfirmation || state.draft!.requiresConfirmation || authority.decision.outcome === "approval_required") && !state.alreadyApproved);
    if (!needsGate) return { authorityOutcome: authority.decision.outcome, authorityDecisionId: authority.decision.id, authorityReasonCode: authority.decision.reasonCode };
    await withTenant(state.tenantId, async (db) => {
      await db
        .update(domainActions)
        .set({ status: "pending", summary: state.draft!.summary, payload: state.draft!.payload })
        .where(and(eq(domainActions.id, state.actionId), eq(domainActions.tenantId, state.tenantId)));
    });
    await appendEpisode(state.tenantId, state.actionId, "gate", {}, { gated: true, summary: state.draft!.summary });
    await enqueueJob(
      "send_push_notification",
      { tenantId: state.tenantId, kind: "approval-needed", actionId: state.actionId, body: state.draft!.summary },
      `push:approval-needed:${state.actionId}`,
      state.correlationId,
    ).catch(() => undefined);
    if (await tenantProviderConfigured(state.tenantId, "vapi")) {
      await enqueueJob(
        "voice_confirm_request",
        { tenantId: state.tenantId, actionId: state.actionId, script: buildConfirmationScript(state.draft!.summary) },
        `voice-confirm:${state.actionId}`,
        state.correlationId,
      ).catch(() => undefined);
    }
    return { authorityOutcome: authority.decision.outcome, authorityDecisionId: authority.decision.id, authorityReasonCode: authority.decision.reasonCode };
  };
}

// Re-derives the same boolean gate() computed — never trusts a stored flag, exactly
// matching GatedExecutor's own re-check pattern.
export function routeAfterGate(state: GateState): "pause" | "execute" | "failed" {
  if (state.authorityOutcome === "denied") return "failed";
  const needsGate = Boolean((state.policy.requiresConfirmation || state.draft!.requiresConfirmation || state.authorityOutcome === "approval_required") && !state.alreadyApproved);
  return needsGate ? "pause" : "execute";
}

// The ONLY node that calls interrupt(). No side effects before or after it — LangGraph
// re-runs an interrupted node's entire body from the top on resume, so anything with a
// side effect here would double-fire.
export function pauseNode(_state: GateState): Partial<GateState> {
  const decision = interrupt({ awaitingApproval: true }) as "approve" | "reject";
  return { decision };
}

export function routeAfterPause(state: GateState): "execute" | "rejected" {
  return state.decision === "approve" ? "execute" : "rejected";
}

export function makeExecuteNode(plugins: PluginRegistry, tools: ToolRegistry) {
  return async (state: GateState): Promise<Partial<GateState>> => {
    const freshAuthority = await revalidateActionExecution(state.tenantId, state.actionId);
    if (freshAuthority.outcome !== "allowed") {
      await setStatus(state.tenantId, state.actionId, "failed");
      return { result: { status: "failure", output: { authorityDecisionId: freshAuthority.id }, error: `Authority denied before execution: ${freshAuthority.reasonCode}` } };
    }
    const plugin = plugins.resolve(state.actionType)!;
    await setStatus(state.tenantId, state.actionId, "executing");
    // Same idempotency scoping as the legacy GatedExecutor — see its comment.
    const identityRef = state.draft!.payload.communicationIdentityRef && typeof state.draft!.payload.communicationIdentityRef === "object"
      ? state.draft!.payload.communicationIdentityRef as Record<string, unknown>
      : null;
    const requestedCommunicationIdentityId = typeof state.draft!.payload.communicationIdentityId === "string"
      ? state.draft!.payload.communicationIdentityId
      : typeof identityRef?.communicationIdentityId === "string" ? identityRef.communicationIdentityId : undefined;
    const requestedAuthProfileRef = typeof state.draft!.payload.authProfileRef === "string" ? state.draft!.payload.authProfileRef : undefined;
    const accessPurpose = typeof state.draft!.payload.purpose === "string" && state.draft!.payload.purpose.trim()
      ? state.draft!.payload.purpose
      : state.actionType;
    const scopedTools = new ScopedToolRegistry(tools, {
      tenantId: state.tenantId,
      domainActionId: state.actionId,
      actorId: state.initiatedBy ?? "system:orchestration",
      purpose: accessPurpose,
      ...(requestedCommunicationIdentityId ? { communicationIdentityId: requestedCommunicationIdentityId } : {}),
      ...(requestedAuthProfileRef ? { authProfileRef: requestedAuthProfileRef } : {}),
    });
    // §2.5: same runtime bridge as the legacy GatedExecutor — see its comment.
    const result = await executePluginViaRuntime({
      tenantId: state.tenantId,
      actionId: state.actionId,
      actionType: state.actionType,
      correlationId: state.correlationId,
      draft: state.draft!,
      plugin,
      tools: scopedTools,
    });
    await appendEpisode(state.tenantId, state.actionId, "execute", { draft: state.draft!.payload }, { ...result });

    const finalStatus =
      result.status === "success" ? "completed" : result.status === "integration_unavailable" ? "blocked_integration_unavailable" : "failed";
    await setStatus(state.tenantId, state.actionId, finalStatus);

    if (finalStatus === "completed") {
      const advanced = await advanceWorkflowForAction(state.tenantId, state.actionType, state.draft!.payload).catch(() => []);
      if (advanced.length > 0) {
        await appendEpisode(state.tenantId, state.actionId, "workflow", {}, { advanced });
      }
    }
    if (finalStatus === "blocked_integration_unavailable" && await tenantProviderConfigured(state.tenantId, "vapi")) {
      await enqueueJob(
        "voice_notify_failure",
        { tenantId: state.tenantId, actionId: state.actionId, script: diagnoseFailure(result.error, state.actionType) },
        `voice-fail:${state.actionId}`,
        state.correlationId,
      ).catch(() => undefined);
    }
    return { result };
  };
}

export function makeFailedNode() {
  return async (state: GateState): Promise<Partial<GateState>> => {
    await setStatus(state.tenantId, state.actionId, "failed");
    return {
      result: {
        status: "failure",
        output: {},
        error: state.authorityOutcome === "denied"
          ? `Authority denied: ${state.authorityReasonCode ?? "not authorized"}`
          : `This request is missing required details: ${(state.validation?.errors ?? []).join("; ")}`,
      },
    };
  };
}

export function makeRejectedNode() {
  return async (): Promise<Partial<GateState>> => ({ result: { status: "success", output: { rejected: true } } });
}
