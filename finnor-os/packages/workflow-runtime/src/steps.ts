// Step claim/complete/fail/recover — mirrors domain_actions' proven atomic
// UPDATE...WHERE status=<expected> concurrency boundary (runAction()/decide() in
// packages/orchestration/src/index.ts). Step execution is driven through the existing
// Postgres job queue (apps/worker/src/queue.ts, job type "run_workflow_step") — this
// file's lease_expires_at is an additional, finer-grained atomic claim on top of the
// job-level lease, not a second queue system.

import { withTenant, enqueueJob, workflowSteps, workflowRuns, commands, integrationOperations, reconciliationCases } from "@finnor/db";
import { and, eq, lt, sql, desc } from "drizzle-orm";
import { maybeChaosKill } from "./chaos";
import { openReconciliationCase } from "./reconciliation";
import { openReceipt, finalizeReceipt, findReceiptByStep } from "./receipts";

// Overridable (FINNOR_STEP_LEASE_SECONDS) so the chaos-test script can prove real
// lease-expiry recovery in seconds rather than waiting out the production default.
function leaseSeconds(): number {
  const override = process.env.FINNOR_STEP_LEASE_SECONDS;
  return override ? Number(override) : 300;
}

export type WorkflowStepRow = typeof workflowSteps.$inferSelect;

export async function enqueueStep(tenantId: string, stepId: string, idempotencyKey: string): Promise<void> {
  // jobs is not tenant-scoped (schema.ts comment) — the payload carries tenant_id so the
  // handler can re-establish tenant context, same convention as every other job type.
  await enqueueJob("run_workflow_step", { tenantId, workflowStepId: stepId }, `workflow-step:${idempotencyKey}`);
}

/** §2.4: opens the one DecisionReceipt for a step's whole lifecycle, at the moment of
 *  its first-ever claim (attempts having just gone 0→1 — a later reclaim after a stale
 *  lease recovery or a retry re-finalizes the SAME receipt, never opens a second one;
 *  decision_receipts.workflow_step_id is unique, and this guard avoids relying on that
 *  constraint alone to fail loudly instead of quietly). Best-effort: a receipt-write
 *  failure must never break the step claim itself, same convention as the voice-confirm
 *  enqueue in executor.ts ("queue trouble must never break the gate itself"). */
async function openReceiptForFirstClaim(tenantId: string, step: WorkflowStepRow): Promise<void> {
  if (step.attempts !== 1) return;
  try {
    const [run] = await withTenant(tenantId, (db) => db.select().from(workflowRuns).where(eq(workflowRuns.id, step.workflowRunId)));
    const [command] = run ? await withTenant(tenantId, (db) => db.select().from(commands).where(eq(commands.id, run.commandId))) : [undefined];
    await openReceipt({
      tenantId,
      workflowRunId: step.workflowRunId,
      workflowStepId: step.id,
      objective: `${run?.workflowType ?? "workflow"}: ${step.stepType}`,
      evidence: [{ source: "workflow_step", ref: step.id, timestamp: new Date().toISOString() }],
      policyApplied: null,
      riskTier: "medium",
      proposedAction: { stepType: step.stepType, payload: step.payload },
      approval: { required: true, approvedBy: command?.requestedBy ?? undefined, at: command?.createdAt.toISOString() },
      correlationId: step.correlationId ?? undefined,
    });
  } catch (err) {
    console.error(`[decision_receipts] failed to open receipt for step ${step.id}`, err);
  }
}

/** Atomic claim — mirrors runAction()'s UPDATE...WHERE status=<expected> pattern.
 *  Returns null if the step is already leased/completed (duplicate job delivery safe). */
export async function claimStep(tenantId: string, stepId: string): Promise<WorkflowStepRow | null> {
  maybeChaosKill("pre_commit");
  const claimed = await withTenant(tenantId, async (db) => {
    const [claimed] = await db
      .update(workflowSteps)
      .set({
        status: "leased",
        leaseExpiresAt: new Date(Date.now() + leaseSeconds() * 1000),
        attempts: sql`${workflowSteps.attempts} + 1`,
        updatedAt: new Date(),
      })
      .where(and(eq(workflowSteps.id, stepId), eq(workflowSteps.tenantId, tenantId), eq(workflowSteps.status, "pending")))
      .returning();
    return claimed ?? null;
  });
  if (claimed) await openReceiptForFirstClaim(tenantId, claimed);
  return claimed;
}

