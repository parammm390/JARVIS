"use client"

// Phase 8 (§8.3 daily scorecard, §8.2 failure-injection calendar) — owner-only,
// real data from finnor_os.readiness_log / finnor_os.failure_injections, no
// fabricated trend lines. Matches DlqBrowser/DataQualityQueue's own convention:
// never eagerly polled by the shared provider, an owner opens this occasionally.

import { useCallback, useEffect, useState } from "react"
import { RefreshCw, TrendingUp, Zap } from "lucide-react"
import { jarvisGet } from "../lib/api"
import { useJarvisAuth } from "../lib/jarvis-auth"
import { ageLabel } from "../lib/data-core"

interface ReadinessDay {
  logDate: string
  workflowSuccessRate: number | null
  stepLatencyP95Ms: number | null
  retryRate: number | null
  humanInterventionRate: number | null
  reconciliationBacklog: number
  dlqDepth: number
  receiptCompleteness: number | null
  incidentNotes: string | null
}

interface FailureInjection {
  id: string
  kind: string
  injectedAt: string
  detectedAt: string | null
  recoveredAt: string | null
  outcome: "pass" | "fail" | "inconclusive" | null
  detail: unknown
}

function pct(v: number | null): string {
  return v === null ? "—" : `${Math.round(v * 100)}%`
}

export function CertificationStatus() {
  const { role } = useJarvisAuth()
  const [days, setDays] = useState<ReadinessDay[] | null>(null)
  const [injections, setInjections] = useState<FailureInjection[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [now, setNow] = useState(Date.now())

  const load = useCallback(async () => {
    setError(null)
    try {
      const [scorecard, calendar] = await Promise.all([
        jarvisGet<{ data: ReadinessDay[] }>("read-models/readiness", { days: "30" }),
        jarvisGet<{ data: FailureInjection[] }>("read-models/failure-injections"),
      ])
      setDays(scorecard.data)
      setInjections(calendar.data)
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't load the 30-day certification trend.")
    }
  }, [])

  useEffect(() => {
    if (role !== "owner") return
    void load()
    setNow(Date.now())
  }, [role, load])

  if (role !== "owner") return null

  const streak = days?.length ?? 0
  const passCount = injections?.filter((i) => i.outcome === "pass").length ?? 0

  return (
    <div className="j-panel">
      <div className="flex items-center justify-between border-b border-white/6 px-4 py-2.5">
        <span className="j-label">30-Day Certification (Phase 8)</span>
        <div className="flex items-center gap-2">
          <span className="rounded-full bg-white/8 px-2 py-0.5 text-[10px] font-black text-white/60">{streak}/30 days logged</span>
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
        {!days && !error && <div className="h-16 animate-pulse rounded-lg bg-white/5" />}

        {days && (
          <>
            <div className="mb-1 flex items-center gap-1.5 text-[9px] font-black uppercase tracking-widest text-[color:var(--j-text-faint)]">
              <TrendingUp className="h-3 w-3" /> Daily scorecard
            </div>
            {days.length === 0 ? (
              <div className="mb-3 rounded-xl border border-white/8 bg-white/[0.02] px-4 py-4 text-center text-[11px] text-[color:var(--j-text-dim)]">
                No days logged yet — the daily_scorecard job writes one real row per calendar day.
              </div>
            ) : (
              <div className="mb-3 space-y-1">
                {days.slice(0, 7).map((d) => (
                  <div key={d.logDate} className="flex items-center justify-between rounded-lg border border-white/8 bg-white/[0.02] px-2.5 py-1.5 text-[10px]">
                    <span className="text-white/50">{d.logDate}</span>
                    <span className="text-white/70">success {pct(d.workflowSuccessRate)}</span>
                    <span className="text-white/70">recon {d.reconciliationBacklog}</span>
                    <span className="text-white/70">dlq {d.dlqDepth}</span>
                  </div>
                ))}
              </div>
            )}

            <div className="mb-1 flex items-center gap-1.5 text-[9px] font-black uppercase tracking-widest text-[color:var(--j-text-faint)]">
              <Zap className="h-3 w-3" /> Failure-injection calendar ({passCount} pass{passCount === 1 ? "" : "es"} logged)
            </div>
            {!injections || injections.length === 0 ? (
              <div className="rounded-xl border border-white/8 bg-white/[0.02] px-4 py-4 text-center text-[11px] text-[color:var(--j-text-dim)]">
                No injections logged yet.
              </div>
            ) : (
              <div className="space-y-1.5">
                {injections.slice(0, 6).map((i) => (
                  <div key={i.id} className="rounded-lg border border-white/8 bg-white/[0.02] px-2.5 py-1.5 text-[10px]">
                    <div className="flex items-center justify-between">
                      <span className="font-black text-white/70">{i.kind.replaceAll("_", " ")}</span>
                      <span className={i.outcome === "pass" ? "text-emerald-300" : i.outcome === "fail" ? "text-red-300" : "text-white/40"}>
                        {i.outcome ?? "pending"}
                      </span>
                    </div>
                    <span className="text-white/35">{ageLabel(i.injectedAt, now)}</span>
                  </div>
                ))}
              </div>
            )}
          </>
        )}
      </div>
    </div>
  )
}
