import type pg from "pg";
import { parseClientManifest, type ClientManifest } from "../client-manifest";
import {
  assertClientReleaseIntegrity,
  hashClientConfiguration,
  sanitizeEvidence,
  sha256,
  stableStringify,
  type ClientCertification,
  type ClientRelease,
  type CoreCertification,
} from "./certification-model";
import type { ClientImpactPlan } from "./client-lifecycle-model";
import type { CoreDiffResult } from "./core-diff-guard";

type Queryable = Pick<pg.Pool, "query">;
export type LifecycleOperationType = "status" | "diff" | "dry_run" | "apply" | "certify" | "promote" | "drift" | "rollback";
export type LifecycleOperationStatus = "PASS" | "FAIL" | "BLOCKED_CONFIG" | "NOOP";
export type DriftStatus = "CLEAN" | "DRIFT" | "BLOCKED_CONFIG" | "CRITICAL";

export class ClientLifecycleConflictError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ClientLifecycleConflictError";
  }
}

export interface LifecycleOperation {
  id: string;
  clientKey: string;
  operationType: LifecycleOperationType;
}

export interface CertifiedClientState {
  tenant: unknown;
  settings: unknown;
  locations: unknown[];
  users: unknown[];
  policies: unknown[];
  integrations: unknown[];
}

export interface ClientReleaseBundle {
  release: ClientRelease;
  certification: ClientCertification;
  coreCertification: CoreCertification;
  manifest: ClientManifest;
  certifiedState: CertifiedClientState;
  certifiedStateHash: string;
  configurationEvidenceHash: string;
}

export interface DriftItem {
  area: "evidence" | "manifest" | "tenant" | "identity" | "workspace" | "policy" | "integration" | "release_pointer" | "runtime_core";
  severity: "WARNING" | "BLOCKING" | "CRITICAL";
  code: string;
  expectedHash?: string | null;
  observedHash?: string | null;
  details?: unknown;
}

export interface ClientDriftReport {
  schema: "finnor.client-drift/v1";
  clientKey: string;
  tenantId: string;
  releaseId: string;
  status: DriftStatus;
  items: DriftItem[];
  certifiedStateHash: string;
  persistedStateHash: string | null;
  activeReleaseId: string | null;
  runtime: { releaseSha: string | null; coreCertificationId: string | null; deploymentIdConfigured: boolean; heartbeatFresh: boolean };
  evidenceHash: string;
}

function operationProvenance(): Record<string, unknown> {
  return sanitizeEvidence({
    source: process.env.FINNOR_RELEASE_SOURCE ?? "client:lifecycle",
    actor: process.env.FINNOR_RELEASE_ACTOR ?? process.env.USER ?? "operator",
    host: process.env.HOSTNAME ?? null,
    processId: process.pid,
  }) as Record<string, unknown>;
}

export async function beginLifecycleOperation(
  pool: pg.Pool,
  input: {
    clientKey: string;
    tenantId?: string | null;
    operationType: LifecycleOperationType;
    plan?: ClientImpactPlan | Record<string, unknown>;
    desiredManifestHash?: string | null;
    fromReleaseId?: string | null;
    toReleaseId?: string | null;
  },
): Promise<LifecycleOperation> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))", [`client-lifecycle:${input.clientKey}`]);
    const inserted = await client.query<{ id: string }>(
      `INSERT INTO finnor_os.client_lifecycle_operations
         (client_key,tenant_id,operation_type,plan_id,desired_manifest_hash,from_release_id,to_release_id,plan,provenance)
       VALUES($1,$2::uuid,$3,$4,$5,$6,$7,$8::jsonb,$9::jsonb) RETURNING id`,
      [input.clientKey, input.tenantId ?? null, input.operationType,
        input.plan && "planId" in input.plan ? String(input.plan.planId) : null,
        input.desiredManifestHash ?? null, input.fromReleaseId ?? null, input.toReleaseId ?? null,
        JSON.stringify(sanitizeEvidence(input.plan ?? {})), JSON.stringify(operationProvenance())],
    );
    await client.query("COMMIT");
    return { id: inserted.rows[0]!.id, clientKey: input.clientKey, operationType: input.operationType };
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    if (error && typeof error === "object" && "code" in error && error.code === "23505") {
      throw new ClientLifecycleConflictError(`Another conflicting client lifecycle mutation is active for ${input.clientKey}`);
    }
    throw error;
  } finally {
    client.release();
  }
}

