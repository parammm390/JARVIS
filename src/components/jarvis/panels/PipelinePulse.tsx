"use client"

// §7.10 — three segmented bars (leads/quotes/proposals) + stock/renewal footer stats.
import { motion } from "framer-motion"
import { LiveDot } from "../atmosphere"
import { useJarvis } from "../lib/data-core"

const SEGMENT_COLORS = ["bg-cyan-400/70", "bg-teal-400/70", "bg-sky-400/70", "bg-violet-400/70", "bg-amber-400/70"]

function SegmentBar({ label, segments }: { label: string; segments: Array<{ status: string; count: number }> }) {
  const total = Math.max(1, segments.reduce((s, r) => s + r.count, 0))
  return (
    <div>
      <div className="mb-1 flex items-center justify-between text-[10px] font-bold uppercase tracking-wider text-[color:var(--j-text-dim)]">
        <span>{label}</span>
        <span>{segments.reduce((s, r) => s + r.count, 0)}</span>
      </div>
      <div className="flex h-2 overflow-hidden rounded-full bg-white/8">
        {segments.map((s, i) => (
          <motion.div
            key={s.status}
            className={SEGMENT_COLORS[i % SEGMENT_COLORS.length]}
            initial={{ width: 0 }}
            animate={{ width: `${(s.count / total) * 100}%` }}
            transition={{ duration: 0.6 }}
          />
        ))}
      </div>
      <div className="mt-1 flex flex-wrap gap-2">
        {segments.map((s) => (
          <span key={s.status} className="text-[9px] text-[color:var(--j-text-faint)]">
            {s.status.replaceAll("_", " ")} · {s.count}
          </span>
        ))}
      </div>
    </div>
  )
}

export function PipelinePulse() {
  const data = useJarvis()
  const ph = data.pipelineHealth
  const worstStock = data.stockRisk?.belowThreshold.slice().sort((a, b) => a.quantity - b.quantity)[0]
  const renewalsDue30d = data.serviceDue?.filter((s) => {
    const days = (new Date(s.renewalDate).getTime() - data.now) / 86400000
    return days >= 0 && days <= 30
  }).length ?? null

  return (
    <div className="j-panel">
      <div className="p-4">
        <div className="mb-3 flex items-center gap-2 text-[11px] font-bold uppercase tracking-[0.18em] text-[color:var(--j-text-dim)]">
          <LiveDot /> Pipeline Pulse
        </div>
        {ph ? (
          <div className="space-y-3">
            <SegmentBar label="Leads" segments={ph.leadsByStatus} />
            <SegmentBar label="Quotes" segments={ph.quotesByStatus} />
            <SegmentBar label="Proposals" segments={ph.proposalsByStatus} />
          </div>
        ) : (
          <div className="text-[12px] text-[color:var(--j-text-faint)]">Loading pipeline…</div>
        )}
        <div className="mt-3 flex flex-wrap gap-2 border-t border-white/6 pt-3 text-[10px]">
          {worstStock && (
            <span className={`rounded-full px-2 py-1 font-bold ${worstStock.quantity === 0 ? "bg-red-400/12 text-red-300" : "bg-amber-300/12 text-amber-200"}`}>
              {worstStock.name}: {worstStock.quantity}/{worstStock.reorderThreshold}
            </span>
          )}
          {renewalsDue30d !== null && renewalsDue30d > 0 && (
            <span className="rounded-full bg-cyan-300/12 px-2 py-1 font-bold text-cyan-200">{renewalsDue30d} renewals due in 30d</span>
          )}
        </div>
      </div>
    </div>
  )
}
