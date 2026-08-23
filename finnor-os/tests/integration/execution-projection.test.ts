import { afterAll, beforeAll, describe, expect, it } from "vitest";
import pg from "pg";
import { migrate } from "../../packages/db/migrate";
import { closePool } from "@finnor/db";
import { executionProjection } from "@finnor/read-models";
import { finalizeComputerRun } from "@finnor/computer";

const DATABASE_URL = process.env.DATABASE_URL ?? "postgres://finnor:finnor@localhost:5432/finnor";
const TENANT = "00000000-0000-4000-8000-00000000e301";
const FOREIGN_TENANT = "00000000-0000-4000-8000-00000000e302";
const OWNER = "00000000-0000-4000-8000-00000000e311";
const TECHNICIAN = "00000000-0000-4000-8000-00000000e312";
const WORK = "00000000-0000-4000-8000-00000000e321";
const LARGE_WORK = "00000000-0000-4000-8000-00000000e322";
const ACTION_SENT = "00000000-0000-4000-8000-00000000e331";
const ACTION_UNKNOWN = "00000000-0000-4000-8000-00000000e332";
const ACTION_COMPUTER = "00000000-0000-4000-8000-00000000e333";
const ACTION_CONFIGURED = "00000000-0000-4000-8000-00000000e335";
const RUN_UNKNOWN = "00000000-0000-4000-8000-00000000e341";
const RUN_COMPLETED = "00000000-0000-4000-8000-00000000e342";
const STEP_UNKNOWN = "00000000-0000-4000-8000-00000000e351";
const STEP_COMPENSATABLE = "00000000-0000-4000-8000-00000000e352";
const COMPUTER_RUN = "00000000-0000-4000-8000-00000000e361";

async function databaseAvailable(): Promise<boolean> {
  const client = new pg.Client({ connectionString: DATABASE_URL, connectionTimeoutMillis: 1_500 });
  try { await client.connect(); await client.end(); return true; } catch { return false; }
}
const available = await databaseAvailable();

