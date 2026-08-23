import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import pg from "pg";
import { beginWorkPlannerAttempt, closePool, finishWorkPlannerAttempt, receiveWork } from "@finnor/db";
import { causalReplayProjection } from "@finnor/read-models";
import { migrate } from "../../packages/db/migrate";
import { GET as getReplay } from "../../apps/api/app/api/works/[id]/replay/route";

const DB_URL = process.env.DATABASE_URL ?? "postgres://finnor:finnor@localhost:5432/finnor";
const TENANT = randomUUID();
const OTHER_TENANT = randomUUID();
const OWNER = randomUUID();
const TECHNICIAN = randomUUID();
const WORK = randomUUID();
const POLICY = randomUUID();
const CHAIN = randomUUID();
const ACTION_WRITE = randomUUID();
const ACTION_REJECTED = randomUUID();
const ACTION_FAILED = randomUUID();
const ACTION_RECOVERY = randomUUID();
const ACTION_COMPUTER = randomUUID();
const AUTH_ALLOWED = randomUUID();
const AUTH_REJECT = randomUUID();
const AUTH_FAILED = randomUUID();
const AUTH_RECOVERY = randomUUID();
const AUTH_COMPUTER = randomUUID();
const APPROVAL = randomUUID();
const COMMAND = randomUUID();
const RUN = randomUUID();
const STEP_WRITE = randomUUID();
const STEP_FAILED = randomUUID();
const COMPUTER_RUN = randomUUID();
const ACCOUNT = randomUUID();
const PROFILE = randomUUID();
const ARTIFACT_HASH = "a".repeat(64);

async function databaseAvailable(): Promise<boolean> {
  const client = new pg.Client({ connectionString: DB_URL, connectionTimeoutMillis: 1_500 });
  try { await client.connect(); await client.end(); return true; } catch { return false; }
}
const available = await databaseAvailable();

function request(tenantId: string, role: "owner" | "technician" = "owner", userId = OWNER): Request {
  return new Request(`http://localhost/api/works/${WORK}/replay`, { headers: { "x-tenant-id": tenantId, "x-user-id": userId, "x-user-role": role } });
}

