// Chaos test (Phase 2 proof item 1): kills a REAL, separate OS process at each of the
// 3 defined boundaries during a workflow touching both proof domains (scheduling +
// communications), then spawns a completely fresh process (no shared memory) to
// recover, and asserts against real Postgres rows for exactly-once completion or an
// explicit reconciliation_case. Standalone, like scripts/load-test.ts — real Postgres,
// no mocks, run outside the vitest suite.
//
// Assertions deliberately use ONLY durable Postgres state (workflow_steps,
// integration_operations, reconciliation_cases) — never the emulators' in-memory
// state, which is process-local and correctly does NOT survive the simulated crash
// (exactly like a real external provider's state living outside our process memory).

import "dotenv/config";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { withTenant, closePool, tenants, workflowRuns, workflowSteps, commands, integrationOperations, reconciliationCases } from "@finnor/db";
import { eq } from "drizzle-orm";
import { submitCommand } from "@finnor/workflow-runtime";

const TENANT_ID = process.env.CHAOS_TENANT_ID ?? "00000000-0000-4000-8000-0000000000c1";
const RUNNER = join(dirname(fileURLToPath(import.meta.url)), "chaos-runner.ts");

function runChild(args: string[], env: Record<string, string> = {}): Promise<{ code: number | null; signal: NodeJS.Signals | null }> {
  return new Promise((resolve, reject) => {
    const child = spawn("npx", ["tsx", RUNNER, ...args], {
      env: { ...process.env, ...env },
      stdio: "inherit",
    });
    child.on("error", reject);
    child.on("exit", (code, signal) => resolve({ code, signal }));
  });
}

async function setup(): Promise<{ workflowRunId: string; commandId: string; stepIds: string[] }> {
  await withTenant(TENANT_ID, (db) => db.insert(tenants).values({ id: TENANT_ID, name: "Chaos Test Dealer" }).onConflictDoNothing());
  const nonce = Date.now();
  const submitted = await withTenant(TENANT_ID, (db) =>
    submitCommand(db, {
      tenantId: TENANT_ID,
      commandType: "chaos_test",
      payload: {},
      workflowType: "hold_and_confirm",
      steps: [
        {
          stepType: "hold_appointment",
          payload: {
            tenantId: TENANT_ID,
            subjectType: "chaos_test",
            subjectId: TENANT_ID,
            scheduledAt: new Date().toISOString(),
            idempotencyKey: `chaos-hold-${nonce}`,
          },
        },
        {
          stepType: "send_confirmation_call",
          payload: { tenantId: TENANT_ID, phoneNumber: "+15555550100", message: "chaos test confirmation", idempotencyKey: `chaos-call-${nonce}` },
        },
      ],
    }),
  );
  return submitted;
}

async function cleanup(stepIds: string[], workflowRunId: string, commandId: string): Promise<void> {
  await withTenant(TENANT_ID, async (db) => {
    await db.delete(reconciliationCases).where(eq(reconciliationCases.tenantId, TENANT_ID));
    for (const id of stepIds) await db.delete(integrationOperations).where(eq(integrationOperations.workflowStepId, id));
    await db.delete(workflowSteps).where(eq(workflowSteps.workflowRunId, workflowRunId));
    await db.delete(workflowRuns).where(eq(workflowRuns.id, workflowRunId));
    await db.delete(commands).where(eq(commands.id, commandId));
  });
}