export async function completeLifecycleOperation(
  db: Queryable,
  operation: LifecycleOperation,
  status: LifecycleOperationStatus,
  evidence: unknown,
  options: { tenantId?: string | null; toReleaseId?: string | null } = {},
): Promise<void> {
  const sanitized = sanitizeEvidence(evidence);
  const result = await db.query(
    `UPDATE finnor_os.client_lifecycle_operations
     SET status=$2,tenant_id=COALESCE($3::uuid,tenant_id),to_release_id=COALESCE($4,to_release_id),
         evidence=$5::jsonb,evidence_hash=$6,finished_at=now()
     WHERE id=$1 AND status='running'`,
    [operation.id, status, options.tenantId ?? null, options.toReleaseId ?? null,
      JSON.stringify(sanitized), sha256(sanitized)],
  );
  if (result.rowCount !== 1) throw new Error(`Lifecycle operation ${operation.id} was not active`);
}

export async function failLifecycleOperation(db: Queryable, operation: LifecycleOperation, error: unknown): Promise<void> {
  const message = error instanceof Error ? error.message : String(error);
  await completeLifecycleOperation(db, operation, "FAIL", { error: message.slice(0, 2_000) });
}

export async function capturePersistedClientState(
  db: Queryable,
  manifest: ClientManifest,
  tenantId: string,
): Promise<CertifiedClientState> {
  // Keep these sequential: callers may pass one PoolClient while promotion holds a
  // transaction, and node-postgres does not support concurrent query() calls on it.
  const tenant = await db.query("SELECT client_key,name,timezone,owner_phone FROM finnor_os.tenants WHERE id=$1", [tenantId]);
  const settings = await db.query("SELECT is_dealer_zero,simulator_enabled,training_mode,workspace_config FROM finnor_os.tenant_settings WHERE tenant_id=$1", [tenantId]);
  const locations = await db.query(
    `SELECT location_key,name,address,timezone,active FROM finnor_os.tenant_locations
     WHERE tenant_id=$1 AND (active OR location_key=ANY($2::text[])) ORDER BY location_key`,
    [tenantId, manifest.locations.map((row) => row.key)],
  );
  const users = await db.query("SELECT email,role,display_name,phone_number,status FROM finnor_os.users WHERE tenant_id=$1 ORDER BY email", [tenantId]);
  const policies = await db.query(
    `SELECT action_type,policy,requires_confirmation,confirmation_template,model_provider,confirmation_timeout_hours
     FROM finnor_os.domain_policies WHERE tenant_id=$1 ORDER BY action_type`,
    [tenantId],
  );
  const integrations = await db.query(
    `SELECT capability,binding,mode,config,credential_provider,
       CASE WHEN credential_ref IS NULL THEN NULL ELSE encode(digest(credential_ref,'sha256'),'hex') END credential_reference_hash,
       credential_version,credential_metadata
     FROM finnor_os.tenant_integrations WHERE tenant_id=$1 ORDER BY capability`,
    [tenantId],
  );
  return sanitizeEvidence({
    tenant: tenant.rows[0] ?? null,
    settings: settings.rows[0] ?? null,
    locations: locations.rows,
    users: users.rows,
    policies: policies.rows,
    integrations: integrations.rows,
  }) as unknown as CertifiedClientState;
}

