"use client"

// Bottom analytics band — the reference image's chart row, bound to real data only:
// comms-by-channel donut (real communications log), action-mix bars (real planner
// stats from /api/insights), and a live performance panel whose latency line REDRAWS
// every 4s from genuinely measured round-trips.

import { useMemo } from "react"
import { LiveDot } from "../atmosphere"
import { AreaSparkline, Donut, GradientBar } from "../lib/charts"
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

  return (
    <div className="j-panel p-4 md:p-5">
      <div className="mb-3 flex items-center gap-2">
        <LiveDot />
        <span className="j-label">Comms by Channel</span>
      </div>
      {total === 0 ? (
        <div className="py-8 text-center text-[12px] text-[color:var(--j-text-faint)]">No communications yet.</div>
      ) : (
        <div className="flex items-center gap-5">
          <Donut segments={segments} size={124} thickness={13} centerLabel={String(total)} centerSub="total" />
          <div className="min-w-0 flex-1 space-y-2">
            {segments.map((s) => (
              <div key={s.label} className="flex items-center gap-2 text-[11.5px]">
                <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: s.color }} />
                <span className="flex-1 capitalize text-[color:var(--j-text-dim)]">{s.label}</span>
                <span className="font-mono font-bold tabular-nums text-[color:var(--j-text)]">{Math.round((s.value / total) * 100)}%</span>
              </div>
            ))}
          </div>
        </div>
      )}
      <p className="mt-3 text-[9.5px] text-[color:var(--j-text-faint)]">From the real communications log, newest 100.</p>
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
    <div className="j-panel p-4 md:p-5">
      <div className="mb-3 flex items-center gap-2">
        <LiveDot />
        <span className="j-label">What Finnor Works On</span>
      </div>
      {rows.length === 0 ? (
        <div className="py-8 text-center text-[12px] text-[color:var(--j-text-faint)]">No planned actions yet.</div>
      ) : (
        <div className="space-y-3">
          {rows.map((r, i) => (
            <div key={r.actionType}>
              <div className="mb-1 flex items-center justify-between text-[11.5px]">
                <span className="capitalize text-[color:var(--j-text-dim)]">{r.actionType.replaceAll("_", " ")}</span>
                <span className="font-mono font-bold tabular-nums text-[color:var(--j-text)]">{r.total}</span>
              </div>
              <GradientBar pct={(r.total / max) * 100} from={BAR_GRADS[i % BAR_GRADS.length]![0]} to={BAR_GRADS[i % BAR_GRADS.length]![1]} />
            </div>
          ))}
        </div>
      )}
      <p className="mt-3 text-[9.5px] text-[color:var(--j-text-faint)]">Planner action counts, last 90 days.</p>
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

  return (
    <div className="j-panel p-4 md:p-5">
      <div className="mb-3 flex items-center gap-2">
        <LiveDot />
        <span className="j-label">System Performance</span>
      </div>
      <div className="space-y-2.5">
        <div className="flex items-baseline justify-between">
          <span className="text-[11.5px] text-[color:var(--j-text-dim)]">API round-trip</span>
          <span className="font-mono text-lg font-bold tabular-nums text-cyan-300">
            {data.apiLatencyMs != null ? <CountUp value={data.apiLatencyMs} format={(n) => `${Math.round(n)}ms`} /> : "—"}
          </span>
        </div>
        {data.latencyHistory.length > 1 && (
          <div className="rounded-lg border border-white/5 bg-black/20 px-2 py-1.5">
            <AreaSparkline values={data.latencyHistory} width={260} height={44} color="var(--j-cyan)" className="w-full" />
            <div className="mt-0.5 flex justify-between text-[8.5px] font-bold uppercase tracking-widest text-[color:var(--j-text-faint)]">
              <span>measured live · one point per poll</span>
              <span>{data.latencyHistory.length} samples</span>
            </div>
          </div>
        )}
        <div className="flex items-baseline justify-between">
          <span className="text-[11.5px] text-[color:var(--j-text-dim)]">Owner approval rate</span>
          <span className="font-mono text-lg font-bold tabular-nums text-emerald-300">{approvalRate != null ? `${approvalRate}%` : "—"}</span>
        </div>
        <div className="flex items-baseline justify-between">
          <span className="text-[11.5px] text-[color:var(--j-text-dim)]">Decisions made</span>
          <span className="font-mono text-lg font-bold tabular-nums text-[color:var(--j-text)]">{decided}</span>
        </div>
        {data.approvalsThisSession + data.rejectionsThisSession > 0 && (
          <div className="flex items-baseline justify-between">
            <span className="text-[11.5px] text-[color:var(--j-text-dim)]">This session</span>
            <span className="j-chip bg-teal-400/10 text-teal-300">
              {data.approvalsThisSession} approved · {data.rejectionsThisSession} rejected
            </span>
          </div>
        )}
      </div>
    </div>
  )
}
