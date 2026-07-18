// Phase 2 (§2.5, "the great rewiring") acceptance: a single-action execution through
// GatedExecutor now creates real commands/workflow_runs/workflow_steps/decision_receipts
// rows via @finnor/workflow-runtime instead of calling plugin.execute() bare — and a
// reflection-style retry (executor.execute() called twice for the SAME domain action)
// creates a SECOND independent step + receipt, never silently swallowed as "already ran"
// (a real regression this test file exists specifically to pin down — an earlier,
// action-scoped idempotency key in the bridge broke full-flow.test.ts's own
// "reflection_retry" test by eating the second attempt).
//
// New rows are identified by diffing workflow_steps ids before/after each call, not by a
// marker field in the payload — plugin.draft() reconstructs its own payload (via zod
// parsing in some plugins), so an injected marker field is not guaranteed to survive
// into the step's stored payload.

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { z } from "zod";
import pg from "pg";
import { migrate } from "../../packages/db/migrate";
import { seed, SEED_TENANT_ID } from "../../packages/db/seed";
import { withTenant, closePool, domainActions, domainPolicies, commands, workflowRuns, workflowSteps, decisionReceipts } from "@finnor/db";
import { eq } from "drizzle-orm";
import { FinnorOrchestrator } from "@finnor/orchestration";
import { ToolRegistry } from "@finnor/tools";
import type { DomainAction } from "@finnor/shared-types";

const DB_URL = process.env.DATABASE_URL ?? "postgres://finnor:finnor@localhost:5432/finnor";
const ACTION_TYPE = "schedule_water_test";

async function dbUp(): Promise<boolean> {
  const c = new pg.Client({ connectionString: DB_URL, connectionTimeoutMillis: 2000 });
  try {
    await c.connect();
    await c.end();
    return true;
  } catch {
    return false;
  }
}
const available = await dbUp();

function mockTools() {
  const reg = new ToolRegistry();
  for (const name of ["ghl_create_contact", "ghl_book_appointment"]) {
    reg.register({
      name,
      description: "mock",
      integration: "mock-ghl",
      inputSchema: z.object({}).passthrough(),
      async run() {
        return { contactId: "mock-contact-1", booked: true };
      },
    });
  }
  return reg;
}

async function createDraftAction(payload: Record<string, unknown>): Promise<DomainAction> {
  return withTenant(SEED_TENANT_ID, async (db) => {
    const [policy] = await db.select().from(domainPolicies).where(eq(domainPolicies.actionType, ACTION_TYPE)).limit(1);
    const [row] = await db
      .insert(domainActions)
      .values({ tenantId: SEED_TENANT_ID, actionType: ACTION_TYPE, payload, policyId: policy?.id ?? null, status: "approved" })
      .returning();
    return {
      id: row!.id,
      tenantId: row!.tenantId,
      actionType: row!.actionType,
      payload: row!.payload as Record<string, unknown>,
      policyId: row!.policyId,
      status: row!.status,
      createdAt: row!.createdAt.toISOString(),
    };
  });
}

/** Every workflow_step id that currently exists for ACTION_TYPE, across every command
 *  the bridge has ever created for it (accumulates harmlessly across test runs against
 *  the persistent local dev DB, same convention as full-flow.test.ts's own fixtures). */
async function currentStepIds(): Promise<Set<string>> {
  return withTenant(SEED_TENANT_ID, async (db) => {
    const cmds = await db.select({ id: commands.id }).from(commands).where(eq(commands.commandType, ACTION_TYPE));
    const ids = new Set<string>();
    for (const c of cmds) {
      const runs = await db.select({ id: workflowRuns.id }).from(workflowRuns).where(eq(workflowRuns.commandId, c.id));
      for (const r of runs) {
        const steps = await db.select({ id: workflowSteps.id }).from(workflowSteps).where(eq(workflowSteps.workflowRunId, r.id));
        for (const s of steps) ids.add(s.id);
      }
    }
    return ids;
  });
}

async function cleanupSteps(stepIds: string[]): Promise<void> {
  if (stepIds.length === 0) return;
  await withTenant(SEED_TENANT_ID, async (db) => {
    for (const stepId of stepIds) {
      const [step] = await db.select().from(workflowSteps).where(eq(workflowSteps.id, stepId));
      if (!step) continue;
      await db.delete(decisionReceipts).where(eq(decisionReceipts.workflowStepId, stepId));
      await db.delete(workflowSteps).where(eq(workflowSteps.id, stepId));
      const remaining = await db.select().from(workflowSteps).where(eq(workflowSteps.workflowRunId, step.workflowRunId));
      if (remaining.length === 0) {
        const [run] = await db.select().from(workflowRuns).where(eq(workflowRuns.id, step.workflowRunId));
        await db.delete(workflowRuns).where(eq(workflowRuns.id, step.workflowRunId));
        if (run) await db.delete(commands).where(eq(commands.id, run.commandId));
      }
    }
  });
}

