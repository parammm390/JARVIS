import { chmod, mkdir, open, readFile, readdir } from "node:fs/promises";
import { dirname, join } from "node:path";
import type pg from "pg";
import {
  CLIENT_CERTIFICATION_SCHEMA,
  CLIENT_RELEASE_SCHEMA,
  CORE_CERTIFICATION_SCHEMA,
  CORE_CERTIFICATION_SUITE_VERSION,
  FINAL_CERTIFICATION_SCHEMA,
  OUTCOME_PACK_CERTIFICATION_SCHEMA,
  assertCoreCertificationIntegrity,
  assertFinalCertificationIntegrity,
  assertOutcomePackCertificationIntegrity,
  stableStringify,
  type ClientCertification,
  type ClientRelease,
  type CoreCertification,
  type FinalCertification,
  type OutcomePackCertificationArtifact,
} from "./certification-model";

export interface StoredArtifact<T> {
  artifact: T;
  path: string;
  reused: boolean;
}

function immutableProjection(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(immutableProjection);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(Object.entries(value as Record<string, unknown>)
    .filter(([key]) => key !== "certifiedAt" && key !== "releasedAt")
    .map(([key, nested]) => [key, immutableProjection(nested)]));
}

async function writeExclusive<T extends { schema: string }>(path: string, artifact: T): Promise<StoredArtifact<T>> {
  await mkdir(dirname(path), { recursive: true });
  try {
    const handle = await open(path, "wx", 0o444);
    try {
      await handle.writeFile(`${JSON.stringify(artifact, null, 2)}\n`, "utf8");
    } finally {
      await handle.close();
    }
    await chmod(path, 0o444);
    return { artifact, path, reused: false };
  } catch (error) {
    if (!error || typeof error !== "object" || !("code" in error) || error.code !== "EEXIST") throw error;
    const existing = JSON.parse(await readFile(path, "utf8")) as T;
    if (stableStringify(immutableProjection(existing)) !== stableStringify(immutableProjection(artifact))) {
      throw new Error(`Immutable certification artifact collision at ${path}`);
    }
    return { artifact: existing, path, reused: true };
  }
}

export class CertificationArtifactStore {
  constructor(readonly root: string) {}

  async writeCoreCertification(artifact: CoreCertification): Promise<StoredArtifact<CoreCertification>> {
    if (artifact.schema !== CORE_CERTIFICATION_SCHEMA) throw new Error("Unexpected core certification schema");
    return writeExclusive(join(this.root, "core", `${artifact.certificationId}.json`), artifact);
  }

  async writeClientCertification(artifact: ClientCertification): Promise<StoredArtifact<ClientCertification>> {
    if (artifact.schema !== CLIENT_CERTIFICATION_SCHEMA) throw new Error("Unexpected client certification schema");
    return writeExclusive(join(this.root, "clients", artifact.clientKey, "certifications", `${artifact.certificationId}.json`), artifact);
  }

  async writeClientRelease(artifact: ClientRelease): Promise<StoredArtifact<ClientRelease>> {
    if (artifact.schema !== CLIENT_RELEASE_SCHEMA) throw new Error("Unexpected client release schema");
    return writeExclusive(join(this.root, "clients", artifact.client.clientKey, "releases", `${artifact.releaseId}.json`), artifact);
  }

  async readCoreCertification(path: string): Promise<CoreCertification> {
    const artifact = JSON.parse(await readFile(path, "utf8")) as CoreCertification;
    if (artifact.schema !== CORE_CERTIFICATION_SCHEMA) throw new Error(`${path} is not a FINNOR core certification`);
    assertCoreCertificationIntegrity(artifact);
    return artifact;
  }

  async findCoreCertifications(): Promise<CoreCertification[]> {
    const dir = join(this.root, "core");
    let files: string[];
    try { files = await readdir(dir); } catch (error) {
      if (error && typeof error === "object" && "code" in error && error.code === "ENOENT") return [];
      throw error;
    }
    // Old phase artifacts remain immutable on disk, but are not candidates for
    // current-suite reuse. The integrity reader also rejects them if a caller
    // explicitly asks for one.
    const current: CoreCertification[] = [];
    for (const file of files.filter((name) => name.endsWith(".json")).sort()) {
      const artifact = JSON.parse(await readFile(join(dir, file), "utf8")) as CoreCertification;
      if (artifact.suiteVersion !== CORE_CERTIFICATION_SUITE_VERSION) continue;
      current.push(await this.readCoreCertification(join(dir, file)));
    }
    return current;
  }

