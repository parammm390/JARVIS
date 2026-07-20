"use client"

// Phase 7 (§7.7) — owner-only DLQ browser: real dead_letters rows (terminal
// external-effect failures the runtime gave up retrying, Phase 2 §2.3), with
// replay/discard wired to the real routes. Never eagerly polled by the shared
// provider (data-core.ts) — an owner opens this occasionally, not every 4 seconds.

import { useCallback, useEffect, useState } from "react"
import { RefreshCw, RotateCcw, Trash2 } from "lucide-react"
import { jarvisGet, jarvisPost, JarvisApiError } from "../lib/api"
import { useJarvisAuth } from "../lib/jarvis-auth"
import { ageLabel } from "../lib/data-core"

interface DeadLetter {
  id: string
  envelope: { type?: string; payload?: unknown }
  errorKind: string
  attempts: number
  firstSeenAt: string
  lastError: string
  replayable: boolean
  status: "open" | "replayed" | "discarded"
}

export function DlqBrowser() {
  const { role } = useJarvisAuth()
  const [rows, setRows] = useState<DeadLetter[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [inflight, setInflight] = useState<string | null>(null)
  const [now, setNow] = useState(Date.now())

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
      await jarvisPost(`dlq/${id}/${verb}`, {})
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
        {!rows && !error && <div className="h-16 animate-pulse rounded-lg bg-white/5" />}
        {rows && rows.length === 0 && <div className="rounded-xl border border-white/8 bg-white/[0.02] px-4 py-6 text-center text-[12px] text-[color:var(--j-text-dim)]">Nothing dead-lettered. Clean.</div>}
        <div className="space-y-2">
          {rows?.slice(0, 10).map((r) => (
            <div key={r.id} className="rounded-xl border border-white/10 bg-white/[0.02] p-3">
              <div className="mb-1 flex items-center justify-between text-[9px] font-black uppercase tracking-widest text-[color:var(--j-text-faint)]">
                <span>{r.envelope?.type ?? "unknown event"}</span>
                <span>{ageLabel(r.firstSeenAt, now)}</span>
              </div>
              <div className="text-[11px] text-[color:var(--j-text)]">{r.lastError}</div>
              <div className="mt-1 flex flex-wrap gap-1">
                <span className="rounded-full bg-white/8 px-2 py-0.5 text-[9px] text-white/50">{r.errorKind}</span>
                <span className="rounded-full bg-white/8 px-2 py-0.5 text-[9px] text-white/50">{r.attempts} attempt{r.attempts === 1 ? "" : "s"}</span>
              </div>
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
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
