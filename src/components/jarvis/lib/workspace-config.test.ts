import { describe, expect, it } from "vitest"
import { DEFAULT_TENANT_WORKSPACE_CONFIG, effectiveMotionPreference, inspectorFieldVisible, normalizeWorkspaceConfig, orderedWorkspaceItems, sceneSlot, vocabularyLabel } from "./workspace-config"

describe("tenant workspace config", () => {
  it("fails closed to a complete default when navigation would strand Home", () => {
    expect(normalizeWorkspaceConfig({ enabledSurfaces: ["work"], navigationPriority: ["home", "work", "customers", "schedule", "money", "agents"] })).toEqual(DEFAULT_TENANT_WORKSPACE_CONFIG)
  })

  it("orders and filters existing surfaces without inventing routes", () => {
    const config = normalizeWorkspaceConfig({
      ...DEFAULT_TENANT_WORKSPACE_CONFIG,
      enabledSurfaces: ["home", "money", "work"],
      navigationPriority: ["home", "money", "work", "customers", "schedule", "agents"],
      roles: {
        ...DEFAULT_TENANT_WORKSPACE_CONFIG.roles,
        owner: { ...DEFAULT_TENANT_WORKSPACE_CONFIG.roles.owner, visibleSurfaces: ["home", "money", "work"] },
        dispatcher: { ...DEFAULT_TENANT_WORKSPACE_CONFIG.roles.dispatcher, visibleSurfaces: ["home", "work"] },
        technician: { ...DEFAULT_TENANT_WORKSPACE_CONFIG.roles.technician, visibleSurfaces: ["home", "work"] },
      },
    })
    expect(orderedWorkspaceItems([{ key: "work" as const }, { key: "home" as const }, { key: "money" as const }], config).map((item) => item.key)).toEqual(["home", "money", "work"])
  })

  it("normalizes the legacy workspace shape forward without losing tenant wording", () => {
    const config = normalizeWorkspaceConfig({
      enabledSurfaces: ["home", "work", "customers"],
      terminology: { home: "HQ", work: "Cases", customers: "Accounts", schedule: "Schedule", money: "Money", agents: "Agents" },
      voiceEnabled: false,
      navigationPriority: ["home", "work", "customers", "schedule", "money", "agents"],
      brand: { accent: "teal", radius: "precise", mark: "AC" },
      visibility: { policy: false, authority: true },
    })
    expect(config).toMatchObject({ version: 2, enabledSurfaces: ["home", "work", "customers"], terminology: { work: "Cases" }, brand: { accent: "teal", mark: "AC" } })
    expect(config.roles.dispatcher.visibleSurfaces).toEqual(["home", "work", "customers"])
  })

  it("keeps vocabulary and scene preferences presentation-only and bounded", () => {
    const config = { ...DEFAULT_TENANT_WORKSPACE_CONFIG, vocabulary: { ...DEFAULT_TENANT_WORKSPACE_CONFIG.vocabulary, serviceVisit: "Service Call" } }
    expect(vocabularyLabel("service_visit", config)).toBe("Service Call")
    expect(vocabularyLabel("unregistered_object", config)).toBe("Unregistered Object")
    expect(sceneSlot("approval")).toBe("approval.context")
    expect(sceneSlot("listening")).toBeNull()
    expect(effectiveMotionPreference("expressive", true)).toBe("reduced")
  })

  it("applies role visibility after the tenant-wide allowlist", () => {
    const config = { ...DEFAULT_TENANT_WORKSPACE_CONFIG, roles: { ...DEFAULT_TENANT_WORKSPACE_CONFIG.roles, technician: { ...DEFAULT_TENANT_WORKSPACE_CONFIG.roles.technician, visibleSurfaces: ["home", "schedule"] as Array<"home" | "schedule"> } } }
    const items = [{ key: "work" as const }, { key: "home" as const }, { key: "schedule" as const }, { key: "money" as const }]
    expect(orderedWorkspaceItems(items, config, "technician").map((item) => item.key)).toEqual(["home", "schedule"])
  })

  it("treats policy and authority visibility as presentation only", () => {
    const config = normalizeWorkspaceConfig({ ...DEFAULT_TENANT_WORKSPACE_CONFIG, visibility: { policy: false, authority: false } })
    expect(inspectorFieldVisible("Policy / permission", config)).toBe(false)
    expect(inspectorFieldVisible("Authority boundary", config)).toBe(false)
    expect(inspectorFieldVisible("What happened", config)).toBe(true)
  })
})
