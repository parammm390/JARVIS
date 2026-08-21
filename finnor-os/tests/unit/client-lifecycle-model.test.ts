import { describe, expect, it } from "vitest";
import { parseClientManifest } from "../../scripts/client-manifest";
import { buildClientImpactPlan } from "../../scripts/release/client-lifecycle-model";

const mapping = {
  version: 1,
  entity: "customer" as const,
  sourceSystem: "lifecycle-crm",
  fields: {
    firstName: { from: "first", required: true, normalize: ["trim"] as const },
    email: { from: "email", normalize: ["trim", "lowercase"] as const },
  },
  externalId: { from: "id", required: true },
  identity: [{ fields: ["email"] }],
  updateMode: "source_owned" as const,
};

function manifest(overrides: Record<string, unknown> = {}) {
  return parseClientManifest({
    clientKey: "lifecycle-client",
    tenant: { name: "Lifecycle Water", timezone: "America/Chicago" },
    users: [{ email: "owner@lifecycle.example", role: "owner" }],
    policyOverrides: { create_review_request: { policy: { review_link_url: "https://example.test/review" } } },
    imports: [
      { key: "customers", source: "csv", sourceRef: "/tmp/customers.csv", definition: mapping },
      { key: "customers-west", source: "csv", sourceRef: "/tmp/customers-west.csv", definition: { ...mapping, sourceSystem: "lifecycle-crm-west" } },
    ],
    ...overrides,
  });
}

describe("Phase 6 deterministic client impact planning", () => {
  it("treats unchanged configuration as a true no-op", () => {
    const current = manifest();
    const plan = buildClientImpactPlan({
      currentManifest: current,
      desiredManifest: parseClientManifest(structuredClone(current)),
      currentReleaseId: `clientrelease-${"a".repeat(64)}`,
      currentCoreSha: "b".repeat(40),
      desiredCoreSha: "b".repeat(40),
    });
    expect(plan.noChange).toBe(true);
    expect(plan.changes).toEqual([]);
    expect(plan.factoryStages).toEqual([]);
    expect(plan.certificationGates).toEqual([]);
  });

  it("keeps workspace wording changes away from imports and providers", () => {
    const current = manifest();
    const desired = parseClientManifest({ ...current, workspaceConfig: {
      enabledSurfaces: ["home", "work", "customers"],
      terminology: { home: "HQ", work: "Cases", customers: "Accounts", schedule: "Schedule", money: "Money", agents: "Agents" },
      voiceEnabled: true,
      navigationPriority: ["home", "work", "customers", "schedule", "money", "agents"],
      brand: { accent: "cyan", radius: "soft", mark: "L" },
      visibility: { policy: true, authority: true },
    } });
    const plan = buildClientImpactPlan({ currentManifest: current, desiredManifest: desired });
    expect(plan.affectedAreas).toEqual(["workspace"]);
    expect(plan.factoryStages).toEqual(["validate", "workspace_policies", "tenant_health", "ready_for_certification"]);
    expect(plan.factoryStages).not.toContain("import");
    expect(plan.factoryStages).not.toContain("integrations_credentials");
    expect(plan.certificationGates).not.toContain("import_replay_safety");
    expect(plan.certificationGates).not.toContain("tenant_provider_health");
    expect(plan.rollback).toMatchObject({ supported: true, scope: "configuration_only" });
  });

  it("invalidates credential and health gates without replaying imports", () => {
    const current = manifest();
    const desired = parseClientManifest({
      ...current,
      integrations: current.integrations.map((row) => row.capability === "communications"
        ? { ...row, binding: "vapi", mode: "sandbox", credential: { provider: "aws-secrets-manager", ref: "finnor/tenants/{tenantId}/vapi-v2" } }
        : row),
    });
    const plan = buildClientImpactPlan({ currentManifest: current, desiredManifest: desired });
    expect(plan.affectedAreas).toEqual(["integration"]);
    expect(plan.factoryStages).toContain("integrations_credentials");
    expect(plan.factoryStages).not.toContain("import");
    expect(plan.certificationGates).toEqual(expect.arrayContaining([
      "credential_references", "tenant_provider_health", "required_integrations_capabilities",
    ]));
  });

  it("reruns only the affected import key and downstream certification gates", () => {
    const current = manifest();
    const desired = parseClientManifest({
      ...current,
      imports: current.imports.map((row) => row.key === "customers"
        ? { ...row, definition: { ...row.definition, fields: { ...row.definition.fields, lastName: { from: "last", normalize: ["trim"] } } } }
        : row),
    });
    const plan = buildClientImpactPlan({ currentManifest: current, desiredManifest: desired });
    expect(plan.affectedAreas).toEqual(["import"]);
    expect(plan.affectedImportKeys).toEqual(["customers"]);
    expect(plan.factoryStages).toContain("import");
    expect(plan.certificationGates).toEqual(expect.arrayContaining([
      "import_replay_safety", "water_treatment_journeys", "evidence_receipts", "configuration_completeness",
    ]));
    expect(plan.rollback.supported).toBe(false);
    expect(plan.rollback.unsupportedAreas).toEqual(["import"]);
  });

  it("requires a fully new certification boundary for a core SHA change", () => {
    const current = manifest();
    const plan = buildClientImpactPlan({
      currentManifest: current,
      desiredManifest: current,
      currentCoreSha: "a".repeat(40),
      desiredCoreSha: "b".repeat(40),
    });
    expect(plan.affectedAreas).toEqual(["core"]);
    expect(plan.factoryStages).toEqual([]);
    expect(plan.certificationGates).toHaveLength(14);
    expect(plan.rollback.supported).toBe(false);
  });
});
