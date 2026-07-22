"use client"

// D1.T2 — the pulse bar: heartbeat dot pulsing at REAL age, queue sparkline
// (FLOW-20 DrawSpark self-draw on each new sample), DLQ badge, binding health lights
// (EMU-tagged where a capability is still emulating — honesty over polish, hard rule
// #7), scan clock (oldest overdue proactive scan). Every number comes from GET
// /api/vitals (A2.T5) via the typed jarvisClient (src/lib/jarvis-client.ts) — this
// component adds zero new backend logic, it's the first real consumer of a route that
// existed but had nowhere to render before D1.

import { useEffect, useRef, useState } from "react"
import { motion } from "framer-motion"
import { jarvisClient, type Vitals } from "@/lib/jarvis-client"
import { useLiveQuery } from "@/lib/jarvis/useLiveQuery"
import { useJarvisAuth } from "../lib/jarvis-auth"
import { StatusDot } from "../ui/primitives/StatusDot"
import { choreo } from "../ui/motion/choreo"

const HISTORY_LEN = 24

function ageLabel(seconds: number | null): string {
  if (seconds === null) return "—"
  if (seconds < 60) return `${Math.round(seconds)}s`
  if (seconds < 3600) return `${Math.round(seconds / 60)}m`
  return `${Math.round(seconds / 3600)}h`
}

function QueueSparkline({ values }: { values: number[] }) {
  if (values.length < 2) return <div className="h-6 w-full" />
  const w = 108
  const h = 24
  const max = Math.max(1, ...values)
  const points = values.map((v, i) => {
    const x = (i / (values.length - 1)) * w
    const y = h - (v / max) * (h - 4) - 2
    return `${x.toFixed(1)},${y.toFixed(1)}`
  })
  const d = `M${points.join(" L")}`
  return (
    <svg viewBox={`0 0 ${w} ${h}`} width={w} height={h} className="overflow-visible">
      <motion.path
        key={values.length}
        d={d}
        fill="none"
        stroke="var(--j-cyan)"
        strokeWidth={1.5}
        strokeLinecap="round"
        strokeLinejoin="round"
        variants={choreo.drawSpark.variants}
        initial="initial"
        animate="animate"
      />
    </svg>
  )
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

  const { data, connection } = useLiveQuery<Vitals & { cursor: null }, null>({
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
      <div className="rounded-xl border border-white/8 bg-white/[0.02] p-3 text-center text-[10px] font-semibold text-[color:var(--j-text-faint)]">
        Sign in for live vitals
      </div>
    )
  }

  if (!data) {
    return <div className="rounded-xl border border-white/8 bg-white/[0.02] p-3 text-[10px] text-[color:var(--j-text-faint)]">Reading pulse…</div>
  }

  const scanAge = oldestScanAgeSeconds(data.scans)
  const bindingEntries = Object.entries(data.bindings)

  return (
    <div className="space-y-2.5 rounded-xl border border-white/8 bg-white/[0.02] p-3" data-connection={connection}>
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <StatusDot status={data.heartbeat.healthy ? "ok" : "down"} />
          <span className="text-[10px] font-bold uppercase tracking-widest text-[color:var(--j-text-dim)]">Worker</span>
        </div>
        <span className="font-mono text-[10px] font-bold text-[color:var(--j-text)]">{ageLabel(data.heartbeat.ageSeconds)}</span>
      </div>

      <div>
        <div className="flex items-center justify-between">
          <span className="text-[10px] font-bold uppercase tracking-widest text-[color:var(--j-text-dim)]">Queue</span>
          <span className="font-mono text-[11px] font-black text-[color:var(--j-text)]">{data.queue.depth}</span>
        </div>
        {!compact && <QueueSparkline values={history} />}
        {data.queue.oldestPendingAgeSeconds !== null && (
          <p className="text-[9px] text-[color:var(--j-text-faint)]">oldest pending {ageLabel(data.queue.oldestPendingAgeSeconds)}</p>
        )}
      </div>

      <div className="flex items-center justify-between">
        <span className="text-[10px] font-bold uppercase tracking-widest text-[color:var(--j-text-dim)]">DLQ</span>
        <span
          className={`j-chip ${data.dlq.openCount > 0 ? "bg-red-400/12 text-red-300" : "bg-white/5 text-[color:var(--j-text-faint)]"}`}
        >
          {data.dlq.openCount} open
        </span>
      </div>

      {!compact && (
        <div className="space-y-1">
          <span className="text-[10px] font-bold uppercase tracking-widest text-[color:var(--j-text-dim)]">Bindings</span>
          <div className="flex flex-wrap gap-1.5">
            {bindingEntries.map(([cap, mode]) => (
              <span key={cap} className="inline-flex items-center gap-1 rounded-full border border-white/8 bg-white/[0.015] px-2 py-0.5 text-[9px] font-semibold text-[color:var(--j-text-dim)]">
                <StatusDot status={bindingStatus(mode)} />
                {cap}
                {mode === "emulator" && <span className="rounded-sm bg-amber-400/15 px-1 text-[8px] font-black text-amber-300">EMU</span>}
              </span>
            ))}
          </div>
        </div>
      )}

      <div className="flex items-center justify-between">
        <span className="text-[10px] font-bold uppercase tracking-widest text-[color:var(--j-text-dim)]">Scans</span>
        <span className={`font-mono text-[10px] font-bold ${scanAge !== null && scanAge > 3600 ? "text-amber-300" : "text-[color:var(--j-text)]"}`}>
          {scanAge === null ? "none yet" : `${ageLabel(scanAge)} oldest`}
        </span>
      </div>
    </div>
  )
}
