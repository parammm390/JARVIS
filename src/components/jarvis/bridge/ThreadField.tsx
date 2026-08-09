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

import { useEffect, useRef, useState } from "react"
import { AnimatePresence, motion, useReducedMotion } from "framer-motion"
import type { ContextChip } from "../kernel/store"
import type { Truth } from "../kernel/types"
import { contextConstellationFlightVariants, fieldWarmExitVariants } from "../kernel/choreography"
import { getAnchorRect, registerAnchor } from "../lib/pulse-bus"

const MAX_POINTS = 60

function deterministicOffset(seed: number): { x: number; y: number; sizePx: number } {
  // Same deterministic-hash technique Orb3D.tsx already uses for geometry jitter
  // (that file's own header explains why: this repo's ESLint rule bans
  // Math.random() anywhere under src/components/jarvis — nothing here may fake a
  // metric or activity effect, and point layout isn't one, but the ban is a
  // blanket file-pattern rule).
  const h1 = Math.sin(seed * 12.9898) * 43758.5453
  const h2 = Math.sin(seed * 78.233) * 12321.987
  const f1 = h1 - Math.floor(h1)
  const f2 = h2 - Math.floor(h2)
  return { x: f1 * 100, y: f2 * 100, sizePx: 2 + f2 * 3 }
}

interface ContextFlight {
  id: string
  index: number
  source: string
  from: { left: number; top: number }
  to: { left: number; top: number }
}

function contextKey(chip: ContextChip): string {
  return `${chip.label}·${chip.source}`
}

function contextOrigin(index: number): { left: number; top: number } {
  const point = deterministicOffset(index + 97)
  return {
    left: (point.x / 100) * window.innerWidth,
    top: ((62 + point.y * 0.28) / 100) * window.innerHeight,
  }
}

export function ThreadField({
  overdueInvoices,
  contextChips = [],
  freezeMotion = false,
}: {
  overdueInvoices: Truth<{ count: number; totalUsd: number }>
  contextChips?: ContextChip[]
  /** The linked Weave owns the active motion budget; preserve the real points
   * while pausing this ambient drift underneath it. */
  freezeMotion?: boolean
}) {
  const reducedMotion = useReducedMotion()
  const [motionReady, setMotionReady] = useState(false)
  const fieldRef = useRef<HTMLDivElement | null>(null)
  const [contextFlights, setContextFlights] = useState<ContextFlight[]>([])
  const knownContextKeysRef = useRef<Set<string>>(new Set(contextChips.map(contextKey)))
  const count = overdueInvoices.status === "known" || overdueInvoices.status === "stale" ? overdueInvoices.value.count : 0
  const shown = Math.min(count, MAX_POINTS)
  const points = Array.from({ length: shown }, (_, i) => deterministicOffset(i + 1))

  useEffect(() => setMotionReady(true), [])
  useEffect(() => registerAnchor("signal-field", () => fieldRef.current?.getBoundingClientRect() ?? null), [])

  useEffect(() => {
    const fresh = contextChips.filter((chip) => !knownContextKeysRef.current.has(contextKey(chip)))
    fresh.forEach((chip) => knownContextKeysRef.current.add(contextKey(chip)))
    if (fresh.length === 0 || reducedMotion) return

    let active = true
    const frame = window.requestAnimationFrame(() => {
      if (!active) return
      const flights = fresh.flatMap((chip, batchIndex) => {
        const index = contextChips.findIndex((candidate) => contextKey(candidate) === contextKey(chip))
        const target = getAnchorRect(`instruction-context-${index}`)
        if (!target) return []
        return [{
          id: `${contextKey(chip)}·${batchIndex}`,
          index: batchIndex,
          source: chip.source,
          from: contextOrigin(index),
          to: { left: target.left + target.width / 2, top: target.top + target.height / 2 },
        }]
      })
      if (flights.length > 0) setContextFlights((current) => [...current, ...flights])
    })
    return () => {
      active = false
      window.cancelAnimationFrame(frame)
    }
  }, [contextChips, reducedMotion])

  // M17 FieldWarm (§5.3, wired P4.T5): a point that disappears (the overdue
  // count dropped — a real payment landed) fades out over 900ms EASE_IO
  // instead of vanishing on the next paint. AnimatePresence needs a stable
  // key per point to detect removal — index is stable here since points are
  // always a deterministic prefix (index 0..shown-1), so a count decrease
  // only ever removes the trailing points, never reshuffles the rest.
  const exitVariants = fieldWarmExitVariants(reducedMotion ?? false)

  return (
    <div ref={fieldRef} aria-hidden className="pointer-events-none fixed inset-0 z-0 overflow-hidden" data-jarvis-field>
      {/* One compositor loop for the field, not one loop per invoice point. The
          points remain real count-driven content; the shared drift is the only
          ambient animation this layer owns. */}
      <div className={`absolute inset-[-12px] ${motionReady && !reducedMotion && !freezeMotion ? "jarvis-field-drift" : ""}`}>
        <AnimatePresence>
          {points.map((p, i) => (
            <motion.span
              key={i}
              exit={exitVariants.exit}
              className="absolute rounded-full bg-[color:var(--j-text-faint)]"
              style={{
                left: `${p.x}%`,
                top: `${p.y}%`,
                width: p.sizePx,
                height: p.sizePx,
                opacity: 0.05 + (i % 5) * 0.01, // 0.05–0.09 neutral depth band, §4.1
              }}
            />
          ))}
        </AnimatePresence>
      </div>
      <AnimatePresence initial={false}>
        {contextFlights.map((flight) => {
          const variants = contextConstellationFlightVariants(flight.index, Boolean(reducedMotion))
          return (
            <motion.span
              key={flight.id}
              initial={{ ...variants.initial, left: flight.from.left, top: flight.from.top }}
              animate={{ ...variants.animate, left: flight.to.left, top: flight.to.top }}
              transition={variants.transition}
              onAnimationComplete={() => setContextFlights((flights) => flights.filter((candidate) => candidate.id !== flight.id))}
              aria-hidden
              data-jarvis-context-impulse
              data-source={`instruction_events.context_retrieved · ${flight.source}`}
              className="pointer-events-none fixed z-10 h-2.5 w-2.5 -translate-x-1/2 -translate-y-1/2 rounded-full bg-cyan-100 shadow-[0_0_22px_rgba(103,232,249,0.82)]"
            />
          )
        })}
      </AnimatePresence>
      <style jsx>{`
        @keyframes jarvis-field-drift {
          0%, 100% { transform: translate3d(0, 0, 0); }
          50% { transform: translate3d(6px, -8px, 0); }
        }
      `}</style>
    </div>
  )
}
