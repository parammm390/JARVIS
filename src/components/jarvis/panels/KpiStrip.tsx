"use client"

// KPI band — the reference image's top row.
//
// P1.T7 / defect C-01: this panel used to read `useJarvis()` directly and coerce
// every network value with a nullish-coalesced zero. Signed out, all six of those
// coerced to a confident `$0` with a sparkline under it — verified live on
// production. Now every number arrives as `Truth<number>` from `kernel/selectors.ts` and renders through
// `Metric`, which per §5.5 shows a veil, a skeleton or an error state instead of a
// number whenever the value is not actually known. The five cards, their labels,
// their copy, their colours and their order are unchanged.

import { useEffect, useMemo, useRef } from "react"
import { Metric } from "../lib/Metric"
import { flash } from "../lib/EventFX"
import { registerAnchor, setLineageHover } from "../lib/pulse-bus"
import { laneAgeMs, SLOW_LANE_STALE_MS } from "../lib/data-core"
import { StaleFog } from "../ui/primitives/StaleFog"
import {
  mapTruth,
  selectCollectedUsd,
  selectOpenLeads,
  selectOpenReconciliation,
  selectOverdueInvoices,
  selectPaymentLinksOpen,
  selectPendingApprovals,
  selectQuotesSent,
  selectRunsInFlight,
  selectStuckRuns,
} from "../kernel/selectors"
import { useLanePresentation, useSelectorInput } from "../kernel/useSelectorInput"
import type { Truth } from "../kernel/types"

const usd = (n: number) => `$${Math.round(n).toLocaleString()}`

/** The sub-line under a card. It carries numbers too, so it is Truth-gated exactly
 *  like the headline is: if we do not know the number, we do not write the sentence.
 *  Rendering "0 payment links open" off a 401 is the same lie in smaller type. */
function SubLine({ truth, render }: { truth: Truth<number>; render: (n: number) => string }) {
  if (truth.status !== "known" && truth.status !== "stale" && truth.status !== "partial") return null
  return <div className="mt-1.5 truncate text-[11px] text-[color:var(--j-text-dim)]">{render(truth.value)}</div>
}

interface Card {
  key: string
  label: string
  value: Truth<number>
  format?: (n: number) => string
  sub: React.ReactNode
  spark: number[]
  color: string
  delta: string | null
  view: string
}

