"use client"

// D1.T2 — the pulse bar: heartbeat dot pulsing at REAL age, queue sparkline
// (FLOW-20 DrawSpark self-draw on each new sample), DLQ badge, binding health lights
// (EMU-tagged where a capability is still emulating — honesty over polish, hard rule
// #7), scan clock (oldest overdue proactive scan). Every number comes from GET
// /api/vitals (A2.T5) via the typed jarvisClient (src/lib/jarvis-client.ts) — this
// component adds zero new backend logic, it's the first real consumer of a route that
// existed but had nowhere to render before D1.

import { useEffect, useRef, useState } from "react"
import { motion, useReducedMotion } from "framer-motion"
import { jarvisClient, type Vitals } from "@/lib/jarvis-client"
import { useLiveQuery } from "@/lib/jarvis/useLiveQuery"
import { useJarvisAuth } from "../lib/jarvis-auth"
import { StatusDot } from "../ui/primitives/StatusDot"
import { choreo } from "../ui/motion/choreo"
import { Ticker } from "../ui/motion/primitives"
import { registerAnchor } from "../lib/pulse-bus"
import { AreaSparkline } from "../lib/charts"
import { ErrorState } from "../ui/primitives/ErrorState"
import { PermissionVeil } from "../ui/primitives/PermissionVeil"

// F2.T3 — FLOW-45 VitalsBreath: the heartbeat dot's period is a real function of its
// own real age (fresher = faster breathing, matching a genuinely healthy worker),
// never a fixed decorative pulse. Past 90s (2x the fast-lane's own 4s poll cadence
// gives it generous slack — this is heartbeat age, not poll age) the worker reads
// stale and the dot switches to a one-shot flatline sweep instead of breathing
// forever on data that's no longer being confirmed.
const HEARTBEAT_STALE_S = 90
function heartbeatPeriodSec(ageSeconds: number): number {
  return Math.min(6, Math.max(1.4, 1.4 + ageSeconds / 20))
}

