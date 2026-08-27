// Workflow engine implementation lives in domain-plugins/shared (plugins use it too;
// they must not import orchestration). Re-exported here for orchestration consumers.
export * from "../../domain-plugins/shared/workflow";

import { domainActions, withTenant } from "@finnor/db";
import { appendEpisode } from "@finnor/memory";
import { and, eq } from "drizzle-orm";
import { advanceWorkflowForAction } from "../../domain-plugins/shared/workflow";

export type RequiredWorkflowAdvancement =
  | { ok: true; advanced: Array<{ workflow: string; subjectId: string; toState: string }> }
  | { ok: false; error: string };

/** A successful domain effect must not be reported complete while its required
 * business workflow projection is stale. Preserve the known effect, flag the
 * action for reconciliation, and make the caller return a non-retryable result. */
export async function advanceWorkflowForActionRequired(params: {
  tenantId: string;
  actionId: string;
  actionType: string;
  payload: Record<string, unknown>;
}): Promise<RequiredWorkflowAdvancement> {
  try {
    return {
      ok: true,
      advanced: await advanceWorkflowForAction(params.tenantId, params.actionType, params.payload),
    };
  } catch (error) {
    const detail = error instanceof Error ? error.message : "unknown workflow advancement failure";
    await withTenant(params.tenantId, async (db) => {
      const updated = await db.update(domainActions).set({ status: "needs_human_review", executionStartedAt: null })
        .where(and(eq(domainActions.tenantId, params.tenantId), eq(domainActions.id, params.actionId)))
        .returning({ id: domainActions.id });
      if (updated.length !== 1) throw new Error("Unable to mark workflow advancement for reconciliation");
    });
    await appendEpisode(params.tenantId, params.actionId, "workflow_advancement_failed", {}, {
      actionType: params.actionType,
      effectSucceeded: true,
      workflowAdvancementRecorded: false,
      error: detail,
    });
    return { ok: false, error: detail };
  }
}
