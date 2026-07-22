"use client"

// C3.T2/T3 — primitive kit demoed on the Stage, same FlowCard chrome convention as
// C2/C3's other catalogs.

import { useState } from "react"
import { FlowCard } from "../motion/FlowCard"
import { Panel } from "./Panel"
import { StatCard } from "./StatCard"
import { RiskBadge, type RiskTier } from "./RiskBadge"
import { StatusDot, type Status } from "./StatusDot"
import { SkeletonText, SkeletonRow, SkeletonStat, SkeletonCard } from "./Skeletons"
import { EmptyState } from "./EmptyState"
import { ErrorState } from "./ErrorState"
import { Sparkline } from "./Sparkline"

function PanelDemo() {
  return (
    <FlowCard id="PRIM-01" title="Panel" reducedFallback="n/a — static shell, no animation to reduce">
      <div className="flex gap-2">
        <Panel className="p-3 text-[10px] text-[color:var(--j-text-dim)]">plain</Panel>
        <Panel hot className="p-3 text-[10px] text-[color:var(--j-text-dim)]">hot</Panel>
      </div>
    </FlowCard>
  )
}

function StatCardDemo() {
  return (
    <FlowCard id="PRIM-02" title="StatCard" reducedFallback="n/a — Metric's own odometer already documented under FLOW-03">
      <StatCard label="queue depth" value={7} source="derived" sparkline={[3, 5, 4, 6, 7, 5, 7]} />
    </FlowCard>
  )
}

function RiskBadgeDemo() {
  return (
    <FlowCard id="PRIM-03" title="RiskBadge" reducedFallback="n/a — static material, no animation to reduce">
      <div className="flex flex-wrap gap-2">
        {(["low", "medium", "high"] as RiskTier[]).map((tier) => (
          <RiskBadge key={tier} tier={tier} />
        ))}
      </div>
    </FlowCard>
  )
}

function StatusDotDemo() {
  return (
    <FlowCard id="PRIM-04" title="StatusDot" reducedFallback="ok state stops pulsing, dot stays solid">
      <div className="flex items-center gap-4">
        {(["ok", "degraded", "down", "unknown"] as Status[]).map((s) => (
          <div key={s} className="flex items-center gap-1.5 text-[9.5px] text-[color:var(--j-text-dim)]">
            <StatusDot status={s} /> {s}
          </div>
        ))}
      </div>
    </FlowCard>
  )
}

function SkeletonsDemo() {
  return (
    <FlowCard id="PRIM-05" title="Skeletons" reducedFallback="n/a — CSS animate-pulse only, no framer-motion to reduce">
      <div className="w-full space-y-2">
        <SkeletonText width="60%" />
        <SkeletonRow />
        <div className="flex gap-2">
          <SkeletonStat className="w-24" />
          <SkeletonCard className="flex-1" />
        </div>
      </div>
    </FlowCard>
  )
}

function EmptyErrorDemo() {
  const [key, setKey] = useState(0)
  return (
    <FlowCard id="PRIM-06" title="EmptyState / ErrorState" reducedFallback="n/a — static states, no animation to reduce">
      <div className="w-full space-y-2">
        <EmptyState title="No pending approvals" description="Everything's clear." actionLabel="Refresh" onAction={() => setKey((k) => k + 1)} />
        <ErrorState message={`Couldn't load (attempt ${key + 1})`} onRetry={() => setKey((k) => k + 1)} />
      </div>
    </FlowCard>
  )
}

function DrawerSparklineDemo() {
  return (
    <FlowCard id="PRIM-07" title="Drawer + Sparkline" reducedFallback="drawer slide-in still runs on a spring (matches ReceiptDrawer's existing behavior, unchanged by this extraction)">
      <div className="flex w-full items-center justify-between">
        <span className="text-[10px] text-[color:var(--j-text-dim)]">Drawer: extracted into ReceiptDrawer above (see any receipt click). Sparkline:</span>
        <Sparkline values={[2, 4, 3, 6, 5, 8, 6]} />
      </div>
    </FlowCard>
  )
}

export function PrimitivesCatalogSection() {
  return (
    <section className="j-panel space-y-3 p-5">
      <div className="mb-1 flex items-center justify-between">
        <h2 className="j-label">C3.T2 — ui/primitives/ kit</h2>
        <span className="j-chip bg-teal-400/12 text-teal-300">9 entries</span>
      </div>
      <p className="text-[11px] text-[color:var(--j-text-dim)]">
        Panel/StatCard/RiskBadge/StatusDot/Skeletons/EmptyState/ErrorState/Drawer/Sparkline. Drawer and Sparkline are real extractions —
        ReceiptDrawer and Metric now compose these instead of owning their own copies.
      </p>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
        <PanelDemo />
        <StatCardDemo />
        <RiskBadgeDemo />
        <StatusDotDemo />
        <SkeletonsDemo />
        <EmptyErrorDemo />
        <DrawerSparklineDemo />
      </div>
    </section>
  )
}
