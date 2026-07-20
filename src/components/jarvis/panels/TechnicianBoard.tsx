"use client"

// Phase 7 (§7.4, technician view) — real upcoming visits from resources/visits.
// Honest, stated limitation: finnor-os's schema has no link between an auth user
// (users.id, the row a signed-in "technician" role maps to) and a technicians.id
// row (packages/db/schema.ts — two separate tables, no foreign key between them
// today). That means this cannot filter to "my" visits specifically — it shows
// every upcoming visit tenant-wide, same data a dispatcher sees, not a personalized
// board. Building real per-technician filtering needs a schema change (a
// technicianId column on users, or an invite-linked mapping table) — a genuine
// backend decision, not something to invent unilaterally in a frontend pass.

import { useEffect, useState } from "react"
import { Wrench, RefreshCw, AlertTriangle } from "lucide-react"
import { useJarvisAuth } from "../lib/jarvis-auth"
import { jarvisGet } from "../lib/api"
import { hasActiveSession } from "../lib/jarvis-auth"

interface Visit {
  id: string
  type: string
  scheduledAt: string | null
  completedAt: string | null
  notes: string | null
  address: string
}

export function TechnicianBoard() {
  const { role } = useJarvisAuth()
  const [visits, setVisits] = useState<Visit[] | null>(null)
  const [error, setError] = useState<string | null>(null)

  function load() {
    jarvisGet<{ rows: Visit[] }>("resources/visits")
      .then((r) => setVisits(r.rows))
      .catch((e) => setError(e instanceof Error ? e.message : "Couldn't load visits."))
  }

  useEffect(() => {
    if (!hasActiveSession() || (role !== "technician" && role !== "owner")) return
    load()
  }, [role])

  if (role !== "technician" && role !== "owner") return null

  const upcoming = (visits ?? []).filter((v) => v.scheduledAt && !v.completedAt).sort((a, b) => new Date(a.scheduledAt!).getTime() - new Date(b.scheduledAt!).getTime())

  return (
    <div className="j-panel">
      <div className="flex items-center justify-between border-b border-white/6 px-4 py-2.5">
        <span className="j-label flex items-center gap-1.5">
          <Wrench className="h-3.5 w-3.5" /> Upcoming Visits
        </span>
        <button type="button" onClick={load} className="rounded-full border border-white/12 p-1 text-white/50 hover:text-cyan-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-300/60">
          <RefreshCw className="h-3 w-3" />
        </button>
      </div>
      <div className="px-4 py-3">
        <div className="mb-2 flex items-center gap-1.5 rounded-lg border border-amber-300/20 bg-amber-300/5 px-2.5 py-1.5 text-[10px] text-amber-200">
          <AlertTriangle className="h-3 w-3 shrink-0" />
          Showing every upcoming visit tenant-wide — there&rsquo;s no link yet between your
          sign-in and a specific technician record, so this can&rsquo;t filter to &ldquo;yours&rdquo; alone.
        </div>
        {error && <div className="mb-2 rounded-lg border border-red-400/30 bg-red-400/5 px-3 py-2 text-[11px] text-red-300">{error}</div>}
        {!visits && !error && <div className="h-16 animate-pulse rounded-lg bg-white/5" />}
        {visits && upcoming.length === 0 && <div className="rounded-xl border border-white/8 bg-white/[0.02] px-4 py-6 text-center text-[12px] text-[color:var(--j-text-dim)]">Nothing upcoming.</div>}
        <div className="space-y-2">
          {upcoming.slice(0, 10).map((v) => (
            <div key={v.id} className="rounded-xl border border-white/10 bg-white/[0.02] p-3">
              <div className="flex items-center justify-between text-[11px] font-bold text-[color:var(--j-text)]">
                <span className="capitalize">{v.type.replaceAll("_", " ")}</span>
                <span className="text-[color:var(--j-text-dim)]">{new Date(v.scheduledAt!).toLocaleString()}</span>
              </div>
              <div className="mt-1 text-[10px] text-[color:var(--j-text-faint)]">{v.address}</div>
              {v.notes && <div className="mt-1 text-[10px] text-[color:var(--j-text-dim)]">{v.notes}</div>}
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
