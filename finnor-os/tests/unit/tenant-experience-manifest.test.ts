import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import { DEFAULT_WORKSPACE_CONFIG, TenantExperienceManifestV2Schema, WorkspaceConfigSchema } from "../../apps/api/lib/workspace-config";
import { parseClientManifest } from "../../scripts/client-manifest";

const references = [
  "docs/reference-tenants/northstar-service.reference.json",
  "docs/reference-tenants/summit-installations.reference.json",
] as const;

describe("Tenant Experience Manifest V2", () => {
  it("normalizes the legacy aggregate forward through the canonical server schema", () => {
    const parsed = WorkspaceConfigSchema.parse({
      enabledSurfaces: ["home", "work", "customers"],
      terminology: { home: "HQ", work: "Cases", customers: "Accounts", schedule: "Schedule", money: "Money", agents: "Agents" },
      voiceEnabled: false,
      navigationPriority: ["home", "work", "customers", "schedule", "money", "agents"],
      brand: { accent: "teal", radius: "precise", mark: "AC" },
      visibility: { policy: false, authority: true },
    });
    expect(parsed).toMatchObject({ version: 2, enabledSurfaces: ["home", "work", "customers"], terminology: { work: "Cases" }, brand: { accent: "teal", mark: "AC" } });
    expect(parsed.roles.dispatcher.visibleSurfaces).toEqual(["home", "work", "customers"]);
  });

  it("rejects unregistered metrics, actions, extensions, slots, assets, and role projections", () => {
    const invalidCases: unknown[] = [];
    const metric = structuredClone(DEFAULT_WORKSPACE_CONFIG) as any; metric.roles.dispatcher.ready.pulseMetrics = ["collected_usd"]; invalidCases.push(metric);
    const action = structuredClone(DEFAULT_WORKSPACE_CONFIG) as any; action.roles.technician.ready.quickActions = [{ key: "review_pipeline" }]; invalidCases.push(action);
    const projection = structuredClone(DEFAULT_WORKSPACE_CONFIG) as any; projection.roles.technician.ready.primaryProjection = "money"; invalidCases.push(projection);
    const extension = structuredClone(DEFAULT_WORKSPACE_CONFIG) as any; extension.extensions["working.visual"] = { key: "reference.northstar-service-priority", config: {} }; invalidCases.push(extension);
    const unknown = structuredClone(DEFAULT_WORKSPACE_CONFIG) as any; unknown.extensions["ready.primary"] = { key: "client.arbitrary-code", config: {} }; invalidCases.push(unknown);
    const asset = structuredClone(DEFAULT_WORKSPACE_CONFIG) as any; asset.brand.logoAssetKey = "https://example.test/logo.svg"; invalidCases.push(asset);
    for (const candidate of invalidCases) expect(TenantExperienceManifestV2Schema.safeParse(candidate).success).toBe(false);
  });

  it("parses two materially different, secret-free reference tenants with the same contract", async () => {
    const parsed = await Promise.all(references.map(async (path) => parseClientManifest(JSON.parse(await readFile(path, "utf8")))));
    expect(parsed.map((manifest) => manifest.workspaceConfig?.version)).toEqual([2, 2]);
    expect(parsed[0]!.workspaceConfig?.brand).not.toEqual(parsed[1]!.workspaceConfig?.brand);
    expect(parsed[0]!.workspaceConfig?.roles.owner.ready.primaryFocus).toBe("service");
    expect(parsed[1]!.workspaceConfig?.roles.owner.ready.primaryFocus).toBe("inventory");
    expect(JSON.stringify(parsed)).not.toMatch(/password|accessToken|refreshToken|apiKey|privateKey/i);
  });
});