describe.skipIf(!available)("ExecutionProjection migrated reconstruction", () => {
  const admin = new pg.Client({ connectionString: DATABASE_URL });

  beforeAll(async () => {
    await migrate(DATABASE_URL);
    await admin.connect();
    await admin.query(`INSERT INTO finnor_os.tenants(id,name) VALUES ($1,'Execution Projection'),($2,'Foreign Projection') ON CONFLICT DO NOTHING`, [TENANT, FOREIGN_TENANT]);
    await admin.query(`INSERT INTO finnor_os.users(id,tenant_id,email,role,display_name) VALUES ($1,$3,'owner-execution@example.test','owner','Avery Owner'),($2,$3,'tech-execution@example.test','technician','Taylor Technician') ON CONFLICT DO NOTHING`, [OWNER, TECHNICIAN, TENANT]);
    await admin.query(`INSERT INTO finnor_os.works(id,tenant_id,status,initial_channel,initial_instruction,created_by,current_owner_id) VALUES ($1,$2,'executing','console','Confirm delivery, reconcile the uncertain charge, and observe the supplier portal.',$3,$3)`, [WORK, TENANT, OWNER]);
    await admin.query(`INSERT INTO finnor_os.domain_actions(id,tenant_id,action_type,payload,status,summary,work_id,initiated_by,plan_id,depends_on,predicted_receipt) VALUES
      ($1,$4,'send_email',$5::jsonb,'completed','Send confirmed delivery notice',$7,$8,$9,'{}','{"simulation":{"predicted":{"expectedResult":{"delivery":"sent"}}}}'),
      ($2,$4,'create_payment_link',$6::jsonb,'pending','Create payment link after delivery',$7,$8,$9,ARRAY[$1]::uuid[],'{"simulation":{"predicted":{"expectedResult":{"paymentLink":"created"}}}}'),
      ($3,$4,'computer_task',$10::jsonb,'completed','Observe supplier order ETA',$7,$8,$9,ARRAY[$1]::uuid[],'{"simulation":{"predicted":{"expectedResult":{"eta":"observed"}}}}'),
      ($11,$4,'computer_task',$10::jsonb,'pending','Approve supplier portal observation',$7,$8,$9,ARRAY[$1]::uuid[],'{"simulation":{"predicted":{"expectedResult":{"eta":"observed"}}}}')`, [
        ACTION_SENT, ACTION_UNKNOWN, ACTION_COMPUTER, TENANT,
        JSON.stringify({ entityType: "supplier_order", entityId: "WS-48", communicationIdentityId: "00000000-0000-4000-8000-00000000e371", email: "customer@example.test" }),
        JSON.stringify({ invoiceId: "00000000-0000-4000-8000-00000000e399" }), WORK, OWNER, "00000000-0000-4000-8000-00000000e330",
        JSON.stringify({ application: "supplier_portal", authProfileRef: "supplier-west", task: "Observe ETA for WS-48", target: { kind: "supplier_order", identifier: "WS-48" }, mode: "READ_ONLY", successCriteria: ["ETA observed"], apiKey: "must-not-render" }),
        ACTION_CONFIGURED,
      ]);
    await admin.query(`INSERT INTO finnor_os.communication_identities(id,tenant_id,identity_key,provider,channel,address) VALUES ('00000000-0000-4000-8000-00000000e371',$1,'dispatch_email','resend','email','dispatch@example.test')`, [TENANT]);
    await admin.query(`INSERT INTO finnor_os.communication_deliveries(tenant_id,domain_action_id,work_id,recipient_type,recipient_id,channel,route,status,provider,communication_identity_id) VALUES ($1,$2,$3,'employee',$4,'email','api','delivered','resend','00000000-0000-4000-8000-00000000e371')`, [TENANT, ACTION_SENT, WORK, OWNER]);
    await admin.query(`INSERT INTO finnor_os.commands(id,tenant_id,command_type,payload,requested_by,status) VALUES ('00000000-0000-4000-8000-00000000e381',$1,'uncertain_payment','{}',$2,'failed'),('00000000-0000-4000-8000-00000000e382',$1,'appointment_hold','{}',$2,'completed')`, [TENANT, OWNER]);
    await admin.query(`INSERT INTO finnor_os.workflow_runs(id,tenant_id,command_id,work_id,workflow_type,status,version) VALUES ($1,$3,'00000000-0000-4000-8000-00000000e381',$4,'single_action','failed',4),($2,$3,'00000000-0000-4000-8000-00000000e382',$4,'lead_to_water_test','completed',2)`, [RUN_UNKNOWN, RUN_COMPLETED, TENANT, WORK]);
    await admin.query(`INSERT INTO finnor_os.workflow_steps(id,tenant_id,workflow_run_id,step_type,sequence,status,idempotency_key,attempts,payload,domain_action_id) VALUES
      ($1,$3,$4,'create_payment_link',0,'failed','unknown-payment',1,'{}',$6),
      ($2,$3,$5,'hold_appointment',0,'completed','hold-appointment',1,$7::jsonb,$8)`, [STEP_UNKNOWN, STEP_COMPENSATABLE, TENANT, RUN_UNKNOWN, RUN_COMPLETED, ACTION_UNKNOWN, JSON.stringify({ tenantId: TENANT, subjectType: "work", subjectId: WORK, scheduledAt: "2026-08-23T10:00:00.000Z", idempotencyKey: "hold-appointment" }), ACTION_SENT]);
    await admin.query(`INSERT INTO finnor_os.integration_operations(tenant_id,workflow_step_id,operation_key,capability,provider,request_hash,status,response) VALUES
      ($1,$2,'unknown-payment','create_payment_link','stripe','hash-unknown','unknown',NULL),
      ($1,$3,'hold-appointment','hold_appointment','native','hash-hold','succeeded',$4::jsonb)`, [TENANT, STEP_UNKNOWN, STEP_COMPENSATABLE, JSON.stringify({ holdId: "00000000-0000-4000-8000-00000000e398", status: "held", scheduledAt: "2026-08-23T10:00:00.000Z" })]);
    await admin.query(`INSERT INTO finnor_os.reconciliation_cases(tenant_id,case_type,related_step_id,details,status) VALUES ($1,'unknown_delivery',$2,'{"provider":"stripe"}','open')`, [TENANT, STEP_UNKNOWN]);
    await admin.query(`INSERT INTO finnor_os.decision_receipts(tenant_id,work_id,domain_action_id,objective,evidence,policy_applied,risk_tier,proposed_action,approval,expected_result,actual_result,finalized_at) VALUES
      ($1,$2,$3,'Send delivery notice','[{"source":"communication_delivery","ref":"delivery-1","timestamp":"2026-08-22T12:00:00.000Z"}]',NULL,'medium','{}','{"required":true,"approvedBy":"owner"}','{"delivery":"sent"}','{"delivery":"delivered"}',now()),
      ($1,$2,$4,'Observe supplier ETA','[{"source":"computer_run","ref":"00000000-0000-4000-8000-00000000e361","timestamp":"2026-08-22T12:00:00.000Z"}]',NULL,'medium','{}','{"required":true,"approvedBy":"owner"}','{"eta":"observed"}','{"status":"succeeded"}',now())`, [TENANT, WORK, ACTION_SENT, ACTION_COMPUTER]);
    await admin.query(`INSERT INTO finnor_os.application_accounts(id,tenant_id,account_key,application,provider,display_name,capabilities) VALUES ('00000000-0000-4000-8000-00000000e372',$1,'supplier_west','supplier_portal','steel','Supplier West','["read"]')`, [TENANT]);
    await admin.query(`INSERT INTO finnor_os.auth_profiles(id,tenant_id,auth_profile_ref,principal_type,principal_id,application_account_id,purpose,credential_provider,credential_ref,capabilities,restrictions) VALUES ('00000000-0000-4000-8000-00000000e373',$1,'supplier-west','employee',$2,'00000000-0000-4000-8000-00000000e372','computer_task','aws-secrets-manager',$3,'["read"]','{}')`, [TENANT, OWNER, `finnor/tenants/${TENANT}/supplier`]);
    await admin.query(`INSERT INTO finnor_os.computer_runs(id,tenant_id,domain_action_id,work_id,actor_id,application_account_id,auth_profile_id,auth_profile_ref,application,provider,status,mode,task,target,allowed_origins,auth_origins,limits,result,effect_status,finished_at) VALUES ($1,$2,$3,$4,$5,'00000000-0000-4000-8000-00000000e372','00000000-0000-4000-8000-00000000e373','supplier-west','supplier_portal','steel','succeeded','READ_ONLY','Observe ETA for WS-48','{"kind":"supplier_order","identifier":"WS-48"}','[]','[]','{"maxSteps":50,"timeoutMs":300000,"maxProviderCredits":2,"maxScreenshots":2,"maxArtifacts":5,"maxDownloadBytes":0,"maxUploadBytes":0,"maxOutputBytes":4096}','{"eta":"2026-08-25"}','none',now())`, [COMPUTER_RUN, TENANT, ACTION_COMPUTER, WORK, OWNER]);
    for (let sequence = 1; sequence <= 45; sequence += 1) {
      await admin.query(`INSERT INTO finnor_os.computer_steps(tenant_id,run_id,seq,phase,operation,status,summary,completed_at) VALUES ($1,$2,$3,'succeeded','observe','succeeded',$4,now())`, [TENANT, COMPUTER_RUN, sequence, `Persisted observation ${sequence}`]);
    }
  }, 120_000);

  afterAll(async () => { await admin.end(); await closePool(); });

  it("reconstructs exact DAG, routes, uncertainty, compensation eligibility, receipts, and bounded computer activity", async () => {
    const projection = await executionProjection(TENANT, WORK, { userId: OWNER, role: "owner", approvableActionIds: [ACTION_UNKNOWN], canControlRuns: true });
    expect(projection).not.toBeNull();
    expect(projection!.nodes).toHaveLength(4);
    expect(projection!.edges).toEqual(expect.arrayContaining([
      expect.objectContaining({ fromActionId: ACTION_SENT, toActionId: ACTION_UNKNOWN }),
      expect.objectContaining({ fromActionId: ACTION_SENT, toActionId: ACTION_COMPUTER }),
    ]));
    expect(projection!.nodes.find((node) => node.id === ACTION_SENT)?.route).toMatchObject({ provider: "resend", identity: { label: "dispatch_email" } });
    const uncertain = projection!.nodes.find((node) => node.id === ACTION_UNKNOWN)!;
    expect(uncertain.observation.verification).toBe("reconciling");
    expect(uncertain.controls.map((control) => control.kind)).toEqual(["approve", "reject", "escalate"]);
    expect(projection!.workflows.find((run) => run.id === RUN_UNKNOWN)?.controls.map((control) => control.kind)).toEqual(["escalate"]);
    expect(projection!.workflows.find((run) => run.id === RUN_COMPLETED)?.steps[0]?.controls).toEqual([expect.objectContaining({ kind: "compensate", endpoint: `/api/workflows/steps/${STEP_COMPENSATABLE}/compensate` })]);
    const computer = projection!.nodes.find((node) => node.id === ACTION_COMPUTER)!.computer!;
    expect(computer.stepCount).toBe(45);
    expect(computer.steps).toHaveLength(40);
    expect(computer.steps[0]?.seq).toBe(6);
    expect(computer.stepsTruncated).toBe(true);
    expect(projection!.nodes.find((node) => node.id === ACTION_CONFIGURED)?.route).toMatchObject({
      application: "supplier_portal",
      provider: "steel",
      identity: { label: "Supplier West" },
      source: "persisted_configuration",
      route: null,
    });
    expect(JSON.stringify(projection)).not.toContain("must-not-render");
    expect(JSON.stringify(projection)).not.toContain("supplier-west");
    expect(projection!.targets).toContainEqual(expect.objectContaining({ entityType: "supplier_order", entityId: "WS-48", label: null }));
  });

  it("enforces role-sensitive redaction and tenant isolation at the read boundary", async () => {
    const technician = await executionProjection(TENANT, WORK, { userId: TECHNICIAN, role: "technician" });
    const sent = technician!.nodes.find((node) => node.id === ACTION_SENT)!;
    expect(sent.semanticPayload.email).toBe("[REDACTED]");
    expect(sent.route?.identity?.label).toBe("Configured email identity");
    expect(technician!.receipts.flatMap((receipt) => receipt.evidence).every((evidence) => evidence.ref === null && evidence.restricted)).toBe(true);
    expect(await executionProjection(FOREIGN_TENANT, WORK, { userId: OWNER, role: "owner" })).toBeNull();
  });

  it("invalidates the selected Work through the existing Phase 2 operational-delta ledger", async () => {
    const rows = (await admin.query(`SELECT change_type,work_id,projection_tags,entity_refs FROM finnor_os.operational_deltas WHERE tenant_id=$1 AND work_id=$2 AND change_type='computer_steps.insert' ORDER BY seq`, [TENANT, WORK])).rows;
    expect(rows).toHaveLength(45);
    expect(rows.every((row) => row.projection_tags.includes("work") && row.projection_tags.includes("computer"))).toBe(true);
    expect(rows[0].entity_refs).toEqual([expect.objectContaining({ entityType: "computer_step" })]);
  });

  it("settles a queued computer receipt with the worker's terminal observation", async () => {
    const actionId = "00000000-0000-4000-8000-00000000e334";
    const runId = "00000000-0000-4000-8000-00000000e362";
    await admin.query(`INSERT INTO finnor_os.domain_actions(id,tenant_id,action_type,payload,status,summary,work_id,initiated_by) VALUES ($1,$2,'computer_task','{}','executing','Terminal receipt proof',$3,$4)`, [actionId, TENANT, WORK, OWNER]);
    await admin.query(`INSERT INTO finnor_os.decision_receipts(tenant_id,work_id,domain_action_id,objective,evidence,risk_tier,proposed_action,approval,actual_result,finalized_at) VALUES ($1,$2,$3,'Computer task queue','[]','medium','{}','{"required":true}','{"pendingComputerRun":true}',now())`, [TENANT, WORK, actionId]);
    await admin.query(`INSERT INTO finnor_os.computer_runs(id,tenant_id,domain_action_id,work_id,actor_id,application_account_id,auth_profile_id,auth_profile_ref,application,provider,status,mode,task,target,allowed_origins,auth_origins,limits,effect_status) VALUES ($1,$2,$3,$4,$5,'00000000-0000-4000-8000-00000000e372','00000000-0000-4000-8000-00000000e373','supplier-west','supplier_portal','steel','running','READ_ONLY','Observe terminal result','{"kind":"supplier_order","identifier":"WS-49"}','[]','[]','{"maxSteps":5,"timeoutMs":300000,"maxProviderCredits":2,"maxScreenshots":2,"maxArtifacts":5,"maxDownloadBytes":0,"maxUploadBytes":0,"maxOutputBytes":4096}','none')`, [runId, TENANT, actionId, WORK, OWNER]);

    await finalizeComputerRun(TENANT, runId, { status: "succeeded", result: { order: "WS-49", eta: "2026-08-27" } });
    const receipt = (await admin.query(`SELECT actual_result,evidence,failure FROM finnor_os.decision_receipts WHERE tenant_id=$1 AND domain_action_id=$2 ORDER BY created_at DESC LIMIT 1`, [TENANT, actionId])).rows[0];
    expect(receipt.actual_result).toMatchObject({ status: "succeeded", computerRunId: runId, result: { order: "WS-49", eta: "2026-08-27" } });
    expect(receipt.evidence).toEqual([expect.objectContaining({ source: "computer_run", ref: runId })]);
    expect(receipt.failure).toBeNull();
  });

  it("keeps a 201-action Work bounded and reconstructs it within the local performance budget", async () => {
    await admin.query(`INSERT INTO finnor_os.works(id,tenant_id,status,initial_channel,initial_instruction,created_by,current_owner_id) VALUES ($1,$2,'executing','console','Large Work projection certification',$3,$3)`, [LARGE_WORK, TENANT, OWNER]);
    await admin.query(`INSERT INTO finnor_os.domain_actions(tenant_id,action_type,payload,status,summary,work_id,initiated_by)
      SELECT $1,'create_task',jsonb_build_object('entityType','supplier_order','entityId','PERF-'||g::text),'draft','Large independent branch '||g::text,$2,$3
      FROM generate_series(1,201) AS g`, [TENANT, LARGE_WORK, OWNER]);
    const started = performance.now();
    const projection = await executionProjection(TENANT, LARGE_WORK, { userId: OWNER, role: "owner" });
    const elapsedMs = performance.now() - started;
    expect(projection!.nodes).toHaveLength(200);
    expect(projection!.truncated.actions).toBe(true);
    expect(projection!.nodes.every((node) => node.dependencyIds.length === 0 && node.status === "runnable")).toBe(true);
    expect(elapsedMs).toBeLessThan(2_500);
  });
});
