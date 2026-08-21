import { createHash } from "node:crypto";
import type { ClientManifest } from "../client-manifest";

/** The only terminal certification states. Keep these values stable for operators and CI. */
export const CERTIFICATION_STATUSES = ["PASS", "FAIL", "BLOCKED_CONFIG"] as const;
export type CertificationStatus = typeof CERTIFICATION_STATUSES[number];

export const CORE_CERTIFICATION_SCHEMA = "finnor.core-certification/v1" as const;
export const CLIENT_CERTIFICATION_SCHEMA = "finnor.client-certification/v1" as const;
export const CLIENT_RELEASE_SCHEMA = "finnor.client-release/v1" as const;
export const CORE_CERTIFICATION_SUITE_VERSION = "phase5-core-v1" as const;
export const CLIENT_CERTIFICATION_SUITE_VERSION = "phase5-client-v1" as const;

const SHA256 = /^[0-9a-f]{64}$/;
const GIT_SHA = /^[0-9a-f]{40}$/;
const VOLATILE_EVIDENCE_KEY = /^(?:at|.*At|timestamp|time|durationMs|elapsedMs|started|finished|created|updated)$/;

function secretShapedKey(key: string): boolean {
  if (/(?:credential|secret).*(?:reference|configured|provider|status|hash|version)/i.test(key)) return false;
  return /secret|password|passphrase|api[_\-\s]?key|access[_\-\s]?token|refresh[_\-\s]?token|private[_\-\s]?key|authorization|cookie|credentials?$/i.test(key);
}

export function stableStringify(value: unknown): string {
  if (value === undefined) return "null";
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  return `{${Object.entries(value as Record<string, unknown>)
    .filter(([, nested]) => nested !== undefined)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, nested]) => `${JSON.stringify(key)}:${stableStringify(nested)}`)
    .join(",")}}`;
}

export function sha256(value: unknown): string {
  return createHash("sha256").update(typeof value === "string" ? value : stableStringify(value)).digest("hex");
}

