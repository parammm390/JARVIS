"use client"

// C2.T1 — FLOW motion primitives: <Enter> <Stagger> <Ticker> <Flight> <Press> +
// choreo.* helpers (choreo.ts, same directory). Every FLOW-01..25 catalog entry is
// built by composing these five, never a bespoke one-off motion component per
// screen — that's the point of naming them here once. Reduced-motion is handled
// INSIDE these primitives (hard rule #10) via framer-motion's own useReducedMotion,
// which reads the OS/browser prefers-reduced-motion setting — callers never need
// their own media-query branch.

import { useEffect, useRef, useState, type ReactNode } from "react"
import { motion, useReducedMotion, useMotionValue, useSpring, animate, type Transition } from "framer-motion"
import { DURATION, SPRING, EASE } from "./tokens"

// ---- <Enter> — FLOW-01 PanelSurface building block: translateY 12→0 + fade, soft
// spring. Reduced motion: fade only, no transform. ----
export function Enter({
  children,
  delay = 0,
  y = 12,
  className,
}: {
  children: ReactNode
  delay?: number
  y?: number
  className?: string
}) {
  const reduced = useReducedMotion()
  return (
    <motion.div
      className={className}
      initial={{ opacity: 0, y: reduced ? 0 : y }}
      animate={{ opacity: 1, y: 0 }}
      transition={reduced ? { duration: DURATION.fast, delay } : { ...SPRING.soft, delay }}
    >
      {children}
    </motion.div>
  )
}

// ---- <Stagger> — FLOW-02 CascadeStagger: children fade/slide in with a fixed
// per-item delay offset (30ms per plan spec). Reduced motion: all children appear
// at once, no cascade. ----
export function Stagger({
  children,
  staggerMs = 30,
  className,
}: {
  children: ReactNode[]
  staggerMs?: number
  className?: string
}) {
  const reduced = useReducedMotion()
  return (
    <div className={className}>
      {children.map((child, i) => (
        <Enter key={i} delay={reduced ? 0 : (i * staggerMs) / 1000}>
          {child}
        </Enter>
      ))}
    </div>
  )
}

// ---- <Ticker> — FLOW-03 OdometerTicker: numeric value rolls (600ms) when it
// changes rather than snapping. Reduced motion: value swaps instantly, no roll. ----
export function Ticker({
  value,
  format = (v: number) => String(Math.round(v)),
  className,
}: {
  value: number
  format?: (v: number) => string
  className?: string
}) {
  const reduced = useReducedMotion()
  const motionValue = useMotionValue(value)
  const spring = useSpring(motionValue, { duration: reduced ? 0 : 0.6 })
  const [display, setDisplay] = useState(format(value))

  useEffect(() => {
    if (reduced) {
      setDisplay(format(value))
      motionValue.set(value)
      return
    }
    motionValue.set(value)
  }, [value, reduced, format, motionValue])

  useEffect(() => {
    const unsub = spring.on("change", (v) => setDisplay(format(v)))
    return unsub
  }, [spring, format])

  return (
    <span className={className} data-flow="03-odometer-ticker">
      {display}
    </span>
  )
}

// ---- <Flight> — FLOW-13 FlyToDock: shared-layout-id flight between two mount
// points. Wraps framer-motion's own layoutId mechanism (the plan's literal spec:
// "layoutId flight"). Reduced motion: reposition with a plain fade, no shared-layout
// tween. ----
export function Flight({
  layoutId,
  children,
  className,
}: {
  layoutId: string
  children: ReactNode
  className?: string
}) {
  const reduced = useReducedMotion()
  return (
    <motion.div
      layoutId={layoutId}
      layout={!reduced}
      className={className}
      transition={reduced ? { duration: DURATION.fast } : SPRING.stiff}
      initial={reduced ? { opacity: 0 } : false}
      animate={{ opacity: 1 }}
    >
      {children}
    </motion.div>
  )
}

// ---- <Press> — FLOW-04 RipplePress: a radial ripple centered on the pointer-down
// point, 400ms. Reduced motion: no ripple, just the caller's own :active state. ----
export function Press({
  children,
  className,
  onPress,
  rippleColor = "rgba(34, 211, 238, 0.35)",
}: {
  children: ReactNode
  className?: string
  onPress?: () => void
  rippleColor?: string
}) {
  const reduced = useReducedMotion()
  const [ripples, setRipples] = useState<{ id: number; x: number; y: number }[]>([])
  const seq = useRef(0)

  function handlePointerDown(e: React.PointerEvent<HTMLDivElement>) {
    onPress?.()
    if (reduced) return
    const rect = e.currentTarget.getBoundingClientRect()
    const id = seq.current++
    setRipples((prev) => [...prev, { id, x: e.clientX - rect.left, y: e.clientY - rect.top }])
    window.setTimeout(() => setRipples((prev) => prev.filter((r) => r.id !== id)), 400)
  }

  return (
    <div className={`relative overflow-hidden ${className ?? ""}`} onPointerDown={handlePointerDown} data-flow="04-ripple-press">
      {children}
      {ripples.map((r) => (
        <motion.span
          key={r.id}
          className="pointer-events-none absolute rounded-full"
          style={{ left: r.x, top: r.y, background: rippleColor, translateX: "-50%", translateY: "-50%" }}
          initial={{ width: 0, height: 0, opacity: 0.6 }}
          animate={{ width: 220, height: 220, opacity: 0 }}
          transition={{ duration: DURATION.slow, ease: EASE.decelerate }}
        />
      ))}
    </div>
  )
}

export { motion, useReducedMotion, animate }
export type { Transition }
