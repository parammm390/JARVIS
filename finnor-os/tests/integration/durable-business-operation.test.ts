import { afterAll, beforeAll, describe, expect, it } from "vitest";
import pg from "pg";
import { randomUUID } from "node:crypto";
import { and, eq, inArray } from "drizzle-orm";
import { migrate } from "../../packages/db/migrate";
import {
  businessOperationAggregate,
  businessOperations,
  businessOperationTargets,
  closePool,
  decisionReceipts,
  domainActions,
  getPool,
  households,
  jobs,
  retryBusinessOperation,
  sandboxOutbox,
  withTenant,
} from "@finnor/db";
import { FinnorOrchestrator } from "@finnor/orchestration";
import { ToolRegistry } from "@finnor/tools";
import type { DomainAction } from "@finnor/shared-types";
import { dispatchBusinessOperation, executeBusinessOperationTarget } from "../../apps/worker/src/handlers/business-operation";
import { nextCallingWindow } from "@finnor/plugin-bulk-notify";

const DB_URL = process.env.DATABASE_URL ?? "postgres://finnor:finnor@localhost:5432/finnor";

async function dbUp(): Promise<boolean> {
  const client = new pg.Client({ connectionString: DB_URL, connectionTimeoutMillis: 2_000 });
  try {
    await client.connect();
    await client.end();
    return true;
  } catch {
    return false;
  }
}

const available = await dbUp();

