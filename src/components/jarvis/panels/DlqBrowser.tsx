"use client"

// Phase 7 (§7.7) — owner-only DLQ browser: real dead_letters rows (terminal
// external-effect failures the runtime gave up retrying, Phase 2 §2.3), with
// replay/discard wired to the real routes. Never eagerly polled by the shared
// provider (data-core.ts) — an owner opens this occasionally, not every 4 seconds.

import { useCallback, useEffect, useState } from "react"
import { AnimatePresence, motion, useReducedMotion } from "framer-motion"
import { ArrowUpRight, ChevronDown, RefreshCw, RotateCcw, Trash2 } from "lucide-react"
import { jarvisGet, jarvisPost, JarvisApiError } from "../lib/api"
import { useJarvisAuth } from "../lib/jarvis-auth"
import { ageLabel } from "../lib/data-core"
import { DecryptText } from "../ui/fx/DecryptText"

// F8.T2 — FLOW-63 DLQGravityWell: a row's REAL disposition (replay vs discard)
// picks its exit choreography — discard sinks with a heavy settle (gravity),
// replay lifts with escape velocity (upward + fast) — never the other way, and
// never fabricated (only `act()`'s own genuinely-succeeded verb sets this).
export const GRAVITY_WELL_EXIT = {
  discard: { opacity: 0, y: 28, scale: 0.92, transition: { duration: 0.42, ease: [0.55, 0, 0.85, 0.2] as const } },
  replay: { opacity: 0, y: -46, scale: 1.04, transition: { duration: 0.32, ease: [0.16, 1, 0.3, 1] as const } },
}
export const GRAVITY_WELL_EXIT_REDUCED = { opacity: 0, transition: { duration: 0.12 } }

interface DeadLetter {
  id: string
  envelope: { type?: string; payload?: unknown }
  errorKind: string
  attempts: number
  firstSeenAt: string
  lastError: string
  replayable: boolean
  status: "open" | "replayed" | "discarded"
  suggestedDisposition?: "replay" | "discard" | "escalate" | null
  suggestionReason?: string | null
  relatedWorkflowRunId?: string | null
}