function sanitizeString(value: string): string {
  return value
    .replace(/Bearer\s+[A-Za-z0-9._~+/=-]+/gi, "Bearer [REDACTED]")
    .replace(/\b(?:sk|rk|pk)_(?:live|test)_[A-Za-z0-9_-]+\b/g, "[REDACTED]")
    .replace(/([?&](?:token|key|secret|password)=)[^&#\s]+/gi, "$1[REDACTED]")
    .replace(/:\/\/([^/@:\s]+):([^/@\s]+)@/g, "://$1:[REDACTED]@");
}

function sanitizeDeploymentUrl(value: string): string {
  try {
    const url = new URL(value);
    url.username = "";
    url.password = "";
    url.search = "";
    url.hash = "";
    return url.toString();
  } catch {
    return sanitizeString(value);
  }
}

/**
 * Certification evidence is a deliberately smaller trust surface than logs. Secret-
 * shaped fields are redacted recursively and volatile timing keys are omitted from
 * fingerprints so equivalent reruns remain content-addressable.
 */
export function sanitizeEvidence(value: unknown, options: { omitVolatile?: boolean } = {}): unknown {
  if (typeof value === "string") return sanitizeString(value);
  if (value === null || typeof value !== "object") return value;
  if (Array.isArray(value)) return value.map((nested) => sanitizeEvidence(nested, options));
  return Object.fromEntries(Object.entries(value as Record<string, unknown>).flatMap(([key, nested]) => {
    if (options.omitVolatile && VOLATILE_EVIDENCE_KEY.test(key)) return [];
    if (secretShapedKey(key)) return [[key, "[REDACTED]"]];
    return [[key, sanitizeEvidence(nested, options)]];
  }));
}

/** Only canonical, public deployment provenance crosses into ClientRelease evidence. */
export function deploymentEvidenceProjection(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object") return {};
  const record = value as Record<string, unknown>;
  const allowed = [
    "ok", "app", "service", "project", "projectId", "commitSha", "buildId", "deploymentId",
    "environment", "version", "source", "traceable", "coreCertificationId", "deploymentUrl", "url",
  ];
  const projected: Record<string, unknown> = {};
  for (const key of allowed) {
    const nested = record[key];
    if (["string", "boolean", "number"].includes(typeof nested)) {
      projected[key] = (key === "deploymentUrl" || key === "url") && typeof nested === "string"
        ? sanitizeDeploymentUrl(nested)
        : sanitizeEvidence(nested);
    }
  }
  if (record.checks && typeof record.checks === "object" && !Array.isArray(record.checks)) {
    projected.checks = Object.fromEntries(Object.entries(record.checks as Record<string, unknown>)
      .filter(([, nested]) => typeof nested === "boolean"));
  }
  if (record.release && typeof record.release === "object") projected.release = deploymentEvidenceProjection(record.release);
  return projected;
}

export interface CertificationGateResult {
  gate: string;
  status: CertificationStatus;
  evidence: unknown;
  evidenceHash: string;
}

export function gateResult(gate: string, status: CertificationStatus, evidence: unknown = {}): CertificationGateResult {
  if (!gate.trim()) throw new Error("Certification gate name is required");
  if (!CERTIFICATION_STATUSES.includes(status)) throw new Error(`Invalid certification status: ${status}`);
  const sanitized = sanitizeEvidence(evidence, { omitVolatile: true });
  return { gate, status, evidence: sanitized, evidenceHash: sha256(sanitized) };
}

export function certificationStatus(gates: readonly Pick<CertificationGateResult, "status">[]): CertificationStatus {
  if (gates.length === 0) return "FAIL";
  if (gates.some((gate) => gate.status === "FAIL")) return "FAIL";
  if (gates.some((gate) => gate.status === "BLOCKED_CONFIG")) return "BLOCKED_CONFIG";
  return "PASS";
}

export const CORE_GATE_KEYS = [
  "source_provenance",
  "typecheck_build",
  "unit_integration",
  "migrations",
  "tenant_rls_security",
  "action_contracts",
  "policy_approval_boundaries",
  "workflow_runtime_recovery",
  "queue_idempotency",
  "load_latency_reliability",
  "release_deployment_invariants",
] as const;

export const CLIENT_GATE_KEYS = [
  "manifest_config_validity",
  "tenant_identity_convergence",
  "user_isolation",
  "workspace_policies",
  "credential_references",
  "tenant_provider_health",
  "import_replay_safety",
  "required_integrations_capabilities",
  "approval_authority_configuration",
  "worker_runtime_health",
  "water_treatment_journeys",
  "evidence_receipts",
  "configuration_completeness",
  "core_diff_guard",
] as const;

function requireGateSet(expected: readonly string[], gates: readonly CertificationGateResult[]): void {
  const actual = new Set(gates.map((gate) => gate.gate));
  const missing = expected.filter((gate) => !actual.has(gate));
  const duplicates = gates.map((gate) => gate.gate).filter((gate, index, all) => all.indexOf(gate) !== index);
  if (missing.length || duplicates.length) {
    throw new Error(`Certification gate set is incomplete (missing=${missing.join(",") || "none"}; duplicates=${duplicates.join(",") || "none"})`);
  }
}

export interface CoreCertification {
  schema: typeof CORE_CERTIFICATION_SCHEMA;
  certificationId: string;
  canonicalCoreSha: string;
  coreSourceTreeHash: string;
  suiteVersion: typeof CORE_CERTIFICATION_SUITE_VERSION;
  suiteHash: string;
  status: CertificationStatus;
  gates: CertificationGateResult[];
  evidenceHash: string;
  certifiedAt: string;
  provenance: { repository: string; source: string };
}

export function createCoreCertification(input: {
  canonicalCoreSha: string;
  coreSourceTreeHash: string;
  gates: CertificationGateResult[];
  certifiedAt?: string;
  repository?: string;
  source?: string;
}): CoreCertification {
  const canonicalCoreSha = input.canonicalCoreSha.toLowerCase();
  if (!GIT_SHA.test(canonicalCoreSha)) throw new Error("canonicalCoreSha must be a full 40-character Git SHA");
  if (!SHA256.test(input.coreSourceTreeHash)) throw new Error("coreSourceTreeHash must be a SHA-256 digest");
  requireGateSet(CORE_GATE_KEYS, input.gates);
  const gates = input.gates.map((gate) => gateResult(gate.gate, gate.status, gate.evidence)).sort((a, b) => a.gate.localeCompare(b.gate));
  const suiteHash = sha256({ version: CORE_CERTIFICATION_SUITE_VERSION, gates: CORE_GATE_KEYS });
  const evidenceHash = sha256(gates.map(({ gate, status, evidenceHash: hash }) => ({ gate, status, evidenceHash: hash })));
  const identityHash = sha256({ canonicalCoreSha, coreSourceTreeHash: input.coreSourceTreeHash, suiteHash, evidenceHash });
  return {
    schema: CORE_CERTIFICATION_SCHEMA,
    certificationId: `corecert-${identityHash}`,
    canonicalCoreSha,
    coreSourceTreeHash: input.coreSourceTreeHash,
    suiteVersion: CORE_CERTIFICATION_SUITE_VERSION,
    suiteHash,
    status: certificationStatus(gates),
    gates,
    evidenceHash,
    certifiedAt: input.certifiedAt ?? new Date().toISOString(),
    provenance: { repository: input.repository ?? "FINNOR", source: input.source ?? "release:certify" },
  };
}

export function assertCoreCertificationIntegrity(artifact: CoreCertification): void {
  const rebuilt = createCoreCertification({
    canonicalCoreSha: artifact.canonicalCoreSha,
    coreSourceTreeHash: artifact.coreSourceTreeHash,
    gates: artifact.gates,
    certifiedAt: artifact.certifiedAt,
    repository: artifact.provenance.repository,
    source: artifact.provenance.source,
  });
  if (stableStringify(rebuilt) !== stableStringify(artifact)) {
    throw new Error(`Core certification ${artifact.certificationId} failed integrity verification`);
  }
}

/** Only an exact, successful core/source/suite match is reusable. */
export function reusableCoreCertification(
  certifications: readonly CoreCertification[],
  input: { canonicalCoreSha: string; coreSourceTreeHash: string },
): CoreCertification | null {
  const suiteHash = sha256({ version: CORE_CERTIFICATION_SUITE_VERSION, gates: CORE_GATE_KEYS });
  return certifications.find((candidate) =>
    candidate.status === "PASS"
    && candidate.canonicalCoreSha === input.canonicalCoreSha.toLowerCase()
    && candidate.coreSourceTreeHash === input.coreSourceTreeHash
    && candidate.suiteHash === suiteHash
  ) ?? null;
}

export interface ClientConfigurationHashes {
  manifestHash: string;
  mappingHashes: Record<string, string>;
  importDefinitionHashes: Record<string, string>;
  policyHash: string;
  workspaceHash: string;
  configHash: string;
  aggregateHash: string;
}

export function hashClientConfiguration(manifest: ClientManifest): ClientConfigurationHashes {
  const mappingHashes = Object.fromEntries(manifest.imports.map((item) => [item.key, sha256({
    entity: item.definition.entity,
    sourceSystem: item.definition.sourceSystem,
    fields: item.definition.fields,
    externalId: item.definition.externalId,
    identity: item.definition.identity,
    relationships: item.definition.relationships,
    updateMode: item.definition.updateMode,
  })]));
  const importDefinitionHashes = Object.fromEntries(manifest.imports.map((item) => [item.key, sha256({
    key: item.key,
    source: item.source,
    definition: item.definition,
  })]));
  const hashes = {
    manifestHash: sha256(manifest),
    mappingHashes,
    importDefinitionHashes,
    policyHash: sha256(manifest.policyOverrides),
    workspaceHash: sha256({ tenantSettings: manifest.tenant.settings, workspaceConfig: manifest.workspaceConfig ?? null, locations: manifest.locations }),
    configHash: sha256({
      tenant: manifest.tenant,
      users: manifest.users,
      requiredCapabilities: manifest.requiredCapabilities,
      integrations: manifest.integrations.map(({ credential, credentialRefs, ...integration }) => ({
        ...integration,
        credentialReference: credential ? { provider: credential.provider, referenceHash: sha256(credential.ref), versionConfigured: Boolean(credential.version) } : null,
        descriptiveReferenceHashes: Object.fromEntries(Object.entries(credentialRefs).map(([key, ref]) => [key, sha256(ref)])),
      })),
      communicationIdentities: (manifest.communicationIdentities ?? []).map(({ credential, ...identity }) => ({
        ...identity,
        credentialReference: credential ? { provider: credential.provider, referenceHash: sha256(credential.ref), versionConfigured: Boolean(credential.version) } : null,
      })),
      communicationIdentityBindings: manifest.communicationIdentityBindings ?? null,
      applicationAccounts: manifest.applicationAccounts ?? null,
      authProfiles: (manifest.authProfiles ?? []).map(({ credential, ...profile }) => ({
        ...profile,
        credentialReference: credential ? { provider: credential.provider, referenceHash: sha256(credential.ref), versionConfigured: Boolean(credential.version) } : null,
      })),
      credentialReferenceHashes: Object.fromEntries(Object.entries(manifest.credentialRefs).map(([key, ref]) => [key, sha256(ref)])),
    }),
  };
  return { ...hashes, aggregateHash: sha256(hashes) };
}

export interface CredentialReferenceStatus {
  capability: string;
  binding: string;
  mode: string;
  configured: boolean;
  provider: string | null;
  referenceHash: string | null;
  versionConfigured: boolean;
  health: "ok" | "degraded" | "down" | "unknown";
}

export function credentialReferenceStatuses(
  manifest: ClientManifest,
  health: Record<string, CredentialReferenceStatus["health"]> = {},
): CredentialReferenceStatus[] {
  return manifest.integrations.map((integration) => ({
    capability: integration.capability,
    binding: integration.binding,
    mode: integration.mode,
    configured: Boolean(integration.credential),
    provider: integration.credential?.provider ?? null,
    referenceHash: integration.credential ? sha256(integration.credential.ref) : null,
    versionConfigured: Boolean(integration.credential?.version),
    health: health[integration.capability] ?? "unknown",
  }));
}

export interface ClientCertification {
  schema: typeof CLIENT_CERTIFICATION_SCHEMA;
  certificationId: string;
  clientKey: string;
  tenantId: string;
  canonicalCoreSha: string;
  coreCertificationId: string;
  suiteVersion: typeof CLIENT_CERTIFICATION_SUITE_VERSION;
  suiteHash: string;
  configurationHashes: ClientConfigurationHashes;
  deploymentEvidenceHash: string;
  migrationVersion: string;
  schemaHash: string;
  status: CertificationStatus;
  gates: CertificationGateResult[];
  evidenceHash: string;
  certifiedAt: string;
}

export function createClientCertification(input: {
  clientKey: string;
  tenantId: string;
  coreCertification: CoreCertification;
  configurationHashes: ClientConfigurationHashes;
  deploymentEvidence: unknown;
  migrationVersion: string;
  schemaHash: string;
  gates: CertificationGateResult[];
  certifiedAt?: string;
}): ClientCertification {
  if (!input.clientKey || !input.tenantId) throw new Error("Client and tenant identity are required");
  if (!SHA256.test(input.schemaHash)) throw new Error("schemaHash must be a SHA-256 digest");
  requireGateSet(CLIENT_GATE_KEYS, input.gates);
  const gates = input.gates.map((gate) => gateResult(gate.gate, gate.status, gate.evidence)).sort((a, b) => a.gate.localeCompare(b.gate));
  // A caller cannot omit the core boundary and still mint green evidence.
  let guardedGates = input.coreCertification.status === "PASS"
    ? gates
    : gates.map((gate) => gate.gate === "core_diff_guard"
      ? gateResult("core_diff_guard", "FAIL", { reason: "referenced core certification is not PASS", coreCertificationStatus: input.coreCertification.status })
      : gate);
  const deploymentRecord = input.deploymentEvidence && typeof input.deploymentEvidence === "object"
    ? input.deploymentEvidence as Record<string, unknown> : {};
  const deployedRelease = deploymentRecord.release && typeof deploymentRecord.release === "object"
    ? deploymentRecord.release as Record<string, unknown> : deploymentRecord;
  const deployedCoreSha = typeof deployedRelease.commitSha === "string" ? deployedRelease.commitSha : null;
  const deployedCoreCertificationId = typeof deployedRelease.coreCertificationId === "string" ? deployedRelease.coreCertificationId : null;
  const deploymentBindingStatus: CertificationStatus = !deployedCoreSha || !deployedCoreCertificationId
    ? "BLOCKED_CONFIG"
    : deployedCoreSha !== input.coreCertification.canonicalCoreSha || deployedCoreCertificationId !== input.coreCertification.certificationId
      ? "FAIL" : "PASS";
  if (deploymentBindingStatus !== "PASS") {
    guardedGates = guardedGates.map((gate) => gate.gate === "configuration_completeness"
      ? gateResult("configuration_completeness", gate.status === "FAIL" ? "FAIL" : deploymentBindingStatus, {
        prior: gate.evidence,
        deploymentCoreBinding: {
          status: deploymentBindingStatus,
          deployedCoreSha,
          deployedCoreCertificationId,
          expectedCoreSha: input.coreCertification.canonicalCoreSha,
          expectedCoreCertificationId: input.coreCertification.certificationId,
        },
      })
      : gate);
  }
  const suiteHash = sha256({ version: CLIENT_CERTIFICATION_SUITE_VERSION, gates: CLIENT_GATE_KEYS });
  const deploymentEvidenceHash = sha256(deploymentEvidenceProjection(input.deploymentEvidence));
  const evidenceHash = sha256(guardedGates.map(({ gate, status, evidenceHash: hash }) => ({ gate, status, evidenceHash: hash })));
  const identityHash = sha256({
    clientKey: input.clientKey,
    tenantId: input.tenantId,
    coreCertificationId: input.coreCertification.certificationId,
    configurationHash: input.configurationHashes.aggregateHash,
    deploymentEvidenceHash,
    migrationVersion: input.migrationVersion,
    schemaHash: input.schemaHash,
    suiteHash,
    evidenceHash,
  });
  return {
    schema: CLIENT_CERTIFICATION_SCHEMA,
    certificationId: `clientcert-${identityHash}`,
    clientKey: input.clientKey,
    tenantId: input.tenantId,
    canonicalCoreSha: input.coreCertification.canonicalCoreSha,
    coreCertificationId: input.coreCertification.certificationId,
    suiteVersion: CLIENT_CERTIFICATION_SUITE_VERSION,
    suiteHash,
    configurationHashes: input.configurationHashes,
    deploymentEvidenceHash,
    migrationVersion: input.migrationVersion,
    schemaHash: input.schemaHash,
    status: certificationStatus(guardedGates),
    gates: guardedGates,
    evidenceHash,
    certifiedAt: input.certifiedAt ?? new Date().toISOString(),
  };
}

export function assertClientCertificationIntegrity(artifact: ClientCertification, coreCertification: CoreCertification): void {
  assertCoreCertificationIntegrity(coreCertification);
  requireGateSet(CLIENT_GATE_KEYS, artifact.gates);
  const normalizedGates = artifact.gates.map((gate) => gateResult(gate.gate, gate.status, gate.evidence))
    .sort((a, b) => a.gate.localeCompare(b.gate));
  const suiteHash = sha256({ version: CLIENT_CERTIFICATION_SUITE_VERSION, gates: CLIENT_GATE_KEYS });
  const evidenceHash = sha256(normalizedGates.map(({ gate, status, evidenceHash: hash }) => ({ gate, status, evidenceHash: hash })));
  const expectedIdentityHash = sha256({
    clientKey: artifact.clientKey,
    tenantId: artifact.tenantId,
    coreCertificationId: coreCertification.certificationId,
    configurationHash: artifact.configurationHashes.aggregateHash,
    deploymentEvidenceHash: artifact.deploymentEvidenceHash,
    migrationVersion: artifact.migrationVersion,
    schemaHash: artifact.schemaHash,
    suiteHash: artifact.suiteHash,
    evidenceHash: artifact.evidenceHash,
  });
  const structurallyValid = artifact.schema === CLIENT_CERTIFICATION_SCHEMA
    && artifact.certificationId === `clientcert-${expectedIdentityHash}`
    && artifact.coreCertificationId === coreCertification.certificationId
    && artifact.canonicalCoreSha === coreCertification.canonicalCoreSha
    && artifact.suiteVersion === CLIENT_CERTIFICATION_SUITE_VERSION
    && artifact.suiteHash === suiteHash
    && artifact.status === certificationStatus(normalizedGates)
    && artifact.evidenceHash === evidenceHash
    && stableStringify(artifact.gates) === stableStringify(normalizedGates);
  if (!structurallyValid) throw new Error(`Client certification ${artifact.certificationId} failed integrity verification`);
}

export interface ClientRelease {
  schema: typeof CLIENT_RELEASE_SCHEMA;
  releaseId: string;
  version: string;
  client: { clientKey: string; tenantId: string };
  core: { canonicalSha: string; certificationId: string; certificationStatus: CertificationStatus; evidenceHash: string; sourceTreeHash: string };
  configurationHashes: ClientConfigurationHashes;
  database: { migrationVersion: string; schemaHash: string };
  integrations: CredentialReferenceStatus[];
  certification: {
    certificationId: string;
    status: CertificationStatus;
    evidenceHash: string;
    gates: Array<{ gate: string; status: CertificationStatus; evidenceHash: string }>;
  };
  deployment: { evidenceHash: string; evidence: unknown };
  rollback: { predecessorReleaseId: string | null; targetReleaseId: string | null };
  provenance: { factoryRunId: string | null; source: string };
  timestamps: { certifiedAt: string; releasedAt: string };
}

export function createClientRelease(input: {
  coreCertification: CoreCertification;
  clientCertification: ClientCertification;
  deploymentEvidence: unknown;
  integrations: CredentialReferenceStatus[];
  predecessorReleaseId?: string | null;
  rollbackTargetReleaseId?: string | null;
  factoryRunId?: string | null;
  releasedAt?: string;
  source?: string;
}): ClientRelease {
  const { coreCertification, clientCertification } = input;
  if (clientCertification.coreCertificationId !== coreCertification.certificationId) {
    throw new Error("Client certification references a different core certification");
  }
  if (clientCertification.canonicalCoreSha !== coreCertification.canonicalCoreSha) {
    throw new Error("Client certification references a different canonical core SHA");
  }
  if (clientCertification.deploymentEvidenceHash !== sha256(deploymentEvidenceProjection(input.deploymentEvidence))) {
    throw new Error("Deployment evidence changed after client certification");
  }
  const deploymentEvidence = deploymentEvidenceProjection(input.deploymentEvidence);
  const integrations = input.integrations.map((row) => ({ ...row })).sort((a, b) => a.capability.localeCompare(b.capability));
  const rollback = { predecessorReleaseId: input.predecessorReleaseId ?? null, targetReleaseId: input.rollbackTargetReleaseId ?? null };
  const identity = {
    clientKey: clientCertification.clientKey,
    tenantId: clientCertification.tenantId,
    canonicalCoreSha: coreCertification.canonicalCoreSha,
    coreCertificationId: coreCertification.certificationId,
    coreEvidenceHash: coreCertification.evidenceHash,
    configurationHashes: clientCertification.configurationHashes,
    database: { migrationVersion: clientCertification.migrationVersion, schemaHash: clientCertification.schemaHash },
    integrations,
    clientCertificationId: clientCertification.certificationId,
    clientCertificationStatus: clientCertification.status,
    clientEvidenceHash: clientCertification.evidenceHash,
    deploymentEvidenceHash: clientCertification.deploymentEvidenceHash,
    rollback,
  };
  const identityHash = sha256(identity);
  const release: ClientRelease = {
    schema: CLIENT_RELEASE_SCHEMA,
    releaseId: `clientrelease-${identityHash}`,
    version: `${clientCertification.clientKey}-${coreCertification.canonicalCoreSha.slice(0, 12)}-${identityHash.slice(0, 12)}`,
    client: { clientKey: clientCertification.clientKey, tenantId: clientCertification.tenantId },
    core: {
      canonicalSha: coreCertification.canonicalCoreSha,
      certificationId: coreCertification.certificationId,
      certificationStatus: coreCertification.status,
      evidenceHash: coreCertification.evidenceHash,
      sourceTreeHash: coreCertification.coreSourceTreeHash,
    },
    configurationHashes: clientCertification.configurationHashes,
    database: { migrationVersion: clientCertification.migrationVersion, schemaHash: clientCertification.schemaHash },
    integrations,
    certification: {
      certificationId: clientCertification.certificationId,
      status: clientCertification.status,
      evidenceHash: clientCertification.evidenceHash,
      gates: clientCertification.gates.map(({ gate, status, evidenceHash }) => ({ gate, status, evidenceHash })),
    },
    deployment: { evidenceHash: clientCertification.deploymentEvidenceHash, evidence: deploymentEvidence },
    rollback,
    provenance: { factoryRunId: input.factoryRunId ?? null, source: input.source ?? "release:certify" },
    timestamps: { certifiedAt: clientCertification.certifiedAt, releasedAt: input.releasedAt ?? new Date().toISOString() },
  };
  // Defense in depth: artifact construction must never leak secret-shaped values.
  return sanitizeEvidence(release) as ClientRelease;
}

export function assertClientReleaseIntegrity(
  artifact: ClientRelease,
  coreCertification: CoreCertification,
  clientCertification: ClientCertification,
): void {
  assertClientCertificationIntegrity(clientCertification, coreCertification);
  const rebuilt = createClientRelease({
    coreCertification,
    clientCertification,
    deploymentEvidence: artifact.deployment.evidence,
    integrations: artifact.integrations,
    predecessorReleaseId: artifact.rollback.predecessorReleaseId,
    rollbackTargetReleaseId: artifact.rollback.targetReleaseId,
    factoryRunId: artifact.provenance.factoryRunId,
    releasedAt: artifact.timestamps.releasedAt,
    source: artifact.provenance.source,
  });
  if (stableStringify(rebuilt) !== stableStringify(artifact)) {
    throw new Error(`Client release ${artifact.releaseId} failed integrity verification`);
  }
}
