"use client"

// D3.T2 — flagship 4/8: inventory plugin's 3 action types (check_stock_level,
// flag_reorder_needed, log_stock_used_on_visit) share one scene, keyed by whichever
// real fields are present. "Tanks drain/fill (FLOW-05), thresholds, reorder diff."
//
// Real shape note: only `log_stock_used_on_visit`'s draft payload carries a numeric
// `quantity` (the amount used on a visit); `check_stock_level`/`flag_reorder_needed`
// drafts are just {sku?, name?} — no numbers to fill a tank with yet. This scene
// draws the tank at full when a reorderThreshold/quantity ratio isn't computable
// (nothing to threaten it), and only bands it amber/red once real threshold data is
// actually present on the payload (execute() output shape, when passed through).

import { motion, useReducedMotion } from "framer-motion"
import { Boxes } from "lucide-react"
import { Panel } from "../../primitives/Panel"
import { EASE } from "../../motion/tokens"
import type { ActionRendererProps } from "../types"

interface InventoryPayload {
  sku?: string
  name?: string
  quantity?: number
  visitId?: string
  reorderThreshold?: number
  reorderNeeded?: boolean
}

export function InventoryScene({ payload, compact }: ActionRendererProps) {
  const p = (payload && typeof payload === "object" ? payload : {}) as InventoryPayload
  const reducedRaw = useReducedMotion()
  const reduced = reducedRaw ?? false
  const label = p.name ?? p.sku ?? "item"

  const hasThresholdData = typeof p.quantity === "number" && typeof p.reorderThreshold === "number" && p.reorderThreshold > 0
  const ratio = hasThresholdData ? Math.max(0, Math.min(1, p.quantity! / (p.reorderThreshold! * 2))) : 1
  const fillColor = p.reorderNeeded ? "#f87171" : ratio < 0.5 ? "#fbbf24" : "#34d399"

  if (compact) {
    return (
      <span className="inline-flex items-center gap-1.5 text-[11px]">
        <Boxes className="h-3 w-3 shrink-0 text-amber-300" />
        <span className="truncate text-[color:var(--j-text)]">
          {label}
          {typeof p.quantity === "number" ? ` · qty ${p.quantity}` : ""}
          {p.reorderNeeded ? " · reorder needed" : ""}
        </span>
      </span>
    )
  }

  return (
    <Panel className="border border-amber-300/25 p-3">
      <div className="mb-2 flex items-center gap-1.5">
        <Boxes className="h-3.5 w-3.5 text-amber-300" />
        <span className="text-[9px] font-black uppercase tracking-widest text-amber-200">{label}</span>
        {p.reorderNeeded && (
          <span className="ml-auto rounded-full bg-red-400/14 px-2 py-0.5 text-[8.5px] font-black text-red-300">reorder needed</span>
        )}
      </div>

      <div className="flex items-center gap-3">
        <svg viewBox="0 0 40 60" width={40} height={60} className="shrink-0 overflow-visible">
          <rect x={2} y={2} width={36} height={56} rx={4} fill="none" stroke="rgba(255,255,255,0.15)" strokeWidth={2} />
          <clipPath id="tank-clip">
            <rect x={4} y={4} width={32} height={52} rx={2} />
          </clipPath>
          <motion.rect
            x={4}
            width={32}
            height={52}
            y={4}
            fill={fillColor}
            fillOpacity={0.5}
            clipPath="url(#tank-clip)"
            style={{ originY: 1 }}
            initial={{ scaleY: 0 }}
            animate={{ scaleY: ratio, transition: reduced ? { duration: 0 } : { duration: 0.9, ease: EASE.decelerate } }}
          />
        </svg>
        <div className="min-w-0 flex-1 space-y-0.5">
          {typeof p.quantity === "number" && (
            <div className="text-[11px] text-[color:var(--j-text-dim)]">
              quantity: <span className="font-black text-[color:var(--j-text)]">{p.quantity}</span>
            </div>
          )}
          {typeof p.reorderThreshold === "number" && (
            <div className="text-[11px] text-[color:var(--j-text-dim)]">
              reorder threshold: <span className="font-black text-[color:var(--j-text)]">{p.reorderThreshold}</span>
            </div>
          )}
          {p.visitId && <div className="truncate text-[10px] text-[color:var(--j-text-faint)]">visit {p.visitId.slice(0, 8)}…</div>}
          {!hasThresholdData && <div className="text-[10px] text-[color:var(--j-text-faint)]">No stock numbers on this draft yet</div>}
        </div>
      </div>
    </Panel>
  )
}
