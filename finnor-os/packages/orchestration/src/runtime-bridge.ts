// Phase 2 (§2.5, "the great rewiring"): the ONE place a plugin's execute() is invoked
// through @finnor/workflow-runtime instead of being called bare. Shared by both engines
// (GatedExecutor in executor.ts and the LangGraph mirror in graph/nodes.ts) so the
// runtime-tracking logic itself is written and tested once, not duplicated.
//
// Why synchronous, not the async job-queue path the 4 existing workflow-kind action
// types use: those action types' callers (submitCommand + enqueueStep, result returned
// before the step ever runs) can tolerate "the real effect happens later" because
// nothing downstream needs an immediate answer. Every other action type's caller
// (POST /actions/:id/confirm, the Vapi voice-confirmation flow that must speak a real
// result back to the caller in the same turn) needs plugin.execute()'s REAL result in
// THIS request. So this bridge still creates the command/run/step rows via
// submitCommand (and — because claimStep/completeStep/failStep already open/finalize a
// DecisionReceipt as of §2.4 — a receipt on every action, per the exit gate), but calls
// the plugin's execute() in-process instead of via enqueueStep and the async worker,
// and returns its real ExecutionResult unchanged. Existing callers see identical
// behavior; the runtime just gains a durable record of what ran.

import { withTenant } from "@finnor/db";
import { submitCommand, claimStep, completeStep, failStep } from "@finnor/workflow-runtime";
import type { DraftAction, ExecutionResult } from "@finnor/shared-types";
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

/** Maps a plugin's ExecutionResult onto the workflow_step's terminal outcome + the
 *  errorKind its DecisionReceipt failure carries. Only "success" is a real completion —
 *  "not_implemented" and "integration_unavailable" are still real failures from the
 *  runtime's point of view (the effect did not happen), just with a more specific,
 *  honest reason than a plain unclassified error. */
function classifyFailure(result: ExecutionResult): { reason: string; errorKind: "provider_down" | "terminal" } {
  if (result.status === "integration_unavailable") {
    return { reason: result.error ?? "integration unavailable", errorKind: "provider_down" };
  }
  if (result.status === "not_implemented") {
    return { reason: result.error ?? "action not implemented", errorKind: "terminal" };
  }
  return { reason: result.error ?? "execution failed", errorKind: "terminal" };
}

export async function executePluginViaRuntime(params: ExecutePluginViaRuntimeParams): Promise<ExecutionResult> {
  // Deliberately NO command-level idempotencyKey here (unlike lead-to-water-test's
  // `lead-to-water-test:${householdId}:${scheduledAt}` and the other 3 workflow-kind
  // plugins). Those dedupe because their caller might legitimately be invoked twice for
  // the SAME logical request (a retried webhook, a duplicate-delivered job) and starting
  // the workflow twice would be wrong. GatedExecutor is different: reflectWithRetry()
  // (packages/orchestration/src/index.ts) deliberately calls executor.execute() a SECOND
  // time on the same action after a classified transient failure (§9's "retry once,
  // escalate after that") — that second call is a genuinely new attempt that MUST
  // actually re-run the plugin, not be swallowed as "already ran". A test proved this
  // the hard way: an action-scoped idempotency key here silently ate the reflection
  // retry. Real exactly-once protection against double-firing an external side effect
  // already lives one level deeper, inside plugin.execute() itself, via
  // ScopedToolRegistry/external_operations keyed by each tool call's own business-derived
  // idempotency key (e.g. invoiceId, not domainActionId) — that layer is unchanged by
  // this bridge. So every call here is honestly recorded as its own command/step/receipt:
  // one receipt per real attempt, not one receipt straining to cover several.
  const submitted = await withTenant(params.tenantId, (db) =>
    submitCommand(db, {
      tenantId: params.tenantId,
      commandType: params.actionType,
      payload: params.draft.payload,
      workflowType: "single_action",
      correlationId: params.correlationId,
      // §3.6: real bug found while building Phase 3's e2e proof test — requestedBy was
      // never threaded from the confirm route through to here, so DecisionReceipt.
      // approval.approvedBy (openReceiptForFirstClaim, workflow-runtime/src/steps.ts)
      // silently came back undefined for every single-action execution, including the
      // majority of the 42 action types (everything not on the LangGraph allowlist —
      // see graph/allowlist-executor.ts). Known remaining gap, not fixed here: the 4
      // graph-routed workflow-kind action types resume from a LangGraph checkpoint
      // (graph/executor.ts's `isPausedHere` branch) rather than a fresh invoke, so
      // injecting approvedBy there needs a `this.graph.updateState(...)` call before
      // resume — a separate, larger change, tracked in docs/phase-status.md.
      requestedBy: params.draft.approvedBy,
      domainActionId: params.actionId,
      steps: [{ stepType: params.actionType, payload: params.draft.payload }],
    }),
  );
  const stepId = submitted.stepIds[0]!;

  const claimed = await claimStep(params.tenantId, stepId);
  if (!claimed) {
    // Should not be reachable — submitCommand just inserted this exact step as
    // brand-new/pending with no idempotency key to collide on, so nothing else could
    // have claimed it first. Kept as a defensive guard (matching claimStep's own
    // generic "duplicate job delivery safe" contract) rather than a bare assertion.
    return { status: "failure", output: {}, error: "Failed to claim the newly created execution step — this should not happen." };
  }

  let result: ExecutionResult;
  try {
    result = await params.plugin.execute(params.draft, params.tools);
  } catch (err) {
    result = { status: "failure", output: {}, error: (err as Error).message };
  }

  if (result.status === "success") {
    await completeStep(params.tenantId, stepId, { status: result.status, output: result.output, expected: result.expected ?? null });
  } else {
    const { reason, errorKind } = classifyFailure(result);
    await failStep(params.tenantId, stepId, reason, errorKind);
  }

  return result;
}