describe.skipIf(!available)("single-action execution via the runtime bridge (§2.5)", () => {
  beforeAll(async () => {
    process.env.DATABASE_URL = DB_URL;
    await migrate(DB_URL);
    await seed(DB_URL);
  });
  afterAll(async () => {
    await closePool();
  });

  it("a successful single-action execution produces a command/run/step/receipt trail", async () => {
    const orchestrator = new FinnorOrchestrator({ tools: mockTools() });
    const action = await createDraftAction({
      address: "1 Test Way",
      contactPhone: "+15555550100",
      contactName: "Bridge Test Household",
      requestedAt: "2026-08-01T10:00:00Z",
    });

    const before = await currentStepIds();
    const result = await orchestrator.executor.execute(action, await orchestrator.loadPolicy(action));
    const after = await currentStepIds();
    const newIds = [...after].filter((id) => !before.has(id));

    try {
      expect(result.status).toBe("success");
      expect(newIds).toHaveLength(1);

      const [step] = await withTenant(SEED_TENANT_ID, (db) => db.select().from(workflowSteps).where(eq(workflowSteps.id, newIds[0]!)));
      expect(step!.stepType).toBe(ACTION_TYPE);
      expect(step!.status).toBe("completed");

      const [run] = await withTenant(SEED_TENANT_ID, (db) => db.select().from(workflowRuns).where(eq(workflowRuns.id, step!.workflowRunId)));
      expect(run!.workflowType).toBe("single_action");

      const [receipt] = await withTenant(SEED_TENANT_ID, (db) => db.select().from(decisionReceipts).where(eq(decisionReceipts.workflowStepId, newIds[0]!)));
      expect(receipt).toBeTruthy();
      expect(receipt!.finalizedAt).not.toBeNull();
      expect(receipt!.actualResult).not.toBeNull();
      expect(receipt!.failure).toBeNull();
    } finally {
      await cleanupSteps(newIds);
    }
  });

  it("reflection's retry-once mechanism creates a SECOND independent step + receipt, not a swallowed no-op", async () => {
    const orchestrator = new FinnorOrchestrator({ tools: mockTools() });
    const action = await createDraftAction({
      address: "2 Test Way",
      contactPhone: "+15555550101",
      contactName: "Retry Test Household",
      requestedAt: "2026-08-02T10:00:00Z",
    });
    const policy = await orchestrator.loadPolicy(action);

    const before = await currentStepIds();
    // Two direct calls to executor.execute() for the SAME action, exactly like
    // reflectWithRetry() does in packages/orchestration/src/index.ts.
    await orchestrator.executor.execute(action, policy);
    await orchestrator.executor.execute(action, policy);
    const after = await currentStepIds();
    const newIds = [...after].filter((id) => !before.has(id));

    try {
      // The whole point of NOT using an action-scoped idempotency key in the bridge:
      // two real executor.execute() calls for the same action are two real, separately
      // receipted attempts — never collapsed into one. (Whether the SECOND attempt's
      // plugin call itself succeeds is a separate, pre-existing concern — GHL booking
      // idempotency at the tool-call layer, ScopedToolRegistry/external_operations,
      // unrelated to this bridge — so this test does not assert both succeed.)
      expect(newIds).toHaveLength(2);
      const steps = await withTenant(SEED_TENANT_ID, async (db) => {
        const rows = [];
        for (const id of newIds) {
          const [s] = await db.select().from(workflowSteps).where(eq(workflowSteps.id, id));
          rows.push(s!);
        }
        return rows;
      });
      expect(steps.every((s) => s.stepType === ACTION_TYPE)).toBe(true);
      // Every attempt is terminal (completed or failed) — never left dangling — and
      // every attempt has its own finalized receipt.
      expect(steps.every((s) => s.status === "completed" || s.status === "failed")).toBe(true);
      const receipts = await withTenant(SEED_TENANT_ID, async (db) => {
        const rows = [];
        for (const id of newIds) {
          const [r] = await db.select().from(decisionReceipts).where(eq(decisionReceipts.workflowStepId, id));
          rows.push(r);
        }
        return rows;
      });
      expect(receipts.every((r) => r && r.finalizedAt !== null)).toBe(true);
    } finally {
      await cleanupSteps(newIds);
    }
  });
});
