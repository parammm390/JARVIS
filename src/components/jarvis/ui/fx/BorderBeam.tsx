"use client"

// C3.T1 — border-beam fx entry. The animation itself already shipped as C2.T2's
// FLOW-17 (`.jarvis-border-beam` in jarvis-theme.css, conic-gradient sweep, already
// reduced-motion-safe via that file's own media query) — this is the reusable
// component wrapper so callers don't need to know the raw class name, matching how
// the other fx/ entries are consumed.

import type { ReactNode } from "react"

export function BorderBeam({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <div className={`jarvis-border-beam ${className}`}>{children}</div>
}
