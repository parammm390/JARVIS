"use client"

// Bottom analytics band — the reference image's chart row, bound to real data only:
// comms-by-channel donut (real communications log), action-mix bars (real planner
// stats from /api/insights), and a live performance panel whose latency line REDRAWS
// every 4s from genuinely measured round-trips.

import { useMemo, useState } from "react"
import { LiveDot } from "../atmosphere"
import { AnomalyFlare, AreaSparkline, Donut, ForecastBand, GradientBar, toPoints } from "../lib/charts"
import { CountUp } from "../lib/CountUp"
import { useJarvis } from "../lib/data-core"

const CHANNEL_COLORS: Record<string, string> = {
  email: "#3b82f6",
  sms: "#22d3ee",
  call: "#8b5cf6",
}
const BAR_GRADS = [
  ["#22d3ee", "#3b82f6"],
  ["#3b82f6", "#8b5cf6"],
  ["#8b5cf6", "#d946ef"],
  ["#2dd4bf", "#22d3ee"],
  ["#fbbf24", "#f87171"],
] as const

export function ChannelDonut() {
  const data = useJarvis()
  const segments = useMemo(() => {
    const counts = new Map<string, number>()
    for (const c of data.comms) counts.set(c.channel, (counts.get(c.channel) ?? 0) + 1)
    return [...counts.entries()]
      .sort((a, b) => b[1] - a[1])
      .map(([label, value]) => ({ label, value, color: CHANNEL_COLORS[label] ?? "#64809f" }))
  }, [data.comms])
  const total = segments.reduce((s, x) => s + x.value, 0)
  // FLOW-83 DonutCarve: hovering/focusing a legend row lifts its matching arc —
  // cross-highlight driven from the legend since the donut svg itself is
  // decorative (aria-hidden).
  const [active, setActive] = useState<string | null>(null)

  return (
    <div className="j-panel">
      <div className="flex items-center justify-between border-b border-white/6 px-4 py-2.5">
        <span className="j-label flex items-center gap-2">
          <LiveDot /> Comms by Channel
        </span>
      </div>
      <div className="px-4 py-3">
      {total === 0 ? (
        <div className="py-8 text-center j-fs-sm text-[color:var(--j-text-faint)]">No communications yet.</div>
      ) : (
        <div className="flex items-center gap-5">
          <Donut segments={segments} size={124} thickness={13} centerLabel={String(total)} centerSub="total" active={active} />
          <div className="min-w-0 flex-1 space-y-2">
            {segments.map((s) => (
              <div
                key={s.label}
                onMouseEnter={() => setActive(s.label)}
                onMouseLeave={() => setActive(null)}
                onFocus={() => setActive(s.label)}
                onBlur={() => setActive(null)}
                tabIndex={0}
                className="flex items-center gap-2 j-fs-sm focus-visible:outline-none"
              >
                <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: s.color }} />
                <span className="flex-1 capitalize text-[color:var(--j-text-dim)]">{s.label}</span>
                <span className="j-num font-mono font-bold text-[color:var(--j-text)]">{Math.round((s.value / total) * 100)}%</span>
              </div>
            ))}
          </div>
        </div>
      )}
      <p className="mt-3 j-fs-micro text-[color:var(--j-text-faint)]">From the real communications log, newest 100.</p>
      </div>
    </div>
  )
}

export function ActionMixBars() {
  const data = useJarvis()
  const rows = useMemo(() => {
    const stats = data.insights?.actionTypeStats ?? []
    return stats
      .slice()
      .sort((a, b) => b.total - a.total)
      .slice(0, 5)
  }, [data.insights])
  const max = Math.max(1, ...rows.map((r) => r.total))

  return (
    <div className="j-panel">
      <div className="flex items-center justify-between border-b border-white/6 px-4 py-2.5">
        <span className="j-label flex items-center gap-2">
          <LiveDot /> What Finnor Works On
        </span>
      </div>
      <div className="px-4 py-3">
      {rows.length === 0 ? (
        <div className="py-8 text-center j-fs-sm text-[color:var(--j-text-faint)]">No planned actions yet.</div>
      ) : (
        <div className="space-y-3">
          {rows.map((r, i) => (
            <div key={r.actionType}>
              <div className="mb-1 flex items-center justify-between j-fs-sm">
                <span className="capitalize text-[color:var(--j-text-dim)]">{r.actionType.replaceAll("_", " ")}</span>
                <span className="j-num font-mono font-bold text-[color:var(--j-text)]">{r.total}</span>
              </div>
              <GradientBar pct={(r.total / max) * 100} from={BAR_GRADS[i % BAR_GRADS.length]![0]} to={BAR_GRADS[i % BAR_GRADS.length]![1]} index={i} />
            </div>
          ))}
        </div>
      )}
      <p className="mt-3 j-fs-micro text-[color:var(--j-text-faint)]">Planner action counts, last 90 days.</p>
      </div>
    </div>
  )
}

