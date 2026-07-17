"use client"

// Greeting header — the reference image's top band. Big time-of-day greeting, an
// honest one-line status built ONLY from nonzero real counts, and on the right a
// listening pill (animated only while a voice session is genuinely live), the real
// measured latency, and a ticking clock.

import { useEffect, useState } from "react"
import { motion } from "framer-motion"
import { useJarvis } from "../lib/data-core"
import type { useVapiSession } from "../lib/useVapiSession"

function systemStatus(data: ReturnType<typeof useJarvis>): { label: string; tone: "teal" | "amber" | "dim"; unconfigured: string[] } {
  if (data.setupDegraded || !data.setupStatus) return { label: "Standalone", tone: "dim", unconfigured: [] }
  const unconfigured = data.setupStatus.actionTypes.filter((e) => e.status !== "configured").map((e) => e.actionType)
  if (unconfigured.length === 0) return { label: "Optimal", tone: "teal", unconfigured: [] }
  return { label: "Partial config", tone: "amber", unconfigured }
}

const TONE_CLASS: Record<string, string> = {
  teal: "bg-teal-300/12 text-teal-200",
  amber: "bg-amber-300/12 text-amber-200",
  dim: "bg-white/8 text-white/50",
}

function statusSentence(pendingCount: number, runsInFlight: number, overdueCount: number, eventsToday: number): string {
  const parts: string[] = []
  if (pendingCount > 0) parts.push(`${pendingCount} approval${pendingCount === 1 ? "" : "s"} waiting on you`)
  if (runsInFlight > 0) parts.push(`${runsInFlight} workflow${runsInFlight === 1 ? "" : "s"} running`)
  if (overdueCount > 0) parts.push(`${overdueCount} overdue invoice${overdueCount === 1 ? "" : "s"}`)
  if (eventsToday > 0) parts.push(`${eventsToday} business event${eventsToday === 1 ? "" : "s"} today`)
  if (parts.length === 0) return "Systems idle. Speak to Finnor to make something happen."
  return `Right now: ${parts.join(" · ")}.`
}

export function HeaderBand({ session }: { session?: ReturnType<typeof useVapiSession> }) {
  const data = useJarvis()
  const [clock, setClock] = useState("")
  useEffect(() => {
    if (data.now) setClock(new Date(data.now).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" }))
  }, [data.now])

  const status = systemStatus(data)
  const hour = data.now ? new Date(data.now).getHours() : 9
  const timeOfDay = hour < 12 ? "Good morning" : hour < 18 ? "Good afternoon" : "Good evening"
  const pendingCount = data.stats?.pending ?? 0
  const overdueCount = data.cashCollections?.invoicesByStatus.find((s) => s.status === "overdue")?.count ?? 0
  const eventsToday = data.events.filter((e) => new Date(e.occurredAt).toDateString() === new Date(data.now).toDateString()).length
  const voiceLive = session && (session.voiceState === "live" || session.voiceState === "speaking")

  return (
    <div className="flex flex-wrap items-center justify-between gap-3 px-1">
      <div>
        <motion.h1
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.6, ease: [0.22, 1, 0.36, 1] }}
          className="text-xl font-black tracking-tight text-[color:var(--j-text)] md:text-2xl"
        >
          {timeOfDay}, Param <span className="inline-block">👋</span>
        </motion.h1>
        <motion.p
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ duration: 0.7, delay: 0.15 }}
          className="mt-0.5 text-[12.5px] text-[color:var(--j-text-dim)]"
        >
          {statusSentence(pendingCount, data.runs.length, overdueCount, eventsToday)}
        </motion.p>
      </div>
      <div className="flex items-center gap-2.5">
        <div
          className={`flex items-center gap-2 rounded-full border px-3.5 py-1.5 ${
            voiceLive ? "border-cyan-400/40 bg-cyan-400/8 text-cyan-200" : "border-white/10 bg-white/[0.03] text-[color:var(--j-text-dim)]"
          }`}
        >
          <span className="text-[10.5px] font-bold">{voiceLive ? "Listening…" : "Voice ready"}</span>
          <span className="flex h-3.5 items-center gap-[2px]" aria-hidden>
            {Array.from({ length: 9 }).map((_, i) => (
              <span
                key={i}
                className={`w-[2px] rounded-full ${voiceLive ? "bg-cyan-300" : "bg-white/25"}`}
                style={{
                  height: `${5 + ((i * 43) % 8)}px`,
                  transformOrigin: "center",
                  animation: voiceLive ? `jarvis-listening-bar ${0.7 + (i % 4) * 0.13}s ease-in-out ${i * 0.06}s infinite` : undefined,
                }}
              />
            ))}
          </span>
        </div>
        <div className="group relative">
          <span className={`j-chip cursor-default uppercase tracking-widest ${TONE_CLASS[status.tone]}`}>{status.label}</span>
          {status.unconfigured.length > 0 && (
            <div className="pointer-events-none absolute right-0 top-full z-20 mt-2 w-64 rounded-xl border border-[color:var(--j-border)] bg-[#070d1a] p-3 text-[10.5px] leading-relaxed text-[color:var(--j-text-dim)] opacity-0 shadow-2xl transition group-hover:opacity-100">
            {status.unconfigured.length} action types not yet configured: {status.unconfigured.slice(0, 6).map((a) => a.replaceAll("_", " ")).join(", ")}
            {status.unconfigured.length > 6 ? "…" : ""}
            </div>
          )}
        </div>
        <span className="hidden font-mono text-xs font-bold tabular-nums tracking-wider text-[color:var(--j-text-dim)] md:inline">{clock}</span>
        {data.apiLatencyMs != null && (
          <span className="hidden font-mono text-[10.5px] font-bold tabular-nums text-[color:var(--j-text-faint)] md:inline">▁ {data.apiLatencyMs}ms</span>
        )}
      </div>
    </div>
  )
}
