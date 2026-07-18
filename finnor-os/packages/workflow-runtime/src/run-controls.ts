// Phase 2 (§2.7): run controls — pause/resume/cancel/retry/escalate. Each is a guarded
// state transition: an atomic UPDATE conditioned on both the expected `version`
// (optimistic concurrency — two concurrent control calls can't both believe they made
// the transition) and the allowed FROM status (an illegal transition, e.g. pausing an
// already-completed run, is rejected, never silently accepted). Every call opens its
// own DecisionReceipt (workflowStepId null — this is a run-level action, not a step
// execution) so "who paused this and when" is answerable the same way any other
// consequential action in this system is.

import { withTenant, workflowRuns, workflowSteps } from "@finnor/db";
import { and, eq, sql, inArray } from "drizzle-orm";
import { advanceWorkflow } from "./steps";
import { openReceipt, finalizeReceipt } from "./receipts";

export type RunControlVerb = "pause" | "resume" | "cancel" | "retry" | "escalate";

export type RunControlFailureReason = "not_found" | "version_conflict" | "illegal_transition";
export type RunControlResult =
  | { ok: true; run: typeof workflowRuns.$inferSelect }
  | { ok: false; reason: RunControlFailureReason };

type WorkflowRunStatus = (typeof workflowRuns.$inferSelect)["status"];

interface TransitionSpec {
  verb: RunControlVerb;
  fromStatuses: WorkflowRunStatus[];
  toStatus: WorkflowRunStatus;
}

const TRANSITIONS: Record<RunControlVerb, TransitionSpec> = {
  pause: { verb: "pause", fromStatuses: ["running"], toStatus: "paused" },
  resume: { verb: "resume", fromStatuses: ["paused"], toStatus: "running" },
  cancel: { verb: "cancel", fromStatuses: ["running", "paused"], toStatus: "cancelled" },
  retry: { verb: "retry", fromStatuses: ["failed"], toStatus: "running" },
  escalate: { verb: "escalate", fromStatuses: ["running", "failed"], toStatus: "escalated" },
};

async function applyTransition(
  tenantId: string,
  runId: string,
  expectedVersion: number,
  spec: TransitionSpec,
  requestedBy: string,
): Promise<RunControlResult> {
  const updated = await withTenant(tenantId, async (db) => {
    const [row] = await db
      .update(workflowRuns)
      .set({ status: spec.toStatus, version: sql`${workflowRuns.version} + 1`, updatedAt: new Date() })
      .where(
        and(
          eq(workflowRuns.id, runId),
          eq(workflowRuns.tenantId, tenantId),
          eq(workflowRuns.version, expectedVersion),
          inArray(workflowRuns.status, spec.fromStatuses),
        ),
      )
      .returning();
    return row ?? null;
  });

  if (!updated) {
    // Distinguish WHY the conditional update matched nothing — not found, a stale
    // version (someone else already transitioned it), or a from-status this verb
    // simply doesn't allow (e.g. pausing an already-completed run).
    const [current] = await withTenant(tenantId, (db) => db.select().from(workflowRuns).where(and(eq(workflowRuns.id, runId), eq(workflowRuns.tenantId, tenantId))));
    if (!current) return { ok: false, reason: "not_found" };
    if (current.version !== expectedVersion) return { ok: false, reason: "version_conflict" };
    return { ok: false, reason: "illegal_transition" };
  }

  await openReceipt({
    tenantId,
    workflowRunId: runId,
    objective: `${spec.verb} workflow run ${runId}`,
    evidence: [{ source: "workflow_runs", ref: runId, timestamp: new Date().toISOString() }],
    policyApplied: null,
    riskTier: "medium",
    proposedAction: { verb: spec.verb, fromStatuses: spec.fromStatuses, toStatus: spec.toStatus },
    approval: { required: true, approvedBy: requestedBy, at: new Date().toISOString() },
    expectedResult: { status: spec.toStatus },
  }).then(({ receiptId }) => finalizeReceipt(tenantId, receiptId, { actualResult: { status: updated.status, version: updated.version } }));

  return { ok: true, run: updated };
}

export async function pauseRun(tenantId: string, runId: string, expectedVersion: number, requestedBy: string): Promise<RunControlResult> {
  return applyTransition(tenantId, runId, expectedVersion, TRANSITIONS.pause, requestedBy);
}

export async function resumeRun(tenantId: string, runId: string, expectedVersion: number, requestedBy: string): Promise<RunControlResult> {
  const result = await applyTransition(tenantId, runId, expectedVersion, TRANSITIONS.resume, requestedBy);
  // Resuming only lifts claimStep's block (see steps.ts) — it does not itself re-fire
  // anything. A step that was already enqueued while paused needs re-driving now that
  // the block is lifted, same call advanceWorkflow already makes after every step.
  if (result.ok) await advanceWorkflow(tenantId, runId).catch(() => undefined);
  return result;
}

export async function cancelRun(tenantId: string, runId: string, expectedVersion: number, requestedBy: string): Promise<RunControlResult> {
  return applyTransition(tenantId, runId, expectedVersion, TRANSITIONS.cancel, requestedBy);
}

/** Retry only makes sense from 'failed' — and unlike the other verbs, actually has
 *  work to do beyond the status flip: the step that broke the chain is still sitting
 *  in 'failed' status (workflow_steps has no auto-reset), so retry resets it back to
 *  'pending' and re-drives the run via the same advanceWorkflow() every step
 *  completion already calls. Never resets a step that's genuinely still in flight
 *  ('leased') — only ones that terminally failed. */
export async function retryRun(tenantId: string, runId: string, expectedVersion: number, requestedBy: string): Promise<RunControlResult> {
  const result = await applyTransition(tenantId, runId, expectedVersion, TRANSITIONS.retry, requestedBy);
  if (!result.ok) return result;
  await withTenant(tenantId, (db) =>
    db
      .update(workflowSteps)
      .set({ status: "pending", terminalReason: null, leaseExpiresAt: null })
      .where(and(eq(workflowSteps.workflowRunId, runId), eq(workflowSteps.status, "failed"))),
  );
  await advanceWorkflow(tenantId, runId).catch(() => undefined);
  return result;
}

export async function escalateRun(tenantId: string, runId: string, expectedVersion: number, requestedBy: string): Promise<RunControlResult> {
  return applyTransition(tenantId, runId, expectedVersion, TRANSITIONS.escalate, requestedBy);
}
