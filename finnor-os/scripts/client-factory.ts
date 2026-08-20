import "dotenv/config";
import { createHash, randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, isAbsolute, resolve } from "node:path";
import type pg from "pg";
import { createClient } from "@supabase/supabase-js";
import { closePool, getPool } from "@finnor/db";
import { parseImportDefinition, runDeclarativeImport, type ImportReport } from "@finnor/import-engine";
import { loadClientManifest, parseClientManifest, type ClientManifest } from "./client-manifest";
import { convergeClientUsers, preflightUserAssignments } from "./client-provisioning";
import type { TenantAuthAdmin } from "./tenant-user";
import { convergeIntegrations, convergeWorkspaceAndPolicies, ensureTenantRecord } from "./tenant-bootstrap";

export const CLIENT_FACTORY_STAGES = [
  "validate",
  "tenant",
  "identity",
  "workspace_policies",
  "integrations_credentials",
  "import",
  "tenant_health",
  "ready_for_certification",
] as const;
export type ClientFactoryStage = typeof CLIENT_FACTORY_STAGES[number];
export type FactoryStatus = "pending" | "running" | "passed" | "failed" | "blocked_config" | "cancelled";

const LEASE_SECONDS = 300;
const stable = (value: unknown): string => {
  if (Array.isArray(value)) return `[${value.map(stable).join(",")}]`;
  if (value && typeof value === "object") return `{${Object.entries(value as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b)).map(([key, nested]) => `${JSON.stringify(key)}:${stable(nested)}`).join(",")}}`;
  return JSON.stringify(value);
};
const sha256 = (value: unknown): string => createHash("sha256").update(typeof value === "string" ? value : stable(value)).digest("hex");
const safeError = (error: unknown): string => {
  const message = error instanceof Error ? error.message : String(error);
  return message
    .replace(/Bearer\s+[A-Za-z0-9._~+/-]+/gi, "Bearer [REDACTED]")
    .replace(/\b(sk|rk|pk)_(live|test)_[A-Za-z0-9]+\b/g, "[REDACTED]")
    .replace(/(secret|password|api[_ -]?key|access[_ -]?token)\s*[=:]\s*[^\s,;]+/gi, "$1=[REDACTED]")
    .slice(0, 2_000);
};

export class FactoryBlockedConfigError extends Error {
  constructor(message: string, readonly evidence: Record<string, unknown> = {}) {
    super(message);
    this.name = "FactoryBlockedConfigError";
  }
}

export class FactoryStageError extends Error {
  constructor(message: string, readonly evidence: Record<string, unknown> = {}) {
    super(message);
    this.name = "FactoryStageError";
  }
}

