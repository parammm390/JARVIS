// Executor (§9): enforces the confirmation gate — a security boundary, not UX (§28
// blueprint). If policy.requires_confirmation, the action is written as status=pending
// and NOTHING executes until POST /confirm flips it to approved. No tool call before
// the gate clears, on any path.

import type { DomainAction, DomainPolicy, ExecutionResult } from "@finnor/shared-types";
import { withTenant, domainActions, enqueueJob, reconcileWorkStatus, transitionWork } from "@finnor/db";
import { appendEpisode } from "@finnor/memory";
import { eq, and } from "drizzle-orm";
import { ScopedToolRegistry, tenantProviderConfigured, type ToolRegistry } from "@finnor/tools";
import type { PluginRegistry } from "./plugin-registry";
import { diagnoseFailure, buildConfirmationScript } from "./voice";
import { advanceWorkflowForAction } from "./workflow";
import { executePluginViaRuntime } from "./runtime-bridge";
import { approvalRequirementForAction } from "../../../scripts/release/action-hardening-spec";
import { evaluateActionAuthorityBoundary } from "./authority-runtime";

export interface Executor {
  execute(action: DomainAction, policy: DomainPolicy): Promise<ExecutionResult>;
  /** Optional: best-effort cleanup on reject (e.g. closing a paused graph thread). */
  close?(actionId: string, tenantId: string, actionType: string): Promise<void>;
}

export class GatedExecutor implements Executor {
  constructor(
    private plugins: PluginRegistry,
    private tools: ToolRegistry,
  ) {}