describe.skipIf(!available)("Phase 5 CausalReplayProjection", () => {
  const admin = new pg.Client({ connectionString: DB_URL });
  let plannerAttemptId = "";

  beforeAll(async () => {
    process.env.DATABASE_URL = DB_URL;
    process.env.AUTH_DEV_BYPASS = "1";
    await migrate(DB_URL);
    await admin.connect();
    await admin.query(`INSERT INTO finnor_os.tenants(id,name) VALUES ($1,'Causal Replay'),($2,'Foreign Replay')`, [TENANT, OTHER_TENANT]);
    await admin.query(`INSERT INTO finnor_os.users(id,tenant_id,email,role,display_name) VALUES ($1,$3,$4,'owner','Snapshot Owner'),($2,$3,$5,'technician','Restricted Technician')`, [OWNER, TECHNICIAN, TENANT, `owner-replay-${OWNER}@example.test`, `tech-replay-${TECHNICIAN}@example.test`]);
    await admin.query(`UPDATE finnor_os.authority_states SET revision=7 WHERE tenant_id=$1`, [TENANT]);

    const received = await receiveWork({
      tenantId: TENANT,
      instructionId: WORK,
      userId: OWNER,
      instruction: "Approve the customer correction, reject unsafe outreach, recover the provider failure, and verify the portal.",
      channel: "text",
      activeContext: {
        version: 1,
        capturedAt: "2026-08-22T09:00:00.000Z",
        source: "text",
        focusedEntity: { entityType: "user", entityId: OWNER },
        selectedEntities: [{ entityType: "user", entityId: OWNER }],
        excludedEntities: [{ entityType: "user", entityId: TECHNICIAN }],
        surface: { id: "work", route: `/jarvis/work?workCaseId=${WORK}`, spatialState: "timeline" },
        filters: [{ field: "status", operator: "eq", value: "open" }],
        timeContext: { timezone: "Asia/Kolkata" },
      },
    });
    const attempt = await beginWorkPlannerAttempt({ tenantId: TENANT, workId: WORK, workInputId: received.workInputId, attemptKey: "replay" });
    plannerAttemptId = attempt.id;

    await admin.query(`INSERT INTO finnor_os.domain_policies(id,tenant_id,action_type,policy,requires_confirmation,version,effective_from) VALUES ($1,$2,'update_customer','{"scope":"customer"}',true,1,'2026-08-01T00:00:00Z')`, [POLICY, TENANT]);
    await admin.query(`INSERT INTO finnor_os.domain_policy_revisions(id,tenant_id,policy_id,action_type,version,policy,requires_confirmation,effective_from) VALUES ($1,$2,$3,'update_customer',1,'{"scope":"customer","historical":true}',true,'2026-08-01T00:00:00Z')`, [randomUUID(), TENANT, POLICY]);
    await admin.query(`INSERT INTO finnor_os.approval_chains(id,tenant_id,key,name) VALUES ($1,$2,'owner_review','Owner review')`, [CHAIN, TENANT]);

    await admin.query(`INSERT INTO finnor_os.domain_actions(id,tenant_id,action_type,payload,policy_id,policy_version,status,summary,work_id,planner_attempt_id,initiated_by,plan_id,depends_on,repaired_from_plan_id) VALUES
      ($1,$6,'update_customer',$11::jsonb,$7,1,'completed','Correct customer status',$10,$9,$8,$12,'{}',NULL),
      ($2,$6,'update_customer','{"email":"private@example.test"}',$7,1,'rejected','Unsafe outreach rejected',$10,$9,$8,$12,ARRAY[$1]::uuid[],NULL),
      ($3,$6,'update_customer','{}',$7,1,'failed','Provider write failed',$10,$9,$8,$12,ARRAY[$1]::uuid[],NULL),
      ($4,$6,'update_customer','{}',$7,1,'completed','Recover failed provider write',$10,$9,$8,$13,ARRAY[$1]::uuid[],$12),
      ($5,$6,'computer_task',$14::jsonb,$7,1,'completed','Verify supplier portal',$10,$9,$8,$13,ARRAY[$4]::uuid[],$12)`, [
        ACTION_WRITE, ACTION_REJECTED, ACTION_FAILED, ACTION_RECOVERY, ACTION_COMPUTER,
        TENANT, POLICY, OWNER, plannerAttemptId, WORK,
        JSON.stringify({ entityType: "user", entityId: OWNER, email: "private@example.test" }),
        randomUUID(), randomUUID(), JSON.stringify({ application: "supplier_portal", task: "Verify result", apiKey: "never-render-this-secret" }),
      ]);
    await finishWorkPlannerAttempt({ tenantId: TENANT, attemptId: plannerAttemptId, status: "succeeded", plannerResult: { actionCount: 5, actionIds: [ACTION_WRITE, ACTION_REJECTED, ACTION_FAILED, ACTION_RECOVERY, ACTION_COMPUTER] } });

    for (const [id, actionId, outcome, reason] of [
      [AUTH_ALLOWED, ACTION_WRITE, "allowed", "role_grant"],
      [AUTH_REJECT, ACTION_REJECTED, "approval_required", "approval_chain"],
      [AUTH_FAILED, ACTION_FAILED, "allowed", "role_grant"],
      [AUTH_RECOVERY, ACTION_RECOVERY, "allowed", "role_grant"],
      [AUTH_COMPUTER, ACTION_COMPUTER, "allowed", "role_grant"],
    ] as const) {
      await admin.query(`INSERT INTO finnor_os.authority_decisions(id,tenant_id,employee_id,authority_revision,operation,capability,resource_type,risk,outcome,reason_code,evidence,work_id,domain_action_id) VALUES ($1,$2,$3,7,'action','execute:update_customer','*','medium',$4,$5,'{"grant":"historical"}',$6,$7)`, [id, TENANT, OWNER, outcome, reason, WORK, actionId]);
    }
    await admin.query(`INSERT INTO finnor_os.authority_approval_requests(id,tenant_id,domain_action_id,requester_id,authority_decision_id,approval_chain_id,status,current_step,resolved_at) VALUES ($1,$2,$3,$4,$5,$6,'rejected',1,'2026-08-22T09:04:00Z')`, [APPROVAL, TENANT, ACTION_REJECTED, OWNER, AUTH_REJECT, CHAIN]);
    await admin.query(`INSERT INTO finnor_os.authority_approval_request_steps(tenant_id,approval_request_id,sequence,approver_capability,status,decided_by,decided_at) VALUES ($1,$2,1,'approve:update_customer','rejected',$3,'2026-08-22T09:04:00Z')`, [TENANT, APPROVAL, OWNER]);

    await admin.query(`INSERT INTO finnor_os.external_operations(tenant_id,domain_action_id,operation_key,provider,request_hash,status,response) VALUES
      ($1,$2,'write-customer','crm','hash-write','succeeded','{"acknowledged":true}'),
      ($1,$3,'failed-write','crm','hash-failed','unknown',NULL),
      ($1,$4,'recovery-write','crm','hash-recovery','succeeded','{"acknowledged":true}')`, [TENANT, ACTION_WRITE, ACTION_FAILED, ACTION_RECOVERY]);
    await admin.query(`INSERT INTO finnor_os.business_events(tenant_id,entity_type,entity_id,event_type,payload,occurred_at,source) VALUES ($1,'user',$2,'customer_status_corrected','{"status":"corrected"}','2026-08-22T09:06:00Z',$3)`, [TENANT, OWNER, `domain_action:${ACTION_WRITE}`]);

    await admin.query(`INSERT INTO finnor_os.commands(id,tenant_id,command_type,payload,requested_by,status) VALUES ($1,$2,'causal_replay_workflow','{}',$3,'failed')`, [COMMAND, TENANT, OWNER]);
    await admin.query(`INSERT INTO finnor_os.workflow_runs(id,tenant_id,command_id,work_id,workflow_type,status,version) VALUES ($1,$2,$3,$4,'causal_replay','failed',3)`, [RUN, TENANT, COMMAND, WORK]);
    await admin.query(`INSERT INTO finnor_os.workflow_steps(id,tenant_id,workflow_run_id,step_type,sequence,status,idempotency_key,attempts,payload,domain_action_id,updated_at) VALUES
      ($1,$3,$4,'write_customer',0,'completed','replay-write',1,'{}',$5,'2026-08-22T09:06:00Z'),
      ($2,$3,$4,'provider_unknown',1,'failed','replay-unknown',1,'{}',$6,'2026-08-22T09:07:00Z')`, [STEP_WRITE, STEP_FAILED, TENANT, RUN, ACTION_WRITE, ACTION_FAILED]);
    await admin.query(`INSERT INTO finnor_os.integration_operations(tenant_id,workflow_step_id,operation_key,capability,provider,request_hash,status,response) VALUES ($1,$2,'provider-unknown','update_customer','crm','hash-integration','unknown',NULL)`, [TENANT, STEP_FAILED]);
    await admin.query(`INSERT INTO finnor_os.outbox_events(tenant_id,workflow_step_id,event_type,status,attempts,last_error_kind,created_at) VALUES ($1,$2,'customer.update','unknown',3,'provider_timeout','2026-08-22T09:07:00Z')`, [TENANT, STEP_FAILED]);
    await admin.query(`INSERT INTO finnor_os.inbox_events(tenant_id,provider,event_id,payload_hash,matched_step_id,status,received_at) VALUES ($1,'crm',$3,'hash-callback',$2,'matched','2026-08-22T09:08:00Z')`, [TENANT, STEP_FAILED, `callback-${WORK}`]);
    await admin.query(`INSERT INTO finnor_os.integration_events(tenant_id,source,provider,source_event_id,event_type,occurred_at,work_id,domain_action_id,status,matched_at) VALUES ($1,'crm_webhook','crm',$4,'customer.updated','2026-08-22T09:08:00Z',$2,$3,'matched','2026-08-22T09:08:01Z')`, [TENANT, WORK, ACTION_WRITE, `callback-${WORK}`]);
    await admin.query(`INSERT INTO finnor_os.reconciliation_cases(tenant_id,case_type,related_step_id,details,status,created_at) VALUES ($1,'unknown_delivery',$2,'{"provider":"crm"}','open','2026-08-22T09:09:00Z')`, [TENANT, STEP_FAILED]);
    await admin.query(`INSERT INTO finnor_os.compensation_cases(tenant_id,workflow_step_id,reason,status,details,created_at,resolved_at) VALUES ($1,$2,'Undo customer correction','succeeded','{"verified":true}','2026-08-22T09:10:00Z','2026-08-22T09:11:00Z')`, [TENANT, STEP_WRITE]);

    await admin.query(`INSERT INTO finnor_os.decision_receipts(tenant_id,workflow_run_id,workflow_step_id,domain_action_id,work_id,objective,evidence,policy_applied,risk_tier,proposed_action,approval,expected_result,actual_result,failure,finalized_at) VALUES
      ($1,$2,$3,$4,$5,'Correct customer','[{"source":"business_events","ref":"customer-status","timestamp":"2026-08-22T09:06:00Z"}]','{"id":"${POLICY}","version":1}','medium','{}','{"required":false}','{"status":"corrected"}','{"status":"corrected"}',NULL,'2026-08-22T09:06:30Z'),
      ($1,$2,$6,$7,$5,'Record uncertain failure','[]','{"id":"${POLICY}","version":1}','medium','{}','{"required":false}','{"status":"updated"}',NULL,'{"message":"Provider timed out","errorKind":"unknown_outcome"}','2026-08-22T09:09:00Z')`, [TENANT, RUN, STEP_WRITE, ACTION_WRITE, WORK, STEP_FAILED, ACTION_FAILED]);
    await admin.query(`INSERT INTO finnor_os.decision_receipts(tenant_id,domain_action_id,work_id,objective,evidence,policy_applied,risk_tier,proposed_action,approval,expected_result,actual_result,finalized_at) VALUES ($1,$2,$3,'Recovery result','[{"source":"external_operations","ref":"recovery-write","timestamp":"2026-08-22T09:12:00Z"}]',$4::jsonb,'medium','{}','{"required":false}','{"status":"corrected"}','{"status":"corrected"}','2026-08-22T09:12:00Z')`, [TENANT, ACTION_RECOVERY, WORK, JSON.stringify({ id: POLICY, version: 1 })]);
    await admin.query(`INSERT INTO finnor_os.plan_repairs(tenant_id,failed_domain_action_id,work_id,source_plan_id,repair_plan_id,terminal_receipt,status,created_at,proposed_at) VALUES ($1,$2,$3,$4,$5,'{"failure":"provider timeout"}','proposed','2026-08-22T09:09:30Z','2026-08-22T09:10:00Z')`, [TENANT, ACTION_FAILED, WORK, randomUUID(), randomUUID()]);

    await admin.query(`INSERT INTO finnor_os.application_accounts(id,tenant_id,account_key,application,provider,display_name,capabilities) VALUES ($1,$2,'causal_portal','supplier_portal','steel','Causal Portal','["read"]')`, [ACCOUNT, TENANT]);
    await admin.query(`INSERT INTO finnor_os.auth_profiles(id,tenant_id,auth_profile_ref,principal_type,principal_id,application_account_id,purpose,credential_provider,credential_ref,capabilities,restrictions) VALUES ($1,$2,'causal-profile','employee',$3,$4,'computer_task','aws-secrets-manager',$5,'["read"]','{}')`, [PROFILE, TENANT, OWNER, ACCOUNT, `finnor/tenants/${TENANT}/causal`]);
    await admin.query(`INSERT INTO finnor_os.computer_runs(id,tenant_id,domain_action_id,work_id,actor_id,application_account_id,auth_profile_id,auth_profile_ref,application,provider,status,mode,task,target,allowed_origins,auth_origins,limits,result,effect_status,created_at,finished_at) VALUES ($1,$2,$3,$4,$5,$6,$7,'causal-profile','supplier_portal','steel','succeeded','READ_ONLY','Verify customer correction','{"kind":"customer","identifier":"C-1"}','[]','[]','{"maxSteps":5,"timeoutMs":300000,"maxProviderCredits":2,"maxScreenshots":2,"maxArtifacts":5,"maxDownloadBytes":0,"maxUploadBytes":0,"maxOutputBytes":4096}','{"verified":true}','none','2026-06-01T00:00:00Z','2026-06-01T00:01:00Z')`, [COMPUTER_RUN, TENANT, ACTION_COMPUTER, WORK, OWNER, ACCOUNT, PROFILE]);
    await admin.query(`INSERT INTO finnor_os.computer_artifacts(tenant_id,run_id,kind,mime_type,size_bytes,sha256,storage_ref,content,metadata,created_at) VALUES ($1,$2,'screenshot','image/png',128,$3,NULL,NULL,'{"retained":"metadata"}','2026-06-01T00:01:00Z')`, [TENANT, COMPUTER_RUN, ARTIFACT_HASH]);
    await admin.query(`INSERT INTO finnor_os.tenant_retention_policies(tenant_id,data_class,retention_days,legal_hold) VALUES ($1,'computer_artifact_content',30,false)`, [TENANT]);
    await admin.query(`INSERT INTO finnor_os.decision_receipts(tenant_id,domain_action_id,work_id,objective,evidence,policy_applied,risk_tier,proposed_action,approval,expected_result,actual_result,finalized_at) VALUES ($1,$2,$3,'Portal verification','[{"source":"computer_run","ref":"${COMPUTER_RUN}","timestamp":"2026-06-01T00:01:00Z"}]',$4::jsonb,'low','{}','{"required":false}','{"verified":true}','{"verified":true}','2026-06-01T00:01:00Z')`, [TENANT, ACTION_COMPUTER, WORK, JSON.stringify({ id: POLICY, version: 1 })]);

    await admin.query(`UPDATE finnor_os.domain_policies SET version=2,policy='{"scope":"new-current-policy"}',effective_from='2026-08-23T00:00:00Z' WHERE id=$1`, [POLICY]);
    await admin.query(`INSERT INTO finnor_os.domain_policy_revisions(tenant_id,policy_id,action_type,version,policy,requires_confirmation,effective_from) VALUES ($1,$2,'update_customer',2,'{"scope":"new-current-policy"}',false,'2026-08-23T00:00:00Z')`, [TENANT, POLICY]);
    await admin.query(`UPDATE finnor_os.users SET display_name='Renamed Today' WHERE id=$1`, [OWNER]);
    await admin.query(`UPDATE finnor_os.works SET status='completed' WHERE id=$1`, [WORK]);
  }, 120_000);

  afterAll(async () => { await admin.end(); await closePool(); });

  it("reconstructs exact context, planner, dependency, governance, callback, failure, recovery, compensation, verification, and receipt edges", async () => {
    const started = performance.now();
    const replay = await causalReplayProjection(TENANT, WORK, { userId: OWNER, role: "owner" });
    const elapsedMs = Math.round(performance.now() - started);
    expect(replay).not.toBeNull();
    expect(replay!.mode).toBe("read_only");
    expect(replay!.readOnlyGuarantee).toEqual({ source: "durable_projection", method: "GET", mutationControlsIncluded: false, sideEffectsPossible: false });
    expect(replay!.edges.every((edge) => edge.certainty === "missing" || edge.evidenceRefs.length > 0)).toBe(true);
    expect(replay!.nodes).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: `action:${ACTION_WRITE}` }),
      expect.objectContaining({ id: `approval:${APPROVAL}`, status: "rejected" }),
      expect.objectContaining({ id: `computer-run:${COMPUTER_RUN}` }),
      expect.objectContaining({ stage: "recovery", title: "Plan recovery" }),
      expect.objectContaining({ stage: "compensation", title: "Compensating action" }),
      expect.objectContaining({ stage: "external_event", title: "Customer Updated" }),
      expect.objectContaining({ stage: "canonical_change", title: "Customer Status Corrected" }),
    ]));
    expect(replay!.edges).toEqual(expect.arrayContaining([
      expect.objectContaining({ from: `action:${ACTION_WRITE}`, to: `action:${ACTION_REJECTED}`, relation: "must_complete_before" }),
      expect.objectContaining({ from: `action:${ACTION_WRITE}`, to: `action:${ACTION_FAILED}`, relation: "must_complete_before" }),
      expect.objectContaining({ to: `approval:${APPROVAL}`, relation: "required_approval" }),
      expect.objectContaining({ to: `computer-run:${COMPUTER_RUN}`, relation: "authorized_dispatch" }),
      expect.objectContaining({ relation: "matched_provider_callback" }),
      expect.objectContaining({ relation: "compensated_by" }),
    ]));
    const policyNodes = replay!.nodes.filter((node) => node.id.startsWith("policy:"));
    expect(policyNodes.length).toBeGreaterThan(0);
    expect(policyNodes.every((node) => node.title.endsWith("v1"))).toBe(true);
    expect(JSON.stringify(policyNodes)).toContain("historical");
    expect(JSON.stringify(policyNodes)).not.toContain("new-current-policy");
    const context = replay!.nodes.find((node) => node.id === `decision-context:${plannerAttemptId}`)!;
    expect(context.facts.entities).toEqual(expect.arrayContaining([expect.objectContaining({ entityId: OWNER, label: "Snapshot Owner" })]));
    expect(JSON.stringify(replay)).not.toContain("never-render-this-secret");
    console.log(`[phase5-metric] ${JSON.stringify({ name: "causal_replay_flagship", latencyMs: elapsedMs, nodes: replay!.nodes.length, edges: replay!.edges.length, provenEdges: replay!.completeness.provenEdges })}`);
  });

  it("fails closed across tenants and restricts technician evidence references, including retained artifact metadata", async () => {
    expect(await causalReplayProjection(OTHER_TENANT, WORK, { userId: OWNER, role: "owner" })).toBeNull();
    const technician = await causalReplayProjection(TENANT, WORK, { userId: TECHNICIAN, role: "technician" });
    expect(technician!.viewer.evidenceVisibility).toBe("restricted");
    expect(technician!.nodes.flatMap((node) => node.evidence).filter((item) => item.availability === "restricted").length).toBeGreaterThan(0);
    expect(technician!.nodes.find((node) => node.id.startsWith("computer-artifact:"))?.evidence[0]).toMatchObject({ availability: "restricted", ref: null, integrityHash: ARTIFACT_HASH });
    const owner = await causalReplayProjection(TENANT, WORK, { userId: OWNER, role: "owner" });
    expect(owner!.nodes.find((node) => node.id.startsWith("computer-artifact:"))?.evidence[0]).toMatchObject({ availability: "expired", integrityHash: ARTIFACT_HASH });
    expect(JSON.stringify(technician)).not.toContain("private@example.test");
  });

  it("keeps provenance immutable and replay GET deterministic without creating work, jobs, actions, or state changes", async () => {
    await expect(admin.query(`UPDATE finnor_os.work_planner_attempts SET decision_context_hash=$1 WHERE id=$2`, ["0".repeat(64), plannerAttemptId])).rejects.toThrow(/immutable/i);
    const before = (await admin.query(`SELECT (SELECT count(*) FROM finnor_os.jobs)::int AS jobs,(SELECT count(*) FROM finnor_os.domain_actions WHERE tenant_id=$1)::int AS actions,(SELECT status FROM finnor_os.works WHERE id=$2) AS status`, [TENANT, WORK])).rows[0];
    const firstResponse = await getReplay(request(TENANT), { params: Promise.resolve({ id: WORK }) });
    const secondResponse = await getReplay(request(TENANT), { params: Promise.resolve({ id: WORK }) });
    expect(firstResponse.status).toBe(200);
    expect(secondResponse.status).toBe(200);
    expect(firstResponse.headers.get("cache-control")).toBe("private, no-store");
    const first = (await firstResponse.json()).replay;
    const second = (await secondResponse.json()).replay;
    expect({ nodes: first.nodes, edges: first.edges, explanation: first.explanation }).toEqual({ nodes: second.nodes, edges: second.edges, explanation: second.explanation });
    const after = (await admin.query(`SELECT (SELECT count(*) FROM finnor_os.jobs)::int AS jobs,(SELECT count(*) FROM finnor_os.domain_actions WHERE tenant_id=$1)::int AS actions,(SELECT status FROM finnor_os.works WHERE id=$2) AS status`, [TENANT, WORK])).rows[0];
    expect(after).toEqual(before);
    expect((await getReplay(request(OTHER_TENANT), { params: Promise.resolve({ id: WORK }) })).status).toBe(404);
  });

  it("marks legacy missing provenance honestly and keeps large history latency bounded", async () => {
    const legacyWork = randomUUID();
    await admin.query(`INSERT INTO finnor_os.works(id,tenant_id,status,initial_channel,initial_instruction,created_by) VALUES ($1,$2,'completed','console','Legacy incomplete Work',$3)`, [legacyWork, TENANT, OWNER]);
    await admin.query(`INSERT INTO finnor_os.work_inputs(id,tenant_id,work_id,instruction_id,channel,instruction_text,created_by) VALUES ($1,$2,$1,$1,'console','Legacy incomplete Work',$3)`, [legacyWork, TENANT, OWNER]);
    await admin.query(`INSERT INTO finnor_os.instruction_sessions(id,tenant_id,work_id,user_id,instruction_text,source) VALUES ($1,$2,$1,$3,'Legacy incomplete Work','typed')`, [legacyWork, TENANT, OWNER]);
    await admin.query(`INSERT INTO finnor_os.domain_actions(tenant_id,action_type,payload,status,summary,work_id,initiated_by) SELECT $1,'create_task','{}','draft','Bounded history branch '||g,$2,$3 FROM generate_series(1,240) g`, [TENANT, legacyWork, OWNER]);
    const started = performance.now();
    const replay = await causalReplayProjection(TENANT, legacyWork, { userId: OWNER, role: "owner" });
    const elapsedMs = performance.now() - started;
    expect(replay!.completeness.status).toBe("legacy_incomplete");
    expect(replay!.nodes).toEqual(expect.arrayContaining([expect.objectContaining({ stage: "missing", status: "legacy incomplete history" })]));
    expect(replay!.truncated.nodes || replay!.truncated.actionEvents || replay!.nodes.length <= replay!.limits.nodes).toBe(true);
    expect(elapsedMs).toBeLessThan(4_000);
    console.log(`[phase5-metric] ${JSON.stringify({ name: "causal_replay_large_history", latencyMs: Math.round(elapsedMs), sourceActions: 240, projectedNodes: replay!.nodes.length, projectedEdges: replay!.edges.length, nodeLimit: replay!.limits.nodes })}`);
  }, 20_000);
});