export async function persistClientReleaseConfiguration(
  db: Queryable,
  input: { release: ClientRelease; manifest: ClientManifest; certifiedState?: CertifiedClientState },
): Promise<void> {
  const manifest = parseClientManifest(input.manifest);
  const hashes = hashClientConfiguration(manifest);
  if (manifest.clientKey !== input.release.client.clientKey || hashes.manifestHash !== input.release.configurationHashes.manifestHash
      || hashes.aggregateHash !== input.release.configurationHashes.aggregateHash) {
    throw new Error("Certified manifest/configuration hashes do not match the immutable ClientRelease");
  }
  const certifiedState = input.certifiedState
    ?? await capturePersistedClientState(db, manifest, input.release.client.tenantId);
  const certifiedStateHash = sha256(certifiedState);
  const evidenceHash = sha256({
    releaseId: input.release.releaseId,
    clientKey: manifest.clientKey,
    tenantId: input.release.client.tenantId,
    manifestHash: hashes.manifestHash,
    configurationHash: hashes.aggregateHash,
    certifiedStateHash,
  });
  await db.query(
    `INSERT INTO finnor_os.client_release_configurations
       (release_id,client_key,tenant_id,manifest_hash,configuration_hash,manifest_snapshot,certified_state,certified_state_hash,evidence_hash)
     VALUES($1,$2,$3::uuid,$4,$5,$6::jsonb,$7::jsonb,$8,$9)
     ON CONFLICT(release_id) DO NOTHING`,
    [input.release.releaseId, manifest.clientKey, input.release.client.tenantId, hashes.manifestHash, hashes.aggregateHash,
      JSON.stringify(manifest), JSON.stringify(certifiedState), certifiedStateHash, evidenceHash],
  );
  const existing = await db.query<{
    manifest_hash: string; configuration_hash: string; manifest_snapshot: unknown;
    certified_state: CertifiedClientState; certified_state_hash: string; evidence_hash: string;
  }>("SELECT * FROM finnor_os.client_release_configurations WHERE release_id=$1", [input.release.releaseId]);
  const row = existing.rows[0];
  if (!row || row.manifest_hash !== hashes.manifestHash || row.configuration_hash !== hashes.aggregateHash
      || stableStringify(row.manifest_snapshot) !== stableStringify(manifest)
      || row.certified_state_hash !== certifiedStateHash || row.evidence_hash !== evidenceHash
      || stableStringify(row.certified_state) !== stableStringify(certifiedState)) {
    throw new Error(`Immutable client configuration artifact collision for ${input.release.releaseId}`);
  }
}

export async function readClientReleaseBundle(db: Queryable, releaseId: string): Promise<ClientReleaseBundle> {
  const result = await db.query<{
    release_artifact: ClientRelease;
    certification_artifact: ClientCertification;
    core_artifact: CoreCertification;
    manifest_snapshot: unknown;
    certified_state: CertifiedClientState;
    certified_state_hash: string;
    config_evidence_hash: string;
    stored_manifest_hash: string;
    stored_configuration_hash: string;
  }>(
    `SELECT r.artifact release_artifact,c.artifact certification_artifact,k.artifact core_artifact,
       cfg.manifest_snapshot,cfg.certified_state,cfg.certified_state_hash,cfg.evidence_hash config_evidence_hash,
       cfg.manifest_hash stored_manifest_hash,cfg.configuration_hash stored_configuration_hash
     FROM finnor_os.client_releases r
     JOIN finnor_os.client_certifications c ON c.certification_id=r.client_certification_id
     JOIN finnor_os.core_certifications k ON k.certification_id=r.core_certification_id
     JOIN finnor_os.client_release_configurations cfg ON cfg.release_id=r.release_id
     WHERE r.release_id=$1`,
    [releaseId],
  );
  const row = result.rows[0];
  if (!row) throw new Error(`Client release ${releaseId} has no Phase 6 certified configuration snapshot`);
  const manifest = parseClientManifest(row.manifest_snapshot);
  assertClientReleaseIntegrity(row.release_artifact, row.core_artifact, row.certification_artifact);
  const hashes = hashClientConfiguration(manifest);
  const expectedEvidenceHash = sha256({
    releaseId,
    clientKey: manifest.clientKey,
    tenantId: row.release_artifact.client.tenantId,
    manifestHash: hashes.manifestHash,
    configurationHash: hashes.aggregateHash,
    certifiedStateHash: row.certified_state_hash,
  });
  if (hashes.manifestHash !== row.stored_manifest_hash || hashes.aggregateHash !== row.stored_configuration_hash
      || sha256(row.certified_state) !== row.certified_state_hash || expectedEvidenceHash !== row.config_evidence_hash) {
    throw new Error(`Client release ${releaseId} configuration evidence failed integrity verification`);
  }
  return {
    release: row.release_artifact,
    certification: row.certification_artifact,
    coreCertification: row.core_artifact,
    manifest,
    certifiedState: row.certified_state,
    certifiedStateHash: row.certified_state_hash,
    configurationEvidenceHash: row.config_evidence_hash,
  };
}

