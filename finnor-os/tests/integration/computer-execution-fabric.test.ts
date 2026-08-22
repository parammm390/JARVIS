import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import pg from "pg";
import { createHash, randomUUID } from "node:crypto";
import { migrate } from "../../packages/db/migrate";
import {
  ComputerBroker,
  ComputerRunner,
  authorizedEffectHash,
  computerEffectOperationKey,
  getComputerRunBundle,
  markComputerSessionCleanupFailed,
  queueComputerRun,
  recoverComputerRunJobs,
  requestComputerCancellation,
  type ComputerDecisionEngine,
  type ComputerProvider,
  type StructuredPageObservation,
} from "@finnor/computer";
import { claimExternalOperation, markExternalOperationUnknown } from "@finnor/tools";
import { activitySnapshot } from "@finnor/read-models";
import { closePool } from "@finnor/db";
import { setTenantSecretReaderForTesting } from "@finnor/security";
import { purgeTenantRetention } from "../../apps/worker/src/handlers/purge-retention";

const SUPER_URL = process.env.DATABASE_URL ?? "postgres://finnor:finnor@localhost:5432/finnor";
const APP_URL = SUPER_URL.replace(/\/\/[^@]+@/, "//finnor_app:finnor_app@");

async function canConnect(connectionString: string): Promise<boolean> {
  const client = new pg.Client({ connectionString, connectionTimeoutMillis: 2_000 });
  try { await client.connect(); await client.end(); return true; } catch { return false; }
}
const available = await canConnect(SUPER_URL);

function observation(text = "Order WS-48. ETA August 30, 2026."): StructuredPageObservation {
  return { url: "https://supplier.example/orders/WS-48", title: "Supplier order WS-48", text, elements: [{ id: "e1", role: "link", name: "WS-48", text: "WS-48", disabled: false, inputKind: null }], openPageUrls: ["https://supplier.example/orders/WS-48"] };
}

function fakeProvider(text?: string): ComputerProvider & { performed: Array<string>; released: boolean } {
  return {
    name: "steel",
    capabilities: new Set(["cloud_session", "cdp", "structured_page", "screenshot", "persistent_profile"]),
    performed: [],
    released: false,
    async createSession() { return { sessionRef: `fake-${randomUUID()}`, liveViewUrl: "https://viewer.invalid/safe-only-inside-provider" }; },
    async observe() { return observation(text); },
    async perform(_session, primitive) { this.performed.push(primitive.kind); return { summary: primitive.kind, pageUrl: "https://supplier.example/orders/WS-48" }; },
    async cost() { return { creditsUsed: 0 }; },
    async release() { this.released = true; },
  };
}

