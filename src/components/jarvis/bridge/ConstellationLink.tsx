"use client"

// F2.T3 — FLOW-49 ConstellationLink: hovering a KpiStrip card draws a faint line to
// the REAL Bridge panel(s) that number's data actually comes from. The lineage map
// below is hand-authored (plan's own instruction) against what's genuinely mounted
// on the Bridge today — "collected"/"overdue" have no Bridge-side panel to point at
// (their only real destination is a legacy Shell view, not present here), so they're
// deliberately left unmapped rather than pointed at something unrelated.

import { useEffect, useState } from "react"
import { motion, useReducedMotion } from "framer-motion"
import { getAnchorRect, onLineageHover } from "../lib/pulse-bus"

const KPI_LINEAGE: Record<string, string[]> = {
  approvals: ["approval-cockpit"],
  pipeline: ["activity-feed"],
  ops: ["pulse-bar", "activity-feed"],
}

interface Line {
  x1: number
  y1: number
  x2: number
  y2: number
}

function computeLines(kpiKey: string): Line[] {
  const targets = KPI_LINEAGE[kpiKey]
  if (!targets) return []
  const from = getAnchorRect(`kpi:${kpiKey}`)
  if (!from) return []
  const fx = from.left + from.width / 2
  const fy = from.top + from.height / 2
  const lines: Line[] = []
  for (const target of targets) {
    const to = getAnchorRect(target)
    if (!to) continue
    lines.push({ x1: fx, y1: fy, x2: to.left + to.width / 2, y2: to.top + to.height / 2 })
  }
  return lines
}

export function ConstellationLink() {
  const reduced = useReducedMotion()
  const [hoverKey, setHoverKey] = useState<string | null>(null)
  const [lines, setLines] = useState<Line[]>([])

  useEffect(() => onLineageHover(setHoverKey), [])

  useEffect(() => {
    if (!hoverKey) {
      setLines([])
      return
    }
    setLines(computeLines(hoverKey))
    // Panels can reflow under a real live-data update while a card is hovered —
    // recompute on resize/scroll rather than freezing a stale line to a moved panel.
    const recompute = () => setLines(computeLines(hoverKey))
    window.addEventListener("resize", recompute)
    window.addEventListener("scroll", recompute, true)
    return () => {
      window.removeEventListener("resize", recompute)
      window.removeEventListener("scroll", recompute, true)
    }
  }, [hoverKey])

  if (lines.length === 0) return null

  return (
    <svg aria-hidden className="pointer-events-none fixed inset-0 z-40 h-full w-full">
      {lines.map((l, i) =>
        reduced ? (
          <g key={i}>
            <circle cx={l.x1} cy={l.y1} r={3} fill="var(--j-cyan)" opacity={0.6} />
            <circle cx={l.x2} cy={l.y2} r={3} fill="var(--j-cyan)" opacity={0.6} />
          </g>
        ) : (
          <motion.line
            key={i}
            x1={l.x1}
            y1={l.y1}
            x2={l.x2}
            y2={l.y2}
            stroke="var(--j-cyan)"
            strokeWidth={1}
            strokeDasharray="3 5"
            initial={{ pathLength: 0, opacity: 0 }}
            animate={{ pathLength: 1, opacity: 0.45 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.25, ease: "easeOut" }}
          />
        ),
      )}
    </svg>
  )
}