export async function activeClientReleaseId(db: Queryable, clientKey: string): Promise<string | null> {
  const result = await db.query<{ release_id: string }>(
    "SELECT release_id FROM finnor_os.active_client_releases WHERE client_key=$1",
    [clientKey],
  );
  return result.rows[0]?.release_id ?? null;
}

export async function activeClientReleaseBundle(db: Queryable, clientKey: string): Promise<ClientReleaseBundle | null> {
  const releaseId = await activeClientReleaseId(db, clientKey);
  return releaseId ? readClientReleaseBundle(db, releaseId) : null;
}

function stateArea(path: string): DriftItem["area"] {
  if (path.startsWith("/tenant")) return "tenant";
  if (path.startsWith("/users")) return "identity";
  if (path.startsWith("/settings") || path.startsWith("/locations")) return "workspace";
  if (path.startsWith("/policies")) return "policy";
  return "integration";
}

function stateDifferences(expected: unknown, actual: unknown, path = ""): DriftItem[] {
  if (stableStringify(expected) === stableStringify(actual)) return [];
  if (Array.isArray(expected) && Array.isArray(actual)) {
    return Array.from({ length: Math.max(expected.length, actual.length) }, (_, index) => index)
      .flatMap((index) => stateDifferences(expected[index], actual[index], `${path}/${index}`));
  }
  const expectedObject = expected !== null && typeof expected === "object";
  const actualObject = actual !== null && typeof actual === "object";
  if (expectedObject && actualObject && !Array.isArray(expected) && !Array.isArray(actual)) {
    const keys = [...new Set([...Object.keys(expected as object), ...Object.keys(actual as object)])].sort();
    return keys.flatMap((key) => stateDifferences(
      (expected as Record<string, unknown>)[key], (actual as Record<string, unknown>)[key], `${path}/${key}`,
    ));
  }
  return [{
    area: stateArea(path), severity: "BLOCKING", code: "persisted_state_mismatch",
    expectedHash: sha256(expected), observedHash: sha256(actual), details: { path },
  }];
}