/** §2.4: finalizes the step's receipt in place — idempotent to call on a resumed step
 *  (recoverStaleSteps re-finalizing after a crash), since it's a plain UPDATE, not an
 *  append. No receipt existing (e.g. the open above failed) is a logged gap, never a
 *  thrown error — the step's own completion must never depend on the receipt succeeding. */
async function finalizeReceiptForStep(tenantId: string, stepId: string, result: { actualResult: Record<string, unknown> } | { errorKind: import("@finnor/shared-types").ErrorKind; message: string; recoveryPath: string }): Promise<void> {
  try {
    const receipt = await findReceiptByStep(tenantId, stepId);
    if (!receipt) {
      console.error(`[decision_receipts] no receipt found to finalize for step ${stepId}`);
      return;
    }
    await finalizeReceipt(
      tenantId,
      receipt.id,
      "actualResult" in result ? { actualResult: result.actualResult } : { failure: { errorKind: result.errorKind, message: result.message, recoveryPath: result.recoveryPath } },
    );
  } catch (err) {
    console.error(`[decision_receipts] failed to finalize receipt for step ${stepId}`, err);
  }
}

export async function completeStep(tenantId: string, stepId: string, evidence: Record<string, unknown>): Promise<void> {
  await withTenant(tenantId, (db) =>
    db
      .update(workflowSteps)
      .set({ status: "completed", evidence, leaseExpiresAt: null, updatedAt: new Date() })
      .where(eq(workflowSteps.id, stepId)),
  );
  await finalizeReceiptForStep(tenantId, stepId, { actualResult: evidence });
}

export async function failStep(
  tenantId: string,
  stepId: string,
  terminalReason: string,
  // failStep is this step's terminal outcome for the current attempt — nothing resets
  // a 'failed' step back to pending except recoverStaleSteps' own stale-lease branch,
  // so "terminal" (not "retryable") is the right default: it accurately reflects THIS
  // attempt's finality, not whether the workflow as a whole might still recover. Callers
  // with a more specific classification (e.g. the §2.5 runtime bridge distinguishing a
  // plugin's "integration_unavailable" from a plain failure) may pass it explicitly.
  errorKind: import("@finnor/shared-types").ErrorKind = "terminal",
): Promise<void> {
  await withTenant(tenantId, (db) =>
    db
      .update(workflowSteps)
      .set({ status: "failed", terminalReason, leaseExpiresAt: null, updatedAt: new Date() })
      .where(eq(workflowSteps.id, stepId)),
  );
  await finalizeReceiptForStep(tenantId, stepId, { errorKind, message: terminalReason, recoveryPath: "review via GET /api/workflows/runs and retry or escalate the run" });
}

/** Enqueues the next pending step in sequence, or marks the workflow_run (and its
 *  parent command) completed once every step has finished. Before enqueueing, merges
 *  every already-completed step's evidence into the next step's payload under
 *  `context.<stepType>` — a later step (e.g. confirm_appointment) can reference an
 *  earlier step's output (e.g. hold_appointment's holdId) without the caller having
 *  known it in advance at submitCommand() time. */
