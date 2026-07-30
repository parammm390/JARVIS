"use client"

// F1.T3 — honest completeness meter reading flow-index.ts directly (no separately
// maintained count that can drift from the data). Sticky section nav lets a session
// jump straight to a band without scrolling the whole Stage.

import { FLOW_INDEX, flowCompleteness, flowBands } from "./flow-index"

export function FlowIndexMeterSection() {
  const { total, shipped, cut, planned } = flowCompleteness()
  const pct = Math.round((shipped / total) * 100)
  const bands = flowBands()

  return (
    <section className="j-panel space-y-3 p-5" id="flow-index">
      <div className="mb-1 flex items-center justify-between">
        <h2 className="j-label">FLOW-100 catalog — flow-index.ts (F1.T3)</h2>
        <span className="j-chip bg-cyan-400/12 text-cyan-300">
          {shipped}/{total} shipped
        </span>
      </div>
      <div className="h-2 w-full overflow-hidden rounded-full bg-white/6">
        <div className="h-full rounded-full bg-gradient-to-r from-cyan-400 to-teal-300" style={{ width: `${pct}%` }} />
      </div>
      <p className="j-fs-micro text-[color:var(--j-text-dim)]">
        {shipped} shipped · {planned} planned · {cut} cut — {pct}% of the full 100-entry catalog. Counts read live from flow-index.ts;
        this file is the runtime source of truth (F-STATE tracks phase/task/evidence separately).
      </p>
      <div className="j-scroll-visible flex gap-2 overflow-x-auto pb-1">
        {bands.map((band) => {
          const entries = FLOW_INDEX.filter((f) => f.band === band)
          const bandShipped = entries.filter((f) => f.status === "shipped").length
          return (
            <a
              key={band}
              href={`#band-${band}`}
              className="j-chip shrink-0 border border-white/10 bg-white/[0.03] text-[color:var(--j-text-dim)] hover:text-cyan-200"
            >
              {band} {bandShipped}/{entries.length}
            </a>
          )
        })}
      </div>
    </section>
  )
}
