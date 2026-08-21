import type { ClientManifest } from "../client-manifest";
import { sanitizeEvidence, sha256, stableStringify } from "./certification-model";

export const LIFECYCLE_AREAS = [
  "tenant", "identity", "workspace", "policy", "integration", "import", "core",
] as const;
export type LifecycleArea = typeof LIFECYCLE_AREAS[number];

export interface ManifestChange {
  path: string;
  kind: "add" | "remove" | "change";
  before: unknown;
  after: unknown;
  beforeHash: string | null;
  afterHash: string | null;
  area: LifecycleArea;
}

export interface ClientImpactPlan {
  schema: "finnor.client-impact-plan/v1";
  planId: string;
  clientKey: string;
  currentReleaseId: string | null;
  currentManifestHash: string | null;
  desiredManifestHash: string;
  currentCoreSha: string | null;
  desiredCoreSha: string | null;
  noChange: boolean;
  changes: ManifestChange[];
  affectedAreas: LifecycleArea[];
  affectedImportKeys: string[];
  factoryStages: string[];
  certificationGates: string[];
  reusableCertificationGates: string[];
  rollback: { supported: boolean; scope: "none" | "configuration_only"; unsupportedAreas: LifecycleArea[] };
}

const FACTORY_STAGE_ORDER = [
  "validate", "tenant", "identity", "workspace_policies", "integrations_credentials",
  "import", "tenant_health", "ready_for_certification",
];

const CERTIFICATION_GATE_ORDER = [
  "manifest_config_validity", "tenant_identity_convergence", "user_isolation", "workspace_policies",
  "credential_references", "tenant_provider_health", "import_replay_safety",
  "required_integrations_capabilities", "approval_authority_configuration", "worker_runtime_health",
  "water_treatment_journeys", "evidence_receipts", "configuration_completeness", "core_diff_guard",
];

function keyed<T>(rows: readonly T[], key: (row: T) => string): Record<string, T> {
  return Object.fromEntries([...rows].sort((a, b) => key(a).localeCompare(key(b))).map((row) => [key(row), row]));
}

/** Arrays with natural identities become maps so ordering cannot create a false diff. */
function diffProjection(manifest: ClientManifest): unknown {
  return {
    manifestVersion: manifest.manifestVersion,
    clientKey: manifest.clientKey,
    tenant: manifest.tenant,
    locations: keyed(manifest.locations, (row) => row.key),
    users: keyed(manifest.users, (row) => row.email),
    orgUnits: manifest.orgUnits === undefined ? null : keyed(manifest.orgUnits, (row) => row.key),
    orgUnitMemberships: manifest.orgUnitMemberships === undefined
      ? null
      : keyed(manifest.orgUnitMemberships, (row) => `${row.orgUnitKey}:${row.employeeEmail}`),
    employeeRelationships: manifest.employeeRelationships === undefined
      ? null
      : keyed(manifest.employeeRelationships, (row) => `${row.subjectEmployeeEmail}:${row.relationshipType}:${row.relatedEmployeeEmail}`),
    aliases: manifest.aliases === undefined ? null : keyed(manifest.aliases, (row) => row.key),
    externalOrganizations: manifest.externalOrganizations === undefined ? null : keyed(manifest.externalOrganizations, (row) => row.key),
    externalContacts: manifest.externalContacts === undefined ? null : keyed(manifest.externalContacts, (row) => row.key),
    communicationIdentities: manifest.communicationIdentities === undefined ? null : keyed(manifest.communicationIdentities, (row) => row.key),
    communicationIdentityBindings: manifest.communicationIdentityBindings === undefined
      ? null
      : keyed(manifest.communicationIdentityBindings, (row) => `${row.identityKey}:${JSON.stringify(row.principal)}:${row.purpose}`),
    applicationAccounts: manifest.applicationAccounts === undefined ? null : keyed(manifest.applicationAccounts, (row) => row.key),
    authProfiles: manifest.authProfiles === undefined ? null : keyed(manifest.authProfiles, (row) => row.ref),
    workspaceConfig: manifest.workspaceConfig ?? null,
    policyOverrides: manifest.policyOverrides,
    requiredCapabilities: [...manifest.requiredCapabilities].sort(),
    integrations: keyed(manifest.integrations, (row) => row.capability),
    credentialRefs: manifest.credentialRefs,
    imports: keyed(manifest.imports, (row) => row.key),
  };
}

