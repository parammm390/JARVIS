import { randomUUID } from "node:crypto";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { closePool, getPool } from "@finnor/db";
import { migrate } from "../../packages/db/migrate";
import { parseClientManifest } from "../../scripts/client-manifest";
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
} from "../../scripts/release/certification-model";
import { persistClientReleaseBundle } from "../../scripts/release/certification-store";

const DB_URL = process.env.DATABASE_URL ?? "postgres://finnor:finnor@localhost:5432/finnor";
async function dbUp() {
  const client = new pg.Client({ connectionString: DB_URL, connectionTimeoutMillis: 2_000 });
  try { await client.connect(); await client.end(); return true; } catch { return false; }
}
const available = await dbUp();

describe.skipIf(!available).sequential("Phase 5 immutable certification persistence", () => {
  beforeAll(async () => {
    process.env.DATABASE_URL = DB_URL;
    await migrate(DB_URL);
  });
  afterAll(() => closePool());

  it("inserts an idempotent release bundle and rejects artifact UPDATE/DELETE", async () => {
    const tenantId = randomUUID();
    const suffix = randomUUID().slice(0, 8);
    const clientKey = `release-${suffix}`;
    const coreSha = "c".repeat(40);
    await getPool().query(
      "INSERT INTO finnor_os.tenants(id,client_key,name,timezone) VALUES($1,$2,$3,'America/Chicago')",
      [tenantId, clientKey, "Immutable Release Water"],
    );
    const manifest = parseClientManifest({
      clientKey,
      tenant: { name: "Immutable Release Water", timezone: "America/Chicago" },
      users: [{ email: `owner-${suffix}@example.test`, role: "owner" }],
      requiredCapabilities: ["crm"],
      policyOverrides: { create_review_request: { policy: { review_link_url: "https://example.test/review" } } },
    });
    const core = createCoreCertification({
      canonicalCoreSha: coreSha,
      coreSourceTreeHash: sha256("tree"),
      gates: CORE_GATE_KEYS.map((gate) => gateResult(gate, "PASS", { gate })),
      certifiedAt: "2026-08-20T00:00:00.000Z",
    });
    const deployment = { commitSha: coreSha, coreCertificationId: core.certificationId, deploymentId: "dpl_immutable", traceable: true };
    const certification = createClientCertification({
      clientKey,
      tenantId,
      coreCertification: core,
      configurationHashes: hashClientConfiguration(manifest),
      deploymentEvidence: deployment,
      migrationVersion: "0082_phase5_certification_releases.sql",
      schemaHash: sha256("schema"),
      gates: CLIENT_GATE_KEYS.map((gate) => gateResult(gate, "PASS", { gate })),
      certifiedAt: "2026-08-20T00:01:00.000Z",
    });
    const release = createClientRelease({
      coreCertification: core,
      clientCertification: certification,
      deploymentEvidence: deployment,
      integrations: credentialReferenceStatuses(manifest),
      releasedAt: "2026-08-20T00:02:00.000Z",
    });

    await persistClientReleaseBundle(getPool(), { core, certification, release });
    await persistClientReleaseBundle(getPool(), { core, certification, release });
    const stored = await getPool().query<{ count: number; artifact: string }>(
      "SELECT count(*)::int count,min(artifact::text) artifact FROM finnor_os.client_releases WHERE release_id=$1",
      [release.releaseId],
    );
    expect(stored.rows[0]!.count).toBe(1);
    expect(stored.rows[0]!.artifact).not.toMatch(/password|sk_live|Bearer /i);
    await expect(getPool().query(
      `INSERT INTO finnor_os.core_certifications
        (certification_id,canonical_core_sha,core_source_tree_hash,suite_hash,status,evidence_hash,artifact,certified_at)
       VALUES($1,$2,$3,$4,'FAIL',$5,$6::jsonb,now())`,
      [`corecert-${"f".repeat(64)}`, core.canonicalCoreSha, core.coreSourceTreeHash, core.suiteHash, core.evidenceHash, JSON.stringify(core)],
    )).rejects.toThrow(/check constraint/i);
    const invalidRollback = createClientRelease({
      coreCertification: core,
      clientCertification: certification,
      deploymentEvidence: deployment,
      integrations: credentialReferenceStatuses(manifest),
      rollbackTargetReleaseId: `clientrelease-${"e".repeat(64)}`,
      releasedAt: "2026-08-20T00:03:00.000Z",
    });
    await expect(persistClientReleaseBundle(getPool(), { core, certification, release: invalidRollback }))
      .rejects.toThrow(/does not identify an immutable client release/);
    await expect(getPool().query("UPDATE finnor_os.client_releases SET status='FAIL' WHERE release_id=$1", [release.releaseId]))
      .rejects.toThrow(/immutable/);
    await expect(getPool().query("DELETE FROM finnor_os.core_certifications WHERE certification_id=$1", [core.certificationId]))
      .rejects.toThrow(/immutable/);
  }, 120_000);
});
