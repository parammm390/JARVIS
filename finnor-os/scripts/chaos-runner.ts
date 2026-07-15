// Child-process entrypoint for scripts/chaos-test.ts. Runs as a real, separate OS
// process — no in-memory state is shared with the parent or with any prior child.
// Two modes:
//   run-step <tenantId> <stepId>            — runs the real run_workflow_step handler
//                                               once (self-kills if FINNOR_CHAOS_KILL_POINT
//                                               matches a hook it passes through)
//   recover <tenantId> <workflowRunId>       — recovers stale leases and drives the
//                                               workflow to completion, exactly what a
//                                               freshly restarted worker would do

import "dotenv/config";
import { withTenant, closePool, workflowRuns, workflowSteps } from "@finnor/db";
import { eq } from "drizzle-orm";
import { recoverStaleSteps } from "@finnor/workflow-runtime";
import { runWorkflowStep } from "../apps/worker/src/handlers/run-workflow-step";

async function driveToCompletion(tenantId: string, workflowRunId: string, maxIterations = 20): Promise<void> {
  for (let i = 0; i < maxIterations; i++) {
    await recoverStaleSteps(tenantId);
    const [run] = await withTenant(tenantId, (db) => db.select().from(workflowRuns).where(eq(workflowRuns.id, workflowRunId)));
    if (!run || run.status !== "running") return;

    const steps = await withTenant(tenantId, (db) => db.select().from(workflowSteps).where(eq(workflowSteps.workflowRunId, workflowRunId)));
    // Respect sequence order — a later step must never run ahead of an earlier one
    // that's stuck (e.g. leased, awaiting an unresolved reconciliation_case).
    const sorted = steps.slice().sort((a, b) => a.sequence - b.sequence);
    const next = sorted.find((s, i) => s.status === "pending" && sorted.slice(0, i).every((prev) => prev.status === "completed"));
    if (next) {
      await runWorkflowStep({ tenantId, workflowStepId: next.id });
    } else {
      await new Promise((r) => setTimeout(r, 500));
    }
  }
}

async function main() {
  const [mode, tenantId, arg2] = process.argv.slice(2);
  if (mode === "run-step") {
    await runWorkflowStep({ tenantId, workflowStepId: arg2 });
  } else if (mode === "recover") {
    await driveToCompletion(tenantId!, arg2!);
  } else {
    throw new Error(`chaos-runner: unknown mode "${mode}"`);
  }
  await closePool();
  process.exit(0);
}

main().catch(async (err) => {
  console.error("[chaos-runner]", err);
  await closePool().catch(() => undefined);
  process.exit(1);
});
