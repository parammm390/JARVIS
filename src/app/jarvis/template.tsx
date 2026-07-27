"use client"

// F7.T1 — FLOW-94 RouteHandoff: a 250ms caustic wipe veil on real /jarvis/* route
// changes. `template.tsx` (unlike `layout.tsx`, which stays put across navigation —
// see layout.tsx's own header, mounting VapiSessionProvider exactly once) is
// remounted by Next.js on every navigation into a new segment, which is the honest
// mechanism for "fires on route change" without a Shell/layout refactor (hard rule
// F7/#8 — the legacy Shell and its ~15 panels stay snapshot-protected, untouched by
// this session).
//
// Scope note (flow-index.ts): orb continuity is NOT this veil's job — Orb3D already
// persists across Bridge scene switches because it lives in Bridge.tsx's LeftRail,
// outside the AnimatePresence keyed by `scene` (bridge/Bridge.tsx's CenterStage).
// Full cross-route shared-element persistence stays deferred until the legacy Shell
// is strangled, per the plan's own honest scope line for this FLOW id.

import { useEffect, useState, type ReactNode } from "react"
import { motion, useReducedMotion } from "framer-motion"
import { choreo } from "@/components/jarvis/ui/motion/choreo"

// Session-scoped, not per-mount: the very first /jarvis/* load of a browser tab is
// a cold boot (Bridge already has its own FLOW-44 BridgeBoot intro for that moment,
// bridge/Bridge.tsx's BRIDGE_BOOT_SESSION_KEY), not a "handoff" between two already-
// rendered routes — playing the wipe on that first paint too would be a fabricated
// transition, not a real one. Every template remount AFTER that first one is a
// genuine client-side navigation, and gets the real veil.
const ROUTE_HANDOFF_SEEN_KEY = "jarvis_route_handoff_seen"
const HANDOFF_MS = 250

function RouteHandoffVeil() {
  const reducedRaw = useReducedMotion()
  const reduced = reducedRaw ?? false
  const [visible, setVisible] = useState(false)

  useEffect(() => {
    let alreadyHandedOff = false
    try {
      alreadyHandedOff = window.sessionStorage.getItem(ROUTE_HANDOFF_SEEN_KEY) === "1"
      window.sessionStorage.setItem(ROUTE_HANDOFF_SEEN_KEY, "1")
    } catch {
      // sessionStorage unavailable (private mode) — honest degrade: skip the veil
      // rather than crash or fabricate a navigation that may not be real.
      return
    }
    if (!alreadyHandedOff) return
    setVisible(true)
    const t = window.setTimeout(() => setVisible(false), reduced ? 0 : HANDOFF_MS)
    return () => window.clearTimeout(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  if (!visible) return null
  return (
    <motion.div
      aria-hidden
      data-flow="94-route-handoff"
      className="pointer-events-none fixed inset-0 z-[80]"
      variants={reduced ? choreo.routeHandoff.reducedVariants : choreo.routeHandoff.variants}
      initial="initial"
      animate="animate"
      style={{ background: "linear-gradient(180deg, rgba(8,14,24,0.94) 0%, rgba(8,14,24,0.55) 100%)" }}
    />
  )
}

export default function JarvisTemplate({ children }: { children: ReactNode }) {
  return (
    <>
      <RouteHandoffVeil />
      {children}
    </>
  )
}
