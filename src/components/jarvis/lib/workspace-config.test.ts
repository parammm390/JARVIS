import { describe, expect, it } from "vitest"
import { DEFAULT_TENANT_WORKSPACE_CONFIG, inspectorFieldVisible, normalizeWorkspaceConfig, orderedWorkspaceItems } from "./workspace-config"

describe("tenant workspace config", () => {
  it("fails closed to a complete default when navigation would strand Home", () => {
    expect(normalizeWorkspaceConfig({ enabledSurfaces: ["work"], navigationPriority: ["home", "work", "customers", "schedule", "money", "agents"] })).toEqual(DEFAULT_TENANT_WORKSPACE_CONFIG)
  })

  it("orders and filters existing surfaces without inventing routes", () => {
    const config = normalizeWorkspaceConfig({
      ...DEFAULT_TENANT_WORKSPACE_CONFIG,
      enabledSurfaces: ["home", "money", "work"],
      navigationPriority: ["home", "money", "work", "customers", "schedule", "agents"],
    })
    expect(orderedWorkspaceItems([{ key: "work" as const }, { key: "home" as const }, { key: "money" as const }], config).map((item) => item.key)).toEqual(["home", "money", "work"])
  })

  it("treats policy and authority visibility as presentation only", () => {
    const config = normalizeWorkspaceConfig({ ...DEFAULT_TENANT_WORKSPACE_CONFIG, visibility: { policy: false, authority: false } })
    expect(inspectorFieldVisible("Policy / permission", config)).toBe(false)
    expect(inspectorFieldVisible("Authority boundary", config)).toBe(false)
    expect(inspectorFieldVisible("What happened", config)).toBe(true)
  })
})
