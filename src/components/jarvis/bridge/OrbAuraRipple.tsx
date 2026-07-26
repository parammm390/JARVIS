"use client"

// F2.T2 — FLOW-38 OrbAuraRipple: one aura ring off the orb per REAL qualifying
// pulse-bus event, colored by the pulse's kind, throttled to at most one every
// ORB_AURA_THROTTLE_MS (3s) so a burst of real diffs still reads as one ring, not a
// strobe. "poll-landed" is deliberately excluded — it fires every fast-lane tick
// (4s) whether or not anything actually changed, so treating it as a ripple trigger
// would violate hard rule F2 ("real state or labeled state") by animating on a
// heartbeat instead of a diff.

import { useEffect, useRef, useState } from "react"
import { motion, useReducedMotion } from "framer-motion"
import { choreo } from "../ui/motion/choreo"
import { onPulse, ORB_AURA_THROTTLE_MS, type Pulse, type PulseKind } from "../lib/pulse-bus"

const RIPPLE_COLOR: Record<PulseKind, string> = {
  "business-event": "var(--j-cyan)",
  step: "var(--j-teal)",
  run: "var(--j-green)",
  pending: "var(--j-amber)",
  decision: "var(--j-violet)",
  activity: "var(--j-cyan)",
  poll: "var(--j-cyan)",
}

export function OrbAuraRipple() {
  const reduced = useReducedMotion()
  const [ring, setRing] = useState<{ id: number; kind: PulseKind } | null>(null)
  const lastFiredRef = useRef(0)
  const seqRef = useRef(0)

  useEffect(() => {
    return onPulse((pulse: Pulse) => {
      if (pulse.kind === "poll") return
      const now = Date.now()
      if (now - lastFiredRef.current < ORB_AURA_THROTTLE_MS) return
      lastFiredRef.current = now
      seqRef.current += 1
      setRing({ id: seqRef.current, kind: pulse.kind })
    })
  }, [])

  if (!ring) return null
  const v = reduced ? choreo.orbAuraRipple.reducedVariants : choreo.orbAuraRipple.variants
  return (
    <motion.span
      key={ring.id}
      aria-hidden
      variants={v}
      initial="initial"
      animate="animate"
      onAnimationComplete={() => setRing((r) => (r?.id === ring.id ? null : r))}
      className="pointer-events-none absolute inset-[-6px] rounded-full border-2"
      style={{ borderColor: RIPPLE_COLOR[ring.kind] }}
    />
  )
}
