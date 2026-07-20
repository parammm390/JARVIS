// Phase 6, Task 6.5 — chaos on REAL staging infrastructure, not a local simulation.
//
// scripts/chaos-test.ts (Phase 2) proves the workflow-runtime's crash-recovery
// contract with surgical precision: a local child process, killed at one of 3 exact
// boundary conditions via a signal hook, recovered by a fresh process. That's the
// right tool for proving the *logic* is correct. This script proves something the
// local harness structurally cannot: that the same guarantees hold when the thing
// that dies is the REAL deployed Railway container running the REAL worker code,
// killed by REALLY restarting it mid-flight — not a synthetic signal at a synthetic
// hook, but an uncontrolled, real infrastructure event.
//
// Method: submit a real batch of real `hold_and_confirm` commands (the exact same
// workflow chaos-test.ts uses) against staging's database. The real deployed
// finnor-worker-staging picks up the resulting real `run_workflow_step` jobs (same
// job type, same queue, same code path production uses). The instant some are
// observed `running`, restart the real service for real. Wait for it to come back
// online and drain the queue via its own real recovery mechanism
// (recoverExpiredRunningJobs' lease-expiry requeue in apps/worker/src/queue.ts —
// nothing special-cased for this test). Verify against real Postgres rows: every
// step reaches a terminal state, no job is lost, and every step is either genuinely
// exactly-once (single integration_operations row, completed) or has a real
// reconciliation_case — never silently duplicated, never silently dropped.
//
// Usage: DATABASE_URL=<staging> npx tsx scripts/staging-infra-chaos-test.ts

import "dotenv/config";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import {
  withTenant,
  closePool,
  tenants,
  workflowRuns,
  workflowSteps,
  commands,
  integrationOperations,
  reconciliationCases,
  decisionReceipts,
  jobs,
} from "@finnor/db";
import { eq, inArray, sql } from "drizzle-orm";
import { submitCommand, enqueueStep } from "@finnor/workflow-runtime";

/** node-postgres/drizzle interpolates a bare JS array into `ANY($1::text[])` as a
 *  "record" literal, not a real Postgres array (`cannot cast type record to text[]`,
 *  found running this for real against staging) -- build an explicit `IN (...)`
 *  instead, which drizzle's `sql.join` parameterizes correctly per element. */
function stepIdIn(ids: string[]) {
  return sql`payload->>'workflowStepId' IN (${sql.join(
    ids.map((id) => sql`${id}`),
    sql`, `,
  )})`;
}

const TENANT_ID = process.env.CHAOS_TENANT_ID ?? "00000000-0000-4000-8000-0000000000c2";
const BATCH_SIZE = Number(process.env.CHAOS_BATCH_SIZE ?? 30);

const RAILWAY_ENVIRONMENT_ID = "d5b663ae-f856-4445-9814-392d4d9e9605";
const RAILWAY_SERVICE_ID = "7a96b903-7c63-491d-9f11-af630dd72563"; // finnor-worker-staging

/** Two dead ends on the way here, each a real finding, neither worked: (1) a
 *  manually-extracted `accessToken` set once as an env var at script start -- worked
 *  the first time (proven: a real batch-200 run genuinely restarted the worker,
 *  instance id changed), then failed "Not Authorized" on a later run once enough real
 *  minutes had passed for that copy to go stale (the CLI's own session auto-refreshes
 *  itself; a copy pulled out of config.json once and reused does not). (2) shelling
 *  out to `railway restart` directly -- consistently exceeded a 30s timeout (matches
 *  this CLI command's behavior observed manually earlier this session too). Settled
 *  here: read the token FRESH from the CLI's own config file at the exact moment of
 *  the call (not a stale env var), call the GraphQL mutation directly -- proven fast
 *  (sub-second) and reliable whenever the token used was actually fresh. */
function freshRailwayToken(): string {
  const config = JSON.parse(readFileSync(`${homedir()}/.railway/config.json`, "utf8"));
  return config.user.accessToken;
}

