import { randomUUID } from "node:crypto";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { and, eq, isNull } from "drizzle-orm";
import {
  businessEffects,
  closePool,
  commands,
  domainActions,
  households,
  planningIrArtifacts,
  tenants,
  works,
  withTenant,
} from "@finnor/db";
import {
  ActionCancellationConflictError,
  authorizeActionExecutionTx,
  createDefaultPluginRegistry,
  compilePlanningEffectToBusinessEffect,
  createDbIrAdmissibilityCompiler,
  LLMPlanner,
  NativePlanningIrRequiredError,
  startWorkObjective,
  type LLMProvider,
} from "@finnor/orchestration";
import { computeIrSemanticHash, parsePlanningIrArtifact } from "@finnor/planning-ir";
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
    const target = { kind: "party", entityType: "household", entityId: householdId, field: "householdId", relationship: "customer_account" };
    return JSON.stringify({ planning_ir: {
      intent: { requestedOutcome: "Create the approved $125 invoice.", executionModel: "ATOMIC_EFFECT", groundedEntities: [target], scope: { included: [target], excluded: [], textExclusions: [] }, unresolvedAmbiguity: [] },
      goal: { statement: "Create the approved $125 invoice.", desiredState: [{ subject: { kind: "business_state", key: "invoice" }, path: ["status"], operator: "eq", expected: "created" }], completionMode: "all", objectiveCompatibility: "reuse_existing_objective_semantics" },
      constraints: { hard: [{ id: "approval-floor", strength: "HARD", kind: "policy_authority", description: "Invoice creation requires approval", status: "violated", subjectRefs: [target], values: { requiresApproval: true } }], soft: [] },
      plan: { nodes: [
        { id: "effect-node", kind: "effect", effectId: "invoice-effect", dependsOn: [], causalPrerequisites: [], requiredCapabilities: ["action:create_invoice"] },
        { id: "observe-node", kind: "observe", observationId: "invoice-observation", dependsOn: ["effect-node"], causalPrerequisites: ["effect-node"], requiredCapabilities: [] },
      ], completion: { mode: "all", observationIds: ["invoice-observation"] } },
      effects: [{ id: "invoice-effect", actionType: "create_invoice", effectIntent: "Create the governed customer invoice", payload: { householdId, amountUsd: 125, memo: "Phase 1 cutover proof" }, targetRefs: [target], requiredCapability: "action:create_invoice", risk: "high", exposure: { amount: 125, currency: "USD" }, proposalOnly: true }],
      observations: [{ id: "invoice-observation", effectId: "invoice-effect", kind: "canonical_state", predicate: { entityType: "invoice", exists: true }, requiredEvidence: ["canonical_read_back"], acknowledgementSufficient: false, verificationFloor: "at_least_existing" }],
    } });
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
    process.env.FINNOR_PLANNING_IR_MODE = "shadow-native-ir";
    const [shadowAction] = await new LLMPlanner(createDefaultPluginRegistry(), provider).plan(
      "Create the approved $125 invoice.", context(), memory(), { executionModel: "ATOMIC_EFFECT" },
    );
    const [shadowIr] = await withTenant(tenantId, (db) => db.select().from(planningIrArtifacts).where(eq(planningIrArtifacts.domainActionId, shadowAction!.id)));
    expect(shadowIr).toMatchObject({ status: "shadow", comparisonClassification: "EXPECTED_IMPROVEMENT", effectId: "invoice-effect" });
    expect(await withTenant(tenantId, (db) => db.select().from(businessEffects).where(eq(businessEffects.domainActionId, shadowAction!.id)))).toHaveLength(0);

    process.env.FINNOR_PLANNING_IR_MODE = "native-ir";
    const [cutoverAction] = await new LLMPlanner(createDefaultPluginRegistry(), provider).plan(
      "Create the approved $125 invoice.", context(), memory(), { executionModel: "ATOMIC_EFFECT" },
    );
    const [cutoverIr] = await withTenant(tenantId, (db) => db.select().from(planningIrArtifacts).where(eq(planningIrArtifacts.domainActionId, cutoverAction!.id)));
    expect(cutoverIr).toMatchObject({ status: "lowered", comparisonClassification: "EXPECTED_IMPROVEMENT", effectId: "invoice-effect" });
    expect(cutoverAction).toMatchObject({ actionType: shadowAction!.actionType, payload: shadowAction!.payload });
    expect(cutoverIr!.irSemanticHash).toBe(shadowIr!.irSemanticHash);

    const action = cutoverAction as DomainAction;
    const policy: DomainPolicy = { id: "", tenantId, actionType: action.actionType, policy: {}, requiresConfirmation: true, confirmationTemplate: null, version: 0 };
    const plugin = createDefaultPluginRegistry().resolve(action.actionType)!;
    const draft = await plugin.draft(action.actionType, action.payload, policy);
    const nativeArtifact = cutoverIr!.artifact as { goal: { desiredState: unknown[] }; constraints: { hard: Array<{ id: string; status: string }> }; plan: { nodes: unknown[] } };
    expect(nativeArtifact.goal.desiredState).toHaveLength(1);
    // The planner claimed "violated"; independent policy truth admitted it.
    expect(nativeArtifact.constraints.hard).toContainEqual(expect.objectContaining({ id: "approval-floor", status: "violated" }));
    expect(nativeArtifact.plan.nodes).toHaveLength(2);
    const effect = await compilePlanningEffectToBusinessEffect({ action, draft, policy, approval: { requiresConfirmation: true, typedConfirmation: false } });
    expect(effect).toBeDefined();
    expect(effect!.semanticHash).not.toBe(cutoverIr!.irSemanticHash);
    expect(JSON.stringify(effect)).not.toContain("irSemanticHash");
    const [storedEffect] = await withTenant(tenantId, (db) => db.select().from(businessEffects).where(eq(businessEffects.domainActionId, action.id)));
    expect(storedEffect!.semanticHash).toBe(effect!.semanticHash);
    expect(storedEffect!.semanticHash).not.toBe(cutoverIr!.irSemanticHash);
  });

  it("fails closed without persisting an action when a native-mode model returns the legacy envelope", async () => {
    process.env.FINNOR_PLANNING_IR_MODE = "native-ir";
    const legacyProvider: LLMProvider = { name: "forbidden-legacy-envelope", async complete() { return JSON.stringify({ actions: [{ action_type: "create_invoice", payload: { householdId, amountUsd: 100 }, reasoning: "legacy envelope" }] }); } };
    const before = await withTenant(tenantId, (db) => db.select({ id: domainActions.id }).from(domainActions));
    await expect(new LLMPlanner(createDefaultPluginRegistry(), legacyProvider).plan(
      "Create the approved $100 invoice.", context(), memory(), { executionModel: "ATOMIC_EFFECT" },
    )).rejects.toBeInstanceOf(NativePlanningIrRequiredError);
    const after = await withTenant(tenantId, (db) => db.select({ id: domainActions.id }).from(domainActions));
    expect(after).toHaveLength(before.length);
  });

  it("persists the Objective goal IR before its controller proposes any effect", async () => {
    process.env.FINNOR_PLANNING_IR_MODE = "native-ir";
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

  it("independently rejects terminal Work at admissibility and at the final execution fence", async () => {
    process.env.FINNOR_PLANNING_IR_MODE = "native-ir";
    const [planned] = await new LLMPlanner(createDefaultPluginRegistry(), provider).plan(
      "Create the approved $125 invoice.", context(), memory(), { executionModel: "ATOMIC_EFFECT" },
    );
    const workId = randomUUID();
    await withTenant(tenantId, async (db) => {
      await db.insert(works).values({ id: workId, tenantId, status: "failed", initialChannel: "text", initialInstruction: "Create the approved $125 invoice." });
      await db.update(domainActions).set({ workId }).where(and(eq(domainActions.tenantId, tenantId), eq(domainActions.id, planned!.id)));
    });
    const [storedIr] = await withTenant(tenantId, (db) => db.select().from(planningIrArtifacts).where(eq(planningIrArtifacts.domainActionId, planned!.id)).limit(1));
    const candidate = parsePlanningIrArtifact(storedIr!.artifact);
    candidate.constraints.hard.push({
      id: "work-must-remain-executable",
      strength: "HARD",
      kind: "precondition",
      description: "Terminal Work cannot authorize a new undispatched effect",
      status: "satisfied",
      subjectRefs: [{ kind: "work", entityType: "work", entityId: workId, field: "workId", provenance: "trusted_runtime_context" }],
      values: { workNotTerminal: true },
    });
    candidate.metadata.irSemanticHash = computeIrSemanticHash(candidate);
    const registry = createDefaultPluginRegistry();
    const admissibility = await withTenant(tenantId, (db) => createDbIrAdmissibilityCompiler({ db, tenantId, plugins: registry }).admit(candidate));
    expect(admissibility.admissible).toBe(false);
    if (!admissibility.admissible) expect(admissibility.issues).toContainEqual(expect.objectContaining({ code: "HARD_CONSTRAINT_VIOLATED" }));

    const action = { ...planned!, workId } as DomainAction;
    const policy: DomainPolicy = { id: "", tenantId, actionType: action.actionType, policy: {}, requiresConfirmation: true, confirmationTemplate: null, version: 0 };
    const plugin = registry.resolve(action.actionType)!;
    const draft = await plugin.draft(action.actionType, action.payload, policy);
    const effect = await compilePlanningEffectToBusinessEffect({ action, draft, policy, approval: { requiresConfirmation: true, typedConfirmation: false } });
    await expect(withTenant(tenantId, (db) => authorizeActionExecutionTx(db, { tenantId, actionId: action.id, authorizationSource: "human_approval" }))).rejects.toBeInstanceOf(ActionCancellationConflictError);
    expect(await withTenant(tenantId, (db) => db.select().from(commands).where(eq(commands.businessEffectId, effect!.id)))).toHaveLength(0);
  });
});
