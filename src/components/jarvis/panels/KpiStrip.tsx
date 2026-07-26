"use client"

// KPI band — the reference image's top row. Big tabular number, gradient area
// sparkline, delta chip. Every number LIVE, every sparkline a real per-poll session
// trend (metricHistory), every delta computed from real data or hidden.

import { useEffect, useRef } from "react"
import { LiveDot } from "../atmosphere"
import { CountUp } from "../lib/CountUp"
import { AreaSparkline, DeltaChip } from "../lib/charts"
import { laneAgeMs, SLOW_LANE_STALE_MS, useJarvis } from "../lib/data-core"
import { flash } from "../lib/EventFX"
import { registerAnchor, setLineageHover } from "../lib/pulse-bus"
import { StaleFog } from "../ui/primitives/StaleFog"

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

  // F2.T3 — FLOW-49 ConstellationLink's real source anchors: one per KPI card, keyed
  // `kpi:<key>` so ConstellationLink.tsx (Bridge-only) can draw a line from whichever
  // card is hovered to its hand-authored target panel(s) without KpiStrip knowing
  // anything about Bridge's layout. A harmless no-op anywhere else this component
  // renders (legacy Shell) since nothing there ever reads these anchors.
  useEffect(() => {
    const unregisters = cards.map((c) => registerAnchor(`kpi:${c.key}`, () => cardRefs.current.get(c.key)?.getBoundingClientRect() ?? null))
    return () => unregisters.forEach((off) => off())
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cards.map((c) => c.key).join(",")])

  // F6.T2 — FLOW-92 StaleFog: most of these cards (cashCollections/pipelineHealth/
  // slaBreaches) are slow-lane read-models; the pending/runs cards are fast-lane and
  // stay fresher than this — an honest, documented mixed-lane approximation (the
  // whole strip fogs by the slow lane's own real last-success timestamp) rather than
  // per-card lane tracking, which no other panel in this codebase does either.
  return (
    <StaleFog ageMs={laneAgeMs(data.slowLastSuccessMs, data.now)} staleAfterMs={SLOW_LANE_STALE_MS}>
    <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-5">
      {cards.map((c, i) => (
        <button
          key={c.key}
          ref={(el) => {
            if (el) cardRefs.current.set(c.key, el)
          }}
          onClick={() => onNavigate?.(c.view)}
          onMouseEnter={() => setLineageHover(c.key)}
          onMouseLeave={() => setLineageHover(null)}
          onFocus={() => setLineageHover(c.key)}
          onBlur={() => setLineageHover(null)}
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
            {c.delta && <DeltaChip label={c.delta} tone={c.deltaTone ?? "up"} />}
          </div>
          <div className="mt-2 flex items-end justify-between gap-2">
            <CountUp value={c.value} format={c.format} className="j-num j-num-glow text-[30px] font-black leading-none text-[color:var(--j-text)]" />
            {c.spark.length > 1 && <AreaSparkline values={c.spark} width={96} height={40} color={c.color} className="w-24 shrink-0" />}
          </div>
          <div className="mt-1.5 truncate text-[11px] text-[color:var(--j-text-dim)]">{c.sub}</div>
        </button>
      ))}
    </div>
    </StaleFog>
  )
}
