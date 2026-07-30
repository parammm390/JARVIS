// jarvis-v3 P5.T3 — real risk-tier derivation for a PENDING action. Verified
// from source before writing this: `action.receipt` is always null pre-
// execution (a receipt is only created at finalization, per
// `workflow-runtime/src/receipts.ts`), so `(action.receipt?.riskTier) ??
// "low"` — ApprovalCockpit.tsx's own prior logic — could never surface
// anything but "low" for any card a human actually decides on. This is the
// one real, additive source of pre-receipt risk this phase adds, scoped
// exactly to what the plan's own Architecture decision requires: "if the
// backend does not return a [bulk-notify recipient] count, the action is
// forced to high-risk typed confirmation." No other action type's tier
// logic changes — everything else still falls through to "low", unchanged.

import type { RiskTier } from "../ui/primitives/RiskBadge"

export interface RiskTierInput {
  actionType: string
  payload: unknown
  receipt?: { riskTier?: string | null } | null
}

/** The real recipient count for a `bulk_notify_existing_customers` action —
 *  `draft()` (bulk-notify/index.ts) always attaches the real, already-
 *  queried `targets` array to the payload. `null` means the field is
 *  genuinely absent/malformed (a real data problem), never "zero real
 *  matches" (a legitimate, different, known-count-of-0 case — an empty
 *  array is NOT unknown). */
export function blastRadiusRecipientCount(payload: unknown): number | null {
  if (!payload || typeof payload !== "object") return null
  const targets = (payload as Record<string, unknown>).targets
  return Array.isArray(targets) ? targets.length : null
}

export function deriveRiskTier(action: RiskTierInput): RiskTier {
  if (action.receipt?.riskTier) return action.receipt.riskTier as RiskTier
  if (action.actionType === "bulk_notify_existing_customers" && blastRadiusRecipientCount(action.payload) === null) return "high"
  return "low"
}