export async function detectClientDrift(
  db: Queryable,
  input: { clientKey: string; releaseId?: string; includeActivePointer?: boolean; now?: Date },
): Promise<ClientDriftReport> {
  const activeRelease = await activeClientReleaseId(db, input.clientKey);
  const releaseId = input.releaseId ?? activeRelease;
  if (!releaseId) throw new Error(`Client ${input.clientKey} has no active ClientRelease`);
  const items: DriftItem[] = [];
  let bundle: ClientReleaseBundle;
  try {
    bundle = await readClientReleaseBundle(db, releaseId);
  } catch (error) {
    const details = error instanceof Error ? error.message : String(error);
    const reportWithoutBundle = {
      schema: "finnor.client-drift/v1" as const,
      clientKey: input.clientKey,
      tenantId: "unresolved",
      releaseId,
      status: "CRITICAL" as const,
      items: [{ area: "evidence" as const, severity: "CRITICAL" as const, code: "release_evidence_invalid", details }],
      certifiedStateHash: "unresolved",
      persistedStateHash: null,
      activeReleaseId: activeRelease,
      runtime: { releaseSha: null, coreCertificationId: null, deploymentIdConfigured: false, heartbeatFresh: false },
    };
    return { ...reportWithoutBundle, evidenceHash: sha256(reportWithoutBundle) };
  }
  if (bundle.release.client.clientKey !== input.clientKey) {
    items.push({ area: "evidence", severity: "CRITICAL", code: "client_identity_mismatch" });
  }
  const persistedState = await capturePersistedClientState(db, bundle.manifest, bundle.release.client.tenantId);
  const persistedStateHash = sha256(persistedState);
  items.push(...stateDifferences(bundle.certifiedState, persistedState));
  if (input.includeActivePointer !== false && activeRelease !== releaseId) {
    items.push({
      area: "release_pointer", severity: "BLOCKING", code: "active_release_mismatch",
      expectedHash: sha256(releaseId), observedHash: activeRelease ? sha256(activeRelease) : null,
      details: { expectedReleaseId: releaseId, activeReleaseId: activeRelease },
    });
  }
  const heartbeat = await db.query<{ last_beat_at: Date; meta: Record<string, unknown> }>(
    "SELECT last_beat_at,meta FROM finnor_os.worker_heartbeat WHERE id='worker'",
  );
  const heartbeatRow = heartbeat.rows[0];
  const runtimeSha = typeof heartbeatRow?.meta?.releaseSha === "string" ? heartbeatRow.meta.releaseSha : null;
  const runtimeCoreCertificationId = typeof heartbeatRow?.meta?.coreCertificationId === "string" ? heartbeatRow.meta.coreCertificationId : null;
  const deploymentIdConfigured = typeof heartbeatRow?.meta?.deploymentId === "string" && heartbeatRow.meta.deploymentId.length > 0;
  const heartbeatFresh = Boolean(heartbeatRow && (input.now ?? new Date()).getTime() - new Date(heartbeatRow.last_beat_at).getTime() < 90_000);
  if (!heartbeatRow || !runtimeSha || !runtimeCoreCertificationId || !deploymentIdConfigured || !heartbeatFresh) {
    items.push({ area: "runtime_core", severity: "BLOCKING", code: "runtime_identity_unavailable", details: { heartbeatFresh, deploymentIdConfigured } });
  } else if (runtimeSha !== bundle.release.core.canonicalSha || runtimeCoreCertificationId !== bundle.release.core.certificationId) {
    items.push({
      area: "runtime_core", severity: "CRITICAL", code: "runtime_core_incompatible",
      details: {
        expectedCoreSha: bundle.release.core.canonicalSha, observedCoreSha: runtimeSha,
        expectedCoreCertificationId: bundle.release.core.certificationId, observedCoreCertificationId: runtimeCoreCertificationId,
      },
    });
  }
  const status: DriftStatus = items.some((item) => item.severity === "CRITICAL") ? "CRITICAL"
    : items.some((item) => item.code === "runtime_identity_unavailable") ? "BLOCKED_CONFIG"
      : items.length ? "DRIFT" : "CLEAN";
  const report = {
    schema: "finnor.client-drift/v1" as const,
    clientKey: input.clientKey,
    tenantId: bundle.release.client.tenantId,
    releaseId,
    status,
    items,
    certifiedStateHash: bundle.certifiedStateHash,
    persistedStateHash,
    activeReleaseId: activeRelease,
    runtime: { releaseSha: runtimeSha, coreCertificationId: runtimeCoreCertificationId, deploymentIdConfigured, heartbeatFresh },
  };
  return { ...report, evidenceHash: sha256(report) };
}

