// Graph nodes — each one mirrors a step of GatedExecutor.execute() exactly, calling
// the SAME unchanged plugin validate/draft/execute methods and the SAME unchanged
// appendEpisode/advanceWorkflowForAction/voice helpers. LangGraph is the engine
// driving these; the plugins and their contract never change.

import { interrupt } from "@langchain/langgraph";
import { withTenant, domainActions, enqueueJob } from "@finnor/db";
import { appendEpisode } from "@finnor/memory";
import { eq, and } from "drizzle-orm";
import type { DomainAction, ExecutionResult } from "@finnor/shared-types";
import { ScopedToolRegistry, type ToolRegistry } from "@finnor/tools";
import type { PluginRegistry } from "../plugin-registry";
import { diagnoseFailure, buildConfirmationScript } from "../voice";
import { advanceWorkflowForAction } from "../workflow";
import type { GateState } from "./state";

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
    await appendEpisode(state.tenantId, state.actionId, "draft", {}, { summary: draft.summary });
    return { draft };
  };
}

export function makeGateNode() {
  return async (state: GateState): Promise<Partial<GateState>> => {
    const needsGate = Boolean((state.policy.requiresConfirmation || state.draft!.requiresConfirmation) && !state.alreadyApproved);
    if (!needsGate) return {};
    await withTenant(state.tenantId, async (db) => {
      await db
        .update(domainActions)
        .set({ status: "pending", summary: state.draft!.summary, payload: state.draft!.payload })
        .where(and(eq(domainActions.id, state.actionId), eq(domainActions.tenantId, state.tenantId)));
    });
    await appendEpisode(state.tenantId, state.actionId, "gate", {}, { gated: true, summary: state.draft!.summary });
    if (process.env.VAPI_API_KEY) {
      await enqueueJob(
        "voice_confirm_request",
        { tenantId: state.tenantId, actionId: state.actionId, script: buildConfirmationScript(state.draft!.summary) },
        `voice-confirm:${state.actionId}`,
        state.correlationId,
      ).catch(() => undefined);
    }
    return {};
  };
}

// Re-derives the same boolean gate() computed — never trusts a stored flag, exactly
// matching GatedExecutor's own re-check pattern.
export function routeAfterGate(state: GateState): "pause" | "execute" {
  const needsGate = Boolean((state.policy.requiresConfirmation || state.draft!.requiresConfirmation) && !state.alreadyApproved);
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
    const plugin = plugins.resolve(state.actionType)!;
    await setStatus(state.tenantId, state.actionId, "executing");
    // Same idempotency scoping as the legacy GatedExecutor — see its comment.
    const scopedTools = new ScopedToolRegistry(tools, { tenantId: state.tenantId, domainActionId: state.actionId });
    let result: ExecutionResult;
    try {
      result = await plugin.execute(state.draft!, scopedTools);
    } catch (err) {
      result = { status: "failure", output: {}, error: (err as Error).message };
    }
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
    if (finalStatus === "blocked_integration_unavailable" && process.env.VAPI_API_KEY) {
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
        error: `This request is missing required details: ${(state.validation?.errors ?? []).join("; ")}`,
      },
    };
  };
}

export function makeRejectedNode() {
  return async (): Promise<Partial<GateState>> => ({ result: { status: "success", output: { rejected: true } } });
}