  async execute(action: DomainAction, policy: DomainPolicy): Promise<ExecutionResult> {
    const plugin = this.plugins.resolve(action.actionType);
    if (!plugin) {
      return { status: "failure", output: {}, error: `No plugin handles ${action.actionType}` };
    }

    const validation = plugin.validate(action.actionType, action.payload, policy);
    await appendEpisode(action.tenantId, action.id, "validate", { payload: action.payload }, { ...validation });
    if (!validation.valid) {
      await this.setStatus(action, "failed");
      return {
        status: "failure",
        output: {},
        error: `This request is missing required details: ${validation.errors.join("; ")}`,
      };
    }

    let draft = await plugin.draft(action.actionType, action.payload, policy);
    draft.correlationId = action.correlationId;
    draft.approvedBy = action.approvedBy;
    draft.domainActionId = action.id;
    if (plugin.prepareDurableOperation) {
      draft = await plugin.prepareDurableOperation(draft, action, policy);
      // Hooks return a draft so they can add the durable operation id. Re-stamp the
      // immutable executor context in case an implementation rebuilt the object.
      draft.correlationId = action.correlationId;
      draft.approvedBy = action.approvedBy;
      draft.domainActionId = action.id;
    }
    await appendEpisode(action.tenantId, action.id, "draft", {}, { summary: draft.summary });

    const approval = approvalRequirementForAction(action.actionType, policy.requiresConfirmation, draft.requiresConfirmation);
    const authority = await evaluateActionAuthorityBoundary(action, policy, draft);
    if (authority.decision.outcome === "denied" || ((action.status === "approved" || action.status === "executing") && authority.decision.outcome !== "allowed")) {
      await this.setStatus(action, "failed");
      await appendEpisode(action.tenantId, action.id, "authority_denied", { capability: authority.request.capability }, {
        decisionId: authority.decision.id,
        revision: authority.decision.authorityRevision,
        reasonCode: authority.decision.reasonCode,
      });
      return { status: "failure", output: { authorityDecisionId: authority.decision.id }, error: `Authority denied: ${authority.decision.reasonCode}` };
    }
    const requiresAuthorityGate = authority.decision.outcome === "approval_required";

    // ---------------- THE CONFIRMATION GATE ----------------
    // The fixed release floor is authoritative: a plugin draft cannot lower a
    // required floor or turn a no-side-effect action into an approval item.
    if ((approval.requiresConfirmation || requiresAuthorityGate) && action.status !== "approved" && action.status !== "executing") {
      await withTenant(action.tenantId, async (db) => {
        await db
          .update(domainActions)
          .set({ status: "pending", summary: draft.summary, payload: draft.payload })
          .where(and(eq(domainActions.id, action.id), eq(domainActions.tenantId, action.tenantId)));
      });
      await appendEpisode(action.tenantId, action.id, "gate", {}, { gated: true, summary: draft.summary });
      await enqueueJob(
        "send_push_notification",
        { tenantId: action.tenantId, kind: "approval-needed", actionId: action.id, body: draft.summary },
        `push:approval-needed:${action.id}`,
        action.correlationId,
      ).catch(() => undefined); // a push is a nudge, never the gate itself
      // Voice-native confirmation: if Vapi is configured, have it read the draft to the
      // owner and capture the spoken yes/no. The queue UI remains the audit/fallback view.
      if (await tenantProviderConfigured(action.tenantId, "vapi")) {
        await enqueueJob(
          "voice_confirm_request",
          { tenantId: action.tenantId, actionId: action.id, script: buildConfirmationScript(draft.summary) },
          `voice-confirm:${action.id}`,
          action.correlationId,
        ).catch(() => undefined); // queue trouble must never break the gate itself
      }
      // Stop here. Execution resumes only via POST /actions/:id/confirm or a spoken yes.
      return {
        status: "success",
        output: { gated: true, pendingConfirmation: true, summary: draft.summary },
      };
    }
    // --------------------------------------------------------

    // A policy may deliberately permit a read-only action without a human
    // confirmation. Record that authorization immutably before claiming it so the
    // runtime bridge can distinguish this legitimate path from a forged SQL status.
    // Confirmation-required actions instead carry the `confirmed` episode written
    // by decide(), which the bridge validates independently.
    if (!approval.requiresConfirmation && !requiresAuthorityGate) {
      await appendEpisode(action.tenantId, action.id, "policy_ungated_authorized", { policyId: policy.id ?? null }, {
        actionType: action.actionType,
        approvalFloor: approval.approvalFloor,
        reason: "fixed action floor does not require confirmation",
      });
    }
    await this.setStatus(action, "executing");
    // Scoped per action execution: claims each external tool call against the
    // external_operations ledger so a reflection retry never re-fires an
    // already-completed side effect (send an SMS twice, double-sync an invoice).
    const scopedTools = new ScopedToolRegistry(this.tools, { tenantId: action.tenantId, domainActionId: action.id });
    // §2.5: routes through @finnor/workflow-runtime (command/step + DecisionReceipt)
    // instead of calling plugin.execute() bare — same real result, now with a durable
    // record. See runtime-bridge.ts's header comment for why this is synchronous.
    const result = await executePluginViaRuntime({
      tenantId: action.tenantId,
      actionId: action.id,
      actionType: action.actionType,
      correlationId: action.correlationId,
      draft,
      plugin,
      tools: scopedTools,
    });
    await appendEpisode(action.tenantId, action.id, "execute", { draft: draft.payload }, { ...result });

    const finalStatus =
      result.status === "success"
        ? "completed"
        : result.status === "integration_unavailable"
          ? "blocked_integration_unavailable"
          : "failed";
    await this.setStatus(action, finalStatus);
    if (finalStatus === "completed") {
      // Advance the relevant workflow state machine (§14) — state lives in the DB.
      const advanced = await advanceWorkflowForAction(
        action.tenantId,
        action.actionType,
        (draft.payload ?? action.payload) as Record<string, unknown>,
      ).catch(() => []);
      if (advanced.length > 0) {
        await appendEpisode(action.tenantId, action.id, "workflow", {}, { advanced });
      }
    }
    if (finalStatus === "blocked_integration_unavailable" && await tenantProviderConfigured(action.tenantId, "vapi")) {
      // Spoken failure diagnosis: name the failing integration out loud, in addition to
      // the audit entry and the blocked queue card. Never instead of them.
      await enqueueJob(
        "voice_notify_failure",
        { tenantId: action.tenantId, actionId: action.id, script: diagnoseFailure(result.error, action.actionType) },
        `voice-fail:${action.id}`,
        action.correlationId,
      ).catch(() => undefined);
    }
    return result;
  }

  private async setStatus(action: DomainAction, status: DomainAction["status"]): Promise<void> {
    await withTenant(action.tenantId, async (db) => {
      await db
        .update(domainActions)
        .set({
          status,
          ...(status === "executing" ? { executionStartedAt: new Date() } : {}),
          ...(status === "completed" || status === "failed" || status === "blocked_integration_unavailable" ? { executionStartedAt: null } : {}),
        })
        .where(and(eq(domainActions.id, action.id), eq(domainActions.tenantId, action.tenantId)));
    });
    if (action.workId) {
      if (status === "executing") {
        await transitionWork(action.tenantId, action.workId, "executing", "action_execution_started", { actionId: action.id });
      } else {
        await reconcileWorkStatus(action.tenantId, action.workId);
      }
    }
  }
}
