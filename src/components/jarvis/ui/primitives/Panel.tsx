"use client"

// C3.T2 — Panel primitive. Every card on the page already shares the `.j-panel`
// recipe (jarvis-theme.css) applied as a raw className string at ~15 call sites —
// this is that same recipe as a component, so new C3+ work can write <Panel> instead
// of re-typing the class string, without changing how any existing panel renders
// (jarvis-theme.css is untouched).
//
// F1.T1 — `tier` (E0-E4, ui/codex.ts) lets callers declare elevation explicitly.
// Default is "E2", which renders IDENTICAL output to pre-F1 Panel (still just
// `j-panel` + optional `j-panel-hot`) — existing call sites get zero visual change,
// snapshot-verified in F1.T5. Only E1/E3/E0/E4 change the className/inline style.

import type { CSSProperties, ReactNode } from "react"
import { ELEVATION, type ElevationTier } from "../codex"

export function Panel({
  children,
  className = "",
  hot = false,
  as: As = "div",
  tier = "E2",
}: {
  children: ReactNode
  className?: string
  hot?: boolean
  as?: "div" | "section" | "article"
  tier?: ElevationTier
}) {
  if (tier === "E2") {
    return <As className={`j-panel ${hot ? "j-panel-hot" : ""} ${className}`}>{children}</As>
  }
  const spec = ELEVATION[tier]
  const style: CSSProperties = {
    border: spec.border,
    backdropFilter: spec.blur === "none" ? undefined : `blur(${spec.blur})`,
    boxShadow: hot ? ELEVATION.E3.shadow : spec.shadow,
    borderRadius: tier === "E0" ? undefined : "1.25rem",
  }
  return (
    <As className={`${tier === "E0" ? "" : "relative"} ${tier === "E3" ? "j-hud" : ""} ${className}`} style={style} data-elevation={tier}>
      {children}
    </As>
  )
}
