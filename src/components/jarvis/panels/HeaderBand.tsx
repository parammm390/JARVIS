"use client"

// Greeting header — the reference image's top band. Big time-of-day greeting, an
// honest one-line status built ONLY from nonzero real counts, and on the right a
// listening pill (animated only while a voice session is genuinely live), the real
// measured latency, and a ticking clock.

import { useEffect, useState } from "react"
import { motion } from "framer-motion"
import { useJarvisAuth } from "../lib/jarvis-auth"
import {
  mapTruth,
  selectEventsToday,
  selectFirstName,
  selectOverdueInvoices,
  selectPendingApprovals,
  selectRunsInFlight,
} from "../kernel/selectors"
import { useLanePresentation, useSelectorInput } from "../kernel/useSelectorInput"
import type { LanePresentation } from "../kernel/useSelectorInput"
import type { Truth } from "../kernel/types"
import type { useVapiSession } from "../lib/useVapiSession"

function systemStatus(data: LanePresentation): { label: string; tone: "teal" | "amber" | "dim"; unconfigured: string[] } {
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

/** A count we are allowed to put in a sentence: a `Truth` that actually resolved to
 *  a number. Anything else contributes nothing — see `statusSentence`. */
function knownCount(t: Truth<number>): number | null {
  return t.status === "known" || t.status === "stale" || t.status === "partial" ? t.value : null
}

/**
 * The one-line status under the greeting.
 *
 * P1 (C-01, in prose): this used to be built from nullish-coalesced zeros, so a signed-out
 * visitor — four 401s — got all zeros, no clauses, and therefore the confident
 * sentence "Systems idle." We do not know that the business is idle; we know we were
 * not allowed to look. A fact contributes a clause only when it is actually known,
 * and when nothing is known the sentence is omitted entirely rather than guessed.
 *
 * Returns null to mean "say nothing". The idle copy is unchanged and is now only
 * reachable when every input genuinely resolved to zero.
 */
function statusSentence(
  pending: Truth<number>,
  runsInFlight: Truth<number>,
  overdue: Truth<number>,
  eventsToday: Truth<number>,
): string | null {
  const counts = [pending, runsInFlight, overdue, eventsToday].map(knownCount)
  if (counts.every((c) => c === null)) return null

  const [p, r, o, e] = counts
  const parts: string[] = []
  if (p !== null && p > 0) parts.push(`${p} approval${p === 1 ? "" : "s"} waiting on you`)
  if (r !== null && r > 0) parts.push(`${r} workflow${r === 1 ? "" : "s"} running`)
  if (o !== null && o > 0) parts.push(`${o} overdue invoice${o === 1 ? "" : "s"}`)
  if (e !== null && e > 0) parts.push(`${e} business event${e === 1 ? "" : "s"} today`)
  if (parts.length === 0) return "Systems idle. Speak to Finnor to make something happen."
  return `Right now: ${parts.join(" · ")}.`
}

export function HeaderBand({ session }: { session?: ReturnType<typeof useVapiSession> }) {
  const lane = useLanePresentation()
  // P1.T8 / defect C-02: this greeting used to hardcode one developer's own first
  // name into the salutation shown to every visitor on production, signed in or
  // not. Null means nobody is named — the greeting drops the name rather than
  // borrowing one.
  const auth = useJarvisAuth()
  const selectorInput = useSelectorInput()
  const firstName = selectFirstName(auth.session?.user)
  const [clock, setClock] = useState("")
  useEffect(() => {
    if (lane.now) setClock(new Date(lane.now).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" }))
  }, [lane.now])

  const status = systemStatus(lane)
  const hour = lane.now ? new Date(lane.now).getHours() : 9
  const timeOfDay = hour < 12 ? "Good morning" : hour < 18 ? "Good afternoon" : "Good evening"
  // Every count in the status sentence comes from a selector and carries its own
  // Truth, so a lane we were refused contributes nothing instead of a zero.
  const pending = selectPendingApprovals(selectorInput)
  const runsInFlight = selectRunsInFlight(selectorInput)
  const overdue = mapTruth(selectOverdueInvoices(selectorInput), (o) => o.count)
  const eventsToday = selectEventsToday(selectorInput)
  const sentence = statusSentence(pending, runsInFlight, overdue, eventsToday)
  const voiceLive = session && (session.voiceState === "live" || session.voiceState === "speaking")
  // A local mic level, not a network fact: no session means the mic is closed, and
  // silence is the real reading for a closed mic. Written as an explicit branch so
  // the file carries no nullish-coalesced zero at all, network or otherwise.
  const volumeLevel = typeof session?.volumeLevel === "number" ? session.volumeLevel : 0

  return (
    <div className="flex flex-wrap items-center justify-between gap-3 px-1">
      <div>
        <motion.h1
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.6, ease: [0.22, 1, 0.36, 1] }}
          className="text-xl font-black tracking-tight text-[color:var(--j-text)] md:text-2xl"
        >
          {firstName ? `${timeOfDay}, ${firstName}` : timeOfDay} <span className="inline-block">👋</span>
        </motion.h1>
        {sentence && (
          <motion.p
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ duration: 0.7, delay: 0.15 }}
            className="mt-0.5 j-fs-sm text-[color:var(--j-text-dim)]"
          >
            {sentence}
          </motion.p>
        )}
      </div>
      <div className="flex items-center gap-2.5 md:min-w-[25rem]">
        <div
          className={`flex items-center gap-2 rounded-full border px-3.5 py-1.5 transition-[width] duration-300 ${
            voiceLive ? "j-panel-hot border-cyan-400/40 bg-cyan-400/8 text-cyan-200" : "border-white/10 bg-white/[0.03] text-[color:var(--j-text-dim)]"
          }`}
        >
          <span className="j-fs-micro font-bold">
            {session?.voiceState === "connecting" ? (
              <span className="inline-flex items-center gap-1">
                Connecting
                {[0, 1, 2].map((i) => (
                  <span key={i} className="h-1 w-1 rounded-full bg-cyan-300" style={{ animation: `jarvis-dot-blink 1.2s ${i * 0.2}s infinite` }} />
                ))}
              </span>
            ) : voiceLive ? (
              "Listening…"
            ) : (
              "Voice ready"
            )}
          </span>
          <span className="flex h-3.5 items-center gap-[2px]" aria-hidden>
            {Array.from({ length: 9 }).map((_, i) =>
              voiceLive ? (
                <span
                  key={i}
                  className="w-[2px] rounded-full bg-cyan-300 transition-transform duration-100"
                  style={{ height: "8px", transform: `scaleY(${0.3 + volumeLevel * 1.4})`, transformOrigin: "center" }}
                />
              ) : (
                <span
                  key={i}
                  className="w-[2px] rounded-full bg-white/25"
                  style={{ height: `${5 + ((i * 43) % 8)}px`, transformOrigin: "center" }}
                />
              ),
            )}
          </span>
        </div>
        <div className="group relative">
          <span className={`j-chip min-w-[7.75rem] justify-center cursor-default uppercase tracking-widest ${TONE_CLASS[status.tone]}`}>{status.label}</span>
          {status.unconfigured.length > 0 && (
            <div className="pointer-events-none absolute right-0 top-full z-20 mt-2 w-64 rounded-xl border border-[color:var(--j-border)] bg-[#070d1a] p-3 j-fs-micro leading-relaxed text-[color:var(--j-text-dim)] opacity-0 shadow-2xl transition group-hover:opacity-100">
            {status.unconfigured.length} action types not yet configured: {status.unconfigured.slice(0, 6).map((a) => a.replaceAll("_", " ")).join(", ")}
            {status.unconfigured.length > 6 ? "…" : ""}
            </div>
          )}
        </div>
        <span className="hidden w-[5.5rem] font-mono text-xs font-bold tabular-nums tracking-wider text-[color:var(--j-text-dim)] md:inline">{clock}</span>
        <span className={`hidden w-[12rem] items-center gap-1.5 font-mono j-fs-micro font-bold tabular-nums text-[color:var(--j-text-faint)] md:flex ${lane.lastPollAtMs == null ? "invisible" : ""}`}>
          {lane.lastPollAtMs != null && (
            <>
            <span className="relative flex h-1.5 w-1.5">
              <span className="absolute h-full w-full animate-ping rounded-full bg-cyan-300 opacity-60" />
              <span className="relative h-1.5 w-1.5 rounded-full bg-cyan-300" />
            </span>
            synced {Math.max(0, Math.round((lane.now - lane.lastPollAtMs) / 1000))}s ago
            {lane.apiLatencyMs != null ? ` · ${lane.apiLatencyMs}ms` : ""}
            </>
          )}
        </span>
      </div>
    </div>
  )
}