export interface PromotionGuardResult {
  releaseId: string;
  currentReleaseId: string | null;
  guards: Array<{ guard: string; status: "PASS" | "FAIL" | "BLOCKED_CONFIG"; evidence: unknown }>;
  drift: ClientDriftReport;
}

export async function evaluatePromotionGuards(
  db: Queryable,
  input: { clientKey: string; releaseId: string; operationId: string; coreDiff: CoreDiffResult },
): Promise<PromotionGuardResult> {
  const bundle = await readClientReleaseBundle(db, input.releaseId);
  const currentReleaseId = await activeClientReleaseId(db, input.clientKey);
  const guards: PromotionGuardResult["guards"] = [];
  const pass = (guard: string, evidence: unknown = {}) => guards.push({ guard, status: "PASS", evidence });
  const fail = (guard: string, evidence: unknown = {}) => guards.push({ guard, status: "FAIL", evidence });
  const blocked = (guard: string, evidence: unknown = {}) => guards.push({ guard, status: "BLOCKED_CONFIG", evidence });

  if (bundle.release.client.clientKey === input.clientKey) pass("client_identity");
  else fail("client_identity", { releaseClientKey: bundle.release.client.clientKey });
  if (bundle.certification.status === "PASS" && bundle.release.certification.status === "PASS"
      && bundle.certification.gates.every((gate) => gate.status === "PASS")) pass("client_certification");
  else fail("client_certification", { status: bundle.certification.status, blockedGates: bundle.certification.gates.filter((gate) => gate.status !== "PASS").map((gate) => gate.gate) });
  if (bundle.coreCertification.status === "PASS" && bundle.release.core.certificationStatus === "PASS") pass("core_certification");
  else fail("core_certification", { status: bundle.coreCertification.status });
  if (input.coreDiff.clean && input.coreDiff.canonicalCoreSha === bundle.release.core.canonicalSha
      && input.coreDiff.coreSourceTreeHash === bundle.release.core.sourceTreeHash) pass("core_diff");
  else fail("core_diff", { changedSharedCorePaths: input.coreDiff.changedSharedCorePaths, expectedTreeHash: bundle.release.core.sourceTreeHash, observedTreeHash: input.coreDiff.coreSourceTreeHash });

  const conflictingOperation = await db.query<{ id: string; operation_type: string }>(
    `SELECT id,operation_type FROM finnor_os.client_lifecycle_operations
     WHERE client_key=$1 AND status='running' AND id<>$2::uuid
       AND operation_type IN ('apply','certify','promote','rollback') LIMIT 1`,
    [input.clientKey, input.operationId],
  );
  const conflictingFactory = await db.query<{ id: string; status: string }>(
    `SELECT id,status FROM finnor_os.client_factory_runs WHERE client_key=$1
       AND status IN ('pending','running','failed','blocked_config') ORDER BY created_at DESC LIMIT 1`,
    [input.clientKey],
  );
  if (!conflictingOperation.rows[0] && !conflictingFactory.rows[0]) pass("exclusive_mutation");
  else blocked("exclusive_mutation", { lifecycle: conflictingOperation.rows[0] ?? null, factory: conflictingFactory.rows[0] ?? null });

  const drift = await detectClientDrift(db, { clientKey: input.clientKey, releaseId: input.releaseId, includeActivePointer: false });
  if (drift.status === "CLEAN") pass("release_convergence", { persistedStateHash: drift.persistedStateHash });
  else if (drift.status === "BLOCKED_CONFIG") blocked("release_convergence", drift);
  else fail("release_convergence", drift);
  return { releaseId: input.releaseId, currentReleaseId, guards, drift };
}

