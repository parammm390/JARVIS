// Executor (§9): enforces the confirmation gate — a security boundary, not UX (§28
// blueprint). If policy.requires_confirmation, the action is written as status=pending
// and NOTHING executes until POST /confirm flips it to approved. No tool call before
// the gate clears, on any path.

import type { DomainAction, DomainPolicy, ExecutionResult } from "@finnor/shared-types";
import { withTenant, domainActions, enqueueJob } from "@finnor/db";
import { appendEpisode } from "@finnor/memory";
import { eq, and } from "drizzle-orm";
import type { ToolRegistry } from "@finnor/tools";
import type { PluginRegistry } from "./plugin-registry";
import { diagnoseFailure, buildConfirmationScript } from "./voice";
import { advanceWorkflowForAction } from "./workflow";

export interface Executor {
  execute(action: DomainAction, policy: DomainPolicy): Promise<ExecutionResult>;
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

    const draft = await plugin.draft(action.actionType, action.payload, policy);
    await appendEpisode(action.tenantId, action.id, "draft", {}, { summary: draft.summary });

    // ---------------- THE CONFIRMATION GATE ----------------
    // draft.requiresConfirmation can only tighten the gate (placeholder policies force it).
    if ((policy.requiresConfirmation || draft.requiresConfirmation) && action.status !== "approved") {
      await withTenant(action.tenantId, async (db) => {
        await db
          .update(domainActions)
          .set({ status: "pending", summary: draft.summary, payload: draft.payload })
          .where(and(eq(domainActions.id, action.id), eq(domainActions.tenantId, action.tenantId)));
      });
      await appendEpisode(action.tenantId, action.id, "gate", {}, { gated: true, summary: draft.summary });
      // Voice-native confirmation: if Vapi is configured, have it read the draft to the
      // owner and capture the spoken yes/no. The queue UI remains the audit/fallback view.
      if (process.env.VAPI_API_KEY) {
        await enqueueJob(
          "voice_confirm_request",
          { tenantId: action.tenantId, actionId: action.id, script: buildConfirmationScript(draft.summary) },
          `voice-confirm:${action.id}`,
        ).catch(() => undefined); // queue trouble must never break the gate itself
      }
      // Stop here. Execution resumes only via POST /actions/:id/confirm or a spoken yes.
      return {
        status: "success",
        output: { gated: true, pendingConfirmation: true, summary: draft.summary },
      };
    }
    // --------------------------------------------------------

    await this.setStatus(action, "executing");
    let result: ExecutionResult;
    try {
      result = await plugin.execute(draft, this.tools);
    } catch (err) {
      result = { status: "failure", output: {}, error: (err as Error).message };
    }
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
    if (finalStatus === "blocked_integration_unavailable" && process.env.VAPI_API_KEY) {
      // Spoken failure diagnosis: name the failing integration out loud, in addition to
      // the audit entry and the blocked queue card. Never instead of them.
      await enqueueJob(
        "voice_notify_failure",
        { tenantId: action.tenantId, actionId: action.id, script: diagnoseFailure(result.error, action.actionType) },
        `voice-fail:${action.id}`,
      ).catch(() => undefined);
    }
    return result;
  }

  private async setStatus(action: DomainAction, status: DomainAction["status"]): Promise<void> {
    await withTenant(action.tenantId, async (db) => {
      await db
        .update(domainActions)
        .set({ status })
        .where(and(eq(domainActions.id, action.id), eq(domainActions.tenantId, action.tenantId)));
    });
  }
}
