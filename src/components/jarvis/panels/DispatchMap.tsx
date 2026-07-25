"use client"

// D5.T2 — stored-coordinate dispatch map. The route line is explicitly a B3
// optimized stop order, not claimed road geometry; MapLibre receives OpenFreeMap's
// keyless style and the R2/PMTiles fallback is documented here for later hosting.

import { useEffect, useRef, useState } from "react"
import { CalendarDays, MapPinned, Route, X } from "lucide-react"
import { jarvisGet } from "../lib/api"
import { Drawer } from "../ui/primitives/Drawer"

type Stop = { visitId: string; technicianId: string; technicianName: string; householdId: string; address: string; latitude: number | null; longitude: number | null; type: string; scheduledAt: string | null; notes: string | null; optimized: { sequence: number } | null }
type MapData = { date: string; synthetic: boolean; stops: Stop[]; unplacedStops: number; route: { naiveKm: number | null; optimizedKm: number | null; kmSaved: number | null } | null }
type Household = { household: { address: string }; contacts: Array<{ name: string }>; equipment: Array<{ type: string; model: string | null }>; serviceVisits: unknown[] }

function isoToday() { return new Date().toISOString().slice(0, 10) }

export function DispatchMap() {
  const container = useRef<HTMLDivElement>(null)
  const map = useRef<import("maplibre-gl").Map | null>(null)
  const [date, setDate] = useState(isoToday)
  const [data, setData] = useState<MapData | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [selected, setSelected] = useState<Stop | null>(null)
  const [household, setHousehold] = useState<Household | null>(null)

  useEffect(() => { jarvisGet<MapData>("dispatch/map", { date }).then(setData).catch((e) => setError(e instanceof Error ? e.message : "Couldn't load dispatch.")) }, [date])
  useEffect(() => {
    if (!container.current || !data) return
    let disposed = false
    void import("maplibre-gl").then((maplibregl) => {
      if (disposed || !container.current) return
      map.current?.remove()
      const placed = data.stops.filter((s) => s.latitude !== null && s.longitude !== null)
      const next = new maplibregl.Map({ container: container.current, style: "https://tiles.openfreemap.org/styles/liberty", center: placed.length ? [placed[0]!.longitude!, placed[0]!.latitude!] : [-95.3698, 29.7604], zoom: placed.length ? 9 : 7 })
      map.current = next
      next.on("load", () => {
        const ordered = [...placed].sort((a, b) => (a.optimized?.sequence ?? Number.MAX_SAFE_INTEGER) - (b.optimized?.sequence ?? Number.MAX_SAFE_INTEGER))
        if (ordered.length > 1) next.addSource("optimized-order", { type: "geojson", data: { type: "Feature", properties: {}, geometry: { type: "LineString", coordinates: ordered.map((s) => [s.longitude!, s.latitude!]) } } })
        if (ordered.length > 1) next.addLayer({ id: "optimized-order", type: "line", source: "optimized-order", paint: { "line-color": "#67e8f9", "line-width": 3, "line-dasharray": [2, 2], "line-opacity": 0.8 } })
        for (const stop of placed) {
          const marker = document.createElement("button")
          marker.className = "flex h-8 w-8 items-center justify-center rounded-full border border-cyan-100/80 bg-cyan-300 text-[11px] font-black text-slate-950 shadow-[0_0_18px_rgba(103,232,249,.8)]"
          marker.textContent = String(stop.optimized?.sequence ?? "•")
          marker.title = `${stop.technicianName}: ${stop.address}`
          marker.onclick = () => setSelected(stop)
          new maplibregl.Marker({ element: marker }).setLngLat([stop.longitude!, stop.latitude!]).addTo(next)
        }
      })
    })
    return () => { disposed = true; map.current?.remove(); map.current = null }
  }, [data])
  useEffect(() => {
    if (!selected) return
    setHousehold(null)
    void jarvisGet<{ data: Household }>("read-models/household-360", { householdId: selected.householdId }).then((r) => setHousehold(r.data)).catch(() => setHousehold(null))
  }, [selected])

  return <div className="space-y-4">
    <div className="flex flex-wrap items-center justify-between gap-3"><div><div className="j-label flex items-center gap-2"><MapPinned className="h-4 w-4" /> Dispatch map</div><p className="mt-1 text-[11px] text-[color:var(--j-text-dim)]">Stored locations only. Dashed line shows B3’s optimized stop order, not road geometry.</p></div><label className="flex items-center gap-2 rounded-xl border border-white/10 px-3 py-2 text-[11px]"><CalendarDays className="h-4 w-4" /><input aria-label="Dispatch day" className="bg-transparent text-white" type="date" value={date} onChange={(e) => setDate(e.target.value)} /></label></div>
    {data?.synthetic && <div className="rounded-xl border border-amber-300/25 bg-amber-300/5 px-3 py-2 text-[11px] text-amber-100">Dealer Zero — synthetic Houston-metro fixture data.</div>}
    {error && <div className="rounded-xl border border-red-400/30 p-3 text-sm text-red-300">{error}</div>}
    <div className="grid gap-4 xl:grid-cols-[1fr_280px]"><div ref={container} className="h-[58vh] min-h-[420px] overflow-hidden rounded-2xl border border-white/10 bg-[#0a1220]" /><aside className="j-panel space-y-4 p-4"><div className="j-label">Route load</div><div className="text-3xl font-black text-cyan-200">{data?.stops.length ?? "—"}<span className="ml-1 text-xs text-white/45">stops</span></div><div className="rounded-xl bg-white/[0.035] p-3 text-[11px] text-white/65"><Route className="mb-2 h-4 w-4 text-cyan-200" />{data?.route ? <><b className="text-white">{data.route.kmSaved ?? 0} km saved</b><br />{data.route.naiveKm ?? "—"} km scheduled → {data.route.optimizedKm ?? "—"} km optimized</> : "No completed B3 route receipt for this day yet."}</div><div className="text-[11px] text-white/45">{data?.unplacedStops ?? 0} stop(s) have no stored coordinate and remain unplaced.</div></aside></div>
    {selected && <Drawer title="Household 360" onClose={() => setSelected(null)}><div className="space-y-4 text-sm"><div><div className="j-label">Stop</div><div className="mt-1 font-bold">{selected.type.replaceAll("_", " ")}</div><div className="text-white/60">{selected.address}</div></div>{household ? <><div><div className="j-label">Contacts</div><div className="mt-1">{household.contacts.map((c) => c.name).join(", ") || "No contacts on file"}</div></div><div><div className="j-label">Equipment</div><div className="mt-1">{household.equipment.map((e) => `${e.type}${e.model ? ` · ${e.model}` : ""}`).join("; ") || "No equipment on file"}</div></div></> : <div className="text-white/50">Loading real household record…</div>}</div></Drawer>}
  </div>
}