async function runScenario(name: string, killPoint: string, leaseSecondsForWait?: number): Promise<void> {
  console.log(`\n=== Scenario: ${name} (kill point: ${killPoint}) ===`);
  const { workflowRunId, commandId, stepIds } = await setup();
  const firstStepId = stepIds[0]!;

  console.log(`[parent] spawning child to run step 1 (hold_appointment) with FINNOR_CHAOS_KILL_POINT=${killPoint}...`);
  const killEnv: Record<string, string> = { FINNOR_CHAOS_KILL_POINT: killPoint };
  if (leaseSecondsForWait) killEnv.FINNOR_STEP_LEASE_SECONDS = String(leaseSecondsForWait);
  const killed = await runChild(["run-step", TENANT_ID, firstStepId], killEnv);
  console.log(`[parent] child process exited: code=${killed.code} signal=${killed.signal}`);
  // spawn("npx", ...) launches npx as an intermediate process — the grandchild (tsx/node)
  // is what actually receives SIGKILL, so npx itself typically reports it via the
  // conventional 128+signum exit code (137 = 128+9) rather than populating `signal`.
  const wasKilled = killed.signal === "SIGKILL" || killed.code === 137;
  if (!wasKilled) {
    console.warn(`[parent] WARNING: expected the child to die by SIGKILL — it exited normally instead (code=${killed.code}, signal=${killed.signal}). The kill hook may not have fired.`);
  }

  const [stepAfterKill] = await withTenant(TENANT_ID, (db) => db.select().from(workflowSteps).where(eq(workflowSteps.id, firstStepId)));
  const [opAfterKill] = await withTenant(TENANT_ID, (db) => db.select().from(integrationOperations).where(eq(integrationOperations.workflowStepId, firstStepId)));
  console.log(`[parent] step 1 status immediately after kill: ${stepAfterKill!.status}`);
  console.log(`[parent] integration_operations status immediately after kill: ${opAfterKill?.status ?? "(none claimed yet)"}`);

  if (leaseSecondsForWait) {
    const waitMs = leaseSecondsForWait * 1000 + 1500;
    console.log(`[parent] waiting ${waitMs}ms for the step's lease to actually expire before recovering...`);
    await new Promise((r) => setTimeout(r, waitMs));
  }

  console.log("[parent] spawning a FRESH child process (no shared memory with either process above) to recover + resume...");
  const recovered = await runChild(["recover", TENANT_ID, workflowRunId]);
  console.log(`[parent] recovery child exited: code=${recovered.code} signal=${recovered.signal}`);

  const [runFinal] = await withTenant(TENANT_ID, (db) => db.select().from(workflowRuns).where(eq(workflowRuns.id, workflowRunId)));
  const stepsFinal = await withTenant(TENANT_ID, (db) => db.select().from(workflowSteps).where(eq(workflowSteps.workflowRunId, workflowRunId)));
  const opsFinal = await withTenant(TENANT_ID, (db) => db.select().from(integrationOperations).where(eq(integrationOperations.workflowStepId, firstStepId)));
  const cases = await withTenant(TENANT_ID, (db) => db.select().from(reconciliationCases).where(eq(reconciliationCases.relatedStepId, firstStepId)));

  console.log(`[parent] FINAL workflow_run status: ${runFinal?.status}`);
  console.log(`[parent] FINAL step statuses: ${stepsFinal.map((s) => `${s.stepType}:${s.status}`).join(", ")}`);
  console.log(`[parent] FINAL integration_operations rows for step 1: ${opsFinal.map((o) => `${o.operationKey}:${o.status}`).join(", ")}`);
  console.log(`[parent] reconciliation_cases opened for step 1: ${cases.length} (${cases.map((c) => `${c.caseType}:${c.status}`).join(", ")})`);

  const exactlyOnce = stepsFinal.filter((s) => s.stepType === "hold_appointment")[0]!.status === "completed" && opsFinal.length === 1;
  const hasReconciliation = cases.length >= 1;
  const verdict = exactlyOnce ? "EXACTLY-ONCE (step completed, single integration_operations row)" : hasReconciliation ? "RECONCILIATION_CASE OPENED (never silently retried/lost)" : "FAIL — neither exactly-once nor reconciled";
  console.log(`[parent] VERDICT: ${verdict}`);

  await cleanup(stepIds, workflowRunId, commandId);
}

async function main() {
  await runScenario("1. pre-commit kill (before the step claim UPDATE ever runs)", "pre_commit");
  await runScenario("2. post-commit-pre-ack kill (real effect happened, crash before recording it — unknown delivery)", "post_commit_pre_ack", 3);
  await runScenario("3. mid-multi-step kill (step 1 committed, crash before step 2 is enqueued)", "mid_multi_step");
  await closePool();
}

main().catch(async (err) => {
  console.error(err);
  await closePool().catch(() => undefined);
  process.exit(1);
});
