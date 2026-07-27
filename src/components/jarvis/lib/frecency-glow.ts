// F10.T1 — FLOW-99 FrecencyGlow. Pure warmth math over the REAL D6.T3 frecency
// store (`lib/frecency.ts`'s `scoreFrecency`) — no new data, just a presentation
// mapping so `bridge/Bridge.tsx`'s nav (the same store that already drives
// `rankPanels`/"Ready next") can warm its most-used entries. Static (no animation,
// no new ambient loop): color only, per the plan's own "no tint" reduced fallback —
// this file has nothing to gate on reduced-motion because it never animates.
import type { CSSProperties } from "react"
import { scoreFrecency, type FrecencyLedger } from "./frecency"

const WARM_THRESHOLD = 0.15

/** 0 when this id has no meaningful score relative to the leader, otherwise a
 *  0..1 warmth normalized against the ledger's own current max — "most-used
 *  warm subtly, rare stay cool," never an absolute/arbitrary scale. */
export function frecencyWarmth(id: string, ledger: FrecencyLedger, now: number): number {
  const scores = Object.keys(ledger).map((key) => scoreFrecency(ledger[key], now))
  const max = scores.length > 0 ? Math.max(...scores) : 0
  if (max <= 0) return 0
  const raw = scoreFrecency(ledger[id], now) / max
  return raw < WARM_THRESHOLD ? 0 : raw
}

/** Inline style for a warmth value — cyan border/background tint scaling with
 *  the score, "no tint" at 0. Kept as plain rgba (not a Tailwind class) since the
 *  opacity is continuous, not one of the design system's fixed steps. */
export function frecencyGlowStyle(warmth: number): CSSProperties {
  if (warmth <= 0) return {}
  return {
    borderColor: `rgba(34, 211, 238, ${(0.12 + warmth * 0.28).toFixed(3)})`,
    backgroundColor: `rgba(34, 211, 238, ${(warmth * 0.06).toFixed(3)})`,
  }
}
