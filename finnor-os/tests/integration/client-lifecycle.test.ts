import { randomUUID } from "node:crypto";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { closePool, getPool } from "@finnor/db";
import { migrate } from "../../packages/db/migrate";
import { parseClientManifest, type ClientManifest } from "../../scripts/client-manifest";
import type { TenantAuthAdmin } from "../../scripts/tenant-user";
import { runClientFactory, startClientFactory } from "../../scripts/client-factory";
import {
  applyClientLifecycleUpdate,
  checkClientLifecycleDrift,
  promoteClientLifecycleRelease,
  rollbackClientLifecycleRelease,
} from "../../scripts/client-lifecycle";
import {
  CLIENT_GATE_KEYS,
  CORE_GATE_KEYS,
  createClientCertification,
  createClientRelease,
  createCoreCertification,
  credentialReferenceStatuses,
  gateResult,
  hashClientConfiguration,
  sha256,
  type ClientRelease,
  type CoreCertification,
} from "../../scripts/release/certification-model";
import { persistClientReleaseBundle } from "../../scripts/release/certification-store";
import {
  ClientLifecycleConflictError,
  beginLifecycleOperation,
  completeLifecycleOperation,
  inspectClientLifecycle,
  persistClientReleaseConfiguration,
  readClientReleaseBundle,
} from "../../scripts/release/client-lifecycle-store";

const DB_URL = process.env.DATABASE_URL ?? "postgres://finnor:finnor@localhost:5432/finnor";
async function dbUp() {
  const client = new pg.Client({ connectionString: DB_URL, connectionTimeoutMillis: 2_000 });
  try { await client.connect(); await client.end(); return true; } catch { return false; }
}
const available = await dbUp();

function fakeAuth(): TenantAuthAdmin {
  const users = new Map<string, { id: string; email: string }>();
  return {
    listUsers: vi.fn(async () => ({ data: { users: [...users.values()], nextPage: null }, error: null })),
    createUser: vi.fn(async ({ email }: { email: string }) => {
      const user = { id: randomUUID(), email };
      users.set(email, user);
      return { data: { user }, error: null };
    }),
    updateUserById: vi.fn(async () => ({ data: { user: {} }, error: null })),
  } as unknown as TenantAuthAdmin;
}

function clientManifest(clientKey: string, workspaceLabel = "Home"): ClientManifest {
  return parseClientManifest({
    clientKey,
    tenant: { name: `${clientKey} Water`, timezone: "America/Chicago" },
    users: [{ email: `owner@${clientKey}.example`, role: "owner" }],
    workspaceConfig: {
      enabledSurfaces: ["home", "work", "customers", "schedule", "money", "agents"],
      terminology: { home: workspaceLabel, work: "Work", customers: "Customers", schedule: "Schedule", money: "Money", agents: "Agents" },
      voiceEnabled: true,
      navigationPriority: ["home", "work", "customers", "schedule", "money", "agents"],
      brand: { accent: "cyan", radius: "soft", mark: "F" },
      visibility: { policy: true, authority: true },
    },
    policyOverrides: { create_review_request: { policy: { review_link_url: "https://example.test/review" } } },
  });
}

function cleanDiff(core: CoreCertification) {
  return {
    canonicalCoreSha: core.canonicalCoreSha,
    coreSourceTreeHash: core.coreSourceTreeHash,
    changedSharedCorePaths: [],
    changedClientPaths: [],
    clean: true,
  };
}

async function converge(manifest: ClientManifest, auth: TenantAuthAdmin) {
  const started = await startClientFactory(manifest, { pool: getPool(), enqueue: false });
  const result = await runClientFactory(started.run.id, { pool: getPool(), auth });
  expect(result.status).toBe("passed");
  return result;
}

async function immutableRelease(input: {
  manifest: ClientManifest;
  tenantId: string;
  factoryRunId: string;
  core: CoreCertification;
  predecessor?: string | null;
  failed?: boolean;
}): Promise<ClientRelease> {
  const deployment = {
    service: "finnor-api",
    commitSha: input.core.canonicalCoreSha,
    coreCertificationId: input.core.certificationId,
    deploymentId: "dpl_phase6_lifecycle",
    traceable: true,
  };
  const certification = createClientCertification({
    clientKey: input.manifest.clientKey,
    tenantId: input.tenantId,
    coreCertification: input.core,
    configurationHashes: hashClientConfiguration(input.manifest),
    deploymentEvidence: deployment,
    migrationVersion: "0083_client_release_lifecycle.sql",
    schemaHash: sha256("phase6-schema"),
    gates: CLIENT_GATE_KEYS.map((gate) => gateResult(gate, input.failed && gate === "evidence_receipts" ? "FAIL" : "PASS", { gate })),
  });
  const release = createClientRelease({
    coreCertification: input.core,
    clientCertification: certification,
    deploymentEvidence: deployment,
    integrations: credentialReferenceStatuses(input.manifest),
    predecessorReleaseId: input.predecessor ?? null,
    factoryRunId: input.factoryRunId,
  });
  await persistClientReleaseBundle(getPool(), { core: input.core, certification, release });
  await persistClientReleaseConfiguration(getPool(), { release, manifest: input.manifest });
  return release;
}

