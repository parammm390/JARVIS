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

export function SkeletonText({ width = "100%", className = "" }: { width?: string; className?: string }) {
  return <div className={`h-3 animate-pulse rounded bg-white/6 ${className}`} style={{ width }} />
}

export function SkeletonRow({ className = "" }: { className?: string }) {
  return (
    <div className={`flex items-center justify-between rounded-lg border border-white/8 bg-white/[0.015] px-3 py-2 ${className}`}>
      <div className="h-2.5 w-24 animate-pulse rounded bg-white/6" />
      <div className="h-2.5 w-12 animate-pulse rounded bg-white/6" />
    </div>
  )
}

export function SkeletonStat({ className = "" }: { className?: string }) {
  return (
    <div className={className}>
      <div className="mb-2 h-2.5 w-16 animate-pulse rounded bg-white/6" />
      <div className="mb-1.5 h-6 w-20 animate-pulse rounded bg-white/8" />
      <div className="h-[28px] w-24 animate-pulse rounded bg-white/[0.04]" />
    </div>
  )
}

export function SkeletonCard({ className = "" }: { className?: string }) {
  return (
    <div className={`j-panel space-y-3 p-4 ${className}`}>
      <div className="h-2.5 w-1/3 animate-pulse rounded bg-white/6" />
      <div className="h-16 animate-pulse rounded-lg bg-white/5" />
      <div className="h-16 animate-pulse rounded-lg bg-white/5" />
    </div>
  )
}