export async function promoteClientRelease(
  pool: pg.Pool,
  input: {
    operation: LifecycleOperation;
    releaseId: string;
    coreDiff: CoreDiffResult;
    kind?: "promotion" | "rollback";
    additionalEvidence?: unknown;
  },
): Promise<{ status: "PASS" | "NOOP"; releaseId: string; previousReleaseId: string | null; promotionId: string | null; verification: ClientDriftReport; guards: PromotionGuardResult["guards"] }> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))", [`client-lifecycle:${input.operation.clientKey}`]);
    const guardResult = await evaluatePromotionGuards(client as unknown as Queryable, {
      clientKey: input.operation.clientKey,
      releaseId: input.releaseId,
      operationId: input.operation.id,
      coreDiff: input.coreDiff,
    });
    const refused = guardResult.guards.filter((guard) => guard.status !== "PASS");
    if (refused.length) {
      await completeLifecycleOperation(client as unknown as Queryable, input.operation,
        refused.some((guard) => guard.status === "FAIL") ? "FAIL" : "BLOCKED_CONFIG",
        { promoted: false, guards: guardResult.guards, drift: guardResult.drift });
      await client.query("COMMIT");
      return Promise.reject(new Error(`Client release promotion refused: ${refused.map((guard) => `${guard.guard}=${guard.status}`).join(", ")}`));
    }
    if (guardResult.currentReleaseId === input.releaseId) {
      await completeLifecycleOperation(client as unknown as Queryable, input.operation, "NOOP", {
        promoted: false,
        mutation: false,
        reason: "requested release is already active",
        guards: guardResult.guards,
        verification: guardResult.drift,
      }, { toReleaseId: input.releaseId });
      await client.query("COMMIT");
      return {
        status: "NOOP",
        releaseId: input.releaseId,
        previousReleaseId: input.releaseId,
        promotionId: null,
        verification: guardResult.drift,
        guards: guardResult.guards,
      };
    }
    const bundle = await readClientReleaseBundle(client as unknown as Queryable, input.releaseId);
    const promotionEvidence = sanitizeEvidence({
      releaseId: input.releaseId,
      previousReleaseId: guardResult.currentReleaseId,
      kind: input.kind ?? "promotion",
      guards: guardResult.guards,
      additionalEvidence: input.additionalEvidence ?? null,
    });
    const promotion = await client.query<{ id: string; promoted_at: Date }>(
      `INSERT INTO finnor_os.client_release_promotions
         (client_key,tenant_id,release_id,previous_release_id,operation_id,kind,evidence,evidence_hash)
       VALUES($1,$2::uuid,$3,$4,$5::uuid,$6,$7::jsonb,$8) RETURNING id,promoted_at`,
      [input.operation.clientKey, bundle.release.client.tenantId, input.releaseId, guardResult.currentReleaseId,
        input.operation.id, input.kind ?? "promotion", JSON.stringify(promotionEvidence), sha256(promotionEvidence)],
    );
    const promotionRow = promotion.rows[0]!;
    await client.query(
      `INSERT INTO finnor_os.active_client_releases(tenant_id,client_key,release_id,promotion_id,revision,promoted_at)
       VALUES($1::uuid,$2,$3,$4::uuid,1,$5)
       ON CONFLICT(tenant_id) DO UPDATE SET release_id=excluded.release_id,promotion_id=excluded.promotion_id,
         revision=active_client_releases.revision+1,promoted_at=excluded.promoted_at,updated_at=now()
       WHERE active_client_releases.client_key=excluded.client_key`,
      [bundle.release.client.tenantId, input.operation.clientKey, input.releaseId, promotionRow.id, promotionRow.promoted_at],
    );
    const verification = await detectClientDrift(client as unknown as Queryable, {
      clientKey: input.operation.clientKey,
      releaseId: input.releaseId,
      includeActivePointer: true,
    });
    if (verification.status !== "CLEAN") throw new Error(`Post-promotion verification failed: ${verification.status}`);
    await completeLifecycleOperation(client as unknown as Queryable, input.operation, "PASS", {
      promoted: true,
      releaseId: input.releaseId,
      previousReleaseId: guardResult.currentReleaseId,
      promotionId: promotionRow.id,
      guards: guardResult.guards,
      verification,
      additionalEvidence: input.additionalEvidence ?? null,
    }, { tenantId: bundle.release.client.tenantId, toReleaseId: input.releaseId });
    await client.query("COMMIT");
    return {
      status: "PASS",
      releaseId: input.releaseId,
      previousReleaseId: guardResult.currentReleaseId,
      promotionId: promotionRow.id,
      verification,
      guards: guardResult.guards,
    };
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}

