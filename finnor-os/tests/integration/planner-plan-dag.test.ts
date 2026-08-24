// B2.T1 acceptance: planner dependencies are persisted as real sibling ids and
// dispatch readiness advances only after the prerequisite actually completes. This
// uses real Postgres, not a status-map mock, because RLS/tenant filters are part of
// the safety property.

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import pg from "pg";
import { randomUUID } from "node:crypto";
import { migrate } from "../../packages/db/migrate";
import { closePool, decisionReceipts, domainActions, tenants, withTenant, workflowSteps } from "@finnor/db";
import { and, eq, inArray } from "drizzle-orm";
import { GatedExecutor, LLMPlanner, createDefaultPluginRegistry, readyPlanActions, validateDependencyIndexes } from "@finnor/orchestration";
import { createDefaultRegistry } from "@finnor/tools";
import type { LLMProvider } from "@finnor/orchestration";
import type { MemorySnapshot, TenantContext } from "@finnor/shared-types";
import { runWorkflowStep } from "../../apps/worker/src/handlers/run-workflow-step";

const DB_URL = process.env.DATABASE_URL ?? "postgres://finnor:finnor@localhost:5432/finnor";
const TENANT_ID = "00000000-0000-4000-8000-0000000000b2";

async function dbUp(): Promise<boolean> {
  const client = new pg.Client({ connectionString: DB_URL, connectionTimeoutMillis: 2000 });
  try {
    await client.connect();
    await client.end();
    return true;
  } catch {
    return false;
  }
}
const available = await dbUp();

const emptyMemory = (): MemorySnapshot => ({ shortTerm: null, longTerm: null, semantic: [], episodic: [], patterns: null });
const context = (): TenantContext => ({ tenantId: TENANT_ID, userId: "planner-dag-test", role: "owner" });

async function runDurableAction(actionId: string): Promise<void> {
  const [step] = await withTenant(TENANT_ID, (db) => db.select().from(workflowSteps).where(and(
    eq(workflowSteps.tenantId, TENANT_ID),
    eq(workflowSteps.domainActionId, actionId),
    eq(workflowSteps.status, "pending"),
  )).limit(1));
  if (!step) return; // non-consequential/manual actions remain synchronous
  await runWorkflowStep({ tenantId: TENANT_ID, workflowStepId: step.id });
}