export interface FactoryRunSummary {
  id: string;
  clientKey: string;
  tenantId: string | null;
  manifestSha256: string;
  status: FactoryStatus;
  currentStage: string | null;
  dispatchVersion: number;
  lastError: string | null;
  cancelRequestedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

interface FactoryRunRow {
  id: string;
  client_key: string;
  tenant_id: string | null;
  manifest_sha256: string;
  manifest_snapshot: unknown;
  status: FactoryStatus;
  current_stage: string | null;
  lease_owner: string | null;
  lease_expires_at: Date | null;
  dispatch_version: number;
  cancel_requested_at: Date | null;
  last_error: string | null;
  created_at: Date;
  updated_at: Date;
}

interface FactoryStageRow {
  id: string;
  run_id: string;
  stage_key: ClientFactoryStage;
  ordinal: number;
  status: FactoryStatus;
  input_sha256: string | null;
  attempts: number;
  evidence: Record<string, unknown>;
  last_error: string | null;
}

export type ImportSourceResolver = (input: {
  manifest: ClientManifest;
  importKey: string;
  sourceRef: string;
}) => Promise<{ name: string; content: string }>;

export interface RunClientFactoryDependencies {
  auth: TenantAuthAdmin;
  pool?: pg.Pool;
  resolveImportSource?: ImportSourceResolver;
  leaseOwner?: string;
  /** Test-only boundary hook used to simulate a process disappearing between stages. */
  afterStage?: (stage: ClientFactoryStage) => Promise<void> | void;
}

function rowSummary(row: FactoryRunRow): FactoryRunSummary {
  return {
    id: row.id,
    clientKey: row.client_key,
    tenantId: row.tenant_id,
    manifestSha256: row.manifest_sha256,
    status: row.status,
    currentStage: row.current_stage,
    dispatchVersion: row.dispatch_version,
    lastError: row.last_error,
    cancelRequestedAt: row.cancel_requested_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

async function adminTransaction<T>(pool: pg.Pool, fn: (client: pg.PoolClient) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query("SET LOCAL search_path = finnor_os, public");
    await client.query("SET LOCAL row_security = off");
    const result = await fn(client);
    await client.query("COMMIT");
    return result;
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}

async function insertFactoryJob(client: pg.PoolClient, runId: string, dispatchVersion: number): Promise<void> {
  await client.query(
    `INSERT INTO jobs (type, payload, idempotency_key, lane, priority)
     VALUES ('run_client_factory', $1::jsonb, $2, 'batch', 20)
     ON CONFLICT (idempotency_key) DO NOTHING`,
    [JSON.stringify({ runId }), `client-factory:${runId}:${dispatchVersion}`],
  );
}

async function ensureStageRows(client: pg.PoolClient, runId: string, previousRunId?: string): Promise<void> {
  for (const [index, stage] of CLIENT_FACTORY_STAGES.entries()) {
    await client.query(
      `INSERT INTO client_factory_stages (run_id, stage_key, ordinal)
       VALUES ($1, $2, $3) ON CONFLICT (run_id, stage_key) DO NOTHING`,
      [runId, stage, index + 1],
    );
  }
  if (previousRunId) {
    // Copy only verifiably-passed checkpoints. Each stage recalculates its input hash
    // before reuse, so changed files/configuration invalidate the copy automatically.
    await client.query(
      `UPDATE client_factory_stages current
       SET status = previous.status,
           input_sha256 = previous.input_sha256,
           evidence = previous.evidence || jsonb_build_object('reusedFromRunId', $2::text),
           finished_at = previous.finished_at,
           updated_at = now()
       FROM client_factory_stages previous
       WHERE current.run_id = $1 AND previous.run_id = $2
         AND current.stage_key = previous.stage_key AND previous.status = 'passed'`,
      [runId, previousRunId],
    );
  }
}

export async function startClientFactory(
  value: ClientManifest | unknown,
  options: { pool?: pg.Pool; enqueue?: boolean } = {},
): Promise<{ run: FactoryRunSummary; created: boolean; dispatched: boolean }> {
  const manifest = parseClientManifest(value);
  const pool = options.pool ?? getPool();
  const manifestSha = sha256(manifest);
  return adminTransaction(pool, async (client) => {
    await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1, 0))", [`client-factory:${manifest.clientKey}`]);
    const activeResult = await client.query<FactoryRunRow>(
      `SELECT * FROM client_factory_runs
       WHERE client_key = $1 AND status IN ('pending','running','failed','blocked_config')
       ORDER BY created_at DESC LIMIT 1 FOR UPDATE`,
      [manifest.clientKey],
    );
    const active = activeResult.rows[0];
    if (active && active.status === "running" && active.lease_expires_at && active.lease_expires_at > new Date()) {
      return { run: rowSummary(active), created: false, dispatched: false };
    }

    let run: FactoryRunRow;
    let created = false;
    if (active) {
      const result = await client.query<FactoryRunRow>(
        `UPDATE client_factory_runs
         SET manifest_version=$2, manifest_sha256=$3, manifest_snapshot=$4::jsonb,
             status='pending', current_stage=NULL, dispatch_version=dispatch_version+1,
             cancel_requested_at=NULL, last_error=NULL, finished_at=NULL,
             lease_owner=NULL, lease_expires_at=NULL, updated_at=now()
         WHERE id=$1 RETURNING *`,
        [active.id, manifest.manifestVersion, manifestSha, JSON.stringify(manifest)],
      );
      run = result.rows[0]!;
      await ensureStageRows(client, run.id);
    } else {
      const previous = await client.query<{ id: string; tenant_id: string | null }>(
        "SELECT id, tenant_id FROM client_factory_runs WHERE client_key=$1 AND status='passed' ORDER BY created_at DESC LIMIT 1",
        [manifest.clientKey],
      );
      const result = await client.query<FactoryRunRow>(
        `INSERT INTO client_factory_runs
           (client_key, tenant_id, manifest_version, manifest_sha256, manifest_snapshot, status, dispatch_version)
         VALUES ($1,$2,$3,$4,$5::jsonb,'pending',1) RETURNING *`,
        [manifest.clientKey, previous.rows[0]?.tenant_id ?? null, manifest.manifestVersion, manifestSha, JSON.stringify(manifest)],
      );
      run = result.rows[0]!;
      created = true;
      await ensureStageRows(client, run.id, previous.rows[0]?.id);
    }
    if (options.enqueue !== false) await insertFactoryJob(client, run.id, run.dispatch_version);
    return { run: rowSummary(run), created, dispatched: options.enqueue !== false };
  });
}

export async function resumeClientFactory(
  runId: string,
  options: { pool?: pg.Pool; enqueue?: boolean; manifest?: ClientManifest | unknown } = {},
): Promise<FactoryRunSummary> {
  const pool = options.pool ?? getPool();
  const replacement = options.manifest === undefined ? null : parseClientManifest(options.manifest);
  return adminTransaction(pool, async (client) => {
    const selected = await client.query<FactoryRunRow>("SELECT * FROM client_factory_runs WHERE id=$1 FOR UPDATE", [runId]);
    const current = selected.rows[0];
    if (!current) throw new Error(`Client factory run ${runId} was not found`);
    if (replacement && replacement.clientKey !== current.client_key) {
      throw new Error(`Replacement manifest clientKey ${replacement.clientKey} does not match run client ${current.client_key}`);
    }
    if (current.status === "passed") return rowSummary(current);
    if (current.status === "cancelled") throw new Error("A cancelled factory run cannot be resumed; start a new run");
    if (current.status === "running" && current.lease_expires_at && current.lease_expires_at > new Date()) return rowSummary(current);
    const result = await client.query<FactoryRunRow>(
      `UPDATE client_factory_runs SET
         manifest_version=COALESCE($2,manifest_version),
         manifest_sha256=COALESCE($3,manifest_sha256),
         manifest_snapshot=COALESCE($4::jsonb,manifest_snapshot),
         status='pending', current_stage=NULL,
         dispatch_version=dispatch_version+1, cancel_requested_at=NULL, last_error=NULL,
         lease_owner=NULL, lease_expires_at=NULL, updated_at=now()
       WHERE id=$1 RETURNING *`,
      [runId, replacement?.manifestVersion ?? null, replacement ? sha256(replacement) : null, replacement ? JSON.stringify(replacement) : null],
    );
    const run = result.rows[0]!;
    if (options.enqueue !== false) await insertFactoryJob(client, run.id, run.dispatch_version);
    return rowSummary(run);
  });
}

export async function cancelClientFactory(runId: string, pool: pg.Pool = getPool()): Promise<FactoryRunSummary> {
  const result = await pool.query<FactoryRunRow>(
    `UPDATE finnor_os.client_factory_runs
     SET cancel_requested_at=now(),
         status=CASE WHEN status='running' THEN status WHEN status IN ('pending','failed','blocked_config') THEN 'cancelled' ELSE status END,
         finished_at=CASE WHEN status IN ('pending','failed','blocked_config') THEN now() ELSE finished_at END,
         updated_at=now()
     WHERE id=$1 RETURNING *`,
    [runId],
  );
  if (!result.rows[0]) throw new Error(`Client factory run ${runId} was not found`);
  return rowSummary(result.rows[0]);
}

export async function inspectClientFactory(input: { runId?: string; clientKey?: string }, pool: pg.Pool = getPool()) {
  if (!input.runId && !input.clientKey) throw new Error("runId or clientKey is required");
  const runResult = await pool.query<FactoryRunRow>(
    input.runId
      ? "SELECT * FROM finnor_os.client_factory_runs WHERE id=$1"
      : "SELECT * FROM finnor_os.client_factory_runs WHERE client_key=$1 ORDER BY created_at DESC LIMIT 1",
    [input.runId ?? input.clientKey],
  );
  const run = runResult.rows[0];
  if (!run) return null;
  const stages = await pool.query<FactoryStageRow>(
    "SELECT * FROM finnor_os.client_factory_stages WHERE run_id=$1 ORDER BY ordinal",
    [run.id],
  );
  return { ...rowSummary(run), stages: stages.rows.map((stage) => ({
    key: stage.stage_key, status: stage.status, inputSha256: stage.input_sha256,
    attempts: stage.attempts, evidence: stage.evidence, lastError: stage.last_error,
  })) };
}

async function defaultImportSourceResolver(input: { sourceRef: string }): Promise<{ name: string; content: string }> {
  const path = input.sourceRef.startsWith("file://") ? fileURLToPath(input.sourceRef) : input.sourceRef;
  if (!isAbsolute(path)) throw new FactoryBlockedConfigError(`Import sourceRef must be absolute for durable execution: ${input.sourceRef}`, { importSourceRef: input.sourceRef });
  return { name: path, content: await readFile(path, "utf8") };
}

interface PreparedImport {
  key: string;
  definition: ReturnType<typeof parseImportDefinition>;
  source: { name: string; content: string };
  sourceSha256: string;
}

async function prepareImports(manifest: ClientManifest, resolver: ImportSourceResolver): Promise<PreparedImport[]> {
  const prepared: PreparedImport[] = [];
  for (const item of manifest.imports) {
    if (!item.sourceRef) throw new FactoryBlockedConfigError(`Import ${item.key} has no sourceRef`, { missingImportSourceRefs: [item.key] });
    let source: { name: string; content: string };
    try {
      source = await resolver({ manifest, importKey: item.key, sourceRef: item.sourceRef });
    } catch (error) {
      if (error instanceof FactoryBlockedConfigError) throw error;
      const code = error && typeof error === "object" && "code" in error ? String((error as { code?: unknown }).code) : "";
      if (["ENOENT", "EACCES", "ENOTDIR"].includes(code)) {
        throw new FactoryBlockedConfigError(`Import source for ${item.key} is unavailable`, { missingImportSourceRefs: [item.key], code });
      }
      throw error;
    }
    prepared.push({
      key: item.key,
      definition: parseImportDefinition({ key: item.key, format: item.source, ...item.definition }),
      source,
      sourceSha256: sha256(source.content),
    });
  }
  return prepared;
}

function preparedImportInputHashes(preparedImports: PreparedImport[] = []): Record<string, string> {
  return Object.fromEntries(preparedImports.map((item) => [item.key, sha256({
    key: item.key,
    definition: item.definition,
    sourceSha256: item.sourceSha256,
  })]));
}

function inputForStage(stage: ClientFactoryStage, manifest: ClientManifest, tenantId: string | null, preparedImports?: PreparedImport[], priorHashes?: Record<string, string | null>): unknown {
  switch (stage) {
    case "validate": return manifest;
    case "tenant": return { clientKey: manifest.clientKey, tenant: { name: manifest.tenant.name, timezone: manifest.tenant.timezone, ownerPhone: manifest.tenant.ownerPhone ?? null } };
    case "identity": return { clientKey: manifest.clientKey, users: manifest.users };
    case "workspace_policies": return { clientKey: manifest.clientKey, settings: manifest.tenant.settings, workspaceConfig: manifest.workspaceConfig ?? null, locations: manifest.locations, policyOverrides: manifest.policyOverrides };
    case "integrations_credentials": return { clientKey: manifest.clientKey, requiredCapabilities: manifest.requiredCapabilities, integrations: manifest.integrations };
    case "import": return { tenantId, imports: preparedImports?.map((item) => ({ key: item.key, definition: item.definition, sourceSha256: item.sourceSha256 }))
      ?? manifest.imports.map((item) => ({ key: item.key, format: item.source, sourceRef: item.sourceRef ?? null, definition: item.definition })) };
    case "tenant_health": return { tenantId, checkpoints: priorHashes };
    case "ready_for_certification": return { tenantId, checkpoints: priorHashes };
  }
}

async function claimRun(pool: pg.Pool, runId: string, owner: string): Promise<FactoryRunRow | null> {
  return adminTransaction(pool, async (client) => {
    const result = await client.query<FactoryRunRow>(
      `UPDATE client_factory_runs
       SET status='running', lease_owner=$2, lease_expires_at=now()+($3||' seconds')::interval,
           started_at=COALESCE(started_at,now()), finished_at=NULL, updated_at=now()
       WHERE id=$1 AND status IN ('pending','running','failed','blocked_config')
         AND (lease_owner IS NULL OR lease_owner=$2 OR lease_expires_at IS NULL OR lease_expires_at<=now())
       RETURNING *`,
      [runId, owner, String(LEASE_SECONDS)],
    );
    const claimed = result.rows[0] ?? null;
    if (claimed) {
      // A hard process death cannot close its in-flight attempt. Once the run lease
      // is reclaimable, terminally label that abandoned evidence before retrying the
      // same stage; otherwise history would contain a misleading eternal `running`.
      await client.query(
        `UPDATE client_factory_stage_attempts
         SET status='failed',error='Factory worker lease expired before the stage completed',finished_at=now()
         WHERE run_id=$1 AND status='running'`,
        [runId],
      );
      await client.query(
        `UPDATE client_factory_stages
         SET status='failed',last_error='Factory worker lease expired before the stage completed',finished_at=now(),updated_at=now()
         WHERE run_id=$1 AND status='running'`,
        [runId],
      );
    }
    return claimed;
  });
}

async function beginStage(pool: pg.Pool, runId: string, owner: string, stage: FactoryStageRow, inputSha: string): Promise<number> {
  return adminTransaction(pool, async (client) => {
    const lock = await client.query("SELECT id FROM client_factory_runs WHERE id=$1 AND status='running' AND lease_owner=$2 FOR UPDATE", [runId, owner]);
    if (!lock.rows[0]) throw new Error("Client factory lease was lost before stage start");
    const nextAttempt = stage.attempts + 1;
    await client.query(
      `UPDATE client_factory_stages SET status='running', input_sha256=$2, attempts=$3,
         evidence='{}'::jsonb, last_error=NULL, started_at=now(), finished_at=NULL, updated_at=now()
       WHERE id=$1`,
      [stage.id, inputSha, nextAttempt],
    );
    await client.query(
      `INSERT INTO client_factory_stage_attempts
         (run_id,stage_id,stage_key,attempt,input_sha256,status)
       VALUES ($1,$2,$3,$4,$5,'running')`,
      [runId, stage.id, stage.stage_key, nextAttempt, inputSha],
    );
    await client.query(
      `UPDATE client_factory_runs SET current_stage=$3,
         lease_expires_at=now()+($4||' seconds')::interval, updated_at=now()
       WHERE id=$1 AND lease_owner=$2`,
      [runId, owner, stage.stage_key, String(LEASE_SECONDS)],
    );
    return nextAttempt;
  });
}

async function finishStage(
  pool: pg.Pool,
  params: { runId: string; owner: string; stage: FactoryStageRow; attempt: number; status: "passed" | "failed" | "blocked_config"; inputSha: string; evidence: Record<string, unknown>; error?: string },
): Promise<void> {
  await adminTransaction(pool, async (client) => {
    const lease = await client.query("SELECT id FROM client_factory_runs WHERE id=$1 AND lease_owner=$2 FOR UPDATE", [params.runId, params.owner]);
    if (!lease.rows[0]) throw new Error("Client factory lease was lost before stage completion");
    await client.query(
      `UPDATE client_factory_stages SET status=$2,input_sha256=$3,evidence=$4::jsonb,last_error=$5,
         finished_at=now(),updated_at=now() WHERE id=$1`,
      [params.stage.id, params.status, params.inputSha, JSON.stringify(params.evidence), params.error ?? null],
    );
    await client.query(
      `UPDATE client_factory_stage_attempts SET status=$3,evidence=$4::jsonb,error=$5,finished_at=now()
       WHERE stage_id=$1 AND attempt=$2`,
      [params.stage.id, params.attempt, params.status, JSON.stringify(params.evidence), params.error ?? null],
    );
  });
}

async function runHealthCheck(pool: pg.Pool, manifest: ClientManifest, tenantId: string): Promise<Record<string, unknown>> {
  const result = await pool.query<{
    tenant_count: number; user_count: number; policy_count: number; integration_count: number;
    missing_required: string[]; down_required: string[];
  }>(
    `SELECT
       (SELECT count(*)::int FROM finnor_os.tenants WHERE id=$1 AND client_key=$2) tenant_count,
       (SELECT count(*)::int FROM finnor_os.users WHERE tenant_id=$1) user_count,
       (SELECT count(*)::int FROM finnor_os.domain_policies WHERE tenant_id=$1) policy_count,
       (SELECT count(*)::int FROM finnor_os.tenant_integrations WHERE tenant_id=$1) integration_count,
       ARRAY(SELECT required FROM unnest($3::text[]) required
             WHERE NOT EXISTS (SELECT 1 FROM finnor_os.tenant_integrations i WHERE i.tenant_id=$1 AND i.capability=required)) missing_required,
       ARRAY(SELECT i.capability FROM finnor_os.tenant_integrations i
             WHERE i.tenant_id=$1 AND i.capability=ANY($3::text[]) AND i.health='down') down_required`,
    [tenantId, manifest.clientKey, manifest.requiredCapabilities],
  );
  const row = result.rows[0]!;
  const issues: string[] = [];
  if (row.tenant_count !== 1) issues.push("tenant identity mismatch");
  if (row.user_count < manifest.users.length) issues.push("missing users");
  if (row.policy_count === 0) issues.push("no policies provisioned");
  if (row.integration_count !== manifest.integrations.length) issues.push("integration count mismatch");
  if (row.missing_required.length) issues.push(`missing required integrations: ${row.missing_required.join(", ")}`);
  if (row.down_required.length) issues.push(`required integrations marked down: ${row.down_required.join(", ")}`);
  const evidence = { tenantId, users: row.user_count, policies: row.policy_count, integrations: row.integration_count, requiredCapabilities: manifest.requiredCapabilities, downRequiredCapabilities: row.down_required };
  if (issues.length) throw new FactoryStageError(`Tenant health failed: ${issues.join("; ")}`, evidence);
  return evidence;
}

async function executeStage(
  stage: ClientFactoryStage,
  context: {
    manifest: ClientManifest;
    tenantId: string | null;
    pool: pg.Pool;
    auth: TenantAuthAdmin;
    preparedImports?: PreparedImport[];
    previousEvidence?: Record<string, unknown>;
  },
): Promise<{ evidence: Record<string, unknown>; tenantId?: string }> {
  const { manifest, pool } = context;
  if (stage === "validate") {
    // Preserve Phase 1's global identity invariant: a known cross-tenant email must
    // fail before even the tenant row is created.
    await preflightUserAssignments(manifest, pool);
    return { evidence: { manifestVersion: manifest.manifestVersion, manifestSha256: sha256(manifest), users: manifest.users.length, integrations: manifest.integrations.length, imports: manifest.imports.length } };
  }
  if (stage === "tenant") {
    const tenantId = await ensureTenantRecord(manifest, pool);
    return { tenantId, evidence: { tenantId, clientKey: manifest.clientKey } };
  }
  if (!context.tenantId) throw new FactoryStageError(`Stage ${stage} requires a durable tenant identity`);
  const tenantId = context.tenantId;
  if (stage === "identity") {
    const users = await convergeClientUsers(manifest, tenantId, { auth: context.auth, pool });
    return { evidence: { users: users.map(({ id, email, role, createdAuthUser, createdAppUser }) => ({ id, email, role, createdAuthUser, createdAppUser })) } };
  }
  if (stage === "workspace_policies") {
    const result = await convergeWorkspaceAndPolicies(manifest, tenantId, pool);
    return { evidence: { locations: result.locations, policies: result.policies, humanOnlyField: result.humanOnlyField } };
  }
  if (stage === "integrations_credentials") {
    const result = await convergeIntegrations(manifest, tenantId, pool);
    const missing = manifest.requiredCapabilities.filter((capability) => {
      const integration = manifest.integrations.find((candidate) => candidate.capability === capability)!;
      return integration.mode !== "emulator" && integration.binding !== "native" && !integration.credential;
    });
    const evidence = {
      integrations: result.integrations,
      requiredCapabilities: manifest.requiredCapabilities,
      credentialReferences: manifest.integrations.filter((integration) => integration.credential).map((integration) => ({ capability: integration.capability, provider: integration.credential!.provider, configured: true })),
      missingCredentialCapabilities: missing,
    };
    if (missing.length) throw new FactoryBlockedConfigError(`Missing credential references for required capabilities: ${missing.join(", ")}`, evidence);
    return { evidence };
  }
  if (stage === "import") {
    const itemInputHashes = preparedImportInputHashes(context.preparedImports);
    const priorHashes = context.previousEvidence?.itemInputHashes;
    const previousItemInputHashes = priorHashes && typeof priorHashes === "object" && !Array.isArray(priorHashes)
      ? priorHashes as Record<string, string>
      : {};
    const reports: ImportReport[] = [];
    const executedImportKeys: string[] = [];
    for (const item of context.preparedImports ?? []) {
      if (previousItemInputHashes[item.key] === itemInputHashes[item.key]) continue;
      const report = await runDeclarativeImport({ tenantId, definition: item.definition, source: item.source });
      reports.push(report);
      executedImportKeys.push(item.key);
      if (report.quarantined > 0) {
        throw new FactoryStageError(`Import ${item.key} quarantined ${report.quarantined} row(s)`, { reports });
      }
    }
    return {
      evidence: {
        reports,
        itemInputHashes,
        executedImportKeys,
        reusedImportKeys: Object.keys(itemInputHashes).filter((key) => previousItemInputHashes[key] === itemInputHashes[key]).sort(),
      },
    };
  }
  if (stage === "tenant_health") return { evidence: await runHealthCheck(pool, manifest, tenantId) };
  const externalProviderCertificationPending = manifest.integrations
    .filter((integration) => integration.mode !== "emulator" && integration.binding !== "native")
    .map((integration) => integration.capability);
  return { evidence: { tenantId, readiness: "ready_for_certification", externalProviderCertificationPending } };
}

export async function runClientFactory(runId: string, dependencies: RunClientFactoryDependencies): Promise<FactoryRunSummary> {
  const pool = dependencies.pool ?? getPool();
  const owner = dependencies.leaseOwner ?? `client-factory:${process.pid}:${randomUUID()}`;
  let run = await claimRun(pool, runId, owner);
  if (!run) {
    const current = await inspectClientFactory({ runId }, pool);
    if (!current) throw new Error(`Client factory run ${runId} was not found`);
    return current;
  }
  const heartbeat = setInterval(() => {
    void pool.query(
      `UPDATE finnor_os.client_factory_runs SET lease_expires_at=now()+($3||' seconds')::interval,updated_at=now()
       WHERE id=$1 AND lease_owner=$2 AND status='running'`,
      [runId, owner, String(LEASE_SECONDS)],
    ).catch(() => undefined);
  }, 30_000);
  heartbeat.unref();

  try {
    const manifest = parseClientManifest(run.manifest_snapshot);
    let tenantId = run.tenant_id;
    const resolver = dependencies.resolveImportSource ?? defaultImportSourceResolver;
    let preparedImports: PreparedImport[] | undefined;
    const hashes: Record<string, string | null> = {};

    for (const stageKey of CLIENT_FACTORY_STAGES) {
      const cancel = await pool.query<{ cancel_requested_at: Date | null }>("SELECT cancel_requested_at FROM finnor_os.client_factory_runs WHERE id=$1", [runId]);
      if (cancel.rows[0]?.cancel_requested_at) {
        const cancelled = await pool.query<FactoryRunRow>(
          `UPDATE finnor_os.client_factory_runs SET status='cancelled',current_stage=NULL,
             lease_owner=NULL,lease_expires_at=NULL,finished_at=now(),updated_at=now()
           WHERE id=$1 AND lease_owner=$2 RETURNING *`,
          [runId, owner],
        );
        return rowSummary(cancelled.rows[0]!);
      }

      let preparationError: unknown;
      if (stageKey === "import") {
        try {
          preparedImports = await prepareImports(manifest, resolver);
        } catch (error) {
          preparedImports = undefined;
          preparationError = error;
        }
      }
      const stageResult = await pool.query<FactoryStageRow>(
        "SELECT * FROM finnor_os.client_factory_stages WHERE run_id=$1 AND stage_key=$2",
        [runId, stageKey],
      );
      const stage = stageResult.rows[0]!;
      const inputSha = sha256(inputForStage(stageKey, manifest, tenantId, preparedImports, hashes));
      hashes[stageKey] = inputSha;
      if (stage.status === "passed" && stage.input_sha256 === inputSha) continue;

      const attempt = await beginStage(pool, runId, owner, stage, inputSha);
      try {
        if (preparationError) throw preparationError;
        const result = await executeStage(stageKey, {
          manifest,
          tenantId,
          pool,
          auth: dependencies.auth,
          preparedImports,
          previousEvidence: stage.evidence,
        });
        if (result.tenantId) {
          tenantId = result.tenantId;
          await pool.query(
            "UPDATE finnor_os.client_factory_runs SET tenant_id=$3,updated_at=now() WHERE id=$1 AND lease_owner=$2",
            [runId, owner, tenantId],
          );
        }
        await finishStage(pool, { runId, owner, stage, attempt, status: "passed", inputSha, evidence: result.evidence });
      } catch (error) {
        const status = error instanceof FactoryBlockedConfigError ? "blocked_config" : "failed";
        const message = safeError(error);
        const evidence = error instanceof FactoryBlockedConfigError || error instanceof FactoryStageError ? error.evidence : {};
        await finishStage(pool, { runId, owner, stage, attempt, status, inputSha, evidence, error: message });
        const stopped = await pool.query<FactoryRunRow>(
          `UPDATE finnor_os.client_factory_runs SET status=$3,last_error=$4,
             lease_owner=NULL,lease_expires_at=NULL,updated_at=now()
           WHERE id=$1 AND lease_owner=$2 RETURNING *`,
          [runId, owner, status, message],
        );
        if (status === "blocked_config") return rowSummary(stopped.rows[0]!);
        throw error;
      }
      // Runs after the checkpoint is durable. A thrown test hook therefore models a
      // process disappearing between stages: the run/lease remain running until the
      // normal stale-lease recovery path reclaims them.
      await dependencies.afterStage?.(stageKey);
    }

    const completed = await pool.query<FactoryRunRow>(
      `UPDATE finnor_os.client_factory_runs SET status='passed',current_stage='ready_for_certification',
         last_error=NULL,lease_owner=NULL,lease_expires_at=NULL,finished_at=now(),updated_at=now()
       WHERE id=$1 AND lease_owner=$2 RETURNING *`,
      [runId, owner],
    );
    if (!completed.rows[0]) throw new Error("Client factory lease was lost before run completion");
    return rowSummary(completed.rows[0]);
  } finally {
    clearInterval(heartbeat);
  }
}

export function createFactoryAuthFromEnv(): TenantAuthAdmin {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY must be set to execute identity provisioning");
  return createClient(url, key, { auth: { autoRefreshToken: false, persistSession: false, detectSessionInUrl: false } }).auth.admin;
}

function cliArgs(): Record<string, string | boolean> {
  return Object.fromEntries(process.argv.slice(2).map((argument) => {
    const [key, ...rest] = argument.replace(/^--/, "").split("=");
    return [key!, rest.length ? rest.join("=") : true];
  }));
}

function absoluteImportRefs(manifest: ClientManifest, manifestPath: string): ClientManifest {
  return parseClientManifest({
    ...manifest,
    imports: manifest.imports.map((item) => ({
      ...item,
      sourceRef: item.sourceRef && !item.sourceRef.startsWith("file://") && !isAbsolute(item.sourceRef)
        ? resolve(dirname(manifestPath), item.sourceRef)
        : item.sourceRef,
    })),
  });
}

async function main(): Promise<void> {
  const options = cliArgs();
  const command = String(options.command ?? "status");
  if (command === "start") {
    if (!options.manifest) throw new Error("Usage: --command=start --manifest=<client.json> [--inline]");
    const path = resolve(String(options.manifest));
    const manifest = absoluteImportRefs(await loadClientManifest(path), path);
    const started = await startClientFactory(manifest, { enqueue: options.inline !== true });
    const result = options.inline === true
      ? await runClientFactory(started.run.id, { auth: createFactoryAuthFromEnv() })
      : started.run;
    console.log(JSON.stringify(result, null, 2));
    return;
  }
  if (command === "status") {
    const result = await inspectClientFactory({ runId: options.run ? String(options.run) : undefined, clientKey: options.clientKey ? String(options.clientKey) : undefined });
    console.log(JSON.stringify(result, null, 2));
    return;
  }
  if (command === "resume" || command === "retry") {
    if (!options.run) throw new Error(`Usage: --command=${command} --run=<uuid>`);
    let replacement: ClientManifest | undefined;
    if (options.manifest) {
      const path = resolve(String(options.manifest));
      replacement = absoluteImportRefs(await loadClientManifest(path), path);
    }
    console.log(JSON.stringify(await resumeClientFactory(String(options.run), { manifest: replacement }), null, 2));
    return;
  }
  if (command === "cancel") {
    if (!options.run) throw new Error("Usage: --command=cancel --run=<uuid>");
    console.log(JSON.stringify(await cancelClientFactory(String(options.run)), null, 2));
    return;
  }
  throw new Error("command must be start, status, resume, retry, or cancel");
}

const isMain = process.argv[1]?.endsWith("client-factory.ts") || process.argv[1]?.endsWith("client-factory.js");
if (isMain) main().catch((error) => { console.error(error); process.exitCode = 1; }).finally(() => closePool());
