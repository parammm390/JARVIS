"use client"

// C3.T2 — RiskBadge, the plan's literal spec: "materials: green glass / amber steel
// / red obsidian". ReceiptDrawer/ApprovalDock today render risk tier as a plain
// `bg-white/8` pill (grepped, confirmed no material treatment exists yet) — this is
// new, real material work, not an extraction. Three distinct surface treatments:
// glass (translucent + blur, low tier — nothing to guard against, see-through),
// steel (brushed metal gradient bands, medium — solid, load-bearing), obsidian
// (glossy near-black + specular sheen, high — heavy, stops you). D2's approval cards
// are the real future consumer; this ships the primitive + Stage proof now.

import type { ReactNode } from "react"

export type RiskTier = "low" | "medium" | "high"

const MATERIAL: Record<RiskTier, { style: React.CSSProperties; label: string; text: string }> = {
  low: {
    label: "low risk",
    text: "#a7f3d0",
    style: {
      background: "linear-gradient(135deg, rgba(52,211,153,0.22), rgba(52,211,153,0.06))",
      border: "1px solid rgba(52,211,153,0.35)",
      backdropFilter: "blur(6px)",
      boxShadow: "var(--j-glow-green)",
    },
  },
  medium: {
    label: "medium risk",
    text: "#1c1206",
    style: {
      background: "linear-gradient(180deg, #fde68a 0%, #f5b942 38%, #d69511 62%, #fde68a 100%)",
      border: "1px solid rgba(120, 76, 6, 0.5)",
      boxShadow: "inset 0 1px 0 rgba(255,255,255,0.55), inset 0 -1px 0 rgba(0,0,0,0.25), var(--j-glow-amber)",
    },
  },
  high: {
    label: "high risk",
    text: "#fecaca",
    style: {
      background: "radial-gradient(120% 140% at 30% 0%, rgba(255,255,255,0.14) 0%, transparent 40%), linear-gradient(160deg, #2a0a0a 0%, #120404 70%)",
      border: "1px solid rgba(248,113,113,0.45)",
      boxShadow: "inset 0 1px 0 rgba(255,255,255,0.08), var(--j-glow-red)",
    },
  },
}

export function RiskBadge({ tier, children }: { tier: RiskTier; children?: ReactNode }) {
  const m = MATERIAL[tier]
  return (
    <span
      className="inline-flex items-center rounded-full px-2.5 py-0.5 text-[10px] font-black uppercase tracking-wide"
      style={{ ...m.style, color: m.text }}
    >
      {children ?? m.label}
    </span>
  )
}