describe.skipIf(!available).sequential("Phase 6 client release lifecycle", () => {
  const core = createCoreCertification({
    canonicalCoreSha: "6".repeat(40),
    coreSourceTreeHash: sha256("phase6-shared-core-v2"),
    gates: CORE_GATE_KEYS.map((gate) => gateResult(gate, "PASS", { gate })),
    certifiedAt: "2026-08-20T00:00:00.000Z",
  });
  const auth = fakeAuth();
  const dependencies = { pool: getPool(), auth, inspectCore: () => cleanDiff(core) };

  beforeAll(async () => {
    process.env.DATABASE_URL = DB_URL;
    await migrate(DB_URL);
    await getPool().query(
      `INSERT INTO finnor_os.worker_heartbeat(id,last_beat_at,meta)
       VALUES('worker',now(),$1::jsonb)
       ON CONFLICT(id) DO UPDATE SET last_beat_at=now(),meta=excluded.meta`,
      [JSON.stringify({ releaseSha: core.canonicalCoreSha, coreCertificationId: core.certificationId, deploymentId: "worker-phase6" })],
    );
  });
  afterAll(() => closePool());

  it("enforces no-op, certification, stale-core, drift, concurrency, independent clients, and safe rollback", async () => {
    const suffix = randomUUID().slice(0, 8);
    const clientA = `lifecycle-a-${suffix}`;
    const clientB = `lifecycle-b-${suffix}`;
    const manifestA1 = clientManifest(clientA, "Home");
    const manifestB1 = clientManifest(clientB, "Home");
    const factoryA1 = await converge(manifestA1, auth);
    const factoryB1 = await converge(manifestB1, auth);
    const releaseA1 = await immutableRelease({ manifest: manifestA1, tenantId: factoryA1.tenantId!, factoryRunId: factoryA1.id, core });
    const releaseB1 = await immutableRelease({ manifest: manifestB1, tenantId: factoryB1.tenantId!, factoryRunId: factoryB1.id, core });

    await promoteClientLifecycleRelease(clientA, releaseA1.releaseId, dependencies);
    await promoteClientLifecycleRelease(clientB, releaseB1.releaseId, dependencies);
    expect((await checkClientLifecycleDrift(clientA, dependencies)).status).toBe("CLEAN");
    expect((await checkClientLifecycleDrift(clientB, dependencies)).status).toBe("CLEAN");

    const beforeNoop = await getPool().query(
      `SELECT
        (SELECT coalesce(sum(version),0)::int FROM finnor_os.domain_policies WHERE tenant_id=$1) policy_versions,
        (SELECT count(*)::int FROM finnor_os.import_runs WHERE tenant_id=$1) imports,
        (SELECT md5(coalesce(string_agg(capability || ':' || updated_at::text,',' ORDER BY capability),'')) FROM finnor_os.tenant_integrations WHERE tenant_id=$1) integration_state_hash,
        (SELECT count(*)::int FROM finnor_os.client_releases WHERE client_key=$2) releases`,
      [factoryA1.tenantId, clientA],
    );
    const noChange = await applyClientLifecycleUpdate(manifestA1, dependencies);
    expect(noChange.status).toBe("NOOP");
    const afterNoop = await getPool().query(
      `SELECT
        (SELECT coalesce(sum(version),0)::int FROM finnor_os.domain_policies WHERE tenant_id=$1) policy_versions,
        (SELECT count(*)::int FROM finnor_os.import_runs WHERE tenant_id=$1) imports,
        (SELECT md5(coalesce(string_agg(capability || ':' || updated_at::text,',' ORDER BY capability),'')) FROM finnor_os.tenant_integrations WHERE tenant_id=$1) integration_state_hash,
        (SELECT count(*)::int FROM finnor_os.client_releases WHERE client_key=$2) releases`,
      [factoryA1.tenantId, clientA],
    );
    expect(afterNoop.rows[0]).toEqual(beforeNoop.rows[0]);

    const held = await beginLifecycleOperation(getPool(), { clientKey: clientA, tenantId: factoryA1.tenantId, operationType: "apply" });
    await expect(beginLifecycleOperation(getPool(), { clientKey: clientA, tenantId: factoryA1.tenantId, operationType: "promote" }))
      .rejects.toBeInstanceOf(ClientLifecycleConflictError);
    await completeLifecycleOperation(getPool(), held, "NOOP", { test: "released conflict lock" });

    const uncertified = await immutableRelease({
      manifest: manifestA1, tenantId: factoryA1.tenantId!, factoryRunId: factoryA1.id, core,
      predecessor: releaseA1.releaseId, failed: true,
    });
    await expect(promoteClientLifecycleRelease(clientA, uncertified.releaseId, dependencies)).rejects.toThrow(/promotion refused/i);

    await getPool().query(
      "UPDATE finnor_os.worker_heartbeat SET last_beat_at=now(),meta=$1::jsonb WHERE id='worker'",
      [JSON.stringify({ releaseSha: "7".repeat(40), coreCertificationId: `corecert-${"7".repeat(64)}`, deploymentId: "stale-worker" })],
    );
    await expect(promoteClientLifecycleRelease(clientA, releaseA1.releaseId, dependencies)).rejects.toThrow(/promotion refused/i);
    await getPool().query(
      "UPDATE finnor_os.worker_heartbeat SET last_beat_at=now(),meta=$1::jsonb WHERE id='worker'",
      [JSON.stringify({ releaseSha: core.canonicalCoreSha, coreCertificationId: core.certificationId, deploymentId: "worker-phase6" })],
    );

    await getPool().query(
      `UPDATE finnor_os.tenant_settings SET workspace_config=jsonb_set(workspace_config,'{terminology,home}','"Drifted"'::jsonb)
       WHERE tenant_id=$1`,
      [factoryA1.tenantId],
    );
    const drifted = await checkClientLifecycleDrift(clientA, dependencies);
    expect(drifted.status).toBe("DRIFT");
    expect(drifted.items.some((item) => item.area === "workspace" && item.code === "persisted_state_mismatch")).toBe(true);
    await getPool().query(
      "UPDATE finnor_os.tenant_settings SET workspace_config=$2::jsonb WHERE tenant_id=$1",
      [factoryA1.tenantId, JSON.stringify(manifestA1.workspaceConfig)],
    );

    const manifestA2 = clientManifest(clientA, "Command Center");
    const appliedA2 = await applyClientLifecycleUpdate(manifestA2, dependencies);
    expect(appliedA2.status).toBe("PASS");
    const appliedFactory = await getPool().query<{ stage_key: string }>(
      "SELECT stage_key FROM finnor_os.client_factory_stages WHERE run_id=$1 AND attempts>0 ORDER BY ordinal",
      [appliedA2.factoryRunId],
    );
    expect(appliedFactory.rows.map((row) => row.stage_key)).toEqual([
      "validate", "workspace_policies", "tenant_health", "ready_for_certification",
    ]);
    const releaseA2 = await immutableRelease({
      manifest: manifestA2,
      tenantId: factoryA1.tenantId!,
      factoryRunId: appliedA2.factoryRunId!,
      core,
      predecessor: releaseA1.releaseId,
    });
    await promoteClientLifecycleRelease(clientA, releaseA2.releaseId, dependencies);

    const statusB = await inspectClientLifecycle(getPool(), clientB) as { active: { release_id: string } };
    expect(statusB.active.release_id).toBe(releaseB1.releaseId);
    expect((await checkClientLifecycleDrift(clientA, dependencies)).status).toBe("CLEAN");
    expect((await checkClientLifecycleDrift(clientB, dependencies)).status).toBe("CLEAN");
    expect(releaseA2.core.certificationId).toBe(releaseB1.core.certificationId);
    expect(releaseA2.core.canonicalSha).toBe(releaseB1.core.canonicalSha);

    await getPool().query(
      `INSERT INTO finnor_os.domain_actions(tenant_id,action_type,payload,status,summary)
       VALUES($1,'send_customer_message','{}'::jsonb,'completed','irreversible lifecycle proof')`,
      [factoryA1.tenantId],
    );
    const rollback = await rollbackClientLifecycleRelease(clientA, releaseA1.releaseId, dependencies) as {
      status: string; scope: string; irreversibleEffects: { retained: { completedActions: number } };
    };
    expect(rollback).toMatchObject({ status: "PASS", scope: "configuration_only" });
    expect(rollback.irreversibleEffects.retained.completedActions).toBeGreaterThan(0);
    expect((await checkClientLifecycleDrift(clientA, dependencies)).status).toBe("CLEAN");
    const history = await inspectClientLifecycle(getPool(), clientA) as {
      active: { release_id: string }; releases: Array<{ release_id: string }>; promotions: Array<{ kind: string }>;
    };
    expect(history.active.release_id).toBe(releaseA1.releaseId);
    expect(history.releases.map((row) => row.release_id)).toEqual(expect.arrayContaining([releaseA1.releaseId, releaseA2.releaseId]));
    expect(history.promotions.some((row) => row.kind === "rollback")).toBe(true);
    expect((await readClientReleaseBundle(getPool(), releaseA2.releaseId)).release.releaseId).toBe(releaseA2.releaseId);
  }, 180_000);
});
