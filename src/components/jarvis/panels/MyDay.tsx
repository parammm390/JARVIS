"use client"

import { useCallback, useMemo, useRef, useState } from "react"
import Link from "next/link"
import { CheckCircle2, ClipboardList, Flag, MapPin, Navigation, Play, Send } from "lucide-react"
import { jarvisPost } from "../lib/api"
import { useJarvisAuth } from "../lib/jarvis-auth"
import { useBusinessProjection } from "../lib/business-projections"
import { businessProjections } from "../lib/projection-definitions"
import { ErrorState } from "../ui/primitives/ErrorState"

type WorkOrder = { id: string; type: string; status: "draft" | "scheduled" | "in_progress" | "completed" | "canceled"; scheduledAt: string | null; address: string; householdId: string }
type Visit = { id: string; type: string; scheduledAt: string | null; completedAt: string | null; notes: string | null; address: string; householdId: string }

export function MyDay() {
  const { role } = useJarvisAuth()
  const projection = useBusinessProjection(businessProjections.technicianDay(), { enabled: role === "technician" })
  const workOrders: WorkOrder[] | null = projection.data?.workOrders ?? null
  const visits: Visit[] | null = projection.data?.visits ?? null
  const [mutationError, setMutationError] = useState<string | null>(null)
  const error = mutationError ?? projection.error?.message ?? null
  const loading = role === "technician" && projection.data === null && projection.status !== "error"
  const [actionId, setActionId] = useState<string | null>(null)
  const [report, setReport] = useState<Record<string, string>>({})
  const [issue, setIssue] = useState<Record<string, string>>({})
  const retryRef = useRef<(() => void) | null>(null)
  const nextStop = useMemo(() => {
    const candidates = [
      ...(workOrders ?? []).map((order) => ({ id: order.id, kind: "work order" as const, type: order.type, address: order.address, householdId: order.householdId, scheduledAt: order.scheduledAt })),
      ...(visits ?? []).map((visit) => ({ id: visit.id, kind: "visit" as const, type: visit.type, address: visit.address, householdId: visit.householdId, scheduledAt: visit.scheduledAt })),
    ].filter((stop) => stop.scheduledAt)
    return candidates.sort((a, b) => new Date(a.scheduledAt!).getTime() - new Date(b.scheduledAt!).getTime())[0] ?? null
  }, [visits, workOrders])

  const load = useCallback(async (): Promise<boolean> => {
    setMutationError(null)
    try {
      await projection.refresh()
      retryRef.current = null
      return true
    } catch (cause) {
      setMutationError(cause instanceof Error ? cause.message : "Couldn’t load your day.")
      retryRef.current = () => { void load() }
      return false
    }
  }, [projection])

  async function act(workOrderId: string, action: "arrive" | "report" | "flag" | "done"): Promise<void> {
    if (actionId) return
    const retryableAction = async () => {
      setActionId(`${workOrderId}:${action}`)
      setMutationError(null)
      try {
        await jarvisPost("technician/my-day", {
          workOrderId,
          action,
          ...(action === "report" ? { report: report[workOrderId] } : {}),
          ...(action === "flag" ? { issue: issue[workOrderId] } : {}),
        })
        const refreshed = await load()
        if (refreshed) retryRef.current = null
        else retryRef.current = () => { void load() }
      } catch (cause) {
        setMutationError(cause instanceof Error ? cause.message : "Couldn’t update the work order.")
        retryRef.current = () => { void retryableAction() }
      } finally {
        setActionId(null)
      }
    }
    await retryableAction()
  }

  if (role !== "technician") return <div className="j-panel p-5 j-fs-sm text-[color:var(--j-text-dim)]">My Day is available to signed-in technician accounts.</div>

  return (
    <div className="mx-auto max-w-lg space-y-3 pb-28">
      <div>
        <div className="j-label">My day</div>
        <p className="mt-1 j-fs-sm text-[color:var(--j-text-dim)]">Assigned work orders and visits for your linked technician record.</p>
      </div>
      {nextStop && <section className="jarvis-my-day-next-stop" aria-label="Next stop">
        <div className="j-label">Next stop · {nextStop.kind}</div>
        <h2 className="mt-1 text-lg font-black capitalize text-cyan-100">{nextStop.type.replaceAll("_", " ")}</h2>
        <p className="mt-1 j-fs-sm text-[color:var(--j-text-dim)]">{nextStop.address}</p>
        <p className="mt-2 j-fs-micro text-white/45">{new Date(nextStop.scheduledAt!).toLocaleString()}</p>
        <div className="mt-3 flex flex-wrap gap-2">
          <a className="inline-flex min-h-11 items-center justify-center gap-1 rounded-lg border border-white/15 px-3 py-2 j-fs-sm font-bold text-cyan-100" target="_blank" rel="noreferrer" href={`https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(nextStop.address)}`}><Navigation className="h-3.5 w-3.5" />Navigate</a>
          <Link className="inline-flex min-h-11 items-center rounded-lg border border-cyan-200/20 px-3 py-2 j-fs-sm font-bold text-cyan-100" href={`/jarvis/customers?householdId=${encodeURIComponent(nextStop.householdId)}`}>Customer</Link>
          <Link className="inline-flex min-h-11 items-center rounded-lg border border-cyan-200/20 px-3 py-2 j-fs-sm font-bold text-cyan-100" href={`/jarvis/work?householdId=${encodeURIComponent(nextStop.householdId)}&${nextStop.kind === "work order" ? "workOrderId" : "visitId"}=${encodeURIComponent(nextStop.id)}`}>Work</Link>
        </div>
      </section>}
      {error && <ErrorState message={workOrders ? `Showing the last successful day. ${error}` : error} onRetry={retryRef.current ?? (() => { void load() })} />}
      {loading && !workOrders && <div className="jarvis-skeleton-tide h-24 rounded-xl bg-white/5" aria-label="Loading your day" />}
      {workOrders?.map((order, index) => (
        <article key={order.id} className="j-panel p-4">
          <div className="flex items-start justify-between gap-3">
            <div>
              <div className="j-fs-micro font-black uppercase tracking-widest text-cyan-200">Work order {index + 1}</div>
              <h2 className="mt-1 font-bold capitalize">{order.type}</h2>
              <p className="mt-1 j-fs-sm text-[color:var(--j-text-dim)]">{order.address}</p>
              <div className="mt-2 flex flex-wrap gap-2 j-fs-micro">
                <Link className="text-cyan-200 underline-offset-2 hover:underline" href={`/jarvis/customers?householdId=${encodeURIComponent(order.householdId)}`}>Customer · {order.householdId.slice(0, 8)}…</Link>
                <Link className="text-cyan-200 underline-offset-2 hover:underline" href={`/jarvis/work?householdId=${encodeURIComponent(order.householdId)}&workOrderId=${encodeURIComponent(order.id)}`}>Work order · {order.id.slice(0, 8)}…</Link>
              </div>
            </div>
            <span className="j-chip border border-white/10 text-[color:var(--j-text-dim)]">{order.status.replaceAll("_", " ")}</span>
          </div>
          <div className="mt-4 grid grid-cols-2 gap-2">
            <a className="inline-flex items-center justify-center gap-1 rounded-lg border border-white/15 px-3 py-2 j-fs-sm font-bold text-cyan-100" target="_blank" rel="noreferrer" href={`https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(order.address)}`}><Navigation className="h-3.5 w-3.5" />Navigate</a>
            <button disabled={order.status !== "scheduled" || actionId !== null} onClick={() => void act(order.id, "arrive")} className="inline-flex items-center justify-center gap-1 rounded-lg bg-cyan-300 px-3 py-2 j-fs-sm font-black text-slate-950 disabled:opacity-50"><Play className="h-3.5 w-3.5" />Arrive</button>
          </div>
          {order.status === "in_progress" && <>
            <textarea value={report[order.id] ?? ""} onChange={(e) => setReport((current) => ({ ...current, [order.id]: e.target.value }))} placeholder="Log visit report" className="mt-3 min-h-16 w-full rounded-lg border border-white/10 bg-white/[.03] p-2 j-fs-sm text-white placeholder:text-white/35" />
            <button disabled={(report[order.id] ?? "").trim().length < 3 || actionId !== null} onClick={() => void act(order.id, "report")} className="mt-2 inline-flex min-h-11 w-full items-center justify-center gap-1 rounded-lg border border-cyan-200/30 px-3 py-2 j-fs-sm font-bold text-cyan-100 disabled:opacity-50"><Send className="h-3.5 w-3.5" />Log report</button>
            <textarea value={issue[order.id] ?? ""} onChange={(e) => setIssue((current) => ({ ...current, [order.id]: e.target.value }))} placeholder="Flag issue for review" className="mt-3 min-h-16 w-full rounded-lg border border-white/10 bg-white/[.03] p-2 j-fs-sm text-white placeholder:text-white/35" />
            <button disabled={(issue[order.id] ?? "").trim().length < 3 || actionId !== null} onClick={() => void act(order.id, "flag")} className="mt-2 inline-flex min-h-11 w-full items-center justify-center gap-1 rounded-lg border border-amber-300/30 px-3 py-2 j-fs-sm font-bold text-amber-100 disabled:opacity-50"><Flag className="h-3.5 w-3.5" />Flag issue</button>
            <button disabled={actionId !== null} onClick={() => void act(order.id, "done")} className="mt-2 inline-flex min-h-11 w-full items-center justify-center gap-1 rounded-lg bg-teal-300 px-3 py-2 j-fs-sm font-black text-slate-950 disabled:opacity-50"><CheckCircle2 className="h-3.5 w-3.5" />Done</button>
          </>}
        </article>
      ))}
      {workOrders?.length === 0 && <div className="j-panel p-5 j-fs-sm text-[color:var(--j-text-dim)]">No assigned work orders today.</div>}
      {visits?.length ? <div className="j-panel p-4"><div className="j-label flex items-center gap-1"><ClipboardList className="h-3.5 w-3.5" />Scheduled visits</div>{visits.map((visit) => <div key={visit.id} className="mt-2 rounded-lg border border-white/8 p-2 j-fs-sm text-[color:var(--j-text-dim)]"><MapPin className="mr-1 inline h-3.5 w-3.5 text-cyan-200" />{visit.type.replaceAll("_", " ")} · {visit.address}<div className="mt-1 flex gap-2 j-fs-micro"><Link className="text-cyan-200 hover:underline" href={`/jarvis/customers?householdId=${encodeURIComponent(visit.householdId)}`}>Customer</Link><Link className="text-cyan-200 hover:underline" href={`/jarvis/work?householdId=${encodeURIComponent(visit.householdId)}&visitId=${encodeURIComponent(visit.id)}`}>Work visit</Link></div></div>)}</div> : null}
    </div>
  )
}