  async writeFinalCertification(artifact: FinalCertification): Promise<StoredArtifact<FinalCertification>> {
    if (artifact.schema !== FINAL_CERTIFICATION_SCHEMA) throw new Error("Unexpected final certification schema");
    return writeExclusive(join(this.root, "final", `${artifact.certificationId}.json`), artifact);
  }

  async writeOutcomePackCertification(artifact: OutcomePackCertificationArtifact): Promise<StoredArtifact<OutcomePackCertificationArtifact>> {
    if (artifact.schema !== OUTCOME_PACK_CERTIFICATION_SCHEMA) throw new Error("Unexpected Outcome Pack certification schema");
    assertOutcomePackCertificationIntegrity(artifact);
    return writeExclusive(join(this.root, "outcome-packs", artifact.tenantId, artifact.packId, `${artifact.certificationId}.json`), artifact);
  }

  async readFinalCertification(path: string): Promise<FinalCertification> {
    const artifact = JSON.parse(await readFile(path, "utf8")) as FinalCertification;
    if (artifact.schema !== FINAL_CERTIFICATION_SCHEMA) throw new Error(`${path} is not a FINNOR final certification`);
    assertFinalCertificationIntegrity(artifact);
    return artifact;
  }
}

async function assertDatabaseArtifact(pool: pg.Pool, table: string, idColumn: string, id: string, artifact: unknown): Promise<void> {
  // Table/column names are constants owned by this module; values remain parameterized.
  const selected = await pool.query<{ artifact: unknown }>(`SELECT artifact FROM finnor_os.${table} WHERE ${idColumn}=$1`, [id]);
  if (!selected.rows[0] || stableStringify(selected.rows[0].artifact) !== stableStringify(artifact)) {
    throw new Error(`Immutable database artifact collision for ${id}`);
  }
}

export async function persistCoreCertification(pool: pg.Pool, artifact: CoreCertification): Promise<void> {
  await pool.query(
    `INSERT INTO finnor_os.core_certifications
       (certification_id,canonical_core_sha,core_source_tree_hash,suite_hash,status,evidence_hash,artifact,certified_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7::jsonb,$8::timestamptz)
     ON CONFLICT (certification_id) DO NOTHING`,
    [artifact.certificationId, artifact.canonicalCoreSha, artifact.coreSourceTreeHash, artifact.suiteHash,
      artifact.status, artifact.evidenceHash, JSON.stringify(artifact), artifact.certifiedAt],
  );
  await assertDatabaseArtifact(pool, "core_certifications", "certification_id", artifact.certificationId, artifact);
}

export async function persistFinalCertification(pool: pg.Pool, artifact: FinalCertification): Promise<void> {
  await pool.query(
    `INSERT INTO finnor_os.final_certifications
       (certification_id,canonical_git_sha,source_tree_hash,suite_version,suite_hash,migration_head,
        migration_source_hash,migration_schema_hash,action_count,action_manifest_hash,deployment_contract_hash,status,evidence_hash,
        artifact,certified_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14::jsonb,$15::timestamptz)
     ON CONFLICT (certification_id) DO NOTHING`,
    [artifact.certificationId, artifact.canonicalGitSha, artifact.sourceTreeHash, artifact.suiteVersion,
      artifact.suiteHash, artifact.migration.head, artifact.migration.sourceHash, artifact.migration.schemaHash,
      artifact.actionManifest.count, artifact.actionManifest.generatedHash, artifact.deployment.contractHash,
      artifact.status, artifact.evidenceHash, JSON.stringify(artifact), artifact.certifiedAt],
  );
  await assertDatabaseArtifact(pool, "final_certifications", "certification_id", artifact.certificationId, artifact);
}

