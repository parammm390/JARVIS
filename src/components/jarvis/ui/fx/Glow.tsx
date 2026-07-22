"use client"

// C3.T1 — tier-colored layered glow. Same GLOW_SHADOW vocabulary atmosphere.tsx's
// <Glass> uses (imported, not re-defined), so a badge/button/card glow always means
// the same physical intensity as a Glass panel's glow. Pure CSS box-shadow — no
// animation, so it needs no reduced-motion branch.

import type { ReactNode } from "react"
import { GLOW_SHADOW } from "../../atmosphere"

export type GlowTier = "cyan" | "teal" | "green" | "red" | "amber" | "none"

export function Glow({
  tier,
  children,
  className = "",
  inline = false,
}: {
  tier: GlowTier
  children: ReactNode
  className?: string
  inline?: boolean
}) {
  return (
    <div
      className={`${inline ? "inline-flex" : "flex"} rounded-[inherit] ${className}`}
      style={{ boxShadow: GLOW_SHADOW[tier], transition: "box-shadow 0.3s ease" }}
    >
      {children}
    </div>
  )
}
