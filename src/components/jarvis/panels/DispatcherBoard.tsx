"use client"

// Phase 7 (§7.4, dispatcher view) — real technician load + upcoming visits + AMC
// renewals due, all from data already polled (technicianLoad, serviceDue) or a
// real resource read (resources/visits, already in the proxy's RESOURCE_KINDS
// allowlist). Gated to dispatcher/owner — the server's own canApprove RBAC is the
// real authorizer for any action taken from here; this is the read surface.

import { useEffect, useState } from "react"
import { CalendarClock, Users, RefreshCw } from "lucide-react"
import { useJarvis, ageLabel } from "../lib/data-core"
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

export function DispatcherBoard() {
  const { role } = useJarvisAuth()
  const data = useJarvis()
  const [visits, setVisits] = useState<Visit[] | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!hasActiveSession() || (role !== "dispatcher" && role !== "owner")) return
    jarvisGet<{ rows: Visit[] }>("resources/visits")
      .then((r) => setVisits(r.rows))
      .catch((e) => setError(e instanceof Error ? e.message : "Couldn't load visits."))
  }, [role])

  if (role !== "dispatcher" && role !== "owner") return null

  const now = Date.now()
  const upcoming = (visits ?? []).filter((v) => v.scheduledAt && !v.completedAt && new Date(v.scheduledAt).getTime() >= now - 24 * 3600 * 1000)
  const overdue = (visits ?? []).filter((v) => v.scheduledAt && !v.completedAt && new Date(v.scheduledAt).getTime() < now - 24 * 3600 * 1000)

  return (
    <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
      <div className="j-panel">
        <div className="flex items-center justify-between border-b border-white/6 px-4 py-2.5">
          <span className="j-label flex items-center gap-1.5">
            <Users className="h-3.5 w-3.5" /> Technician Load
          </span>
        </div>
        <div className="space-y-2 px-4 py-3">
          {!data.technicianLoad && <div className="h-16 animate-pulse rounded-lg bg-white/5" />}
          {data.technicianLoad?.length === 0 && <div className="text-[12px] text-[color:var(--j-text-dim)]">No technicians on file.</div>}
          {data.technicianLoad?.map((t) => (
            <div key={t.technicianId} className="flex items-center justify-between rounded-xl border border-white/10 bg-white/[0.02] px-3 py-2">
              <span className="text-[12px] font-bold text-[color:var(--j-text)]">{t.name}</span>
              <div className="flex gap-1.5">
                <span className="rounded-full bg-cyan-300/12 px-2 py-0.5 text-[9px] font-black text-cyan-200">{t.upcomingAppointments} upcoming</span>
                <span className="rounded-full bg-white/8 px-2 py-0.5 text-[9px] font-black text-white/50">{t.openWorkOrders} open orders</span>
              </div>
            </div>
          ))}
        </div>
      </div>

      <div className="j-panel">
        <div className="flex items-center justify-between border-b border-white/6 px-4 py-2.5">
          <span className="j-label flex items-center gap-1.5">
            <CalendarClock className="h-3.5 w-3.5" /> Visits Needing Attention
          </span>
          <button type="button" onClick={() => jarvisGet<{ rows: Visit[] }>("resources/visits").then((r) => setVisits(r.rows))} className="rounded-full border border-white/12 p-1 text-white/50 hover:text-cyan-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-300/60">
            <RefreshCw className="h-3 w-3" />
          </button>
        </div>
        <div className="space-y-2 px-4 py-3">
          {error && <div className="rounded-lg border border-red-400/30 bg-red-400/5 px-3 py-2 text-[11px] text-red-300">{error}</div>}
          {!visits && !error && <div className="h-16 animate-pulse rounded-lg bg-white/5" />}
          {visits && overdue.length === 0 && upcoming.length === 0 && (
            <div className="rounded-xl border border-white/8 bg-white/[0.02] px-4 py-6 text-center text-[12px] text-[color:var(--j-text-dim)]">Nothing overdue or imminent.</div>
          )}
          {overdue.map((v) => (
            <div key={v.id} className="rounded-xl border border-red-400/25 bg-red-400/5 px-3 py-2">
              <div className="flex items-center justify-between text-[11px] font-bold text-red-300">
                <span>{v.type.replaceAll("_", " ")} — {v.address}</span>
                <span>overdue {ageLabel(v.scheduledAt!, now)}</span>
              </div>
            </div>
          ))}
          {upcoming.slice(0, 8).map((v) => (
            <div key={v.id} className="rounded-xl border border-white/10 bg-white/[0.02] px-3 py-2">
              <div className="flex items-center justify-between text-[11px] font-bold text-[color:var(--j-text)]">
                <span>{v.type.replaceAll("_", " ")} — {v.address}</span>
                <span className="text-[color:var(--j-text-dim)]">{new Date(v.scheduledAt!).toLocaleString()}</span>
              </div>
            </div>
          ))}
        </div>
      </div>

      {data.serviceDue && data.serviceDue.length > 0 && (
        <div className="j-panel xl:col-span-2">
          <div className="border-b border-white/6 px-4 py-2.5">
            <span className="j-label">AMC Renewals Due</span>
          </div>
          <div className="flex flex-wrap gap-2 px-4 py-3">
            {data.serviceDue.slice(0, 12).map((s) => (
              <span key={s.agreementId} className="rounded-full bg-amber-300/12 px-2.5 py-1 text-[10px] font-bold text-amber-200">
                {s.cadence} · {s.status} · due {new Date(s.renewalDate).toLocaleDateString()}
              </span>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