export async function persistOutcomePackCertification(pool: pg.Pool, artifact: OutcomePackCertificationArtifact): Promise<void> {
  assertOutcomePackCertificationIntegrity(artifact);
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query("SET LOCAL search_path=finnor_os,public");
    await client.query("SET LOCAL row_security=off");
    await client.query(
      `INSERT INTO finnor_os.outcome_pack_certifications
        (tenant_id,pack_id,pack_version,level,status,fingerprint,dependency_versions,evidence,
         sample_size,critical_violations,certified_at,valid_until)
       VALUES($1::uuid,$2,$3,$4,$5,$6,$7::jsonb,$8::jsonb,$9,$10,$11::timestamptz,$12::timestamptz)
       ON CONFLICT(tenant_id,pack_id,pack_version,level,fingerprint) DO UPDATE SET
         status=EXCLUDED.status,evidence=EXCLUDED.evidence,sample_size=EXCLUDED.sample_size,
         critical_violations=EXCLUDED.critical_violations,certified_at=EXCLUDED.certified_at,
         valid_until=EXCLUDED.valid_until,suspended_at=NULL,suspension_reason=NULL`,
      [artifact.tenantId, artifact.packId, artifact.packVersion, artifact.level, artifact.status, artifact.fingerprint,
        JSON.stringify({ suiteVersion: artifact.suiteVersion }), JSON.stringify(artifact), artifact.sampleSize,
        artifact.criticalViolations, artifact.certifiedAt, artifact.validUntil],
    );
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}

export async function assertClientReleaseRollbackReferences(pool: pg.Pool, release: ClientRelease): Promise<void> {
  const references = [release.rollback.predecessorReleaseId, release.rollback.targetReleaseId].filter((id): id is string => Boolean(id));
  if (references.length === 0) return;
  const result = await pool.query<{ release_id: string; client_key: string; tenant_id: string }>(
    `SELECT release_id,client_key,tenant_id::text tenant_id FROM finnor_os.client_releases WHERE release_id=ANY($1::text[])`,
    [references],
  );
  for (const reference of references) {
    const target = result.rows.find((row) => row.release_id === reference);
    if (!target) throw new Error(`Rollback reference ${reference} does not identify an immutable client release`);
    if (target.client_key !== release.client.clientKey || target.tenant_id !== release.client.tenantId) {
      throw new Error(`Rollback reference ${reference} belongs to a different client or tenant`);
    }
  }
}

export async function persistClientReleaseBundle(
  pool: pg.Pool,
  input: { core: CoreCertification; certification: ClientCertification; release: ClientRelease },
): Promise<void> {
  await persistCoreCertification(pool, input.core);
  const cert = input.certification;
  await pool.query(
    `INSERT INTO finnor_os.client_certifications
       (certification_id,client_key,tenant_id,canonical_core_sha,core_certification_id,configuration_hash,
        deployment_evidence_hash,migration_version,schema_hash,suite_hash,status,evidence_hash,artifact,certified_at)
     VALUES ($1,$2,$3::uuid,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13::jsonb,$14::timestamptz)
     ON CONFLICT (certification_id) DO NOTHING`,
    [cert.certificationId, cert.clientKey, cert.tenantId, cert.canonicalCoreSha, cert.coreCertificationId,
      cert.configurationHashes.aggregateHash, cert.deploymentEvidenceHash, cert.migrationVersion, cert.schemaHash,
      cert.suiteHash, cert.status, cert.evidenceHash, JSON.stringify(cert), cert.certifiedAt],
  );
  await assertDatabaseArtifact(pool, "client_certifications", "certification_id", cert.certificationId, cert);

  const release = input.release;
  await assertClientReleaseRollbackReferences(pool, release);
  await pool.query(
    `INSERT INTO finnor_os.client_releases
       (release_id,release_version,client_key,tenant_id,canonical_core_sha,core_certification_id,
        client_certification_id,manifest_hash,configuration_hash,deployment_evidence_hash,
        migration_version,schema_hash,status,predecessor_release_id,rollback_target_release_id,
        artifact,certified_at,released_at)
     VALUES ($1,$2,$3,$4::uuid,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16::jsonb,$17::timestamptz,$18::timestamptz)
     ON CONFLICT (release_id) DO NOTHING`,
    [release.releaseId, release.version, release.client.clientKey, release.client.tenantId,
      release.core.canonicalSha, release.core.certificationId, release.certification.certificationId,
      release.configurationHashes.manifestHash, release.configurationHashes.aggregateHash,
      release.deployment.evidenceHash, release.database.migrationVersion, release.database.schemaHash,
      release.certification.status, release.rollback.predecessorReleaseId, release.rollback.targetReleaseId,
      JSON.stringify(release), release.timestamps.certifiedAt, release.timestamps.releasedAt],
  );
  await assertDatabaseArtifact(pool, "client_releases", "release_id", release.releaseId, release);
}