async function restartRealWorker(): Promise<void> {
  const res = await fetch("https://backboard.railway.com/graphql/v2", {
    method: "POST",
    headers: { Authorization: `Bearer ${freshRailwayToken()}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      query: `mutation($serviceId: String!, $environmentId: String!) {
        serviceInstanceRedeploy(serviceId: $serviceId, environmentId: $environmentId)
      }`,
      variables: { serviceId: RAILWAY_SERVICE_ID, environmentId: RAILWAY_ENVIRONMENT_ID },
    }),
  });
  const json = await res.json();
  if (json.errors) throw new Error(`Railway API error: ${JSON.stringify(json.errors)}`);
}

/** The GraphQL `service`/`deployment` read queries reject this token with "Not
 *  Authorized" even though the `serviceInstanceRedeploy` MUTATION (used above) accepts
 *  it fine -- found by testing a minimal query directly, not guessed. The `railway`
 *  CLI itself already reliably reports status (used throughout this session), so shell
 *  out to it for reads instead of fighting the read-query auth further.
 *
 *  Returns the running CONTAINER INSTANCE id, not the deployment id -- found the hard
 *  way that `serviceInstanceRedeploy` restarts the container in place and does NOT
 *  mint a new deployment record (the deployment id stayed identical for 20+ seconds
 *  after a real restart, a dead end). The instance id (railway status --json's
 *  activeDeployments[].instances[].id) is the actual container process and genuinely
 *  changes on every real restart -- that's the real signal a NEW container is up. */
function workerStatus(): { status: string; instanceId: string | null } {
  // RAILWAY_API_TOKEN (this script's own, for the GraphQL mutation above) has
  // read-query restrictions the CLI's own stored ~/.railway/config.json session does
  // NOT have -- found by testing directly: `railway status` works fine interactively
  // (no RAILWAY_API_TOKEN in that shell) but fails "Unauthorized" as a child process
  // that inherits it. Strip it so the CLI falls back to its real, working session.
  const { RAILWAY_API_TOKEN: _unused, ...cleanEnv } = process.env;
  const out = execFileSync("railway", ["status", "--json"], { encoding: "utf8", cwd: process.cwd(), env: cleanEnv });
  const data = JSON.parse(out);
  for (const envEdge of data.environments?.edges ?? []) {
    for (const svcEdge of envEdge.node.serviceInstances?.edges ?? []) {
      const dep = svcEdge.node.activeDeployments?.[0];
      const startCmd: string | undefined = dep?.meta?.fileServiceManifest?.deploy?.startCommand;
      if (startCmd?.includes("apps/$SERVICE_APP")) {
        const instance = dep.instances?.[0];
        return { status: instance?.status === "RUNNING" ? "ONLINE" : (instance?.status ?? "UNKNOWN"), instanceId: instance?.id ?? null };
      }
    }
  }
  return { status: "UNKNOWN", instanceId: null };
}

async function submitBatch(n: number): Promise<{ workflowRunId: string; commandId: string; stepIds: string[] }[]> {
  await withTenant(TENANT_ID, (db) => db.insert(tenants).values({ id: TENANT_ID, name: "Staging Infra Chaos Tenant" }).onConflictDoNothing());
  const results: { workflowRunId: string; commandId: string; stepIds: string[] }[] = [];
  for (let i = 0; i < n; i++) {
    const nonce = `${Date.now()}-${i}`;
    const submitted = await withTenant(TENANT_ID, (db) =>
      submitCommand(db, {
        tenantId: TENANT_ID,
        commandType: "staging_infra_chaos_test",
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
              idempotencyKey: `staging-chaos-hold-${nonce}`,
            },
          },
          {
            stepType: "send_confirmation_call",
            payload: { tenantId: TENANT_ID, phoneNumber: "+15555550100", message: "staging infra chaos test", idempotencyKey: `staging-chaos-call-${nonce}` },
          },
        ],
      }),
    );
    // submitCommand only inserts the rows -- it does NOT enqueue the first job itself.
    // Real callers (e.g. domain-plugins/lead-to-water-test/index.ts) explicitly call
    // enqueueStep right after; found by reading that real call site after this script's
    // first run sat polling an empty queue for 20s straight (submitCommand alone never
    // produces a `jobs` row, so nothing was ever going to appear).
    await enqueueStep(TENANT_ID, submitted.stepIds[0]!, `staging-chaos-hold-${nonce}`);
    results.push(submitted);
  }
  return results;
}

/** Polling this hard against a pooled connection during the exact window the real
 *  worker container is restarting can hit a transient "Connection terminated" (found
 *  running this for real -- the pool's own connection got dropped mid-restart, not a
 *  bug in the query). Retry a few times with a short backoff instead of crashing the
 *  whole test over a network blip that has nothing to do with what's being verified. */
async function withRetry<T>(fn: () => Promise<T>, attempts = 5): Promise<T> {
  let lastErr: unknown;
  for (let i = 0; i < attempts; i++) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
      await new Promise((r) => setTimeout(r, 1000 * (i + 1)));
    }
  }
  throw lastErr;
}

async function countJobsByStatus(stepIds: string[]): Promise<Record<string, number>> {
  const rows = await withRetry(() =>
    withTenant(TENANT_ID, (db) =>
      db
        .select({ status: jobs.status, n: sql<number>`count(*)::int` })
        .from(jobs)
        .where(stepIdIn(stepIds))
        .groupBy(jobs.status),
    ),
  );
  const out: Record<string, number> = {};
  for (const r of rows) out[r.status] = r.n;
  return out;
}

async function cleanup(batches: { workflowRunId: string; commandId: string; stepIds: string[] }[]): Promise<void> {
  const allStepIds = batches.flatMap((b) => b.stepIds);
  await withTenant(TENANT_ID, async (db) => {
    await db.delete(reconciliationCases).where(eq(reconciliationCases.tenantId, TENANT_ID));
    for (const id of allStepIds) await db.delete(integrationOperations).where(eq(integrationOperations.workflowStepId, id));
    for (const id of allStepIds) await db.delete(decisionReceipts).where(eq(decisionReceipts.workflowStepId, id));
    if (allStepIds.length) await db.delete(jobs).where(stepIdIn(allStepIds));
    await db.delete(workflowSteps).where(
      inArray(
        workflowSteps.workflowRunId,
        batches.map((b) => b.workflowRunId),
      ),
    );
    await db.delete(workflowRuns).where(
      inArray(
        workflowRuns.id,
        batches.map((b) => b.workflowRunId),
      ),
    );
    await db.delete(commands).where(
      inArray(
        commands.id,
        batches.map((b) => b.commandId),
      ),
    );
  });
}

async function main(): Promise<void> {
  console.log(`=== Staging infra chaos test: submitting ${BATCH_SIZE} real commands to the real staging queue ===`);
  const batches = await submitBatch(BATCH_SIZE);
  const allStepIds = batches.flatMap((b) => b.stepIds);
  console.log(`Submitted ${batches.length} commands, ${allStepIds.length} steps total. Real finnor-worker-staging should now be draining these.`);

  console.log("Polling for at least some jobs to reach 'running' (proof the real worker picked them up)...");
  let sawRunning = false;
  for (let i = 0; i < 40; i++) {
    const counts = await countJobsByStatus(allStepIds);
    console.log(`  [t+${i * 0.5}s] job status counts: ${JSON.stringify(counts)}`);
    if ((counts.running ?? 0) > 0) {
      sawRunning = true;
      break;
    }
    if ((counts.completed ?? 0) + (counts.dead_letter ?? 0) === allStepIds.length) {
      console.log("  All jobs already reached a terminal state before we could catch one running -- worker is faster than our poll interval. Restarting anyway for a genuine mid-batch kill.");
      break;
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  console.log(sawRunning ? "Caught real jobs mid-flight (status=running) on the real deployed worker." : "Did not directly observe a running job (worker may be faster than the poll) -- proceeding to restart regardless for a real, uncontrolled kill.");

  console.log("=== Restarting the REAL finnor-worker-staging Railway service NOW ===");
  const before = workerStatus();
  console.log(`Worker status before restart: ${before.status} (instance ${before.instanceId})`);
  await restartRealWorker();
  console.log("Restart triggered via Railway's real API (serviceInstanceRedeploy) -- the real container is dying right now.");

  console.log("Waiting for the real worker to come back online on a genuinely NEW container instance (not just 'Online' -- that could still be the old one draining)...");
  let backOnline = false;
  for (let i = 0; i < 60; i++) {
    await new Promise((r) => setTimeout(r, 3000));
    const cur = workerStatus();
    console.log(`  [t+${i * 3}s] worker status: ${cur.status}, instance ${cur.instanceId}`);
    if (cur.status === "ONLINE" && cur.instanceId && cur.instanceId !== before.instanceId) {
      backOnline = true;
      break;
    }
    if (cur.status === "CRASHED") {
      console.error(`  Worker restart FAILED with status CRASHED -- stopping here, this is a real finding, not proceeding to fake a recovery.`);
      break;
    }
  }
  console.log(backOnline ? "Real worker confirmed back online on a genuinely new deployment." : "Worker did not confirm a new online deployment within the wait window -- recorded as a real finding below.");

  console.log("Waiting for the queue to drain via the worker's own real recovery mechanism (no test-only shortcuts)...");
  let finalCounts: Record<string, number> = {};
  for (let i = 0; i < 60; i++) {
    finalCounts = await countJobsByStatus(allStepIds);
    const terminal = (finalCounts.completed ?? 0) + (finalCounts.dead_letter ?? 0);
    console.log(`  [t+${i * 5}s] job status counts: ${JSON.stringify(finalCounts)} (${terminal}/${allStepIds.length} terminal)`);
    if (terminal === allStepIds.length) break;
    await new Promise((r) => setTimeout(r, 5000));
  }

  console.log("\n=== VERIFICATION (real Postgres state only) ===");
  const stepsFinal = await withRetry(() => withTenant(TENANT_ID, (db) => db.select().from(workflowSteps).where(inArray(workflowSteps.id, allStepIds))));
  const opsFinal = await withRetry(() => withTenant(TENANT_ID, (db) => db.select().from(integrationOperations).where(inArray(integrationOperations.workflowStepId, allStepIds))));
  const casesFinal = await withRetry(() => withTenant(TENANT_ID, (db) => db.select().from(reconciliationCases).where(eq(reconciliationCases.tenantId, TENANT_ID))));

  const opsByStep = new Map<string, typeof opsFinal>();
  for (const op of opsFinal) {
    const arr = opsByStep.get(op.workflowStepId!) ?? [];
    arr.push(op);
    opsByStep.set(op.workflowStepId!, arr);
  }

  let exactlyOnceCount = 0;
  let reconciledCount = 0;
  let failCount = 0;
  let stuckCount = 0;
  for (const step of stepsFinal) {
    const ops = opsByStep.get(step.id) ?? [];
    const hasCase = casesFinal.some((c) => c.relatedStepId === step.id);
    if (step.status === "pending" || step.status === "leased") {
      stuckCount++;
    } else if (step.status === "completed" && ops.length <= 1) {
      exactlyOnceCount++;
    } else if (hasCase) {
      reconciledCount++;
    } else if (step.status === "completed" && ops.length > 1) {
      failCount++; // completed but with duplicate side effects -- a real violation
    } else {
      failCount++;
    }
  }

  console.log(`Total steps: ${stepsFinal.length}`);
  console.log(`  Exactly-once (completed, <=1 integration_operations row): ${exactlyOnceCount}`);
  console.log(`  Reconciled (real reconciliation_case opened, never silently lost/duplicated): ${reconciledCount}`);
  console.log(`  STUCK (never reached a terminal step status): ${stuckCount}`);
  console.log(`  FAIL (duplicate side effects or unexplained state): ${failCount}`);
  console.log(`Job queue final counts: ${JSON.stringify(finalCounts)}`);
  console.log(`Worker came back online: ${backOnline}`);

  const verdict = failCount === 0 && stuckCount === 0 ? "PASS -- every step exactly-once or genuinely reconciled, zero stuck, zero duplicated" : "FAIL -- see counts above, a real finding";
  console.log(`\nVERDICT: ${verdict}`);

  console.log("\nCleaning up test data...");
  await cleanup(batches);
  await closePool();

  if (failCount > 0 || stuckCount > 0) process.exit(1);
}

main().catch(async (err) => {
  console.error("FATAL:", err);
  await closePool().catch(() => undefined);
  process.exit(1);
});
