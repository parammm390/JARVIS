// D3.T1 — shared types for the action-type renderer registry. Root `src/` never
// imports finnor-os's zod schemas directly (no cross-workspace type dependency exists
// anywhere in this codebase today, grepped, confirmed — jarvis-client's generated
// OpenAPI types are the only backend-shape bridge) so each of the 44 action types'
// field lists are hand-encoded here from the real schemas (packages/domain-plugins/*),
// read file-by-file, not guessed.

import type { ComponentType } from "react"
import { CERTIFIED_ACTION_STATES, type CertifiedActionState } from "./action-state-contract"

// P2.T8 (§7.2): "interactive" is `clarification_request`'s own tier — highest
// priority in the product per §7.2's own renderer table, and deliberately
// distinct from "flagship" (a designed business-action scene) since a
// clarification is a question, not a gated action.
export type RendererTier = "flagship" | "standard" | "interactive" | "fallback"

/** How a StandardRenderer field should format its value. Never "raw" — every kind
 *  renders through a real formatter (see fields.ts), so an unmapped field kind is a
 *  bug to fix, not an escape hatch back to JSON.stringify. */
export type FieldKind =
  | "text"
  | "longtext"
  | "phone"
  | "email"
  | "currency"
  | "number"
  | "enum"
  | "date"
  | "boolean"
  | "uuid"

export interface FieldSpec {
  key: string
  label: string
  kind: FieldKind
}

export interface ActionRendererProps {
  actionType: string
  payload: unknown
  /** Compact mode: feed rows and approval-card previews get a one-line summary
   *  instead of the full field list / scene chrome. Every renderer must honor this —
   *  it's what lets the SAME component prove out in feed + approval + receipt
   *  contexts (the plan's own EXIT GATE wording) rather than needing 3 near-duplicate
   *  versions per type. */
  compact?: boolean
}

export interface RegistryEntry {
  tier: RendererTier
  /** Plugin dir name (packages/domain-plugins/<plugin>), drives PluginMeta's icon/
   *  color — not a display label by itself. */
  plugin: string
  label: string
  /** Standard tier only — flagship components own their own field layout. */
  fields?: FieldSpec[]
  /** Flagship tier only. */
  Component?: ComponentType<ActionRendererProps>
  /** A representative payload matching the real zod schema, used by the Stage
   *  catalog and nowhere else — never fed to a live context. */
  fixture: unknown
  /** State coverage is explicit so certified paths never silently fall back for a
   * pending, approved, executing, completed, failed, or blocked action. */
  states: readonly CertifiedActionState[]
}

export { CERTIFIED_ACTION_STATES }
