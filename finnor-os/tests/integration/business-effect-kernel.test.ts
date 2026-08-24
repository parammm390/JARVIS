import { randomUUID } from "node:crypto";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import {
  businessEffects,
  closePool,
  decisionReceipts,
  domainActions,
  households,
  reconciliationCases,
  serviceVisits,
  tasks,
  users,
  withTenant,
  workflowSteps,
} from "@finnor/db";
import {
  BusinessEffectBoundaryError,
  FinnorOrchestrator,
  createDefaultPluginRegistry,
  ensureBusinessEffect,
  markBusinessEffectAuthorized,
  markBusinessEffectExecuting,
  recordBusinessEffectOutcome,
  verifyBusinessEffectPreconditions,
} from "@finnor/orchestration";
import { ToolRegistry } from "@finnor/tools";
import type { BusinessEffectSet, DomainAction } from "@finnor/shared-types";
import { migrate } from "../../packages/db/migrate";
import { runWorkflowStep } from "../../apps/worker/src/handlers/run-workflow-step";

const DB_URL = process.env.DATABASE_URL ?? "postgres://finnor:finnor@localhost:5432/finnor";
const available = await (async () => {
  const client = new pg.Client({ connectionString: DB_URL, connectionTimeoutMillis: 2_000 });
  try { await client.connect(); await client.end(); return true; } catch { return false; }
})();

const tenantId = randomUUID();
const otherTenantId = randomUUID();
const ownerId = randomUUID();
const householdId = randomUUID();
const otherHouseholdId = randomUUID();
const taskId = randomUUID();
const divergentTaskId = randomUUID();
const visitId = randomUUID();

async function compile(actionType: string, payload: Record<string, unknown>): Promise<{ action: DomainAction; effect: BusinessEffectSet; orchestrator: FinnorOrchestrator }> {
  const orchestrator = new FinnorOrchestrator({ tools: new ToolRegistry() });
  const [row] = await withTenant(tenantId, (db) => db.insert(domainActions).values({
    tenantId,
    actionType,
    payload,
    status: "draft",
    initiatedBy: ownerId,
  }).returning());
  const action: DomainAction = {
    id: row!.id,
    tenantId,
    actionType,
    payload: row!.payload as Record<string, unknown>,
    policyId: row!.policyId,
    status: row!.status,
    initiatedBy: row!.initiatedBy,
    createdAt: row!.createdAt.toISOString(),
  };
  const policy = await orchestrator.loadPolicy(action);
  const plugin = createDefaultPluginRegistry().resolve(actionType);
  if (!plugin) throw new Error(`missing plugin for ${actionType}`);
  const validation = await plugin.validate(actionType, payload, policy);
  if (!validation.valid) throw new Error(validation.errors.join("; "));
  const draft = await plugin.draft(actionType, payload, policy);
  const effect = await ensureBusinessEffect({ action, draft, policy, approval: { requiresConfirmation: true, typedConfirmation: false } });
  if (!effect) throw new Error(`${actionType} unexpectedly compiled as a read`);
  return { action, effect, orchestrator };
}