function pointerToken(value: string): string {
  return value.replaceAll("~", "~0").replaceAll("/", "~1");
}

function areaForPath(path: string): LifecycleArea {
  if (path.startsWith("/users")
    || path.startsWith("/orgUnits")
    || path.startsWith("/orgUnitMemberships")
    || path.startsWith("/employeeRelationships")
    || path.startsWith("/aliases")
    || path.startsWith("/externalOrganizations")
    || path.startsWith("/externalContacts")) return "identity";
  if (path.startsWith("/workspaceConfig") || path.startsWith("/locations") || path.startsWith("/tenant/settings")) return "workspace";
  if (path.startsWith("/policyOverrides")) return "policy";
  if (path.startsWith("/integrations")
    || path.startsWith("/requiredCapabilities")
    || path.startsWith("/credentialRefs")
    || path.startsWith("/communicationIdentities")
    || path.startsWith("/communicationIdentityBindings")
    || path.startsWith("/applicationAccounts")
    || path.startsWith("/authProfiles")) return "integration";
  if (path.startsWith("/imports")) return "import";
  return "tenant";
}

function visibleValue(path: string, value: unknown): unknown {
  if (value === undefined) return null;
  if (/\/(?:credential|credentialRefs)(?:\/|$)|\/sourceRef$/i.test(path)) {
    return value === null ? null : { configured: true, referenceHash: sha256(value) };
  }
  return sanitizeEvidence(value);
}

function walkDiff(before: unknown, after: unknown, path = ""): ManifestChange[] {
  if (stableStringify(before) === stableStringify(after)) return [];
  const beforeObject = before !== null && typeof before === "object" && !Array.isArray(before);
  const afterObject = after !== null && typeof after === "object" && !Array.isArray(after);
  if (beforeObject && afterObject) {
    const keys = [...new Set([
      ...Object.keys(before as Record<string, unknown>),
      ...Object.keys(after as Record<string, unknown>),
    ])].sort();
    return keys.flatMap((key) => walkDiff(
      (before as Record<string, unknown>)[key],
      (after as Record<string, unknown>)[key],
      `${path}/${pointerToken(key)}`,
    ));
  }
  const beforeMissing = before === undefined;
  const afterMissing = after === undefined;
  return [{
    path: path || "/",
    kind: beforeMissing ? "add" : afterMissing ? "remove" : "change",
    before: visibleValue(path, before),
    after: visibleValue(path, after),
    beforeHash: beforeMissing ? null : sha256(before),
    afterHash: afterMissing ? null : sha256(after),
    area: areaForPath(path),
  }];
}

function ordered(values: Iterable<string>, order: readonly string[]): string[] {
  const set = new Set(values);
  return order.filter((value) => set.has(value));
}

function invalidationForAreas(areas: Set<LifecycleArea>): { factory: string[]; certification: string[] } {
  if (areas.size === 0) return { factory: [], certification: [] };
  const hasConfigurationChange = [...areas].some((area) => area !== "core");
  const factory = new Set<string>(hasConfigurationChange ? ["validate", "tenant_health", "ready_for_certification"] : []);
  const certification = new Set(["manifest_config_validity", "tenant_identity_convergence", "worker_runtime_health", "configuration_completeness", "core_diff_guard"]);
  if (areas.has("tenant")) {
    factory.add("tenant");
  }
  if (areas.has("identity")) {
    factory.add("identity");
    certification.add("user_isolation");
    certification.add("approval_authority_configuration");
  }
  if (areas.has("workspace") || areas.has("policy")) {
    factory.add("workspace_policies");
    certification.add("workspace_policies");
    certification.add("approval_authority_configuration");
  }
  if (areas.has("integration")) {
    factory.add("integrations_credentials");
    certification.add("credential_references");
    certification.add("tenant_provider_health");
    certification.add("required_integrations_capabilities");
  }
  if (areas.has("import")) {
    factory.add("import");
    certification.add("import_replay_safety");
    certification.add("water_treatment_journeys");
    certification.add("evidence_receipts");
  }
  if (areas.has("core")) {
    CERTIFICATION_GATE_ORDER.forEach((gate) => certification.add(gate));
  }
  return { factory: ordered(factory, FACTORY_STAGE_ORDER), certification: ordered(certification, CERTIFICATION_GATE_ORDER) };
}

