"use client"

// C3.T2 — geometry-matched skeletons. `animate-pulse` divs already exist ad hoc at
// 9+ call sites (ReceiptDrawer, TechnicianBoard, OpsTicker, DailyBriefing,
// CertificationStatus, DispatcherBoard, DlqBrowser, DataQualityQueue) — this doesn't
// replace those (each is hand-shaped to its own real layout and touching them is a
// panel-refactor with no functional gain, out of scope for C3). What was actually
// missing: named, reusable shapes for NEW work (D-track) to reach for instead of
// hand-rolling yet another one-off pulse div. Matches the geometry of the primitives
// built alongside it this session: SkeletonStat mirrors Metric's label+value+
// sparkline stack, SkeletonCard mirrors Panel/StatCard proportions.
//
// F1.T2/T4 — FLOW-29 SkeletonTide: every shape below now sweeps with
// `.jarvis-skeleton-tide` (jarvis-theme.css) instead of bare `animate-pulse`, and
// takes an optional `index` so a parent list can stagger the sweep by DOM order via
// `--tide-delay` (120ms/step, matching Stagger's cascade convention). Geometry and
// call-site API are unchanged — this is a drop-in visual upgrade, not a new shape.

import type { CSSProperties } from "react"

function tideStyle(index: number): CSSProperties {
  return { "--tide-delay": `${index * 120}ms` } as CSSProperties
}

export function SkeletonText({ width = "100%", className = "", index = 0 }: { width?: string; className?: string; index?: number }) {
  return <div className={`jarvis-skeleton-tide h-3 rounded bg-white/6 ${className}`} style={{ width, ...tideStyle(index) }} />
}

export function SkeletonRow({ className = "", index = 0 }: { className?: string; index?: number }) {
  return (
    <div className={`flex items-center justify-between rounded-lg border border-white/8 bg-white/[0.015] px-3 py-2 ${className}`} style={tideStyle(index)}>
      <div className="jarvis-skeleton-tide h-2.5 w-24 rounded bg-white/6" />
      <div className="jarvis-skeleton-tide h-2.5 w-12 rounded bg-white/6" />
    </div>
  )
}

export function SkeletonStat({ className = "", index = 0 }: { className?: string; index?: number }) {
  return (
    <div className={className} style={tideStyle(index)}>
      <div className="jarvis-skeleton-tide mb-2 h-2.5 w-16 rounded bg-white/6" />
      <div className="jarvis-skeleton-tide mb-1.5 h-6 w-20 rounded bg-white/8" />
      <div className="jarvis-skeleton-tide h-[28px] w-24 rounded bg-white/[0.04]" />
    </div>
  )
}

export function SkeletonCard({ className = "", index = 0 }: { className?: string; index?: number }) {
  return (
    <div className={`j-panel space-y-3 p-4 ${className}`} style={tideStyle(index)}>
      <div className="jarvis-skeleton-tide h-2.5 w-1/3 rounded bg-white/6" />
      <div className="jarvis-skeleton-tide h-16 rounded-lg bg-white/5" />
      <div className="jarvis-skeleton-tide h-16 rounded-lg bg-white/5" />
    </div>
  )
}