describe.skipIf(!available)("Universal Business Effect kernel", () => {
  beforeAll(async () => {
    process.env.DATABASE_URL = DB_URL;
    await migrate(DB_URL);
    // Creating the two tenant roots outside tenant-scoped helpers is intentional
    // fixture setup; all product-owned rows below use withTenant.
    const admin = new pg.Client({ connectionString: DB_URL });
    await admin.connect();
    await admin.query(`INSERT INTO finnor_os.tenants(id,name) VALUES ($1,'Effect Tenant'),($2,'Other Effect Tenant')`, [tenantId, otherTenantId]);
    await admin.query(`INSERT INTO finnor_os.households(id,tenant_id,address) VALUES ($1,$2,'Cross-tenant target')`, [otherHouseholdId, otherTenantId]);
    await admin.end();
    await withTenant(tenantId, async (db) => {
      await db.insert(users).values({ id: ownerId, tenantId, email: `${ownerId}@effect.test`, role: "owner", displayName: "Effect Owner", status: "active" });
      await db.insert(households).values({ id: householdId, tenantId, address: "1 Effect Way", contactInfo: { phone: "+15550100001" } });
      await db.insert(tasks).values([
        { id: taskId, tenantId, subjectType: "household", subjectId: householdId, title: "Inspect system", status: "open", priority: "normal" },
        { id: divergentTaskId, tenantId, subjectType: "household", subjectId: householdId, title: "Remain open", status: "open", priority: "normal" },
      ]);
      await db.insert(serviceVisits).values({ id: visitId, tenantId, householdId, type: "water_test", scheduledAt: new Date("2026-09-01T14:00:00.000Z") });
    });
  });

  afterAll(async () => { await closePool(); });

  it("carries one exact deterministic effect through approval, authority, execution, verification, and receipt", async () => {
    const { action, effect, orchestrator } = await compile("update_task", {
      taskRef: { taskId },
      title: "Inspect and document system",
      status: "done",
      priority: "high",
    });
    expect(effect.targets).toContainEqual(expect.objectContaining({ kind: "entity", type: "task", id: taskId }));
    expect(effect.before[0]).toMatchObject({ target: { type: "task", id: taskId }, values: { title: "Inspect system", status: "open", priority: "normal" } });
    expect(effect.delta.values).toMatchObject({ taskRef: { taskId }, title: "Inspect and document system", status: "done", priority: "high" });
    expect(effect.expected.state).toEqual({ title: "Inspect and document system", status: "done", priority: "high" });

    await withTenant(tenantId, (db) => db.update(domainActions).set({ status: "pending", summary: effect.approval.summary }).where(eq(domainActions.id, action.id)));
    const result = await orchestrator.decide(action.id, tenantId, "approve", ownerId, { role: "owner" });
    expect(result.status).toBe("success");
    expect(result.output).toMatchObject({ authorized: true, durable: true, queued: true });

    const [queuedStep] = await withTenant(tenantId, (db) => db.select().from(workflowSteps)
      .where(and(eq(workflowSteps.tenantId, tenantId), eq(workflowSteps.domainActionId, action.id))).limit(1));
    expect(queuedStep).toMatchObject({ status: "pending", executionState: "authorized", stepType: "execute_authorized_effect" });
    await runWorkflowStep({ tenantId, workflowStepId: queuedStep!.id });

    const [storedEffect, storedAction, receipt] = await withTenant(tenantId, async (db) => Promise.all([
      db.select().from(businessEffects).where(eq(businessEffects.id, effect.id)).then((rows) => rows[0]),
      db.select().from(domainActions).where(eq(domainActions.id, action.id)).then((rows) => rows[0]),
      db.select().from(decisionReceipts).where(eq(decisionReceipts.businessEffectId, effect.id)).then((rows) => rows[0]),
    ]));
    expect(storedAction!.status).toBe("completed");
    expect(storedEffect!.status).toBe("verified");
    expect(storedEffect!.verification).toMatchObject({ state: "verified" });
    expect(receipt).toMatchObject({
      intendedEffectHash: effect.semanticHash,
      authorizedEffectHash: effect.semanticHash,
      executedEffectHash: effect.semanticHash,
      verification: expect.objectContaining({ state: "verified" }),
    });
  });

  it("freezes exact communication and financial semantics and rejects material broadening", async () => {
    const communication = await compile("send_customer_message", {
      phone: "+15550100001",
      channel: "sms",
      message: "Your service visit is confirmed for Tuesday.",
    });
    expect(communication.effect.targets).toContainEqual(expect.objectContaining({ type: "phone_endpoint", id: "+15550100001" }));
    expect(communication.effect.delta.values).toMatchObject({ channel: "sms", message: "Your service visit is confirmed for Tuesday." });
    expect(communication.effect.bindings).toContainEqual(expect.objectContaining({ selection: "policy_resolved" }));
    expect(communication.effect.approval.summary).toContain("+15550100001");
    expect(communication.effect.approval.summary).toContain("Your service visit is confirmed for Tuesday.");

    const policy = await communication.orchestrator.loadPolicy(communication.action);
    const plugin = createDefaultPluginRegistry().resolve("send_customer_message")!;
    const broadened = await plugin.draft("send_customer_message", { phone: "+15550199999", channel: "sms", message: "A broader message" }, policy);
    await expect(ensureBusinessEffect({ action: communication.action, draft: broadened, policy, approval: { requiresConfirmation: true, typedConfirmation: false } }))
      .rejects.toMatchObject({ name: "BusinessEffectBoundaryError", code: "material_effect_change" });

    const financial = await compile("create_invoice", { householdId, amountUsd: 475.25, memo: "Approved installation deposit" });
    expect(financial.effect.exposure).toEqual({ amount: 475.25, currency: "USD" });
    expect(financial.effect.targets).toContainEqual(expect.objectContaining({ type: "household", id: householdId }));
    expect(financial.effect.delta.values).toMatchObject({ amountUsd: 475.25, householdId });
    const financialPolicy = await financial.orchestrator.loadPolicy(financial.action);
    const accounting = createDefaultPluginRegistry().resolve("create_invoice")!;
    const increased = await accounting.draft("create_invoice", { householdId, amountUsd: 575.25, memo: "Approved installation deposit" }, financialPolicy);
    await expect(ensureBusinessEffect({ action: financial.action, draft: increased, policy: financialPolicy, approval: { requiresConfirmation: true, typedConfirmation: false } }))
      .rejects.toBeInstanceOf(BusinessEffectBoundaryError);
  });

  it("detects stale scheduling state before execution", async () => {
    const { effect } = await compile("reschedule_visit", { visitId, newTime: "2026-09-03T15:30:00.000Z", reason: "Customer request" });
    expect(effect.before[0]).toMatchObject({ target: { type: "service_visit", id: visitId }, values: { scheduledAt: "2026-09-01T14:00:00.000Z" } });
    expect(effect.expected.state).toEqual({ scheduledAt: "2026-09-03T15:30:00.000Z" });
    await withTenant(tenantId, (db) => db.update(serviceVisits).set({ scheduledAt: new Date("2026-09-02T16:00:00.000Z") }).where(eq(serviceVisits.id, visitId)));
    await expect(verifyBusinessEffectPreconditions(tenantId, effect)).rejects.toMatchObject({ code: "stale_precondition" });
  });

  it("keeps divergence and unknown delivery truthful, and blocks blind replay", async () => {
    const divergent = await compile("update_task", { taskRef: { taskId: divergentTaskId }, status: "done" });
    await markBusinessEffectAuthorized(tenantId, divergent.effect.id);
    await markBusinessEffectExecuting(tenantId, divergent.effect);
    const mismatch = await recordBusinessEffectOutcome(tenantId, divergent.effect, { status: "success", output: { providerAccepted: true } });
    expect(mismatch.state).toBe("divergent");

    const uncertain = await compile("send_customer_message", { phone: "+15550100001", channel: "sms", message: "Uncertain delivery test" });
    await markBusinessEffectAuthorized(tenantId, uncertain.effect.id);
    await markBusinessEffectExecuting(tenantId, uncertain.effect);
    const unknown = await recordBusinessEffectOutcome(tenantId, uncertain.effect, { status: "failure", output: { dispatched: true }, error: "connection lost", errorKind: "unknown_outcome" });
    expect(unknown.state).toBe("reconciliation_required");
    const [reconciliation] = await withTenant(tenantId, (db) => db.select().from(reconciliationCases).where(and(eq(reconciliationCases.tenantId, tenantId), eq(reconciliationCases.businessEffectId, uncertain.effect.id))));
    expect(reconciliation).toMatchObject({ status: "open", caseType: "unknown_delivery" });
    await expect(markBusinessEffectExecuting(tenantId, uncertain.effect)).rejects.toMatchObject({ code: "material_effect_change" });
  });

  it("rejects forged cross-tenant targets and immutable effect mutation at both compiler and database boundaries", async () => {
    await expect(compile("create_invoice", { householdId: otherHouseholdId, amountUsd: 10 }))
      .rejects.toMatchObject({ name: "BusinessEffectBoundaryError", code: "effect_missing" });

    const { effect } = await compile("send_customer_message", { phone: "+15550100001", channel: "sms", message: "Immutable intent" });
    await expect(withTenant(tenantId, (db) => db.update(businessEffects).set({ effect: { tampered: true } }).where(eq(businessEffects.id, effect.id))))
      .rejects.toMatchObject({ cause: expect.objectContaining({ message: expect.stringMatching(/immutable/i) }) });
    await expect(withTenant(tenantId, (db) => db.delete(businessEffects).where(eq(businessEffects.id, effect.id))))
      .rejects.toMatchObject({ cause: expect.objectContaining({ message: expect.stringMatching(/append-only/i) }) });

    const [forgedAction] = await withTenant(tenantId, (db) => db.insert(domainActions).values({ tenantId, actionType: "create_invoice", payload: {}, status: "draft" }).returning());
    const forgedId = randomUUID();
    const forgedBody = {
      schemaVersion: 1,
      source: { domainActionId: forgedAction!.id, actionType: "create_invoice", workId: null, objectiveStepId: null },
      targets: [{ kind: "entity", type: "household", id: otherHouseholdId, sourcePath: "householdId" }],
      bindings: [],
      authority: { policyId: null },
    };
    await expect(withTenant(tenantId, (db) => db.insert(businessEffects).values({
      id: forgedId,
      tenantId,
      domainActionId: forgedAction!.id,
      semanticHash: "a".repeat(64),
      scopeHash: "b".repeat(64),
      operationClass: "financial_write",
      effect: forgedBody,
    }))).rejects.toMatchObject({ cause: expect.objectContaining({ message: expect.stringMatching(/crosses tenant boundary|does not exist/i) }) });

    const secretEffectId = randomUUID();
    await expect(withTenant(tenantId, (db) => db.insert(businessEffects).values({
      id: secretEffectId,
      tenantId,
      domainActionId: forgedAction!.id,
      semanticHash: "e".repeat(64),
      scopeHash: "f".repeat(64),
      operationClass: "financial_write",
      effect: {
        ...forgedBody,
        targets: [{ kind: "resource", type: "proposed_business_change", id: forgedAction!.id, sourcePath: "domainActionId" }],
        authorizationToken: "must-never-be-persisted",
      },
    }))).rejects.toMatchObject({ cause: expect.objectContaining({ message: expect.stringMatching(/business_effects_no_secrets_check/i) }) });
  });

  it("leaves deterministic reads outside mutation-effect machinery", async () => {
    const orchestrator = new FinnorOrchestrator({ tools: new ToolRegistry() });
    const [row] = await withTenant(tenantId, (db) => db.insert(domainActions).values({ tenantId, actionType: "answer_customer_question", payload: { question: "When is our next service visit?" }, status: "draft" }).returning());
    const action: DomainAction = { id: row!.id, tenantId, actionType: row!.actionType, payload: row!.payload as Record<string, unknown>, policyId: null, status: row!.status, createdAt: row!.createdAt.toISOString() };
    const policy = await orchestrator.loadPolicy(action);
    const plugin = createDefaultPluginRegistry().resolve(action.actionType)!;
    const draft = await plugin.draft(action.actionType, action.payload, policy);
    expect(await ensureBusinessEffect({ action, draft, policy, approval: { requiresConfirmation: false, typedConfirmation: false } })).toBeUndefined();
    const [stored] = await withTenant(tenantId, (db) => db.select({ businessEffectId: domainActions.businessEffectId }).from(domainActions).where(eq(domainActions.id, action.id)));
    expect(stored!.businessEffectId).toBeNull();
  });
});
