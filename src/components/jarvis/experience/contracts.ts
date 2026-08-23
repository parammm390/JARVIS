import type { InstructionState } from "../kernel/types"
import type { ExperienceProjectionKey, ExperienceRole, ExperienceScene, TenantWorkspaceConfig } from "../lib/workspace-config"

/** The complete data boundary available to trusted client overlays. It contains
 * presentation-safe state only: no database client, token, policy object, provider
 * credential, or arbitrary runtime handle crosses this seam. */
export interface TenantExtensionContext {
  role: ExperienceRole
  scene: ExperienceScene
  vocabulary: Readonly<TenantWorkspaceConfig["vocabulary"]>
  primaryProjection: ExperienceProjectionKey
  activeWork: { id: string | null; state: InstructionState } | null
}

export interface TenantOverlayProps<TConfig extends Record<string, unknown> = Record<string, unknown>> {
  context: TenantExtensionContext
  config: TConfig
}