describe.skipIf(!available)("Upgrade 6 durable customer win-back operation", () => {
  const tenantId = randomUUID();
  let operationId = "";
  let actionId = "";
  let validHouseholdId = "";
  let revokedHouseholdId = "";
  let invalidHouseholdId = "";

  beforeAll(async () => {
    process.env.DATABASE_URL = DB_URL;
    process.env.COMMS_MODE = "sandbox";
    await migrate(DB_URL);
    await getPool().query(`INSERT INTO finnor_os.tenants (id, name) VALUES ($1, 'Durable Operation Test')`, [tenantId]);
    await withTenant(tenantId, async (db) => {
      const created = await db.insert(households).values([
        { tenantId, address: "1 Durable Way", contactInfo: { name: "Valid Target", phone: "+15550100001" }, marketingConsent: true },
        { tenantId, address: "2 Durable Way", contactInfo: { name: "Revoked Target", phone: "+15550100002" }, marketingConsent: true },
        { tenantId, address: "3 Durable Way", contactInfo: { name: "Invalid Target", phone: "not-a-phone" }, marketingConsent: true },
      ]).returning({ id: households.id });
      validHouseholdId = created[0]!.id;
      revokedHouseholdId = created[1]!.id;
      invalidHouseholdId = created[2]!.id;
    });
  });

  afterAll(async () => {
    await closePool();
  });

  it("freezes the exact cohort and approval only queues durable execution", async () => {
    const [row] = await withTenant(tenantId, (db) => db.insert(domainActions).values({
      tenantId,
      actionType: "bulk_notify_existing_customers",
      payload: { channel: "sms", discountPercent: 15, minDaysInactive: 0 },
      status: "draft",
    }).returning());
    actionId = row!.id;
    const action: DomainAction = {
      id: row!.id,
      tenantId,
      actionType: row!.actionType,
      payload: row!.payload as Record<string, unknown>,
      policyId: null,
      policyVersion: null,
      status: "draft",
      createdAt: row!.createdAt.toISOString(),
    };
    // No execution tool is registered here. Reaching a tool call during approval
    // would fail the test; durable workers own all effects after authorization.
    const orchestrator = new FinnorOrchestrator({ tools: new ToolRegistry() });
    const policy = await orchestrator.loadPolicy(action);
    const gated = await orchestrator.executor.execute(action, policy);
    expect(gated.output.pendingConfirmation).toBe(true);

    const [persistedAction] = await withTenant(tenantId, (db) => db.select().from(domainActions).where(eq(domainActions.id, actionId)));
    expect(persistedAction!.payload).not.toHaveProperty("_operationPreparationTargets");

    const [prepared] = await withTenant(tenantId, (db) => db.select().from(businessOperations).where(eq(businessOperations.domainActionId, actionId)));
    operationId = prepared!.id;
    expect(prepared!.status).toBe("awaiting_approval");
    const frozen = await withTenant(tenantId, (db) => db.select().from(businessOperationTargets).where(eq(businessOperationTargets.operationId, operationId)));
    expect(frozen.map((target) => target.targetId).sort()).toEqual([validHouseholdId, revokedHouseholdId, invalidHouseholdId].sort());
    expect(frozen.every((target) => Boolean((target.preparedPayload as Record<string, unknown>).message))).toBe(true);

    const approved = await orchestrator.decide(actionId, tenantId, "approve", "owner:test", { typedConfirmation: true, role: "owner" });
    expect(approved.output).toMatchObject({ authorized: true, durable: true, operationId, queued: true });
    const [queuedOperation] = await withTenant(tenantId, (db) => db.select().from(businessOperations).where(eq(businessOperations.id, operationId)));
    expect(queuedOperation!.status).toBe("queued");
    const dispatchJobs = await withTenant(tenantId, (db) => db.select().from(jobs).where(eq(jobs.idempotencyKey, `business-operation:${operationId}:dispatch:authorized`)));
    expect(dispatchJobs).toHaveLength(1);
  });

  it("rechecks consent, classifies invalid input, executes one target, and never duplicates a retry", async () => {
    await withTenant(tenantId, (db) => db.update(households).set({ marketingConsent: false }).where(eq(households.id, revokedHouseholdId)));
    await dispatchBusinessOperation({ tenantId, operationId, actionId });

    const targets = await withTenant(tenantId, (db) => db.select().from(businessOperationTargets).where(eq(businessOperationTargets.operationId, operationId)));
    expect(targets.find((target) => target.targetId === revokedHouseholdId)).toMatchObject({ status: "skipped", failureClass: "policy" });
    expect(targets.find((target) => target.targetId === invalidHouseholdId)).toMatchObject({ status: "failed", failureClass: "invalid_input", errorKind: "validation" });
    const valid = targets.find((target) => target.targetId === validHouseholdId)!;
    expect(valid.status).toBe("pending");
    expect(valid.jobKey).toBeTruthy();

    const targetPayload = { tenantId, operationId, targetId: valid.id, actionId };
    await executeBusinessOperationTarget(targetPayload);
    await executeBusinessOperationTarget(targetPayload); // duplicate job delivery

    const [completedTarget] = await withTenant(tenantId, (db) => db.select().from(businessOperationTargets).where(eq(businessOperationTargets.id, valid.id)));
    expect(completedTarget).toMatchObject({ status: "succeeded", attempts: 1 });
    const outbox = await withTenant(tenantId, (db) => db.select().from(sandboxOutbox).where(and(eq(sandboxOutbox.tenantId, tenantId), eq(sandboxOutbox.toNumber, "+15550100001"))));
    expect(outbox).toHaveLength(1);

    const aggregate = await businessOperationAggregate(tenantId, operationId) as { operation: typeof businessOperations.$inferSelect };
    expect(aggregate.operation.status).toBe("completed_with_failures");
    expect(aggregate.operation).toMatchObject({ succeededCount: 1, failedCount: 1, skippedCount: 1, pendingCount: 0, retryCount: 0 });
    const [receipt] = await withTenant(tenantId, (db) => db.select().from(decisionReceipts).where(eq(decisionReceipts.operationId, operationId)));
    expect(receipt!.finalizedAt).not.toBeNull();
    expect(receipt!.actualResult).toMatchObject({ operationId, succeeded: 1, failed: 1, skipped: 1 });
  });

  it("recovers only failed reviewable targets and makes the recovery request idempotent", async () => {
    const [invalid] = await withTenant(tenantId, (db) => db.select().from(businessOperationTargets).where(and(eq(businessOperationTargets.operationId, operationId), eq(businessOperationTargets.targetId, invalidHouseholdId))));
    await withTenant(tenantId, async (db) => {
      await db.update(businessOperationTargets).set({ status: "failed", failureClass: "human_review", errorKind: "needs_human" }).where(eq(businessOperationTargets.id, invalid!.id));
      await db.update(businessOperations).set({ status: "needs_human_review" }).where(eq(businessOperations.id, operationId));
      await db.update(domainActions).set({ status: "needs_human_review" }).where(eq(domainActions.id, actionId));
    });
    const first = await retryBusinessOperation({ tenantId, operationId, requestedBy: "owner:test", recoveryKey: "recover-config-1" });
    expect(first).toMatchObject({ retried: 1, duplicate: false });
    const second = await retryBusinessOperation({ tenantId, operationId, requestedBy: "owner:test", recoveryKey: "recover-config-1" });
    expect(second).toMatchObject({ retried: 0, duplicate: true });
    const after = await withTenant(tenantId, (db) => db.select().from(businessOperationTargets).where(and(eq(businessOperationTargets.operationId, operationId), inArray(businessOperationTargets.targetId, [validHouseholdId, invalidHouseholdId]))));
    expect(after.find((target) => target.targetId === validHouseholdId)?.status).toBe("succeeded");
    expect(after.find((target) => target.targetId === invalidHouseholdId)).toMatchObject({ status: "retry", attempts: 0 });
  });

  it("reserves only available calling capacity and durably schedules the remainder", async () => {
    const callTenantId = randomUUID();
    await getPool().query(`INSERT INTO finnor_os.tenants (id, name) VALUES ($1, 'Durable Cap Test')`, [callTenantId]);
    await withTenant(callTenantId, (db) => db.insert(households).values([
      { tenantId: callTenantId, address: "1 Cap Way", contactInfo: { name: "Cap One", phone: "+15550110001" }, marketingConsent: true },
      { tenantId: callTenantId, address: "2 Cap Way", contactInfo: { name: "Cap Two", phone: "+15550110002" }, marketingConsent: true },
    ]));
    const [row] = await withTenant(callTenantId, (db) => db.insert(domainActions).values({ tenantId: callTenantId, actionType: "bulk_notify_existing_customers", payload: { channel: "call", discountPercent: 10, minDaysInactive: 0 }, status: "draft" }).returning());
    const action: DomainAction = { id: row!.id, tenantId: callTenantId, actionType: row!.actionType, payload: row!.payload as Record<string, unknown>, policyId: null, policyVersion: null, status: "draft", createdAt: row!.createdAt.toISOString() };
    const orchestrator = new FinnorOrchestrator({ tools: new ToolRegistry() });
    await orchestrator.executor.execute(action, await orchestrator.loadPolicy(action));
    await orchestrator.decide(action.id, callTenantId, "approve", "owner:cap", { typedConfirmation: true });
    const [operation] = await withTenant(callTenantId, (db) => db.select().from(businessOperations).where(eq(businessOperations.domainActionId, action.id)));
    const date = nextCallingWindow("America/Chicago", new Date(), 0).localDate;
    await getPool().query(
      `INSERT INTO finnor_os.api_rate_limits (bucket_key, window_started_at, count) VALUES ($1, $2, 199)
       ON CONFLICT (bucket_key, window_started_at) DO UPDATE SET count = 199`,
      [`budget:${callTenantId}:vapi:call:${date}`, `${date}T00:00:00.000Z`],
    );
    await dispatchBusinessOperation({ tenantId: callTenantId, operationId: operation!.id, actionId: action.id });
    const callTargets = await withTenant(callTenantId, (db) => db.select().from(businessOperationTargets).where(eq(businessOperationTargets.operationId, operation!.id)));
    expect(callTargets.filter((target) => target.jobKey?.includes("call-batch"))).toHaveLength(1);
    expect(callTargets.filter((target) => target.jobKey === null)).toHaveLength(1);
    const continuation = await withTenant(callTenantId, (db) => db.select().from(jobs).where(eq(jobs.idempotencyKey, `business-operation:${operation!.id}:dispatch:continuation:0`)));
    expect(continuation).toHaveLength(1);
    expect(continuation[0]!.runAt.getTime()).toBeGreaterThan(Date.now());

    // A crashed call batch must be retried through its original queue payload and
    // provider idempotency key, never redispatched as a new campaign sequence.
    const assigned = callTargets.find((target) => target.jobKey?.includes("call-batch"))!;
    await withTenant(callTenantId, async (db) => {
      await db.update(businessOperationTargets).set({ status: "running", leaseExpiresAt: new Date(Date.now() - 60_000) }).where(eq(businessOperationTargets.id, assigned.id));
      await db.update(jobs).set({ status: "queued" }).where(eq(jobs.idempotencyKey, assigned.jobKey!));
    });
    await dispatchBusinessOperation({ tenantId: callTenantId, operationId: operation!.id, actionId: action.id });
    const [awaitingOriginalBatch] = await withTenant(callTenantId, (db) => db.select().from(businessOperationTargets).where(eq(businessOperationTargets.id, assigned.id)));
    expect(awaitingOriginalBatch).toMatchObject({ status: "running", jobKey: assigned.jobKey });

    await withTenant(callTenantId, (db) => db.update(jobs).set({ status: "dead_letter" }).where(eq(jobs.idempotencyKey, assigned.jobKey!)));
    await dispatchBusinessOperation({ tenantId: callTenantId, operationId: operation!.id, actionId: action.id });
    const [unknownOutcome] = await withTenant(callTenantId, (db) => db.select().from(businessOperationTargets).where(eq(businessOperationTargets.id, assigned.id)));
    expect(unknownOutcome).toMatchObject({ status: "failed", failureClass: "human_review", errorKind: "needs_human", jobKey: assigned.jobKey });
    expect(unknownOutcome!.lastError).toMatch(/Reconcile the provider campaign/);
    await getPool().query(`DELETE FROM finnor_os.api_rate_limits WHERE bucket_key LIKE $1`, [`budget:${callTenantId}:%`]);
  });
});
