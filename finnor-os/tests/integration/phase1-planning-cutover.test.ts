import { randomUUID } from "node:crypto";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { and, eq, isNull } from "drizzle-orm";
import {
  businessEffects,
  closePool,
  domainActions,
  households,
  planningIrArtifacts,
  tenants,
  withTenant,
} from "@finnor/db";
import {
  createDefaultPluginRegistry,
  ensureBusinessEffect,
  LLMPlanner,
  startWorkObjective,
  type LLMProvider,
} from "@finnor/orchestration";
import type { DomainAction, DomainPolicy, MemorySnapshot, TenantContext } from "@finnor/shared-types";
import { migrate } from "../../packages/db/migrate";

const DB_URL = process.env.DATABASE_URL ?? "postgres://finnor:finnor@localhost:5432/finnor";
const available = await (async () => {
  const client = new pg.Client({ connectionString: DB_URL, connectionTimeoutMillis: 2_000 });
  try { await client.connect(); await client.end(); return true; } catch { return false; }
})();
const tenantId = randomUUID();
const householdId = randomUUID();
const memory = (): MemorySnapshot => ({ shortTerm: null, longTerm: null, semantic: [], episodic: [], patterns: null });
const context = (): TenantContext => ({ tenantId, userId: "phase1-cutover-fixture", role: "owner" });
const provider: LLMProvider = {
  name: "phase1-frozen-planner",
  async complete() {
    return JSON.stringify({ actions: [{ action_type: "create_invoice", payload: { householdId, amountUsd: 125, memo: "Phase 1 cutover proof" } }] });
  },
};

describe.skipIf(!available).sequential("Phase-1 Planning IR shadow and cutover", () => {
  beforeAll(async () => {
    process.env.DATABASE_URL = DB_URL;
    await migrate(DB_URL);
    await withTenant(tenantId, async (db) => {
      await db.insert(tenants).values({ id: tenantId, name: "Phase 1 Cutover Tenant" });
      await db.insert(households).values({ id: householdId, tenantId, address: "1 Cutover Proof Way" });
    });
  });

  afterAll(async () => {
    delete process.env.FINNOR_PLANNING_IR_MODE;
    await closePool();
  });

  it("runs the candidate IR in shadow with zero BusinessEffects, then cuts the same semantics over through the lowerer", async () => {
    process.env.FINNOR_PLANNING_IR_MODE = "shadow";
    const [shadowAction] = await new LLMPlanner(createDefaultPluginRegistry(), provider).plan(
      "Create the approved $125 invoice.", context(), memory(), { executionModel: "ATOMIC_EFFECT" },
    );
    const [shadowIr] = await withTenant(tenantId, (db) => db.select().from(planningIrArtifacts).where(eq(planningIrArtifacts.domainActionId, shadowAction!.id)));
    expect(shadowIr).toMatchObject({ status: "shadow", comparisonClassification: "EQUIVALENT" });
    expect(await withTenant(tenantId, (db) => db.select().from(businessEffects).where(eq(businessEffects.domainActionId, shadowAction!.id)))).toHaveLength(0);

    process.env.FINNOR_PLANNING_IR_MODE = "cutover";
    const [cutoverAction] = await new LLMPlanner(createDefaultPluginRegistry(), provider).plan(
      "Create the approved $125 invoice.", context(), memory(), { executionModel: "ATOMIC_EFFECT" },
    );
    const [cutoverIr] = await withTenant(tenantId, (db) => db.select().from(planningIrArtifacts).where(eq(planningIrArtifacts.domainActionId, cutoverAction!.id)));
    expect(cutoverIr).toMatchObject({ status: "lowered", comparisonClassification: "EQUIVALENT" });
    expect(cutoverAction).toMatchObject({ actionType: shadowAction!.actionType, payload: shadowAction!.payload });
    expect(cutoverIr!.irSemanticHash).toBe(shadowIr!.irSemanticHash);

    const action = cutoverAction as DomainAction;
    const policy: DomainPolicy = { id: "", tenantId, actionType: action.actionType, policy: {}, requiresConfirmation: true, confirmationTemplate: null, version: 0 };
    const plugin = createDefaultPluginRegistry().resolve(action.actionType)!;
    const draft = await plugin.draft(action.actionType, action.payload, policy);
    const effect = await ensureBusinessEffect({ action, draft, policy, approval: { requiresConfirmation: true, typedConfirmation: false } });
    expect(effect).toBeDefined();
    expect(effect!.semanticHash).not.toBe(cutoverIr!.irSemanticHash);
    expect(JSON.stringify(effect)).not.toContain("irSemanticHash");
    const [storedEffect] = await withTenant(tenantId, (db) => db.select().from(businessEffects).where(eq(businessEffects.domainActionId, action.id)));
    expect(storedEffect!.semanticHash).toBe(effect!.semanticHash);
    expect(storedEffect!.semanticHash).not.toBe(cutoverIr!.irSemanticHash);
  });

  it("persists the Objective goal IR before its controller proposes any effect", async () => {
    process.env.FINNOR_PLANNING_IR_MODE = "cutover";
    const started = await startWorkObjective("Keep every open customer invoice followed up until its persisted success condition is true.", context(), {
      channel: "text",
      activeContext: { householdId },
      maxSteps: 2,
      maxActions: 1,
      maxQueries: 2,
    });
    const [goalIr] = await withTenant(tenantId, (db) => db.select().from(planningIrArtifacts).where(and(
      eq(planningIrArtifacts.workId, started.workId),
      isNull(planningIrArtifacts.domainActionId),
      isNull(planningIrArtifacts.objectiveStepId),
    )));
    expect(goalIr).toMatchObject({ status: "accepted", comparisonClassification: "EQUIVALENT" });
    expect((goalIr!.artifact as { effects: unknown[] }).effects).toEqual([]);
    expect((goalIr!.artifact as { intent: { executionModel: string } }).intent.executionModel).toBe("OBJECTIVE");
    expect(await withTenant(tenantId, (db) => db.select().from(domainActions).where(eq(domainActions.workId, started.workId)))).toHaveLength(0);
  });
});
