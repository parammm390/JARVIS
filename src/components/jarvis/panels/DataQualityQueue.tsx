"use client"

// Phase 7 (§7.7) — the data-quality/contradiction queue: real individual unresolved
// findings (GET /api/data-quality/findings), each with a "Mark resolved" action
// (owner-only). Honestly scoped: resolving records that a human reviewed and
// handled it — no automatic fix exists for e.g. two conflicting phone numbers, so
// this never claims to have silently corrected the underlying data.

import { useCallback, useEffect, useState } from "react"
import { RefreshCw, Check } from "lucide-react"
import { jarvisGet, jarvisPost } from "../lib/api"
import { useJarvisAuth } from "../lib/jarvis-auth"
import { hasActiveSession } from "../lib/jarvis-auth"
import { ageLabel } from "../lib/data-core"

interface Finding {
  id: string
  findingType: string
  entityType: string
  entityId: string
  details: Record<string, unknown>
  severity: "low" | "medium" | "high"
  createdAt: string
}

const SEVERITY_STYLE: Record<string, string> = {
  low: "bg-white/8 text-white/50",
  medium: "bg-amber-300/12 text-amber-200",
  high: "bg-red-400/14 text-red-300",
}

export function DataQualityQueue() {
  const { role } = useJarvisAuth()
  const [rows, setRows] = useState<Finding[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [inflight, setInflight] = useState<string | null>(null)
  const [now, setNow] = useState(Date.now())

  const load = useCallback(async () => {
    if (!hasActiveSession()) return
    setError(null)
    try {
      const res = await jarvisGet<{ findings: Finding[] }>("data-quality/findings")
      setRows(res.findings)
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't load the data-quality queue.")
    }
  }, [])

  useEffect(() => {
    void load()
    setNow(Date.now())
  }, [load])

  if (!hasActiveSession()) return null

  async function resolve(id: string) {
    if (inflight) return
    setInflight(id)
    try {
      await jarvisPost(`data-quality/findings/${id}/resolve`, {})
      setRows((prev) => prev?.filter((r) => r.id !== id) ?? prev)
    } catch (e) {
      setError(e instanceof Error ? e.message : "That didn't go through.")
    } finally {
      setInflight(null)
    }
  }

  return (
    <div className="j-panel">
      <div className="flex items-center justify-between border-b border-white/6 px-4 py-2.5">
        <span className="j-label">Data Quality</span>
        <div className="flex items-center gap-2">
          {rows && rows.length > 0 && <span className="rounded-full bg-amber-300/12 px-2 py-0.5 text-[10px] font-black text-amber-200">{rows.length}</span>}
          <button type="button" onClick={() => void load()} className="rounded-full border border-white/12 p-1 text-white/50 hover:text-cyan-200">
            <RefreshCw className="h-3 w-3" />
          </button>
        </div>
      </div>
      <div className="px-4 py-3">
        {error && <div className="mb-2 rounded-lg border border-red-400/30 bg-red-400/5 px-3 py-2 text-[11px] text-red-300">{error}</div>}
        {!rows && !error && <div className="h-16 animate-pulse rounded-lg bg-white/5" />}
        {rows && rows.length === 0 && <div className="rounded-xl border border-white/8 bg-white/[0.02] px-4 py-6 text-center text-[12px] text-[color:var(--j-text-dim)]">No open findings.</div>}
        <div className="space-y-2">
          {rows?.slice(0, 8).map((f) => (
            <div key={f.id} className="rounded-xl border border-white/10 bg-white/[0.02] p-3">
              <div className="mb-1 flex items-center justify-between text-[9px] font-black uppercase tracking-widest text-[color:var(--j-text-faint)]">
                <span>{f.findingType.replaceAll("_", " ")} · {f.entityType}</span>
                <span>{ageLabel(f.createdAt, now)}</span>
              </div>
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-1.5">
                  <span className={`rounded-full px-2 py-0.5 text-[9px] font-black uppercase ${SEVERITY_STYLE[f.severity]}`}>{f.severity}</span>
                  {typeof f.details?.note === "string" && <span className="text-[10px] text-[color:var(--j-text-dim)]">{f.details.note}</span>}
                </div>
                {role === "owner" && (
                  <button
                    type="button"
                    disabled={inflight === f.id}
                    onClick={() => resolve(f.id)}
                    className="inline-flex shrink-0 items-center gap-1 rounded-full border border-white/15 px-2.5 py-1 text-[9.5px] font-black text-white/70 hover:text-teal-200 disabled:opacity-40"
                  >
                    <Check className="h-3 w-3" /> Mark resolved
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