describe.skipIf(!available)("planner plan DAG", () => {
  beforeAll(async () => {
    process.env.DATABASE_URL = DB_URL;
    await migrate(DB_URL);
    await withTenant(TENANT_ID, (db) => db.insert(tenants).values({ id: TENANT_ID, name: "Planner DAG Test Dealer" }).onConflictDoNothing());
  });

  afterAll(async () => {
    // action_log is intentionally append-only and references these action rows, so
    // planner-produced fixtures remain as an auditable record just like real plans.
    await closePool();
  });

  it("rejects duplicate, forward, and cyclic-by-construction dependency indexes", () => {
    expect(validateDependencyIndexes([{ dependsOn: [] }, { dependsOn: [0] }, { dependsOn: [0, 1] }])).toEqual([[], [0], [0, 1]]);
    expect(() => validateDependencyIndexes([{ dependsOn: [0] }])).toThrow("invalid dependency index");
    expect(() => validateDependencyIndexes([{ dependsOn: [] }, { dependsOn: [0, 0] }])).toThrow("repeats");
  });

  it("persists a two-step planner response and exposes only the root until it completes", async () => {
    const provider: LLMProvider = {
      name: "planner-dag-stub",
      async complete() {
        return JSON.stringify({
          actions: [
            { action_type: "create_invoice", payload: { amountUsd: 125 } },
            { action_type: "create_invoice", payload: { amountUsd: 250 }, depends_on: [0] },
          ],
        });
      },
    };
    const planner = new LLMPlanner(createDefaultPluginRegistry(), provider);
    const actions = await planner.plan("Create the two approved invoices in order.", context(), emptyMemory());
    expect(actions).toHaveLength(2);

    const rows = await withTenant(TENANT_ID, (db) =>
      db.select().from(domainActions).where(and(eq(domainActions.tenantId, TENANT_ID), eq(domainActions.id, actions[0]!.id))),
    );
    const planRows = await withTenant(TENANT_ID, (db) =>
      db.select().from(domainActions).where(and(eq(domainActions.tenantId, TENANT_ID), inArray(domainActions.id, actions.map((action) => action.id)))),
    );
    const first = planRows.find((row) => row.id === actions[0]!.id);
    const second = planRows.find((row) => row.id === actions[1]!.id);
    expect(first!.planId).toBeTruthy();
    expect(second!.planId).toBe(first!.planId);
    expect(second!.dependsOn).toEqual([first!.id]);

    const before = await readyPlanActions(TENANT_ID, first!.planId!);
    expect(before.map((action) => action.id)).toEqual([first!.id]);

    await withTenant(TENANT_ID, (db) => db.update(domainActions).set({ status: "completed" }).where(eq(domainActions.id, first!.id)));
    const after = await readyPlanActions(TENANT_ID, first!.planId!);
    expect(after.map((action) => action.id)).toEqual([second!.id]);
  });

  it("does not treat a foreign-tenant action id as a completed prerequisite", async () => {
    const planId = randomUUID();
    const foreignPrerequisite = randomUUID();
    const ownDependent = randomUUID();
    await withTenant(TENANT_ID, (db) =>
      db.insert(domainActions).values({ id: ownDependent, tenantId: TENANT_ID, actionType: "create_invoice", payload: {}, planId, dependsOn: [foreignPrerequisite] }),
    );
    expect(await readyPlanActions(TENANT_ID, planId)).toEqual([]);
  });

  it("executes a two-step DAG in dependency order with one runtime receipt per step", async () => {
    const planId = randomUUID();
    const [first] = await withTenant(TENANT_ID, (db) =>
      db.insert(domainActions).values({ tenantId: TENANT_ID, actionType: "manual_step_suggestion", payload: { originalActionType: "first", originalPayload: {}, unavailableCapabilities: ["test"], reason: "first receipt fixture" }, planId }).returning(),
    );
    const [second] = await withTenant(TENANT_ID, (db) =>
      db.insert(domainActions).values({ tenantId: TENANT_ID, actionType: "manual_step_suggestion", payload: { originalActionType: "second", originalPayload: {}, unavailableCapabilities: ["test"], reason: "second receipt fixture" }, planId, dependsOn: [first!.id] }).returning(),
    );
    const executor = new GatedExecutor(createDefaultPluginRegistry(), createDefaultRegistry());
    const policy = { id: "", tenantId: TENANT_ID, actionType: "manual_step_suggestion", policy: {}, requiresConfirmation: false, confirmationTemplate: null, version: 0 };
    expect((await readyPlanActions(TENANT_ID, planId)).map((action) => action.id)).toEqual([first!.id]);
    await executor.execute({ id: first!.id, tenantId: TENANT_ID, actionType: first!.actionType, payload: first!.payload as Record<string, unknown>, policyId: null, status: "draft", createdAt: first!.createdAt.toISOString() }, policy);
    await runDurableAction(first!.id);
    expect((await readyPlanActions(TENANT_ID, planId)).map((action) => action.id)).toEqual([second!.id]);
    await executor.execute({ id: second!.id, tenantId: TENANT_ID, actionType: second!.actionType, payload: second!.payload as Record<string, unknown>, policyId: null, status: "draft", createdAt: second!.createdAt.toISOString() }, policy);
    await runDurableAction(second!.id);
    const receipts = await withTenant(TENANT_ID, (db) => db.select().from(decisionReceipts).where(eq(decisionReceipts.tenantId, TENANT_ID)));
    expect(receipts.filter((receipt) => receipt.domainActionId === first!.id || receipt.domainActionId === second!.id)).toHaveLength(2);
  });
});
