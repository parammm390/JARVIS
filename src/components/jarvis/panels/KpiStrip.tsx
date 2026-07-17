"use client"

// KPI band — the reference image's top row. Big tabular number, gradient area
// sparkline, delta chip. Every number LIVE, every sparkline a real per-poll session
// trend (metricHistory), every delta computed from real data or hidden.

import { useEffect, useRef } from "react"
import { LiveDot } from "../atmosphere"
import { CountUp } from "../lib/CountUp"
import { AreaSparkline } from "../lib/charts"
import { useJarvis } from "../lib/data-core"
import { flash } from "../lib/EventFX"

const usd = (n: number) => `$${Math.round(n).toLocaleString()}`

interface Card {
  key: string
  label: string
  value: number
  format?: (n: number) => string
  sub: string
  spark: number[]
  color: string
  delta: string | null
  deltaTone: "up" | "warn" | null
  view: string
}

export function KpiStrip({ onNavigate }: { onNavigate?: (view: string) => void }) {
  const data = useJarvis()

  const overdue = data.cashCollections?.invoicesByStatus.find((s) => s.status === "overdue")
  const collectedUsd = data.cashCollections?.totalCollected ?? 0
  const paymentLinksOpen = data.cashCollections?.paymentLinksAwaitingPayment ?? 0
  const leadsOpen = data.pipelineHealth?.leadsByStatus.reduce((s, r) => s + r.count, 0) ?? 0
  const quotesSent = data.pipelineHealth?.quotesByStatus.find((q) => q.status === "sent")?.count ?? 0
  const stuckRuns = data.slaBreaches?.stuckWorkflowRuns ?? 0
  const openRecon = data.slaBreaches?.openReconciliationCases ?? 0
  const pendingCount = data.stats?.pending ?? 0
  const runsInFlight = data.runs.length

  const cards: Card[] = [
    {
      key: "approvals",
      label: "Awaiting Approval",
      value: pendingCount,
      sub: "gated actions in the queue",
      spark: data.metricHistory.pending ?? [],
      color: "var(--j-cyan)",
      delta: data.newPendingSinceOpen > 0 ? `+${data.newPendingSinceOpen} this session` : null,
      deltaTone: data.newPendingSinceOpen > 0 ? "up" : null,
      view: "Command Center",
    },
    {
      key: "collected",
      label: "Collected",
      value: collectedUsd,
      format: usd,
      sub: `${paymentLinksOpen} payment link${paymentLinksOpen === 1 ? "" : "s"} open`,
      spark: data.metricHistory.collectedUsd ?? [],
      color: "var(--j-green)",
      delta: null,
      deltaTone: null,
      view: "Invoices",
    },
    {
      key: "overdue",
      label: "Overdue",
      value: overdue?.totalUsd ?? 0,
      format: usd,
      sub: `${overdue?.count ?? 0} invoice${(overdue?.count ?? 0) === 1 ? "" : "s"} outstanding`,
      spark: data.metricHistory.overdueUsd ?? [],
      color: "var(--j-red)",
      delta: null,
      deltaTone: null,
      view: "Invoices",
    },
    {
      key: "pipeline",
      label: "Open Leads",
      value: leadsOpen,
      sub: `${quotesSent} quote${quotesSent === 1 ? "" : "s"} awaiting signature`,
      spark: data.metricHistory.leadsOpen ?? [],
      color: "var(--j-violet)",
      delta: null,
      deltaTone: null,
      view: "Leads & CRM",
    },
    {
      key: "ops",
      label: "Runs In Flight",
      value: runsInFlight,
      sub: `${stuckRuns} stuck · ${openRecon} reconciling`,
      spark: data.metricHistory.runs ?? [],
      color: "var(--j-blue)",
      delta: stuckRuns + openRecon > 0 ? "needs attention" : null,
      deltaTone: stuckRuns + openRecon > 0 ? "warn" : null,
      view: "Workflows",
    },
  ]

  const cardRefs = useRef<Map<string, HTMLElement>>(new Map())
  const prevValues = useRef<Map<string, number>>(new Map())

  useEffect(() => {
    for (const c of cards) {
      const prev = prevValues.current.get(c.key)
      if (prev !== undefined && prev !== c.value) {
        flash(cardRefs.current.get(c.key) ?? null)
      }
      prevValues.current.set(c.key, c.value)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cards.map((c) => c.value).join(",")])

  return (
    <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-5">
      {cards.map((c, i) => (
        <button
          key={c.key}
          ref={(el) => {
            if (el) cardRefs.current.set(c.key, el)
          }}
          onClick={() => onNavigate?.(c.view)}
          style={{ animationDelay: `${i * 60}ms`, ["--rise-to" as string]: 1 }}
          className="jarvis-rise j-panel group relative min-h-[118px] overflow-hidden p-3.5 text-left transition-transform duration-150 hover:-translate-y-0.5"
        >
          {/* accent glow seep, per-card color */}
          <div
            className="pointer-events-none absolute -right-8 -top-10 h-28 w-28 rounded-full opacity-[0.12] blur-2xl transition-opacity group-hover:opacity-25"
            style={{ background: c.color }}
          />
          <div className="flex items-center justify-between gap-2">
            <span className="flex items-center gap-1.5">
              <LiveDot />
              <span className="j-label">{c.label}</span>
            </span>
            {c.delta && (
              <span className={`j-chip shrink-0 ${c.deltaTone === "warn" ? "bg-amber-400/12 text-amber-300" : "bg-teal-400/12 text-teal-300"}`}>{c.delta}</span>
            )}
          </div>
          <div className="mt-2 flex items-end justify-between gap-2">
            <CountUp value={c.value} format={c.format} className="j-num-glow text-[30px] font-black tabular-nums leading-none text-[color:var(--j-text)]" />
            {c.spark.length > 1 && <AreaSparkline values={c.spark} width={96} height={40} color={c.color} className="w-24 shrink-0" />}
          </div>
          <div className="mt-1.5 truncate text-[11px] text-[color:var(--j-text-dim)]">{c.sub}</div>
        </button>
      ))}
    </div>
  )
}