export function AiPerformance() {
  const data = useJarvis()
  const { approvalRate, decided } = useMemo(() => {
    const stats = data.insights?.actionTypeStats ?? []
    let dec = 0
    let rej = 0
    for (const s of stats) {
      dec += s.decided ?? 0
      rej += s.rejected ?? 0
    }
    return { approvalRate: dec > 0 ? Math.round(((dec - rej) / dec) * 100) : null, decided: dec }
  }, [data.insights])

  // F5.T2 — FLOW-86/87 graceful-absent wiring: Insights.forecastBand/anomalies
  // (data-core.ts) aren't returned by any real API deploy yet (B3's job), so
  // `anomaly` and `forecastBand` below are always undefined today — ForecastBand
  // and AnomalyFlare both render nothing until B3 ships. The point math reuses the
  // SAME toPoints scale AreaSparkline draws with, so alignment is exact the moment
  // real data arrives, not approximated.
  const anomaly = data.insights?.anomalies?.[0]
  const anomalyPoint = useMemo(() => {
    if (!anomaly || data.latencyHistory.length < 2) return null
    const pts = toPoints(data.latencyHistory, 260, 44)
    const p = pts[anomaly.index]
    return p ? { x: p[0], y: p[1] } : null
  }, [anomaly, data.latencyHistory])

  return (
    <div className="j-panel">
      <div className="flex items-center justify-between border-b border-white/6 px-4 py-2.5">
        <span className="j-label flex items-center gap-2">
          <LiveDot /> System Performance
        </span>
      </div>
      <div className="px-4 py-3">
      <div className="space-y-2.5">
        <div className="flex items-baseline justify-between">
          <span className="j-fs-sm text-[color:var(--j-text-dim)]">API round-trip</span>
          <span className="j-num font-mono text-lg font-bold text-cyan-300">
            {data.apiLatencyMs != null ? <CountUp value={data.apiLatencyMs} format={(n) => `${Math.round(n)}ms`} /> : "—"}
          </span>
        </div>
        {data.latencyHistory.length > 1 && (
          <div className="relative rounded-lg border border-white/5 bg-black/20 px-2 py-1.5">
            <ForecastBand band={data.insights?.forecastBand} width={260} height={44} />
            <AreaSparkline values={data.latencyHistory} width={260} height={44} color="var(--j-cyan)" className="w-full" axisEtch />
            <AnomalyFlare point={anomalyPoint} label={anomaly?.label} />
            <div className="mt-0.5 flex justify-between j-fs-micro font-bold uppercase tracking-widest text-[color:var(--j-text-faint)]">
              <span>measured live · one point per poll</span>
              <span>{data.latencyHistory.length} samples</span>
            </div>
          </div>
        )}
        <div className="flex items-baseline justify-between">
          <span className="j-fs-sm text-[color:var(--j-text-dim)]">Owner approval rate</span>
          <span className="j-num font-mono text-lg font-bold text-emerald-300">{approvalRate != null ? `${approvalRate}%` : "—"}</span>
        </div>
        <div className="flex items-baseline justify-between">
          <span className="j-fs-sm text-[color:var(--j-text-dim)]">Decisions made</span>
          <span className="j-num font-mono text-lg font-bold text-[color:var(--j-text)]">{decided}</span>
        </div>
        {data.approvalsThisSession + data.rejectionsThisSession > 0 && (
          <div className="flex items-baseline justify-between">
            <span className="j-fs-sm text-[color:var(--j-text-dim)]">This session</span>
            <span className="j-chip bg-teal-400/10 text-teal-300">
              {data.approvalsThisSession} approved · {data.rejectionsThisSession} rejected
            </span>
          </div>
        )}
      </div>
      </div>
    </div>
  )
}