export function KpiStrip({ onNavigate }: { onNavigate?: (view: string) => void }) {
  // Every displayed FACT comes from a selector. `lane` carries only presentation
  // state — session-local sparkline history, the session's new-pending counter, and
  // the slow lane's timestamp for the strip-wide fog. No number below is read from
  // raw lane state.
  const lane = useLanePresentation()
  const input = useSelectorInput()

  const overdue = selectOverdueInvoices(input)
  const collected = selectCollectedUsd(input)
  const paymentLinksOpen = selectPaymentLinksOpen(input)
  const openLeads = selectOpenLeads(input)
  const quotesSent = selectQuotesSent(input)
  const stuckRuns = selectStuckRuns(input)
  const openRecon = selectOpenReconciliation(input)
  const pending = selectPendingApprovals(input)
  const runsInFlight = selectRunsInFlight(input)

  const needsAttention =
    (stuckRuns.status === "known" ? stuckRuns.value : 0) + (openRecon.status === "known" ? openRecon.value : 0) > 0

  const cards: Card[] = [
    {
      key: "approvals",
      label: "Awaiting Approval",
      value: pending,
      sub: <SubLine truth={pending} render={() => "gated actions in the queue"} />,
      spark: lane.metricHistory.pending ?? [],
      color: "var(--j-cyan)",
      delta: lane.newPendingSinceOpen > 0 ? `+${lane.newPendingSinceOpen} this session` : null,
      view: "Command Center",
    },
    {
      key: "collected",
      label: "Collected",
      value: collected,
      format: usd,
      sub: <SubLine truth={paymentLinksOpen} render={(n) => `${n} payment link${n === 1 ? "" : "s"} open`} />,
      spark: lane.metricHistory.collectedUsd ?? [],
      color: "var(--j-green)",
      delta: null,
      view: "Invoices",
    },
    {
      key: "overdue",
      label: "Overdue",
      // One fact, two projections — the dollar total headlines, the count sits
      // under it. Both come from the same row of the same read (§4.7), so they
      // cannot disagree about whether they are known.
      value: mapTruth(overdue, (o) => o.totalUsd),
      format: usd,
      sub: (
        <SubLine
          truth={mapTruth(overdue, (o) => o.count)}
          render={(n) => `${n} invoice${n === 1 ? "" : "s"} outstanding`}
        />
      ),
      spark: lane.metricHistory.overdueUsd ?? [],
      color: "var(--j-red)",
      delta: null,
      view: "Invoices",
    },
    {
      key: "pipeline",
      label: "Open Leads",
      value: openLeads,
      sub: <SubLine truth={quotesSent} render={(n) => `${n} quote${n === 1 ? "" : "s"} awaiting signature`} />,
      spark: lane.metricHistory.leadsOpen ?? [],
      color: "var(--j-violet)",
      delta: null,
      view: "Leads & CRM",
    },
    {
      key: "ops",
      label: "Runs In Flight",
      value: runsInFlight,
      sub: <SubLine truth={stuckRuns} render={(n) => `${n} stuck · ${openRecon.status === "known" ? openRecon.value : "—"} reconciling`} />,
      spark: lane.metricHistory.runs ?? [],
      color: "var(--j-blue)",
      delta: needsAttention ? "needs attention" : null,
      view: "Workflows",
    },
  ]

  const cardRefs = useRef<Map<string, HTMLElement>>(new Map())
  const prevValues = useRef<Map<string, number | null>>(new Map())

  // Flash on a REAL change of a KNOWN number. A transition into or out of a veil is
  // not a value change and must not read as one.
  const knownValues = useMemo(
    () => cards.map((c) => `${c.key}:${c.value.status === "known" ? c.value.value : "-"}`).join(","),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [cards.map((c) => (c.value.status === "known" ? c.value.value : "-")).join(",")],
  )

  useEffect(() => {
    for (const c of cards) {
      const next = c.value.status === "known" ? c.value.value : null
      const prev = prevValues.current.get(c.key)
      if (prev !== undefined && prev !== null && next !== null && prev !== next) {
        flash(cardRefs.current.get(c.key) ?? null)
      }
      prevValues.current.set(c.key, next)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [knownValues])

  // F2.T3 — FLOW-49 ConstellationLink's real source anchors: one per KPI card, keyed
  // `kpi:<key>` so ConstellationLink.tsx (Bridge-only) can draw a line from whichever
  // card is hovered to its hand-authored target panel(s) without KpiStrip knowing
  // anything about Bridge's layout. A harmless no-op anywhere else this component
  // renders (legacy Shell) since nothing there ever reads these anchors.
  useEffect(() => {
    const unregisters = cards.map((c) =>
      registerAnchor(`kpi:${c.key}`, () => cardRefs.current.get(c.key)?.getBoundingClientRect() ?? null),
    )
    return () => unregisters.forEach((off) => off())
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cards.map((c) => c.key).join(",")])

  // F6.T2 — FLOW-92 StaleFog: most of these cards (cashCollections/pipelineHealth/
  // slaBreaches) are slow-lane read-models; the pending/runs cards are fast-lane and
  // stay fresher than this — an honest, documented mixed-lane approximation (the
  // whole strip fogs by the slow lane's own real last-success timestamp) rather than
  // per-card lane tracking, which no other panel in this codebase does either.
  return (
    <StaleFog ageMs={laneAgeMs(lane.slowLastSuccessMs, lane.now)} staleAfterMs={SLOW_LANE_STALE_MS}>
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
            <Metric
              label={c.label}
              value={c.value}
              format={c.format}
              delta={c.delta}
              sparkline={c.spark}
            />
            {c.sub}
          </button>
        ))}
      </div>
    </StaleFog>
  )
}
