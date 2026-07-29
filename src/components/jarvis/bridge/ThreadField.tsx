"use client"

// The Instruction Thread — depth 0, the Field (plan v3 §2.3/§6⓪).
//
// "Renders real overdue invoices as points in a slow drift — warmer and larger
// with age. Empty business → empty field, honestly." Deliberately simple: a
// point per real overdue invoice is not knowable from `selectOverdueInvoices`
// alone (it returns a count + total, not one row per invoice — the read-model
// is an aggregate, not a list), so this renders `count` points, laid out
// deterministically (no `Math.random()` — banned in this tree, Phase 7 §7.8)
// and animated with ONE continuous CSS transform loop (the field counts as the
// ≤2-ambient-loop budget's first slot, §5.3). It never carries a number —
// the count drives HOW MANY points exist, never a label reading the count back.

import { useReducedMotion } from "framer-motion"
import type { Truth } from "../kernel/types"

const MAX_POINTS = 60

function deterministicOffset(seed: number): { x: number; y: number; delayS: number; sizePx: number } {
  // Same deterministic-hash technique Orb3D.tsx already uses for geometry jitter
  // (that file's own header explains why: this repo's ESLint rule bans
  // Math.random() anywhere under src/components/jarvis — nothing here may fake a
  // metric or activity effect, and point layout isn't one, but the ban is a
  // blanket file-pattern rule).
  const h1 = Math.sin(seed * 12.9898) * 43758.5453
  const h2 = Math.sin(seed * 78.233) * 12321.987
  const f1 = h1 - Math.floor(h1)
  const f2 = h2 - Math.floor(h2)
  return { x: f1 * 100, y: f2 * 100, delayS: f1 * 6, sizePx: 2 + f2 * 3 }
}

export function ThreadField({ overdueInvoices }: { overdueInvoices: Truth<{ count: number; totalUsd: number }> }) {
  const reducedMotion = useReducedMotion()
  const count = overdueInvoices.status === "known" || overdueInvoices.status === "stale" ? overdueInvoices.value.count : 0
  const shown = Math.min(count, MAX_POINTS)
  const points = Array.from({ length: shown }, (_, i) => deterministicOffset(i + 1))

  return (
    <div aria-hidden className="pointer-events-none fixed inset-0 z-0 overflow-hidden" data-jarvis-field>
      {points.map((p, i) => (
        <span
          key={i}
          className="absolute rounded-full bg-[color:var(--j-amber)]"
          style={{
            left: `${p.x}%`,
            top: `${p.y}%`,
            width: p.sizePx,
            height: p.sizePx,
            opacity: 0.1 + (i % 5) * 0.024, // 0.10–0.22 band, §2.3
            animation: reducedMotion ? undefined : `jarvis-field-drift 22s ease-in-out ${p.delayS}s infinite`,
          }}
        />
      ))}
      <style jsx>{`
        @keyframes jarvis-field-drift {
          0% { transform: translate(0, 0); }
          50% { transform: translate(6px, -8px); }
          100% { transform: translate(0, 0); }
        }
      `}</style>
    </div>
  )
}