export function buildClientImpactPlan(input: {
  currentManifest: ClientManifest | null;
  desiredManifest: ClientManifest;
  currentReleaseId?: string | null;
  currentCoreSha?: string | null;
  desiredCoreSha?: string | null;
}): ClientImpactPlan {
  if (input.currentManifest && input.currentManifest.clientKey !== input.desiredManifest.clientKey) {
    throw new Error("Desired manifest clientKey cannot differ from the current client release");
  }
  const changes = input.currentManifest
    ? walkDiff(diffProjection(input.currentManifest), diffProjection(input.desiredManifest))
    : walkDiff({}, diffProjection(input.desiredManifest));
  const currentCoreSha = input.currentCoreSha ?? null;
  const desiredCoreSha = input.desiredCoreSha ?? currentCoreSha;
  if (currentCoreSha && desiredCoreSha && currentCoreSha !== desiredCoreSha) {
    changes.push({
      path: "/core/canonicalSha", kind: "change", before: currentCoreSha, after: desiredCoreSha,
      beforeHash: sha256(currentCoreSha), afterHash: sha256(desiredCoreSha), area: "core",
    });
  }
  changes.sort((a, b) => a.path.localeCompare(b.path));
  const areas = new Set(changes.map((change) => change.area));
  const invalidation = invalidationForAreas(areas);
  const affectedImportKeys = [...new Set(changes.flatMap((change) => {
    const match = change.path.match(/^\/imports\/([^/]+)/);
    return match ? [match[1]!.replaceAll("~1", "/").replaceAll("~0", "~")] : [];
  }))].sort();
  const unsupportedAreas = [...areas].filter((area) => !["tenant", "workspace", "policy", "integration"].includes(area));
  const reusableCertificationGates = CERTIFICATION_GATE_ORDER.filter((gate) => !invalidation.certification.includes(gate));
  const identity = {
    clientKey: input.desiredManifest.clientKey,
    currentReleaseId: input.currentReleaseId ?? null,
    currentManifestHash: input.currentManifest ? sha256(input.currentManifest) : null,
    desiredManifestHash: sha256(input.desiredManifest),
    currentCoreSha,
    desiredCoreSha,
    changes,
    factoryStages: invalidation.factory,
    certificationGates: invalidation.certification,
  };
  return {
    schema: "finnor.client-impact-plan/v1",
    planId: `clientplan-${sha256(identity)}`,
    clientKey: input.desiredManifest.clientKey,
    currentReleaseId: input.currentReleaseId ?? null,
    currentManifestHash: identity.currentManifestHash,
    desiredManifestHash: identity.desiredManifestHash,
    currentCoreSha,
    desiredCoreSha,
    noChange: changes.length === 0,
    changes,
    affectedAreas: LIFECYCLE_AREAS.filter((area) => areas.has(area)),
    affectedImportKeys,
    factoryStages: invalidation.factory,
    certificationGates: invalidation.certification,
    reusableCertificationGates,
    rollback: {
      supported: changes.length > 0 && unsupportedAreas.length === 0,
      scope: changes.length > 0 && unsupportedAreas.length === 0 ? "configuration_only" : "none",
      unsupportedAreas,
    },
  };
}
