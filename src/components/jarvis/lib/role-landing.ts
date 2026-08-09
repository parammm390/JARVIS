import type { JarvisRole } from "./jarvis-auth"

/** Values accepted by the existing user-prefs route. `schedule` is deliberately
 * not added here: it is the v6 role default, not a new persisted preference. */
export type SavedHomepage = "bridge" | "map" | "my-day" | null | undefined

export type RoleLanding = "home" | "schedule" | "dispatch-map" | "my-day"

export const DEFAULT_ROLE_LANDING: Record<JarvisRole, RoleLanding> = {
  owner: "home",
  dispatcher: "schedule",
  technician: "my-day",
}

/**
 * Selects only a source-supported role scene. The only saved override that is
 * valid for a dispatcher in the current preference contract is `map`; a stale
 * or cross-role value falls back to the v6 default. Owner preferences never
 * replace the canonical Home command canvas, and no role outside /api/me's
 * three-value contract is accepted here.
 */
export function roleLandingFor(role: JarvisRole, savedHomepage: SavedHomepage): RoleLanding {
  if (role === "owner") return DEFAULT_ROLE_LANDING.owner
  if (role === "dispatcher" && savedHomepage === "map") return "dispatch-map"
  return DEFAULT_ROLE_LANDING[role]
}
