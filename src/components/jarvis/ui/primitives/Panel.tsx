"use client"

// C3.T2 — Panel primitive. Every card on the page already shares the `.j-panel`
// recipe (jarvis-theme.css) applied as a raw className string at ~15 call sites —
// this is that same recipe as a component, so new C3+ work can write <Panel> instead
// of re-typing the class string, without changing how any existing panel renders
// (jarvis-theme.css is untouched).

import type { ReactNode } from "react"

export function Panel({
  children,
  className = "",
  hot = false,
  as: As = "div",
}: {
  children: ReactNode
  className?: string
  hot?: boolean
  as?: "div" | "section" | "article"
}) {
  return <As className={`j-panel ${hot ? "j-panel-hot" : ""} ${className}`}>{children}</As>
}
