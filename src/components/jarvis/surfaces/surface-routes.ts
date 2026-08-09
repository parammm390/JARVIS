export type OperationalSurface = "home" | "work" | "customers" | "schedule" | "money" | "agents"

export interface HouseholdContext {
  id: string
  label: string
}

export const SURFACES: Array<{ key: OperationalSurface; label: string; href: string }> = [
  { key: "home", label: "Home", href: "/jarvis" },
  { key: "work", label: "Work", href: "/jarvis/work" },
  { key: "customers", label: "Customers", href: "/jarvis/customers" },
  { key: "schedule", label: "Schedule", href: "/jarvis/schedule" },
  { key: "money", label: "Money", href: "/jarvis/money" },
  { key: "agents", label: "Agents", href: "/jarvis/agents" },
]

export const MOBILE_SURFACES = SURFACES.filter((surface) => surface.key !== "customers" && surface.key !== "agents")

export function withHouseholdContext(href: string, context: HouseholdContext | undefined): string {
  if (!context) return href
  return `${href}?householdId=${encodeURIComponent(context.id)}`
}

export function withHouseholdId(href: string, householdId: string | null): string {
  return withHouseholdContext(href, householdId ? { id: householdId, label: "" } : undefined)
}
