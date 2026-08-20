import { execFileSync } from "node:child_process";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, describe, expect, it } from "vitest";
import { parseClientManifest, type ClientManifest } from "../../scripts/client-manifest";
import {
  CLIENT_GATE_KEYS,
  CORE_GATE_KEYS,
  createClientCertification,
  createClientRelease,
  createCoreCertification,
  assertCoreCertificationIntegrity,
  assertClientReleaseIntegrity,
  credentialReferenceStatuses,
  gateResult,
  hashClientConfiguration,
  reusableCoreCertification,
  sha256,
  type CertificationGateResult,
  type CertificationStatus,
  type CoreCertification,
} from "../../scripts/release/certification-model";
import { inspectCoreDiff, isSharedCorePath } from "../../scripts/release/core-diff-guard";

const CORE_SHA_A = "a".repeat(40);
const CORE_SHA_B = "b".repeat(40);
const TREE_HASH = sha256("canonical-core-tree");
const SCHEMA_HASH = sha256("schema-v1");
const tempDirs: string[] = [];

function gates(keys: readonly string[], overrides: Record<string, CertificationStatus> = {}): CertificationGateResult[] {
  return keys.map((gate) => gateResult(gate, overrides[gate] ?? "PASS", { check: gate, deterministic: true }));
}

function core(sha = CORE_SHA_A, overrides: Record<string, CertificationStatus> = {}): CoreCertification {
  return createCoreCertification({
    canonicalCoreSha: sha,
    coreSourceTreeHash: TREE_HASH,
    gates: gates(CORE_GATE_KEYS, overrides),
    certifiedAt: "2026-08-20T00:00:00.000Z",
  });
}

function deployment(certifiedCore: CoreCertification) {
  return { commitSha: certifiedCore.canonicalCoreSha, coreCertificationId: certifiedCore.certificationId, deploymentId: "dpl_certified", traceable: true, service: "finnor-api" };
}

const mapping = {
  version: 1,
  entity: "customer" as const,
  sourceSystem: "certification-crm",
  fields: {
    firstName: { from: "first", required: true, normalize: ["trim"] as const },
    email: { from: "email", normalize: ["trim", "lowercase"] as const },
  },
  externalId: { from: "id", required: true },
  identity: [{ fields: ["email"] }],
  updateMode: "source_owned" as const,
};

function manifest(clientKey = "client-alpha", overrides: Record<string, unknown> = {}): ClientManifest {
  return parseClientManifest({
    clientKey,
    tenant: { name: `${clientKey} Water`, timezone: "America/Chicago" },
    users: [{ email: `owner@${clientKey}.example`, role: "owner" }],
    requiredCapabilities: ["crm"],
    policyOverrides: { create_review_request: { policy: { review_link_url: "https://example.test/review" } } },
    imports: [{ key: "customers", source: "csv", sourceRef: "/tmp/customers.csv", definition: mapping }],
    ...overrides,
  });
}

function clientCertification(input: {
  manifest?: ClientManifest;
  clientKey?: string;
  tenantId?: string;
  core?: CoreCertification;
  gateOverrides?: Record<string, CertificationStatus>;
  deployment?: unknown;
} = {}) {
  const clientManifest = input.manifest ?? manifest(input.clientKey);
  const certifiedCore = input.core ?? core();
  return createClientCertification({
    clientKey: clientManifest.clientKey,
    tenantId: input.tenantId ?? `tenant-${clientManifest.clientKey}`,
    coreCertification: certifiedCore,
    configurationHashes: hashClientConfiguration(clientManifest),
    deploymentEvidence: input.deployment ?? deployment(certifiedCore),
    migrationVersion: "0082_phase5_certification_releases.sql",
    schemaHash: SCHEMA_HASH,
    gates: gates(CLIENT_GATE_KEYS, input.gateOverrides),
    certifiedAt: "2026-08-20T00:05:00.000Z",
  });
}

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});