describe.skipIf(!available)("Phase 3 Computer Execution Fabric", () => {
  const tenantId = randomUUID();
  const otherTenantId = randomUUID();
  const actorId = randomUUID();
  const otherActorId = randomUUID();
  const roleId = randomUUID();
  const accountId = randomUUID();
  const profileId = randomUUID();
  let admin: pg.Client;

  beforeAll(async () => {
    await migrate(SUPER_URL);
    admin = new pg.Client({ connectionString: SUPER_URL });
    await admin.connect();
    await admin.query(`INSERT INTO finnor_os.tenants(id,client_key,name) VALUES ($1,$2,'Computer A'),($3,$4,'Computer B')`, [tenantId, `computer-${tenantId}`, otherTenantId, `computer-${otherTenantId}`]);
    await admin.query(`INSERT INTO finnor_os.tenant_settings(tenant_id,computer_config) VALUES ($1,$2::jsonb),($3,$2::jsonb)`, [tenantId, JSON.stringify({ enabled: true, provider: "steel", maxSteps: 5, timeoutMs: 60_000, maxProviderCredits: 5, maxScreenshots: 2, maxArtifacts: 5, maxDownloadBytes: 1024, maxUploadBytes: 0, maxOutputBytes: 16_384 }), otherTenantId]);
    await admin.query(`INSERT INTO finnor_os.users(id,tenant_id,email,role,display_name,status) VALUES ($1,$2,$3,'owner','Computer Owner','active'),($4,$5,$6,'owner','Other Owner','active')`, [actorId, tenantId, `${actorId}@example.test`, otherActorId, otherTenantId, `${otherActorId}@example.test`]);
    await admin.query(`INSERT INTO finnor_os.employee_roles(id,tenant_id,key,name,active) VALUES ($1,$2,'computer-owner','Computer Owner',true)`, [roleId, tenantId]);
    await admin.query(`INSERT INTO finnor_os.employee_role_assignments(tenant_id,employee_id,role_id,resource_scope,active) VALUES ($1,$2,$3,'{"kind":"tenant"}',true)`, [tenantId, actorId, roleId]);
    await admin.query(`INSERT INTO finnor_os.role_authority_grants(tenant_id,role_id,capability,resource_type,effect,max_risk,approval_required) VALUES ($1,$2,'*','*','allow','high',false)`, [tenantId, roleId]);
    await admin.query(`INSERT INTO finnor_os.application_accounts(id,tenant_id,account_key,application,provider,display_name,status,capabilities,metadata) VALUES ($1,$2,'supplier-west','supplier_portal','supplier_portal','Supplier West','active','["read","write"]',$3::jsonb)`, [accountId, tenantId, JSON.stringify({ homeUrl: "https://supplier.example/orders", allowedOrigins: ["https://supplier.example"], authOrigins: ["https://login.example"] })]);
    await admin.query(`INSERT INTO finnor_os.auth_profiles(id,tenant_id,auth_profile_ref,principal_type,principal_id,application_account_id,purpose,priority,credential_provider,credential_ref,status,capabilities,restrictions) VALUES ($1,$2,'supplier-west','employee',$3,$4,'computer_task',100,'aws-secrets-manager',$5,'active','["read","write"]','{}')`, [profileId, tenantId, actorId, accountId, `finnor/tenants/${tenantId}/steel/supplier-west`]);
    setTenantSecretReaderForTesting(async () => ({ steelProfileId: "credential-sensitive-steel-profile" }));
    process.env.DATABASE_URL = APP_URL;
    await closePool();
  });

  afterAll(async () => {
    setTenantSecretReaderForTesting(null);
    await closePool();
    process.env.DATABASE_URL = SUPER_URL;
    await admin?.end();
  });

  async function executingAction(): Promise<string> {
    const actionId = randomUUID();
    await admin.query(`INSERT INTO finnor_os.domain_actions(id,tenant_id,action_type,payload,status,initiated_by,authority_context) VALUES ($1,$2,'computer_task',$3::jsonb,'executing',$4,'{"outcome":"allowed","resources":[]}')`, [actionId, tenantId, JSON.stringify({ application: "supplier_portal", authProfileRef: "supplier-west", task: "Find ETA for WS-48", target: { kind: "supplier_order", identifier: "WS-48" }, mode: "READ_ONLY", successCriteria: ["ETA observed"] }), actorId]);
    await admin.query(`INSERT INTO finnor_os.action_log(tenant_id,domain_action_id,step,input,output) VALUES ($1,$2,'policy_ungated_authorized','{}','{}')`, [tenantId, actionId]);
    return actionId;
  }

  async function executingWriteAction(): Promise<string> {
    const actionId = randomUUID();
    const payload = { application: "supplier_portal", authProfileRef: "supplier-west", task: "Update the delivery note for WS-48", target: { kind: "supplier_order", identifier: "WS-48" }, mode: "WRITE", successCriteria: ["Exact delivery note observed"], authorizedEffect: { operation: "update_delivery_note", target: { kind: "supplier_order", identifier: "WS-48" }, changes: { deliveryNote: "Call warehouse before delivery" } } };
    await admin.query(`INSERT INTO finnor_os.domain_actions(id,tenant_id,action_type,payload,status,initiated_by,authority_context) VALUES ($1,$2,'computer_task',$3::jsonb,'executing',$4,'{"outcome":"allowed","resources":[]}')`, [actionId, tenantId, JSON.stringify(payload), actorId]);
    await admin.query(`INSERT INTO finnor_os.action_log(tenant_id,domain_action_id,step,input,output) VALUES ($1,$2,'confirmed','{}','{"approved":true}')`, [tenantId, actionId]);
    return actionId;
  }

  it("runs an isolated read, verifies literal evidence, reconstructs live steps, and releases the session", async () => {
    const actionId = await executingAction();
    const queued = await queueComputerRun({ application: "supplier_portal", authProfileRef: "supplier-west", task: "Find ETA for WS-48", target: { kind: "supplier_order", identifier: "WS-48" }, mode: "READ_ONLY", successCriteria: ["ETA observed"] }, { tenantId, actorId, domainActionId: actionId, purpose: "computer_task" });
    const provider = fakeProvider();
    const broker = new ComputerBroker(); broker.register(provider);
    const engine: ComputerDecisionEngine = { decide: vi.fn().mockResolvedValue({ kind: "complete", summary: "ETA found and verified", result: { order: "WS-48", eta: "August 30, 2026" }, evidenceText: "ETA August 30, 2026" }) };
    const terminal = await new ComputerRunner({ broker, decisionEngine: engine }).run(tenantId, queued.run.id);
    expect(terminal).toEqual({ status: "succeeded", result: expect.objectContaining({ order: "WS-48", eta: "August 30, 2026", verified: true, evidenceCaptured: true }) });
    expect(provider.performed).toEqual(["navigate"]);
    expect(engine.decide).toHaveBeenCalledWith(expect.objectContaining({ task: expect.objectContaining({ successCriteria: ["ETA observed"] }) }));
    expect(provider.released).toBe(true);
    const bundle = await getComputerRunBundle(tenantId, queued.run.id);
    expect(bundle?.run.status).toBe("succeeded");
    expect(bundle?.steps.map((step) => step.operation)).toEqual(expect.arrayContaining(["queue", "authorize", "create_session", "open_application", "capture_evidence", "release_session"]));
    expect(bundle?.artifacts).toEqual([expect.objectContaining({ kind: "result_evidence", metadata: { verified: true, mode: "READ_ONLY" } })]);
    expect(JSON.stringify(bundle)).not.toMatch(/credential-sensitive|sessionRef|providerSession|cookie|apiKey/i);
    expect(await getComputerRunBundle(otherTenantId, queued.run.id)).toBeNull();
    expect((await activitySnapshot(tenantId)).items.some((item) => item.source === "computer_step" && item.detail.runId === queued.run.id)).toBe(true);
  });

  it("blocks a read-only mutation before the provider receives it", async () => {
    const actionId = await executingAction();
    const queued = await queueComputerRun({ application: "supplier_portal", authProfileRef: "supplier-west", task: "Find ETA for WS-48", target: { kind: "supplier_order", identifier: "WS-48" }, mode: "READ_ONLY", successCriteria: ["ETA observed"] }, { tenantId, actorId, domainActionId: actionId });
    const provider = fakeProvider();
    const broker = new ComputerBroker(); broker.register(provider);
    const terminal = await new ComputerRunner({ broker, decisionEngine: { async decide() { return { kind: "effect", summary: "Submit a change", effect: { operation: "update_delivery_note", target: { kind: "supplier_order", identifier: "WS-48" }, changes: { note: "broader" } }, primitive: { kind: "click", locator: { kind: "role", role: "button", name: "Submit" } } }; } } }).run(tenantId, queued.run.id);
    expect(terminal).toMatchObject({ status: "blocked", code: "read_only_mutation" });
    expect(provider.performed).toEqual(["navigate"]);
    expect(provider.released).toBe(true);
  });

  it("fails closed when employee authority changes while the run is pending", async () => {
    const actionId = await executingAction();
    const queued = await queueComputerRun({ application: "supplier_portal", authProfileRef: "supplier-west", task: "Find ETA for WS-48", target: { kind: "supplier_order", identifier: "WS-48" }, mode: "READ_ONLY", successCriteria: ["ETA observed"] }, { tenantId, actorId, domainActionId: actionId, purpose: "computer_task" });
    await admin.query(`UPDATE finnor_os.employee_role_assignments SET active=false WHERE tenant_id=$1 AND employee_id=$2`, [tenantId, actorId]);
    try {
      const provider = fakeProvider(); const broker = new ComputerBroker(); broker.register(provider);
      const terminal = await new ComputerRunner({ broker, decisionEngine: { async decide() { throw new Error("must not decide after authority revocation"); } } }).run(tenantId, queued.run.id);
      expect(terminal).toMatchObject({ status: "blocked", code: "authorization_changed" });
      expect(provider.performed).toEqual([]);
      expect(provider.released).toBe(false);
    } finally {
      await admin.query(`UPDATE finnor_os.employee_role_assignments SET active=true WHERE tenant_id=$1 AND employee_id=$2`, [tenantId, actorId]);
    }
  });

  it("executes an exact authorized write once, reconciles post-state, and never replays the terminal run", async () => {
    const actionId = await executingWriteAction();
    const authorizedEffect = { operation: "update_delivery_note", target: { kind: "supplier_order", identifier: "WS-48" }, changes: { deliveryNote: "Call warehouse before delivery" } };
    const queued = await queueComputerRun({ application: "supplier_portal", authProfileRef: "supplier-west", task: "Update the delivery note for WS-48", target: authorizedEffect.target, mode: "WRITE", successCriteria: ["Exact delivery note observed"], authorizedEffect }, { tenantId, actorId, domainActionId: actionId });
    let applied = false;
    const provider = fakeProvider() as ReturnType<typeof fakeProvider>;
    provider.observe = async () => observation(applied ? "Order WS-48. Delivery note: Call warehouse before delivery" : "Order WS-48. Delivery note: none");
    provider.perform = async (_session, primitive) => {
      provider.performed.push(primitive.kind);
      if (primitive.kind === "click") applied = true;
      return { summary: primitive.kind, pageUrl: "https://supplier.example/orders/WS-48" };
    };
    const broker = new ComputerBroker(); broker.register(provider);
    const decide = vi.fn()
      .mockResolvedValueOnce({ kind: "effect", summary: "Submit exact approved delivery note", effect: authorizedEffect, primitive: { kind: "click", locator: { kind: "role", role: "button", name: "Save delivery note" } } })
      .mockResolvedValueOnce({ kind: "complete", summary: "Delivery note verified", result: { order: "WS-48", deliveryNote: "Call warehouse before delivery" }, evidenceText: "Delivery note: Call warehouse before delivery" });
    const runner = new ComputerRunner({ broker, decisionEngine: { decide } });
    expect(await runner.run(tenantId, queued.run.id)).toMatchObject({ status: "succeeded" });
    expect(provider.performed).toEqual(["navigate", "click"]);
    expect((await admin.query(`SELECT status FROM finnor_os.external_operations WHERE tenant_id=$1 AND domain_action_id=$2`, [tenantId, actionId])).rows).toEqual([{ status: "succeeded" }]);
    expect(await runner.run(tenantId, queued.run.id)).toMatchObject({ status: "succeeded" });
    expect(provider.performed).toEqual(["navigate", "click"]);
  });

  it("reconciles a crash after external mutation without dispatching the write twice", async () => {
    const actionId = await executingWriteAction();
    const authorizedEffect = { operation: "update_delivery_note", target: { kind: "supplier_order", identifier: "WS-48" }, changes: { deliveryNote: "Call warehouse before delivery" } };
    const queued = await queueComputerRun({ application: "supplier_portal", authProfileRef: "supplier-west", task: "Update the delivery note for WS-48", target: authorizedEffect.target, mode: "WRITE", successCriteria: ["Exact delivery note observed"], authorizedEffect }, { tenantId, actorId, domainActionId: actionId, purpose: "computer_task" });
    let applied = false;
    let writeDispatches = 0;
    const provider = fakeProvider();
    provider.observe = async () => observation(applied ? "Order WS-48. Delivery note: Call warehouse before delivery" : "Order WS-48. Delivery note: none");
    provider.perform = async (_session, primitive) => {
      provider.performed.push(primitive.kind);
      if (primitive.kind === "click") {
        writeDispatches += 1;
        applied = true;
        throw new Error("simulated worker loss after the external server committed");
      }
      return { summary: primitive.kind, pageUrl: "https://supplier.example/orders/WS-48" };
    };
    const broker = new ComputerBroker(); broker.register(provider);
    const decide = vi.fn()
      .mockResolvedValueOnce({ kind: "effect", summary: "Submit exact approved delivery note", effect: authorizedEffect, primitive: { kind: "click", locator: { kind: "role", role: "button", name: "Save delivery note" } } })
      .mockResolvedValueOnce({ kind: "complete", summary: "Delivery note reconciled", result: { order: "WS-48", deliveryNote: "Call warehouse before delivery" }, evidenceText: "Delivery note: Call warehouse before delivery" });
    expect(await new ComputerRunner({ broker, decisionEngine: { decide } }).run(tenantId, queued.run.id)).toMatchObject({ status: "succeeded" });
    expect(writeDispatches).toBe(1);
    expect((await admin.query(`SELECT status FROM finnor_os.external_operations WHERE tenant_id=$1 AND domain_action_id=$2`, [tenantId, actionId])).rows).toEqual([{ status: "succeeded" }]);
  });

  it("reattaches after a worker restart and inspects possible write state before navigating", async () => {
    const actionId = await executingWriteAction();
    const authorizedEffect = { operation: "update_delivery_note", target: { kind: "supplier_order", identifier: "WS-48" }, changes: { deliveryNote: "Call warehouse before delivery" } };
    const queued = await queueComputerRun({ application: "supplier_portal", authProfileRef: "supplier-west", task: "Update the delivery note for WS-48", target: authorizedEffect.target, mode: "WRITE", successCriteria: ["Exact delivery note observed"], authorizedEffect }, { tenantId, actorId, domainActionId: actionId, purpose: "computer_task" });
    const operationKey = computerEffectOperationKey(authorizedEffect);
    await claimExternalOperation(tenantId, actionId, operationKey, authorizedEffectHash(authorizedEffect));
    await markExternalOperationUnknown(tenantId, actionId, operationKey, { simulatedWorkerRestart: true });
    await admin.query(`UPDATE finnor_os.computer_runs SET status='reconciling', provider_session_ref='existing-isolated-session', effect_status='unknown', effect_operation_key=$3 WHERE tenant_id=$1 AND id=$2`, [tenantId, queued.run.id, operationKey]);
    const provider = fakeProvider("Order WS-48. Delivery note: Call warehouse before delivery");
    const broker = new ComputerBroker(); broker.register(provider);
    const terminal = await new ComputerRunner({ broker, decisionEngine: { async decide() { return { kind: "complete", summary: "Recovered delivery note verified", result: { order: "WS-48", deliveryNote: "Call warehouse before delivery" }, evidenceText: "Delivery note: Call warehouse before delivery" }; } } }).run(tenantId, queued.run.id);
    expect(terminal).toMatchObject({ status: "succeeded" });
    expect(provider.performed).toEqual([]);
    expect(provider.released).toBe(true);
    expect((await getComputerRunBundle(tenantId, queued.run.id))?.steps.map((step) => step.operation)).toEqual(expect.arrayContaining(["recover_session", "inspect_recovered_state", "reconcile_effect"]));
  });

  it("blocks a broader write before dispatch", async () => {
    const actionId = await executingWriteAction();
    const authorizedEffect = { operation: "update_delivery_note", target: { kind: "supplier_order", identifier: "WS-48" }, changes: { deliveryNote: "Call warehouse before delivery" } };
    const queued = await queueComputerRun({ application: "supplier_portal", authProfileRef: "supplier-west", task: "Update the delivery note for WS-48", target: authorizedEffect.target, mode: "WRITE", successCriteria: ["Exact delivery note observed"], authorizedEffect }, { tenantId, actorId, domainActionId: actionId });
    const provider = fakeProvider(); const broker = new ComputerBroker(); broker.register(provider);
    const terminal = await new ComputerRunner({ broker, decisionEngine: { async decide() { return { kind: "effect", summary: "Broader update", effect: { ...authorizedEffect, changes: { ...authorizedEffect.changes, expedite: true } }, primitive: { kind: "click", locator: { kind: "role", role: "button", name: "Save" } } }; } } }).run(tenantId, queued.run.id);
    expect(terminal).toMatchObject({ status: "blocked", code: "effect_broader_than_authorized" });
    expect(provider.performed).toEqual(["navigate"]);
  });

  it("honors durable cancellation and preserves prior history", async () => {
    const actionId = await executingAction();
    const queued = await queueComputerRun({ application: "supplier_portal", authProfileRef: "supplier-west", task: "Find ETA for WS-48", target: { kind: "supplier_order", identifier: "WS-48" }, mode: "READ_ONLY", successCriteria: ["ETA observed"] }, { tenantId, actorId, domainActionId: actionId });
    await requestComputerCancellation(tenantId, queued.run.id);
    const provider = fakeProvider(); const broker = new ComputerBroker(); broker.register(provider);
    const terminal = await new ComputerRunner({ broker, decisionEngine: { async decide() { throw new Error("must not decide after cancellation"); } } }).run(tenantId, queued.run.id);
    expect(terminal).toMatchObject({ status: "cancelled" });
    expect(provider.released).toBe(false);
    expect((await getComputerRunBundle(tenantId, queued.run.id))?.steps.length).toBeGreaterThanOrEqual(2);
  });

  it("stops an active run at the next boundary and releases its provider session", async () => {
    const actionId = await executingAction();
    const queued = await queueComputerRun({ application: "supplier_portal", authProfileRef: "supplier-west", task: "Find ETA for WS-48", target: { kind: "supplier_order", identifier: "WS-48" }, mode: "READ_ONLY", successCriteria: ["ETA observed"] }, { tenantId, actorId, domainActionId: actionId, purpose: "computer_task" });
    const provider = fakeProvider();
    provider.observe = async () => {
      await requestComputerCancellation(tenantId, queued.run.id);
      return observation();
    };
    const broker = new ComputerBroker(); broker.register(provider);
    const terminal = await new ComputerRunner({ broker, decisionEngine: { async decide() { throw new Error("must not decide after active cancellation"); } } }).run(tenantId, queued.run.id);
    expect(terminal).toMatchObject({ status: "cancelled" });
    expect(provider.performed).toEqual(["navigate"]);
    expect(provider.released).toBe(true);
    expect((await getComputerRunBundle(tenantId, queued.run.id))?.steps.map((step) => step.operation)).toEqual(expect.arrayContaining(["cancel", "release_session"]));
  });

  it("ends truthfully at the governed step limit", async () => {
    const actionId = await executingAction();
    const queued = await queueComputerRun({ application: "supplier_portal", authProfileRef: "supplier-west", task: "Find ETA for WS-48", target: { kind: "supplier_order", identifier: "WS-48" }, mode: "READ_ONLY", successCriteria: ["ETA observed"] }, { tenantId, actorId, domainActionId: actionId, purpose: "computer_task" });
    const provider = fakeProvider(); const broker = new ComputerBroker(); broker.register(provider);
    const terminal = await new ComputerRunner({ broker, decisionEngine: { async decide() { return { kind: "act", summary: "Wait for data", primitive: { kind: "wait", milliseconds: 0 } }; } } }).run(tenantId, queued.run.id);
    expect(terminal).toMatchObject({ status: "timed_out", code: "step_limit" });
    expect(provider.performed).toEqual(["navigate", "wait", "wait", "wait", "wait", "wait"]);
    expect((await getComputerRunBundle(tenantId, queued.run.id))?.run.status).toBe("timed_out");
  });

  it("stops deterministically at the provider-cost budget", async () => {
    const actionId = await executingAction();
    const queued = await queueComputerRun({ application: "supplier_portal", authProfileRef: "supplier-west", task: "Find ETA for WS-48", target: { kind: "supplier_order", identifier: "WS-48" }, mode: "READ_ONLY", successCriteria: ["ETA observed"] }, { tenantId, actorId, domainActionId: actionId, purpose: "computer_task" });
    const provider = fakeProvider();
    provider.cost = async () => ({ creditsUsed: 5 });
    const broker = new ComputerBroker(); broker.register(provider);
    const terminal = await new ComputerRunner({ broker, decisionEngine: { async decide() { throw new Error("must not decide after budget exhaustion"); } } }).run(tenantId, queued.run.id);
    expect(terminal).toMatchObject({ status: "timed_out", code: "provider_budget" });
    expect(provider.performed).toEqual(["navigate"]);
  });

  it("stops deterministically at the wall-clock timeout", async () => {
    const actionId = await executingAction();
    const queued = await queueComputerRun({ application: "supplier_portal", authProfileRef: "supplier-west", task: "Find ETA for WS-48", target: { kind: "supplier_order", identifier: "WS-48" }, mode: "READ_ONLY", successCriteria: ["ETA observed"] }, { tenantId, actorId, domainActionId: actionId, purpose: "computer_task" });
    const provider = fakeProvider(); const broker = new ComputerBroker(); broker.register(provider);
    let clockReads = 0;
    const terminal = await new ComputerRunner({ broker, decisionEngine: { async decide() { throw new Error("must not decide after timeout"); } }, now: () => clockReads++ === 0 ? 0 : 60_001 }).run(tenantId, queued.run.id);
    expect(terminal).toMatchObject({ status: "timed_out", code: "wall_clock_timeout" });
    expect(provider.performed).toEqual(["navigate"]);
  });

  it("records provider failure without inventing success", async () => {
    const actionId = await executingAction();
    const queued = await queueComputerRun({ application: "supplier_portal", authProfileRef: "supplier-west", task: "Find ETA for WS-48", target: { kind: "supplier_order", identifier: "WS-48" }, mode: "READ_ONLY", successCriteria: ["ETA observed"] }, { tenantId, actorId, domainActionId: actionId, purpose: "computer_task" });
    const provider = fakeProvider();
    provider.createSession = async () => { throw new Error("simulated provider outage"); };
    const broker = new ComputerBroker(); broker.register(provider);
    const terminal = await new ComputerRunner({ broker, decisionEngine: { async decide() { throw new Error("must not decide after provisioning failure"); } } }).run(tenantId, queued.run.id);
    expect(terminal).toMatchObject({ status: "failed", code: "computer_failure" });
    expect((await getComputerRunBundle(tenantId, queued.run.id))?.run.result).toBeNull();
  });

  it("requeues a stranded active run once per recovery scan", async () => {
    const actionId = await executingAction();
    const queued = await queueComputerRun({ application: "supplier_portal", authProfileRef: "supplier-west", task: "Find ETA for WS-48", target: { kind: "supplier_order", identifier: "WS-48" }, mode: "READ_ONLY", successCriteria: ["ETA observed"] }, { tenantId, actorId, domainActionId: actionId, purpose: "computer_task" });
    await admin.query(`UPDATE finnor_os.jobs SET status='completed', completed_at=now() WHERE type='run_computer_task' AND payload->>'runId'=$1`, [queued.run.id]);
    expect(await recoverComputerRunJobs(tenantId)).toMatchObject({ queued: 1 });
    expect(await recoverComputerRunJobs(tenantId)).toMatchObject({ queued: 0 });
    expect(Number((await admin.query(`SELECT count(*) FROM finnor_os.jobs WHERE type='run_computer_task' AND status='queued' AND payload->>'runId'=$1`, [queued.run.id])).rows[0].count)).toBe(1);
    await requestComputerCancellation(tenantId, queued.run.id);
    expect(await new ComputerRunner({ broker: new ComputerBroker(), decisionEngine: { async decide() { throw new Error("cancelled before decision"); } } }).run(tenantId, queued.run.id)).toMatchObject({ status: "cancelled" });
  });

  it("times out a run past its durable deadline and retains an orphan session for bounded cleanup retry", async () => {
    const actionId = await executingAction();
    const queued = await queueComputerRun({ application: "supplier_portal", authProfileRef: "supplier-west", task: "Find ETA for WS-48", target: { kind: "supplier_order", identifier: "WS-48" }, mode: "READ_ONLY", successCriteria: ["ETA observed"] }, { tenantId, actorId, domainActionId: actionId, purpose: "computer_task" });
    await admin.query(
      `UPDATE finnor_os.computer_runs
          SET status='running',provider_session_ref='orphan-provider-session',deadline_at=now()-interval '1 second'
        WHERE tenant_id=$1 AND id=$2`,
      [tenantId, queued.run.id],
    );
    await admin.query(
      `UPDATE finnor_os.jobs SET status='completed',completed_at=now()
        WHERE type='run_computer_task' AND payload->>'runId'=$1`, [queued.run.id],
    );
    const recovery = await recoverComputerRunJobs(tenantId);
    expect(recovery.queued).toBe(0);
    expect(recovery.orphanSessions).toContainEqual({ runId: queued.run.id, sessionRef: "orphan-provider-session" });
    expect((await getComputerRunBundle(tenantId, queued.run.id))?.run).toMatchObject({ status: "timed_out" });
    await markComputerSessionCleanupFailed(tenantId, queued.run.id, "provider_unavailable");
    const cleanup = await admin.query(
      "SELECT provider_session_ref,cleanup_attempted_at,cleanup_failure_code FROM finnor_os.computer_runs WHERE id=$1", [queued.run.id],
    );
    expect(cleanup.rows[0]).toMatchObject({ provider_session_ref: "orphan-provider-session", cleanup_failure_code: "provider_unavailable" });
    expect(cleanup.rows[0].cleanup_attempted_at).not.toBeNull();
  });

  it("redacts expired artifact bytes and locators while preserving immutable evidence metadata", async () => {
    const existing = await admin.query<{ run_id: string; step_id: string | null }>(
      "SELECT run_id,step_id FROM finnor_os.computer_artifacts WHERE tenant_id=$1 ORDER BY created_at LIMIT 1",
      [tenantId],
    );
    expect(existing.rowCount).toBe(1);
    const bytes = Buffer.from("sensitive screenshot bytes");
    const hash = createHash("sha256").update(bytes).digest("hex");
    const artifact = await admin.query<{ id: string }>(
      `INSERT INTO finnor_os.computer_artifacts
         (tenant_id,run_id,step_id,kind,mime_type,size_bytes,sha256,storage_ref,content,metadata,created_at)
       VALUES ($1,$2,$3,'screenshot','image/png',$4,$5,'private/object/key',$6,'{"verified":true}',now()-interval '31 days')
       RETURNING id`,
      [tenantId, existing.rows[0]!.run_id, existing.rows[0]!.step_id, bytes.length, hash, bytes],
    );
    await admin.query(
      `INSERT INTO finnor_os.tenant_retention_policies(tenant_id,data_class,retention_days,legal_hold)
       VALUES ($1,'computer_artifact_content',30,false)
       ON CONFLICT (tenant_id,data_class) DO UPDATE SET retention_days=excluded.retention_days,legal_hold=false`,
      [tenantId],
    );
    const result = await purgeTenantRetention(tenantId);
    expect(result.computerArtifactContentsScrubbed).toBeGreaterThanOrEqual(1);
    const retained = await admin.query(
      "SELECT content,storage_ref,sha256,size_bytes,mime_type,metadata FROM finnor_os.computer_artifacts WHERE id=$1",
      [artifact.rows[0]!.id],
    );
    expect(retained.rows[0]).toEqual({
      content: null,
      storage_ref: null,
      sha256: hash,
      size_bytes: bytes.length,
      mime_type: "image/png",
      metadata: { verified: true },
    });
  });

  it("refuses a missing governed auth profile before creating a run", async () => {
    const actionId = randomUUID();
    const payload = { application: "supplier_portal", authProfileRef: "missing-profile", task: "Find ETA for WS-48", target: { kind: "supplier_order", identifier: "WS-48" }, mode: "READ_ONLY", successCriteria: ["ETA observed"] };
    await admin.query(`INSERT INTO finnor_os.domain_actions(id,tenant_id,action_type,payload,status,initiated_by,authority_context) VALUES ($1,$2,'computer_task',$3::jsonb,'executing',$4,'{"outcome":"allowed","resources":[]}')`, [actionId, tenantId, JSON.stringify(payload), actorId]);
    await expect(queueComputerRun(payload as never, { tenantId, actorId, domainActionId: actionId, purpose: "computer_task" })).rejects.toThrow(/profile|account/i);
    expect(Number((await admin.query(`SELECT count(*) FROM finnor_os.computer_runs WHERE tenant_id=$1 AND domain_action_id=$2`, [tenantId, actionId])).rows[0].count)).toBe(0);
  });
});