export async function inspectIrreversibleEffects(
  db: Queryable,
  tenantId: string,
  since: Date,
): Promise<{ reversible: false; retained: Record<string, number>; statement: string }> {
  const result = await db.query<{
    outbound_communications: number; successful_payments: number; completed_workflows: number;
    completed_actions: number; import_runs: number;
  }>(
    `SELECT
       (SELECT count(*)::int FROM finnor_os.communications_log WHERE tenant_id=$1 AND direction='outbound' AND timestamp >= $2) outbound_communications,
       (SELECT count(*)::int FROM finnor_os.payments WHERE tenant_id=$1 AND status='succeeded' AND received_at >= $2) successful_payments,
       (SELECT count(*)::int FROM finnor_os.workflow_runs WHERE tenant_id=$1 AND status IN ('completed','compensated') AND updated_at >= $2) completed_workflows,
       (SELECT count(*)::int FROM finnor_os.domain_actions WHERE tenant_id=$1 AND status='completed' AND created_at >= $2) completed_actions,
       (SELECT count(*)::int FROM finnor_os.import_runs WHERE tenant_id=$1 AND started_at >= $2) import_runs`,
    [tenantId, since],
  );
  const row = result.rows[0]!;
  return {
    reversible: false,
    retained: {
      outboundCommunications: row.outbound_communications,
      successfulPayments: row.successful_payments,
      completedWorkflows: row.completed_workflows,
      completedActions: row.completed_actions,
      importRuns: row.import_runs,
    },
    statement: "External effects and historical facts are retained; only certified reversible configuration may be restored.",
  };
}

export async function inspectClientLifecycle(db: Queryable, clientKey: string): Promise<unknown> {
  const [active, releases, promotions, operations] = await Promise.all([
    db.query(
      `SELECT a.client_key,a.tenant_id::text,a.release_id,a.revision,a.promoted_at,r.release_version,
         r.canonical_core_sha,r.client_certification_id,r.status
       FROM finnor_os.active_client_releases a JOIN finnor_os.client_releases r ON r.release_id=a.release_id
       WHERE a.client_key=$1`, [clientKey],
    ),
    db.query(
      `SELECT release_id,release_version,tenant_id::text,canonical_core_sha,client_certification_id,status,
         predecessor_release_id,rollback_target_release_id,certified_at,released_at
       FROM finnor_os.client_releases WHERE client_key=$1 ORDER BY released_at DESC`, [clientKey],
    ),
    db.query(
      `SELECT id,release_id,previous_release_id,kind,evidence_hash,promoted_at
       FROM finnor_os.client_release_promotions WHERE client_key=$1 ORDER BY promoted_at DESC`, [clientKey],
    ),
    db.query(
      `SELECT id,operation_type,status,plan_id,desired_manifest_hash,from_release_id,to_release_id,
         evidence_hash,provenance,started_at,finished_at
       FROM finnor_os.client_lifecycle_operations WHERE client_key=$1 ORDER BY started_at DESC LIMIT 100`, [clientKey],
    ),
  ]);
  return { clientKey, active: active.rows[0] ?? null, releases: releases.rows, promotions: promotions.rows, operations: operations.rows };
}

export function materializeRollbackManifest(bundle: ClientReleaseBundle): ClientManifest {
  if (bundle.manifest.workspaceConfig) return bundle.manifest;
  const settings = bundle.certifiedState.settings as { workspace_config?: unknown } | null;
  return parseClientManifest({ ...bundle.manifest, workspaceConfig: settings?.workspace_config });
}