export async function advanceWorkflow(tenantId: string, workflowRunId: string): Promise<void> {
  maybeChaosKill("mid_multi_step");
  const allSteps = await withTenant(tenantId, (db) =>
    db.select().from(workflowSteps).where(eq(workflowSteps.workflowRunId, workflowRunId)).orderBy(workflowSteps.sequence),
  );
  const next = allSteps.find((s) => s.status === "pending");
  if (next) {
    const context: Record<string, unknown> = {};
    for (const s of allSteps) {
      if (s.status === "completed" && s.evidence) {
        const evidence = s.evidence as Record<string, unknown>;
        context[s.stepType] = "output" in evidence ? evidence.output : evidence;
      }
    }
    await withTenant(tenantId, (db) =>
      db.update(workflowSteps).set({ payload: { ...(next.payload as Record<string, unknown>), context } }).where(eq(workflowSteps.id, next.id)),
    );
    await enqueueStep(tenantId, next.id, next.idempotencyKey);
    return;
  }

  const steps = allSteps;
  const allCompleted = steps.length > 0 && steps.every((s) => s.status === "completed");
  const anyFailed = steps.some((s) => s.status === "failed");
  const finalStatus = allCompleted ? "completed" : anyFailed ? "failed" : "running";
  if (finalStatus === "running") return; // still has leased/compensating steps in flight

  const [run] = await withTenant(tenantId, (db) =>
    db.update(workflowRuns).set({ status: finalStatus, updatedAt: new Date() }).where(eq(workflowRuns.id, workflowRunId)).returning(),
  );
  if (run) {
    await withTenant(tenantId, (db) =>
      db.update(commands).set({ status: finalStatus, updatedAt: new Date() }).where(eq(commands.id, run.commandId)),
    );
  }
}

/**
 * Reclaims steps whose lease has expired — called at the top of the run_workflow_step
 * job handler, exactly like recoverExpiredRunningJobs() in apps/worker/src/queue.ts.
 * The matching integration_operations row is the source of truth for what to do:
 *  - no claim row yet:  nothing external happened — safe to reset and re-enqueue.
 *  - status 'succeeded': the real effect happened, only the bookkeeping write was lost —
 *    mark the step completed and resume (exactly-once, resumed correctly).
 *  - status 'running':  crashed mid-call, delivery unknown — NEVER blindly retry; open
 *    a reconciliation_case instead (the blueprint's own rule).
 *  - status 'failed':   a failed attempt delivered nothing — safe to reset and retry.
 */
export async function recoverStaleSteps(tenantId: string): Promise<{ recovered: number; reconciled: number }> {
  const stale = await withTenant(tenantId, (db) =>
    db
      .select()
      .from(workflowSteps)
      .where(and(eq(workflowSteps.tenantId, tenantId), eq(workflowSteps.status, "leased"), lt(workflowSteps.leaseExpiresAt, new Date()))),
  );

  let recovered = 0;
  let reconciled = 0;

  for (const step of stale) {
    const [claimRow] = await withTenant(tenantId, (db) =>
      db
        .select()
        .from(integrationOperations)
        .where(eq(integrationOperations.workflowStepId, step.id))
        .orderBy(desc(integrationOperations.createdAt))
        .limit(1),
    );

    if (!claimRow) {
      await withTenant(tenantId, (db) =>
        db.update(workflowSteps).set({ status: "pending", leaseExpiresAt: null }).where(eq(workflowSteps.id, step.id)),
      );
      await enqueueStep(tenantId, step.id, step.idempotencyKey);
      recovered++;
      continue;
    }

    if (claimRow.status === "succeeded") {
      await completeStep(tenantId, step.id, { operationKey: claimRow.operationKey, resumedFromRecovery: true });
      await advanceWorkflow(tenantId, step.workflowRunId);
      recovered++;
      continue;
    }

    if (claimRow.status === "running") {
      // Idempotent: recoverStaleSteps() can legitimately be called many times while a
      // step sits stuck (every job-queue poll, every retry loop iteration) — a stale
      // leased step with no lease bump must only ever open ONE open reconciliation_case,
      // never one per call.
      const [existingCase] = await withTenant(tenantId, (db) =>
        db
          .select()
          .from(reconciliationCases)
          .where(and(eq(reconciliationCases.relatedStepId, step.id), eq(reconciliationCases.status, "open"))),
      );
      if (!existingCase) {
        await openReconciliationCase(tenantId, {
          caseType: "unknown_delivery",
          relatedStepId: step.id,
          details: { operationKey: claimRow.operationKey, capability: claimRow.capability },
        });
        reconciled++;
      }
      continue;
    }

    // claimRow.status === 'failed' or 'unknown' (already reconciled) — safe to retry.
    await withTenant(tenantId, (db) =>
      db.update(workflowSteps).set({ status: "pending", leaseExpiresAt: null }).where(eq(workflowSteps.id, step.id)),
    );
    await enqueueStep(tenantId, step.id, step.idempotencyKey);
    recovered++;
  }

  return { recovered, reconciled };
}
