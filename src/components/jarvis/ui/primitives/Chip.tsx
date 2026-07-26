"use client"

// F1.T4 — `.j-chip` (jarvis-theme.css) is already applied as a raw className string
// at 19+ call sites with hand-picked color combos (grepped 2026-07-27: amber/blue/
// cyan/emerald/teal/violet/white variants, some bordered, some not). Chip
// consolidates those combos into a `tone` enum so new call sites reach for one
// component instead of re-typing a bg/text pair; existing call sites are swapped
// only where F1.T4 lists them as snapshot-safe (mechanical, pixel-identical).

import type { ReactNode } from "react"

export type ChipTone = "cyan" | "teal" | "green" | "amber" | "violet" | "blue" | "neutral" | "outline"

const TONE_CLASS: Record<ChipTone, string> = {
  cyan: "bg-cyan-400/12 text-cyan-300",
  teal: "bg-teal-400/12 text-teal-300",
  green: "bg-emerald-400/12 text-emerald-300",
  amber: "bg-amber-300/12 text-amber-100",
  violet: "bg-violet-400/12 text-violet-300",
  blue: "bg-blue-400/10 text-blue-300/80",
  neutral: "bg-white/5 text-[color:var(--j-text-dim)]",
  outline: "border border-white/10 bg-white/[.035] text-[color:var(--j-text-dim)]",
}

export function Chip({
  children,
  tone = "neutral",
  className = "",
  as: As = "span",
  ...rest
}: {
  children: ReactNode
  tone?: ChipTone
  className?: string
  as?: "span" | "button"
} & React.ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <As className={`j-chip ${TONE_CLASS[tone]} ${className}`} {...(As === "button" ? rest : {})}>
      {children}
    </As>
  )
}