export function DlqBrowser() {
  const { role } = useJarvisAuth()
  const reduced = useReducedMotion()
  const [rows, setRows] = useState<DeadLetter[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [inflight, setInflight] = useState<string | null>(null)
  const [replayedRunId, setReplayedRunId] = useState<string | null>(null)
  const [now, setNow] = useState(Date.now())
  // FLOW-63 DLQGravityWell: which real verb a row settled on, read at the moment
  // AnimatePresence captures its exit animation (see `act()` below).
  const [settlingVerb, setSettlingVerb] = useState<Record<string, "replay" | "discard">>({})
  // FLOW-66 TriageWhisper: suggestionReason stays collapsed until a real row
  // expand — DecryptText only ever types in text this repo already has (A4.T3's
  // real suggested_disposition/suggestionReason), nothing fetched on expand.
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set())
  const toggleExpand = (id: string) =>
    setExpandedIds((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })

  const load = useCallback(async () => {
    setError(null)
    try {
      const res = await jarvisGet<{ deadLetters: DeadLetter[] }>("dlq", { status: "open" })
      setRows(res.deadLetters)
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't load the dead-letter queue.")
    }
  }, [])

  useEffect(() => {
    if (role !== "owner") return
    void load()
    setNow(Date.now())
  }, [role, load])

  // Phase 7 (§7.4): client-side courtesy only, matching the run-controls' own note —
  // the backend's canApprove(ctx,"*") gate is the real authorizer. `role` starts
  // null while /me is still loading, so this returns null a beat before an owner's
  // real access — an acceptable, brief false-negative, never a false-positive.
  if (role !== "owner") return null

  async function act(id: string, verb: "replay" | "discard") {
    if (inflight) return
    setInflight(id)
    try {
      const result = await jarvisPost<{ workflowRunId?: string | null }>(`dlq/${id}/${verb}`, {})
      if (verb === "replay") setReplayedRunId(result.workflowRunId ?? null)
      setSettlingVerb((prev) => ({ ...prev, [id]: verb }))
      setRows((prev) => prev?.filter((r) => r.id !== id) ?? prev)
    } catch (e) {
      setError(e instanceof JarvisApiError ? e.message : e instanceof Error ? e.message : "That didn't go through.")
    } finally {
      setInflight(null)
    }
  }

  return (
    <div className="j-panel">
      <div className="flex items-center justify-between border-b border-white/6 px-4 py-2.5">
        <span className="j-label">Dead-Letter Queue</span>
        <div className="flex items-center gap-2">
          {rows && rows.length > 0 && <span className="rounded-full bg-red-400/12 px-2 py-0.5 text-[10px] font-black text-red-300">{rows.length}</span>}
          <button
            type="button"
            onClick={() => void load()}
            className="rounded-full border border-white/12 p-1 text-white/50 hover:text-cyan-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-300/60"
          >
            <RefreshCw className="h-3 w-3" />
          </button>
        </div>
      </div>
      <div className="px-4 py-3">
        {error && <div className="mb-2 rounded-lg border border-red-400/30 bg-red-400/5 px-3 py-2 text-[11px] text-red-300">{error}</div>}
        {!rows && !error && <div className="jarvis-skeleton-tide h-16 rounded-lg bg-white/5" />}
        {rows && rows.length === 0 && <div className="rounded-xl border border-white/8 bg-white/[0.02] px-4 py-6 text-center text-[12px] text-[color:var(--j-text-dim)]">Nothing dead-lettered. Clean.</div>}
        <div className="space-y-2">
          <AnimatePresence initial={false}>
            {rows?.slice(0, 10).map((r) => {
              const expanded = expandedIds.has(r.id)
              const hasReason = Boolean(r.suggestionReason)
              return (
                <motion.div
                  key={r.id}
                  layout
                  initial={false}
                  exit={reduced ? GRAVITY_WELL_EXIT_REDUCED : GRAVITY_WELL_EXIT[settlingVerb[r.id] ?? "discard"]}
                  className="rounded-xl border border-white/10 bg-white/[0.02] p-3"
                >
                  <button
                    type="button"
                    onClick={() => hasReason && toggleExpand(r.id)}
                    aria-expanded={hasReason ? expanded : undefined}
                    className={`mb-1 flex w-full items-center justify-between gap-2 text-left text-[9px] font-black uppercase tracking-widest text-[color:var(--j-text-faint)] ${hasReason ? "cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-300/60" : "cursor-default"}`}
                  >
                    <span className="flex items-center gap-1">
                      {hasReason && <ChevronDown className={`h-3 w-3 transition-transform duration-200 ${expanded ? "rotate-180" : ""}`} />}
                      {r.envelope?.type ?? "unknown event"}
                    </span>
                    <span>{ageLabel(r.firstSeenAt, now)}</span>
                  </button>
                  <div className="text-[11px] text-[color:var(--j-text)]">{r.lastError}</div>
                  <div className="mt-1 flex flex-wrap gap-1">
                    <span className="rounded-full bg-white/8 px-2 py-0.5 text-[9px] text-white/50">{r.errorKind}</span>
                    <span className="rounded-full bg-white/8 px-2 py-0.5 text-[9px] text-white/50">{r.attempts} attempt{r.attempts === 1 ? "" : "s"}</span>
                    {r.suggestedDisposition && (
                      <span className={`rounded-full px-2 py-0.5 text-[9px] font-black ${r.suggestedDisposition === "replay" ? "bg-cyan-400/10 text-cyan-200" : r.suggestedDisposition === "discard" ? "bg-slate-400/10 text-slate-300" : "bg-amber-400/10 text-amber-200"}`}>
                        suggest {r.suggestedDisposition}
                      </span>
                    )}
                  </div>
                  {/* FLOW-66 TriageWhisper: the real suggestionReason (A4.T3) types
                      itself in via DecryptText only once this row is genuinely
                      expanded → instant text, no scramble (reduced, DecryptText's
                      own built-in reduced-motion branch). */}
                  {expanded && r.suggestionReason && (
                    <DecryptText text={r.suggestionReason} mode="decrypt" charMs={14} className="mt-2 block text-[10px] leading-relaxed text-[color:var(--j-text-dim)]" />
                  )}
                  <div className="mt-2 flex gap-2">
                    {r.replayable && (
                      <button
                        type="button"
                        disabled={inflight === r.id}
                        onClick={() => act(r.id, "replay")}
                        className="inline-flex items-center gap-1 rounded-full border border-white/15 px-3 py-1 text-[10px] font-black text-white/70 hover:text-cyan-200 disabled:opacity-40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-300/60"
                      >
                        <RotateCcw className="h-3 w-3" /> Replay
                      </button>
                    )}
                    <button
                      type="button"
                      disabled={inflight === r.id}
                      onClick={() => act(r.id, "discard")}
                      className="inline-flex items-center gap-1 rounded-full border border-white/15 px-3 py-1 text-[10px] font-black text-white/50 hover:text-red-300 disabled:opacity-40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-300/60"
                    >
                      <Trash2 className="h-3 w-3" /> Discard
                    </button>
                  </div>
                  {r.relatedWorkflowRunId && (
                    <a
                      href={`/jarvis?workflowRunId=${encodeURIComponent(r.relatedWorkflowRunId)}#workflow-theater`}
                      className="mt-2 inline-flex items-center gap-1 text-[10px] font-black text-cyan-300/80 hover:text-cyan-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-300/60"
                    >
                      View linked workflow <ArrowUpRight className="h-3 w-3" />
                    </a>
                  )}
                </motion.div>
              )
            })}
          </AnimatePresence>
          {replayedRunId && (
            <a
              href={`/jarvis?workflowRunId=${encodeURIComponent(replayedRunId)}#workflow-theater`}
              className="inline-flex items-center gap-1 rounded-lg border border-cyan-300/20 bg-cyan-300/5 px-3 py-2 text-[10px] font-black text-cyan-100 hover:text-cyan-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-300/60"
            >
              Replay queued. View the linked workflow <ArrowUpRight className="h-3 w-3" />
            </a>
          )}
        </div>
      </div>
    </div>
  )
}