describe("Phase 5 core + client certification model", () => {
  it("reuses an unchanged PASS core certification without rerunning the core matrix", () => {
    const certified = core();
    expect(reusableCoreCertification([certified], { canonicalCoreSha: CORE_SHA_A, coreSourceTreeHash: TREE_HASH }))
      .toBe(certified);
  });

  it("invalidates a prior core certification when the canonical core SHA changes", () => {
    expect(reusableCoreCertification([core()], { canonicalCoreSha: CORE_SHA_B, coreSourceTreeHash: TREE_HASH })).toBeNull();
  });

  it("invalidates client certification identity after manifest, mapping, or policy changes", () => {
    const base = manifest();
    const changedManifest = manifest("client-alpha", { tenant: { name: "Renamed Water", timezone: "America/Chicago" } });
    const changedMapping = manifest("client-alpha", { imports: [{ key: "customers", source: "csv", sourceRef: "/tmp/customers.csv", definition: { ...mapping, fields: { ...mapping.fields, lastName: { from: "last", normalize: ["trim"] } } } }] });
    const changedPolicy = manifest("client-alpha", { policyOverrides: { create_review_request: { policy: { review_link_url: "https://example.test/other-review" } } } });
    const ids = [base, changedManifest, changedMapping, changedPolicy].map((value) => clientCertification({ manifest: value }).certificationId);
    expect(new Set(ids).size).toBe(4);
    expect(hashClientConfiguration(base).mappingHashes).not.toEqual(hashClientConfiguration(changedMapping).mappingHashes);
    expect(hashClientConfiguration(base).policyHash).not.toBe(hashClientConfiguration(changedPolicy).policyHash);
  });

  it("gives an identical rerun equivalent release identity and evidence", () => {
    const certifiedCore = core();
    const certification = clientCertification({ core: certifiedCore });
    const deploymentEvidence = deployment(certifiedCore);
    const first = createClientRelease({
      coreCertification: certifiedCore,
      clientCertification: certification,
      deploymentEvidence,
      integrations: credentialReferenceStatuses(manifest()),
      releasedAt: "2026-08-20T00:06:00.000Z",
    });
    const second = createClientRelease({
      coreCertification: certifiedCore,
      clientCertification: certification,
      deploymentEvidence,
      integrations: credentialReferenceStatuses(manifest()),
      releasedAt: "2026-08-20T01:06:00.000Z",
    });
    expect(second.releaseId).toBe(first.releaseId);
    expect(second.certification.evidenceHash).toBe(first.certification.evidenceHash);
    expect(second.deployment.evidenceHash).toBe(first.deployment.evidenceHash);
    expect(second.configurationHashes).toEqual(first.configurationHashes);
  });

  it("cannot create a PASS release when any client gate fails", () => {
    const certifiedCore = core();
    const certification = clientCertification({ core: certifiedCore, gateOverrides: { evidence_receipts: "FAIL" } });
    const deploymentEvidence = deployment(certifiedCore);
    const release = createClientRelease({
      coreCertification: certifiedCore,
      clientCertification: certification,
      deploymentEvidence,
      integrations: credentialReferenceStatuses(manifest()),
    });
    expect(certification.status).toBe("FAIL");
    expect(release.certification.status).toBe("FAIL");
  });

  it("keeps BLOCKED_CONFIG distinct from operational FAIL", () => {
    const blocked = clientCertification({ gateOverrides: { tenant_provider_health: "BLOCKED_CONFIG" } });
    const failed = clientCertification({ gateOverrides: { tenant_provider_health: "FAIL" } });
    expect(blocked.status).toBe("BLOCKED_CONFIG");
    expect(failed.status).toBe("FAIL");
    expect(blocked.certificationId).not.toBe(failed.certificationId);
  });

  it("keeps missing deployment/core binding as BLOCKED_CONFIG instead of green", () => {
    const certifiedCore = core();
    const blocked = clientCertification({
      core: certifiedCore,
      deployment: { commitSha: certifiedCore.canonicalCoreSha, deploymentId: "dpl_missing_binding", traceable: true },
    });
    expect(blocked.status).toBe("BLOCKED_CONFIG");
    expect(blocked.gates.find((gate) => gate.gate === "configuration_completeness")?.status).toBe("BLOCKED_CONFIG");
  });

  it("rejects tampered immutable core evidence", () => {
    const artifact = core();
    const tampered = structuredClone(artifact);
    tampered.gates[0]!.evidence = { changed: true };
    expect(() => assertCoreCertificationIntegrity(tampered)).toThrow(/integrity/);
  });

  it("rejects stale core suites and mismatched release evidence", () => {
    const certifiedCore = core();
    const certification = clientCertification({ core: certifiedCore });
    const release = createClientRelease({
      coreCertification: certifiedCore,
      clientCertification: certification,
      deploymentEvidence: deployment(certifiedCore),
      integrations: credentialReferenceStatuses(manifest()),
    });
    const staleCore = structuredClone(certifiedCore);
    staleCore.suiteVersion = "phase4-core-v0" as typeof staleCore.suiteVersion;
    expect(() => assertCoreCertificationIntegrity(staleCore)).toThrow(/integrity/);

    const tamperedRelease = structuredClone(release);
    tamperedRelease.deployment.evidenceHash = sha256("mismatched-release-evidence");
    expect(() => assertClientReleaseIntegrity(tamperedRelease, certifiedCore, certification)).toThrow(/changed after client certification|integrity/);
  });

  it("never places secret values in immutable release evidence", () => {
    const secret = "sk_live_NEVER_STORE_THIS_123";
    const certifiedCore = core();
    const deploymentEvidence = {
      ...deployment(certifiedCore),
      deploymentUrl: `https://deploy.example.test/release?opaque=${secret}#${secret}`,
      apiKey: secret,
      nested: { authorization: `Bearer ${secret}` },
    };
    const certification = clientCertification({ core: certifiedCore, deployment: deploymentEvidence });
    const release = createClientRelease({
      coreCertification: certifiedCore,
      clientCertification: certification,
      deploymentEvidence,
      integrations: credentialReferenceStatuses(manifest()),
    });
    const serialized = JSON.stringify(release);
    expect(serialized).not.toContain(secret);
    expect(serialized).not.toContain("apiKey");
    expect(serialized).not.toContain("/tmp/customers.csv");
  });

  it("detects client-specific mutation of shared core while allowing generated client artifacts", async () => {
    const repo = await mkdtemp(join(tmpdir(), "finnor-core-guard-"));
    tempDirs.push(repo);
    await mkdir(join(repo, "finnor-os/apps/api"), { recursive: true });
    await mkdir(join(repo, "finnor-os/clients/acme"), { recursive: true });
    await writeFile(join(repo, "finnor-os/apps/api/index.ts"), "export const core = 1;\n");
    await writeFile(join(repo, "finnor-os/clients/acme/config.json"), "{}\n");
    execFileSync("git", ["init"], { cwd: repo });
    execFileSync("git", ["config", "user.email", "cert@example.test"], { cwd: repo });
    execFileSync("git", ["config", "user.name", "Certification"], { cwd: repo });
    execFileSync("git", ["add", "."], { cwd: repo });
    execFileSync("git", ["commit", "-m", "canonical core"], { cwd: repo });
    const sha = execFileSync("git", ["rev-parse", "HEAD"], { cwd: repo, encoding: "utf8" }).trim();
    await writeFile(join(repo, "finnor-os/apps/api/index.ts"), "export const core = 2; // client fork\n");
    await writeFile(join(repo, "finnor-os/clients/acme/config.json"), "{\"enabled\":true}\n");
    const diff = inspectCoreDiff(repo, sha);
    expect(diff.clean).toBe(false);
    expect(diff.changedSharedCorePaths).toEqual(["finnor-os/apps/api/index.ts"]);
    expect(diff.changedClientPaths).toContain("finnor-os/clients/acme/config.json");
    expect(isSharedCorePath("finnor-os/scripts/client-factory.ts")).toBe(true);
    expect(isSharedCorePath("finnor-os/tests/unit/release-certification.test.ts")).toBe(true);
  });

  it("certifies two client identities against one identical core SHA without duplicating core evidence", () => {
    const certifiedCore = core();
    const alpha = clientCertification({ clientKey: "client-alpha", tenantId: "tenant-alpha", core: certifiedCore });
    const bravo = clientCertification({ clientKey: "client-bravo", tenantId: "tenant-bravo", core: certifiedCore });
    expect(alpha.coreCertificationId).toBe(certifiedCore.certificationId);
    expect(bravo.coreCertificationId).toBe(certifiedCore.certificationId);
    expect(alpha.canonicalCoreSha).toBe(bravo.canonicalCoreSha);
    expect(alpha.certificationId).not.toBe(bravo.certificationId);
  });
});
