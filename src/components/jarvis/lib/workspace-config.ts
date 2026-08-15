export type WorkspaceSurfaceKey = "home" | "work" | "customers" | "schedule" | "money" | "agents"
export type WorkspaceAccent = "cyan" | "teal" | "amber" | "violet"

export interface TenantWorkspaceConfig {
  enabledSurfaces: WorkspaceSurfaceKey[]
  terminology: Record<WorkspaceSurfaceKey, string>
  voiceEnabled: boolean
  navigationPriority: WorkspaceSurfaceKey[]
  brand: { accent: WorkspaceAccent; radius: "precise" | "soft"; mark: string }
  visibility: { policy: boolean; authority: boolean }
}

export const WORKSPACE_SURFACES: WorkspaceSurfaceKey[] = ["home", "work", "customers", "schedule", "money", "agents"]

export const DEFAULT_TENANT_WORKSPACE_CONFIG: TenantWorkspaceConfig = {
  enabledSurfaces: [...WORKSPACE_SURFACES],
  terminology: { home: "Home", work: "Work", customers: "Customers", schedule: "Schedule", money: "Money", agents: "Agents" },
  voiceEnabled: true,
  navigationPriority: [...WORKSPACE_SURFACES],
  brand: { accent: "cyan", radius: "soft", mark: "F" },
  visibility: { policy: true, authority: true },
}

function isSurface(value: unknown): value is WorkspaceSurfaceKey {
  return typeof value === "string" && WORKSPACE_SURFACES.includes(value as WorkspaceSurfaceKey)
}

export function normalizeWorkspaceConfig(value: unknown): TenantWorkspaceConfig {
  if (!value || typeof value !== "object" || Array.isArray(value)) return DEFAULT_TENANT_WORKSPACE_CONFIG
  const candidate = value as Partial<TenantWorkspaceConfig>
  const enabled = Array.isArray(candidate.enabledSurfaces) ? Array.from(new Set(candidate.enabledSurfaces.filter(isSurface))) : []
  const priority = Array.isArray(candidate.navigationPriority) ? Array.from(new Set(candidate.navigationPriority.filter(isSurface))) : []
  if (!enabled.includes("home") || priority.length !== WORKSPACE_SURFACES.length) return DEFAULT_TENANT_WORKSPACE_CONFIG
  const terminology = candidate.terminology && typeof candidate.terminology === "object"
    ? Object.fromEntries(WORKSPACE_SURFACES.map((key) => {
        const term = candidate.terminology?.[key]
        return [key, typeof term === "string" && term.trim() ? term.trim().slice(0, 24) : DEFAULT_TENANT_WORKSPACE_CONFIG.terminology[key]]
      })) as Record<WorkspaceSurfaceKey, string>
    : DEFAULT_TENANT_WORKSPACE_CONFIG.terminology
  const accent = ["cyan", "teal", "amber", "violet"].includes(candidate.brand?.accent ?? "") ? candidate.brand!.accent : "cyan"
  const radius = candidate.brand?.radius === "precise" ? "precise" : "soft"
  const mark = typeof candidate.brand?.mark === "string" && candidate.brand.mark.trim() ? candidate.brand.mark.trim().slice(0, 3) : "F"
  return {
    enabledSurfaces: enabled,
    terminology,
    voiceEnabled: candidate.voiceEnabled !== false,
    navigationPriority: priority,
    brand: { accent, radius, mark },
    visibility: { policy: candidate.visibility?.policy !== false, authority: candidate.visibility?.authority !== false },
  }
}

export function orderedWorkspaceItems<T extends { key: WorkspaceSurfaceKey }>(items: T[], config: TenantWorkspaceConfig): T[] {
  const byKey = new Map(items.map((item) => [item.key, item]))
  return config.navigationPriority.flatMap((key) => config.enabledSurfaces.includes(key) && byKey.has(key) ? [byKey.get(key)!] : [])
}

export function inspectorFieldVisible(label: string, config: TenantWorkspaceConfig): boolean {
  const normalized = label.toLocaleLowerCase()
  if (!config.visibility.policy && normalized.includes("policy")) return false
  if (!config.visibility.authority && (normalized.includes("authority") || normalized.includes("permission"))) return false
  return true
}
