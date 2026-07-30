"use client"

// jarvis-v3 P5.T2 — `route_suggestion` (route-optimization plugin). Reuses
// `DispatchMapCore` (panels/DispatchMap.tsx) unmodified, per this session's
// own binding — no new map implementation. Real shape note, verified from
// source (route-optimization/index.ts): the draft-time payload this scene
// always receives (both in the approval card AND the receipt's
// `proposedAction.payload` — ActionRenderer.tsx's own "same renderer in
// every context" design) is ONLY `{technicianId, date, tenantId}` —
// `simulate()` predicts an empty `fieldChanges`, and the real polyline/
// stop-order/km-saved facts exist ONLY in `execute()`'s own output, which
// this component never receives directly (that's `ThreadVerification`'s
// predicted<->actual job, not this renderer's). So this scene fetches the
// SAME real `/api/dispatch/map?date=` data `DispatchMap` itself fetches —
// honest, live, and (once a `route_suggestion` has actually executed for
// this technician/date) it "gets truer over time" the same way the receipt
// does, because that endpoint joins in the most recent matching
// decision-receipt server-side. No `technicianId` filter exists on the
// endpoint (verified from source), so this scene filters the returned stops
// to this technician client-side rather than inventing a server change.

import { useEffect, useState } from "react"
import { Route } from "lucide-react"
import { Panel } from "../../primitives/Panel"
import { jarvisGet } from "../../../lib/api"
import { DispatchMapCore, type MapData } from "../../../panels/DispatchMap"
import type { ActionRendererProps } from "../types"

interface RouteSuggestionPayload {
  technicianId?: string
  date?: string
}

function useTechnicianDayMap(technicianId: string | undefined, date: string | undefined) {
  const [data, setData] = useState<MapData | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (!technicianId || !date) {
      setLoading(false)
      return
    }
    let cancelled = false
    setLoading(true)
    jarvisGet<MapData>("dispatch/map", { date })
      .then((full) => {
        if (cancelled) return
        setData({ ...full, stops: full.stops.filter((s) => s.technicianId === technicianId) })
        setError(null)
      })
      .catch((e) => {
        if (!cancelled) setError(e instanceof Error ? e.message : "Couldn't load the route map.")
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [technicianId, date])

  return { data, error, loading }
}

export function RouteScene({ payload, compact }: ActionRendererProps) {
  const p = (payload && typeof payload === "object" ? payload : {}) as RouteSuggestionPayload
  const { data, error, loading } = useTechnicianDayMap(p.technicianId, p.date)
  const technicianName = data?.stops[0]?.technicianName
  const stopCount = data?.stops.length ?? null

  if (compact) {
    return (
      <span className="inline-flex items-center gap-1.5 j-fs-micro">
        <Route className="h-3 w-3 shrink-0 text-cyan-300" />
        <span className="truncate text-[color:var(--j-text)]">
          route · {technicianName ?? p.technicianId?.slice(0, 8) ?? "technician"} · {p.date ?? "date pending"}
        </span>
      </span>
    )
  }

  return (
    <Panel className="border border-cyan-400/25 p-3">
      <div className="mb-2 flex items-center gap-1.5">
        <Route className="h-3.5 w-3.5 text-cyan-300" />
        <span className="j-fs-micro font-black uppercase tracking-widest text-cyan-300">Route Suggestion</span>
      </div>
      <div className="mb-2 j-fs-micro text-[color:var(--j-text-dim)]">
        <span className="font-black text-[color:var(--j-text)]">{technicianName ?? p.technicianId?.slice(0, 8) ?? "technician"}</span>
        {" · "}
        {p.date ?? "date pending"}
        {stopCount !== null && <span> · {stopCount} stop{stopCount === 1 ? "" : "s"}</span>}
      </div>

      {loading && <div className="j-fs-micro text-[color:var(--j-text-faint)]">Loading the real dispatch map…</div>}
      {error && <div className="j-fs-micro text-red-300">{error}</div>}
      {!loading && !error && stopCount === 0 && (
        <div className="j-fs-micro text-[color:var(--j-text-faint)]">No scheduled stops for this technician on this date yet.</div>
      )}
      {!loading && !error && data && stopCount !== null && stopCount > 0 && (
        <div className="max-h-[280px] overflow-hidden rounded-xl">
          <DispatchMapCore data={data} error={null} />
        </div>
      )}
    </Panel>
  )
}