function HeartbeatPulse({ healthy, ageSeconds }: { healthy: boolean; ageSeconds: number | null }) {
  const reduced = useReducedMotion()
  const stale = ageSeconds !== null && ageSeconds > HEARTBEAT_STALE_S
  if (!healthy || stale) {
    return (
      <span className="relative inline-flex h-1.5 w-4 items-center" aria-hidden data-status="down">
        <motion.span
          className="h-[1.5px] w-full rounded-full bg-amber-400"
          initial={{ scaleX: 0.2, opacity: 0.5 }}
          animate={reduced ? { scaleX: 1, opacity: 1 } : { scaleX: [0.2, 1, 0.2], opacity: [0.5, 1, 0.5] }}
          transition={reduced ? { duration: 0 } : { duration: 1.4, repeat: Infinity, ease: "easeInOut" }}
        />
      </span>
    )
  }
  const period = reduced ? 0 : heartbeatPeriodSec(ageSeconds ?? 0)
  return (
    <span className="relative inline-flex h-1.5 w-1.5" aria-hidden data-status="ok">
      <motion.span
        className="absolute inline-flex h-full w-full rounded-full bg-[#2dd4bf]"
        initial={{ scale: 1, opacity: 0.6 }}
        animate={period ? { scale: [1, 1.8, 1], opacity: [0.6, 0, 0.6] } : { scale: 1, opacity: 0.3 }}
        transition={period ? { duration: period, repeat: Infinity, ease: "easeInOut" } : { duration: 0 }}
      />
      <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-[#2dd4bf]" />
    </span>
  )
}

// F2.T3 — FLOW-40 PulseLiquidGauges: queue depth + DLQ backlog as tiny liquid
// vessels with a meniscus line, reusing choreo.liquidFill (C2's own FLOW-05 preset)
// rather than inventing a second fill animation. `capacity` is an honest visual
// ceiling for the vessel's scale, not a real system limit — values beyond it simply
// read as "full", same as any gauge.
function LiquidVessel({ value, capacity, color }: { value: number; capacity: number; color: string }) {
  const reduced = useReducedMotion()
  const ratio = Math.max(0, Math.min(1, value / capacity))
  const transition = reduced ? { duration: 0 } : (choreo.liquidFill.variants.animate as { transition: object }).transition
  return (
    <span className="relative inline-block h-5 w-2.5 shrink-0 overflow-hidden rounded-sm border border-white/10 bg-white/[0.03]" aria-hidden>
      <motion.span
        initial={{ scaleY: 0, originY: 1 }}
        animate={{ scaleY: ratio, originY: 1, transition }}
        className="absolute inset-x-0 bottom-0"
        style={{ height: "100%", background: color }}
      />
      {ratio > 0 && ratio < 1 && <span className="absolute inset-x-0 rounded-full" style={{ bottom: `${ratio * 100}%`, height: 1, background: color, opacity: 0.7 }} />}
    </span>
  )
}

const HISTORY_LEN = 24

function ageLabel(seconds: number | null): string {
  if (seconds === null) return "—"
  if (seconds < 60) return `${Math.round(seconds)}s`
  if (seconds < 3600) return `${Math.round(seconds / 60)}m`
  return `${Math.round(seconds / 3600)}h`
}

// F5.T3 — adoption: this used to be a bespoke FLOW-20 DrawSpark-only path (no
// gradient fill, no latest-point pulse). Swapped for the grammar AreaSparkline so
// PulseBar's queue trend gets FLOW-84 SparkPulse (and FLOW-81 AxisEtch) for free,
// same real `history` data, zero new fetches.
function QueueSparkline({ values }: { values: number[] }) {
  if (values.length < 2) return <div className="h-6 w-full" />
  return <AreaSparkline values={values} width={108} height={24} color="var(--j-cyan)" className="w-full" axisEtch />
}

function bindingStatus(mode: string): "ok" | "degraded" | "unknown" {
  if (mode === "emulator") return "degraded"
  if (mode === "native" || mode === "vapi" || mode === "sandbox") return "ok"
  return "unknown"
}

function oldestScanAgeSeconds(scans: Record<string, string | null>): number | null {
  const now = Date.now()
  let oldest: number | null = null
  for (const iso of Object.values(scans)) {
    if (!iso) continue
    const age = (now - new Date(iso).getTime()) / 1000
    if (oldest === null || age > oldest) oldest = age
  }
  return oldest
}

export function PulseBar({ compact = false }: { compact?: boolean }) {
  const { session } = useJarvisAuth()
  const historyRef = useRef<number[]>([])
  const [history, setHistory] = useState<number[]>([])
  const rootRef = useRef<HTMLDivElement | null>(null)

  // F2.T3 — FLOW-49 ConstellationLink's real target anchor for the "ops"/"pipeline"
  // KPI cards (see ConstellationLink.tsx's hand-authored lineage map).
  useEffect(() => registerAnchor("pulse-bar", () => rootRef.current?.getBoundingClientRect() ?? null), [])

  const { data, connection, error } = useLiveQuery<Vitals & { cursor: null }, null>({
    fetchPage: async () => {
      const v = await jarvisClient.vitals()
      return { ...v, cursor: null }
    },
    reduce: (_prev, next) => next,
    visibleIntervalMs: 4000,
    blurredIntervalMs: 25000,
    enabled: !!session,
  })

  useEffect(() => {
    if (!data) return
    historyRef.current = [...historyRef.current, data.queue.depth].slice(-HISTORY_LEN)
    setHistory(historyRef.current)
  }, [data])

  if (!session) {
    return (
      <div className="rounded-xl border border-white/8 bg-white/[0.02] p-3">
        <PermissionVeil reason="Sign in for live vitals — real worker heartbeat, queue depth, and DLQ backlog for your own tenant." actionLabel="Sign in" actionHref="/jarvis/login" />
      </div>
    )
  }

  if (!data) {
    // F6.T3 — FLOW-89 ErrorFracture: a genuine poll failure (not merely "still
    // loading" — useLiveQuery's own `error` distinguishes the two) surfaces the real
    // message instead of the generic "Reading pulse…" forever. No onRetry here: the
    // hook already retries on its own visibleIntervalMs cadence — a fake retry button
    // would just be theater on top of behavior that already happens.
    if (error) {
      return (
        <div className="rounded-xl border border-white/8 bg-white/[0.02] p-3">
          <ErrorState message={`Vitals unreachable: ${error}`} />
        </div>
      )
    }
    return <div className="rounded-xl border border-white/8 bg-white/[0.02] p-3 j-fs-micro text-[color:var(--j-text-faint)]">Reading pulse…</div>
  }

  const scanAge = oldestScanAgeSeconds(data.scans)
  const bindingEntries = Object.entries(data.bindings)

  return (
    <div ref={rootRef} className="space-y-2.5 rounded-xl border border-white/8 bg-white/[0.02] p-3" data-connection={connection}>
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <HeartbeatPulse healthy={data.heartbeat.healthy} ageSeconds={data.heartbeat.ageSeconds} />
          <span className="j-fs-micro font-bold uppercase tracking-widest text-[color:var(--j-text-dim)]">Worker</span>
        </div>
        <span className="j-num font-mono j-fs-micro font-bold text-[color:var(--j-text)]">{ageLabel(data.heartbeat.ageSeconds)}</span>
      </div>

      <div>
        <div className="flex items-center justify-between gap-2">
          <span className="j-fs-micro font-bold uppercase tracking-widest text-[color:var(--j-text-dim)]">Queue</span>
          <span className="flex items-center gap-1.5">
            <LiquidVessel value={data.queue.depth} capacity={20} color="var(--j-cyan)" />
            <Ticker value={data.queue.depth} className="j-num font-mono j-fs-micro font-black text-[color:var(--j-text)]" />
          </span>
        </div>
        {!compact && <QueueSparkline values={history} />}
        {data.queue.oldestPendingAgeSeconds !== null && (
          <p className="j-num j-fs-micro text-[color:var(--j-text-faint)]">oldest pending {ageLabel(data.queue.oldestPendingAgeSeconds)}</p>
        )}
      </div>

      <div className="flex items-center justify-between gap-2">
        <span className="j-fs-micro font-bold uppercase tracking-widest text-[color:var(--j-text-dim)]">DLQ</span>
        <span className="flex items-center gap-1.5">
          <LiquidVessel value={data.dlq.openCount} capacity={5} color="var(--j-red)" />
          <span className={`j-chip ${data.dlq.openCount > 0 ? "bg-red-400/12 text-red-300" : "bg-white/5 text-[color:var(--j-text-faint)]"}`}>
            {data.dlq.openCount} open
          </span>
        </span>
      </div>

      {!compact && (
        <div className="space-y-1">
          <span className="j-fs-micro font-bold uppercase tracking-widest text-[color:var(--j-text-dim)]">Bindings</span>
          <div className="flex flex-wrap gap-1.5">
            {bindingEntries.map(([cap, mode]) => (
              <span key={cap} className="inline-flex items-center gap-1 rounded-full border border-white/8 bg-white/[0.015] px-2 py-0.5 j-fs-micro font-semibold text-[color:var(--j-text-dim)]">
                <StatusDot status={bindingStatus(mode)} />
                {cap}
                {mode === "emulator" && <span className="rounded-sm bg-amber-400/15 px-1 j-fs-micro font-black text-amber-300">EMU</span>}
              </span>
            ))}
          </div>
        </div>
      )}

      <div className="flex items-center justify-between">
        <span className="j-fs-micro font-bold uppercase tracking-widest text-[color:var(--j-text-dim)]">Scans</span>
        <span className={`j-num font-mono j-fs-micro font-bold ${scanAge !== null && scanAge > 3600 ? "text-amber-300" : "text-[color:var(--j-text)]"}`}>
          {scanAge === null ? "none yet" : `${ageLabel(scanAge)} oldest`}
        </span>
      </div>
    </div>
  )
}
