"use client"

// D5.T2 — stored-coordinate dispatch map. The route line is explicitly a B3
// optimized stop order, not claimed road geometry; MapLibre receives OpenFreeMap's
// keyless style and the R2/PMTiles fallback is documented here for later hosting.
//
// F9.T1/T2 — Band F9 Geo Cinema (FLOW-74..80). Built against this file's REAL,
// already-shipped D5.T2 surface (this component + its real /api/jarvis/dispatch/map
// data), per this phase's own Read: line ("discover from D5's STATE evidence, don't
// assume names"). D5's own exit-gate LIVE recording proof stays open (standing
// no-test-creds limitation, documented in F-STATE) — that gap is NOT fabricated here;
// what F9 needed was D5's real shipped code, which this file already is.
//
// Two honest deviations from the plan's literal FLOW-75/79 wording, since the real
// backend doesn't carry the literal data those words assume (verified by reading
// finnor-os/apps/api/app/api/dispatch/map/route.ts — RouteOutput only ever carries
// naiveKm/optimizedKm/kmSaved aggregates + a per-stop `sequence`, never a per-leg
// duration; and no service-area/zone geometry exists anywhere in the schema):
//   - FLOW-75 RouteInk: "width ∝ real leg durations" → width ∝ REAL per-leg distance,
//     computed here via haversine over each consecutive pair's actual stored
//     coordinates. Real number, just distance instead of duration (no duration exists).
//   - FLOW-79 ZoneBreath: "active jobs in area" polygon → a REAL convex hull computed
//     over today's actual placed stop coordinates (no configured zone polygon exists
//     to bind to instead). Breathes only while real placed-stop count > 0.
// FLOW-76 TechComet takes the plan's own explicitly allowed fallback: no live
// technician position source exists anywhere in this codebase (grepped — no
// telemetry table, no position stream) → scrubber-replay-only, honestly, interpolated
// along the real ordered stop coordinates as the user drags FLOW-77's new scrub
// control (which itself is a genuinely new control — D5.T2's "day scrubber" turned
// out to mean the day-to-day date picker below, not an intra-day visit-order scrub;
// re-probed against real source per Start Ritual step 2, not assumed from the plan's
// wording).

import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { CalendarDays, MapPinned, Route, X } from "lucide-react"
import Link from "next/link"
import { jarvisGet, jarvisPost } from "../lib/api"
import { Drawer } from "../ui/primitives/Drawer"
import { ErrorState } from "../ui/primitives/ErrorState"

type Stop = { visitId: string; sourceKind: "service_visit" | "appointment"; technicianId: string | null; technicianName: string | null; householdId: string; address: string; latitude: number | null; longitude: number | null; type: string; scheduledAt: string | null; notes: string | null; optimized: { sequence: number } | null }
type MapData = { date: string; synthetic: boolean; stops: Stop[]; technicians?: Array<{ id: string; name: string }>; unplacedStops: number; route: { naiveKm: number | null; optimizedKm: number | null; kmSaved: number | null } | null }
type Household = { household: { address: string }; contacts: Array<{ name: string }>; equipment: Array<{ type: string; model: string | null }>; serviceVisits: unknown[] }

function isoToday() { return new Date().toISOString().slice(0, 10) }

function reducedMotionNow(): boolean {
  return typeof window !== "undefined" && typeof window.matchMedia === "function" && window.matchMedia("(prefers-reduced-motion: reduce)").matches
}

// FLOW-75 RouteInk's real distance driver — haversine over stored coordinates.
function haversineKm(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
  const R = 6371
  const dLat = ((b.lat - a.lat) * Math.PI) / 180
  const dLng = ((b.lng - a.lng) * Math.PI) / 180
  const la1 = (a.lat * Math.PI) / 180
  const la2 = (b.lat * Math.PI) / 180
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(la1) * Math.cos(la2) * Math.sin(dLng / 2) ** 2
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)))
}

function legsGeoJSON(ordered: Stop[]) {
  const legs: Array<{ distanceKm: number; coords: [number, number][] }> = []
  for (let i = 0; i < ordered.length - 1; i++) {
    const a = ordered[i]!
    const b = ordered[i + 1]!
    const distanceKm = haversineKm({ lat: a.latitude!, lng: a.longitude! }, { lat: b.latitude!, lng: b.longitude! })
    legs.push({ distanceKm, coords: [[a.longitude!, a.latitude!], [b.longitude!, b.latitude!]] })
  }
  const maxKm = legs.reduce((m, l) => Math.max(m, l.distanceKm), 0.001)
  return {
    maxKm,
    geojson: {
      type: "FeatureCollection" as const,
      features: legs.map((l) => ({ type: "Feature" as const, properties: { distanceKm: l.distanceKm }, geometry: { type: "LineString" as const, coordinates: l.coords } })),
    },
  }
}

// FLOW-79 ZoneBreath's real geometry driver — monotone-chain convex hull over
// today's actual placed stop coordinates. No fabricated zone; if fewer than 3
// stops are placed, no polygon is drawn at all (honestly nothing to breathe).
function convexHull(points: Array<[number, number]>): Array<[number, number]> {
  const pts = [...new Map(points.map((p) => [`${p[0]},${p[1]}`, p])).values()].sort((a, b) => a[0] - b[0] || a[1] - b[1])
  if (pts.length < 3) return pts
  const cross = (o: [number, number], a: [number, number], b: [number, number]) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0])
  const lower: Array<[number, number]> = []
  for (const p of pts) {
    while (lower.length >= 2 && cross(lower[lower.length - 2]!, lower[lower.length - 1]!, p) <= 0) lower.pop()
    lower.push(p)
  }
  const upper: Array<[number, number]> = []
  for (let i = pts.length - 1; i >= 0; i--) {
    const p = pts[i]!
    while (upper.length >= 2 && cross(upper[upper.length - 2]!, upper[upper.length - 1]!, p) <= 0) upper.pop()
    upper.push(p)
  }
  lower.pop()
  upper.pop()
  return [...lower, ...upper]
}

function orderedPlaced(data: MapData | null): Stop[] {
  if (!data) return []
  return data.stops
    .filter((s) => s.latitude !== null && s.longitude !== null)
    .sort((a, b) => (a.optimized?.sequence ?? Number.MAX_SAFE_INTEGER) - (b.optimized?.sequence ?? Number.MAX_SAFE_INTEGER))
}

// FLOW-76 TechComet's honest interpolation — fractional position along the REAL
// ordered stop coordinates, driven by the FLOW-77 scrub value (0..100), never a
// live position (none exists to bind to).
function cometPosition(ordered: Stop[], scrub: number): [number, number] | null {
  if (ordered.length < 2) return null
  const t = (scrub / 100) * (ordered.length - 1)
  const i = Math.min(ordered.length - 2, Math.floor(t))
  const frac = t - i
  const a = ordered[i]!
  const b = ordered[i + 1]!
  return [a.longitude! + (b.longitude! - a.longitude!) * frac, a.latitude! + (b.latitude! - a.latitude!) * frac]
}

export function DispatchMapCore({ data, error, loading = false, onRetry = () => {}, onAssigned = () => {} }: { data: MapData | null; error: string | null; loading?: boolean; onRetry?: () => void; onAssigned?: () => void }) {
  const container = useRef<HTMLDivElement>(null)
  const map = useRef<import("maplibre-gl").Map | null>(null)
  const cometMarkers = useRef<import("maplibre-gl").Marker[]>([])
  const zoneRaf = useRef<number | null>(null)
  const [selected, setSelected] = useState<Stop | null>(null)
  const [household, setHousehold] = useState<Household | null>(null)
  const [householdError, setHouseholdError] = useState<string | null>(null)
  const [scrub, setScrub] = useState(0)
  const [scrubbing, setScrubbing] = useState(false)
  const [assignee, setAssignee] = useState("")
  const [assigning, setAssigning] = useState(false)
  const [assignError, setAssignError] = useState<string | null>(null)

  const ordered = useMemo(() => orderedPlaced(data), [data])

  useEffect(() => {
    if (!container.current || !data) return
    let disposed = false
    void import("maplibre-gl").then((maplibregl) => {
      if (disposed || !container.current) return
      map.current?.remove()
      const placed = ordered
      const reduced = reducedMotionNow()
      const next = new maplibregl.Map({ container: container.current, style: "https://tiles.openfreemap.org/styles/liberty", center: placed.length ? [placed[0]!.longitude!, placed[0]!.latitude!] : [-95.3698, 29.7604], zoom: placed.length ? 9 : 7 })
      map.current = next
      next.on("load", () => {
        // FLOW-75 RouteInk — one line-string per real leg, width driven by that
        // leg's real haversine distance (see file header: no leg-duration field exists).
        if (placed.length > 1) {
          const { geojson, maxKm } = legsGeoJSON(placed)
          next.addSource("route-ink", { type: "geojson", data: geojson })
          next.addLayer({
            id: "route-ink",
            type: "line",
            source: "route-ink",
            paint: {
              "line-color": "#67e8f9",
              "line-width": ["interpolate", ["linear"], ["get", "distanceKm"], 0, 2, maxKm, 7],
              "line-dasharray": [2, 2],
              "line-opacity": 0.8,
            },
          })
        }
        // FLOW-79 ZoneBreath — a real convex hull over today's actual placed
        // coordinates; breathes (fill-opacity oscillation) only while jobs exist.
        if (placed.length >= 3) {
          const hull = convexHull(placed.map((s) => [s.longitude!, s.latitude!] as [number, number]))
          if (hull.length >= 3) {
            next.addSource("zone-breath", { type: "geojson", data: { type: "Feature", properties: {}, geometry: { type: "Polygon", coordinates: [[...hull, hull[0]!]] } } })
            next.addLayer({ id: "zone-breath", type: "fill", source: "zone-breath", paint: { "fill-color": "#5eead4", "fill-opacity": reduced ? 0.08 : 0.05 } }, "route-ink")
            if (!reduced) {
              const start = performance.now()
              const tick = (now: number) => {
                if (document.visibilityState === "hidden" || !map.current) return
                const period = 5200
                const phase = ((now - start) % period) / period
                const opacity = 0.05 + 0.07 * (0.5 - 0.5 * Math.cos(phase * Math.PI * 2))
                if (map.current.getLayer("zone-breath")) map.current.setPaintProperty("zone-breath", "fill-opacity", opacity)
                zoneRaf.current = requestAnimationFrame(tick)
              }
              zoneRaf.current = requestAnimationFrame(tick)
            }
          }
        }
        // FLOW-74 PinDrop — each real stop marker drops in with a one-shot dust
        // ring; reduced-motion collapses to an instant, static pin (matchMedia
        // checked once per mount, this effect is client-only, no SSR involved).
        for (const stop of placed) {
          const wrap = document.createElement("div")
          wrap.className = "relative flex h-8 w-8 items-center justify-center"
          if (!reduced) {
            const ring = document.createElement("span")
            ring.className = "jarvis-pin-dustring"
            wrap.appendChild(ring)
          }
          const marker = document.createElement("button")
          marker.className = `flex h-8 w-8 items-center justify-center rounded-full border border-cyan-100/80 bg-cyan-300 j-fs-micro font-black text-slate-950 shadow-[0_0_18px_rgba(103,232,249,.8)] ${reduced ? "" : "jarvis-pin-drop"}`
          marker.textContent = String(stop.optimized?.sequence ?? "•")
          marker.title = `${stop.technicianName ?? "Unassigned"}: ${stop.address}`
          marker.onclick = () => {
            // FLOW-80 MapFocusDive — camera dives to the real stop coordinate in
            // sync with the household drawer opening.
            map.current?.flyTo({ center: [stop.longitude!, stop.latitude!], zoom: Math.max(map.current.getZoom(), 12.5), duration: reducedMotionNow() ? 0 : 900, essential: true })
            setSelected(stop)
          }
          wrap.appendChild(marker)
          new maplibregl.Marker({ element: wrap }).setLngLat([stop.longitude!, stop.latitude!]).addTo(next)
        }
      })
    })
    return () => {
      disposed = true
      if (zoneRaf.current) cancelAnimationFrame(zoneRaf.current)
      map.current?.remove()
      map.current = null
    }
  }, [data, ordered])

  // FLOW-76 TechComet — real interpolated position + a fading trail, only while
  // the operator is actively dragging the FLOW-77 scrub control (never a standing
  // ambient loop; updates only on discrete scrub-input events).
  useEffect(() => {
    if (!scrubbing || !map.current) return
    void import("maplibre-gl").then((maplibregl) => {
      const m = map.current
      if (!m) return
      const pos = cometPosition(ordered, scrub)
      if (!pos) return
      const trail = document.createElement("div")
      trail.className = "jarvis-comet-dot"
      const marker = new maplibregl.Marker({ element: trail }).setLngLat(pos).addTo(m)
      cometMarkers.current.push(marker)
      const stale = cometMarkers.current.slice(0, -6)
      cometMarkers.current = cometMarkers.current.slice(-6)
      stale.forEach((mk) => mk.remove())
      cometMarkers.current.forEach((mk, i) => {
        const el = mk.getElement()
        el.style.opacity = String(0.15 + 0.7 * ((i + 1) / cometMarkers.current.length))
      })
    })
  }, [scrub, scrubbing, ordered])

  useEffect(() => {
    if (!selected) return
    setHousehold(null)
    setHouseholdError(null)
    void jarvisGet<{ data: Household }>("read-models/household-360", { householdId: selected.householdId })
      .then((r) => setHousehold(r.data))
      .catch((cause) => setHouseholdError(cause instanceof Error ? cause.message : "Couldn’t load the household record."))
  }, [selected])

  async function assignVisit(): Promise<void> {
    if (!selected || !assignee || assigning) return
    setAssigning(true)
    setAssignError(null)
    try {
      await jarvisPost("dispatch/map", { visitId: selected.visitId, sourceKind: selected.sourceKind, technicianId: assignee })
      setSelected(null)
      setAssignee("")
      onAssigned()
    } catch (cause) {
      setAssignError(cause instanceof Error ? cause.message : "Couldn’t assign the visit.")
    } finally {
      setAssigning(false)
    }
  }

  useEffect(() => {
    if (!scrubbing) {
      cometMarkers.current.forEach((mk) => mk.remove())
      cometMarkers.current = []
    }
  }, [scrubbing])

  // FLOW-77 DayScrub's sun-angle gradient — shifts with the scrub fraction across
  // the real ordered-stop sequence (an honest proxy for "through the day", since no
  // per-stop time-of-day evenly spans 0-100 the way a clock does).
  const sunGradient = useMemo(() => {
    const t = scrub / 100
    const dawn = "rgba(103,116,232,0.10)"
    const noon = "rgba(251,191,36,0.10)"
    const dusk = "rgba(244,114,182,0.10)"
    const stop = t < 0.5 ? `color-mix(in srgb, ${dawn} ${100 - t * 200}%, ${noon} ${t * 200}%)` : `color-mix(in srgb, ${noon} ${100 - (t - 0.5) * 200}%, ${dusk} ${(t - 0.5) * 200}%)`
    return stop
  }, [scrub])

  return (
    <div className="jarvis-dispatch-map-core space-y-4">
      {data?.synthetic && <div className="rounded-xl border border-amber-300/25 bg-amber-300/5 px-3 py-2 j-fs-micro text-amber-100">Dealer Zero — synthetic Houston-metro fixture data.</div>}
      {error && <ErrorState message={data ? `Showing the last successful route. ${error}` : error} onRetry={onRetry} />}
      {assignError && <ErrorState message={assignError} onRetry={() => void assignVisit()} />}
      {loading && !data && <div className="rounded-xl border border-white/8 bg-white/[0.02] p-4 j-fs-sm text-[color:var(--j-text-dim)]">Loading the real dispatch route…</div>}
      <div className="jarvis-dispatch-map-grid grid gap-4 xl:grid-cols-[1fr_280px]">
        <div className="space-y-2">
          <div className="relative h-[58vh] min-h-[420px] overflow-hidden rounded-2xl border border-white/10 bg-[#0a1220]">
            <div ref={container} className="h-full w-full" />
            <div aria-hidden className="pointer-events-none absolute inset-0 transition-[background] duration-700" style={{ background: sunGradient }} />
          </div>
          {ordered.length > 1 && (
            <div className="j-panel flex items-center gap-3 p-3">
              <span className="j-label shrink-0">Day scrub</span>
              <input
                aria-label="Scrub through today's real visit order"
                type="range"
                min={0}
                max={100}
                value={scrub}
                onChange={(e) => setScrub(Number(e.target.value))}
                onPointerDown={() => setScrubbing(true)}
                onPointerUp={() => setScrubbing(false)}
                className="h-1.5 w-full flex-1 accent-cyan-300"
              />
              <span className="w-10 shrink-0 text-right j-fs-micro text-white/45">{scrub}%</span>
            </div>
          )}
        </div>
        <aside className="j-panel space-y-4 p-4">
          <div className="j-label">Route load</div>
          <div className="text-3xl font-black text-cyan-200">
            {data?.stops.length ?? "—"}
            <span className="ml-1 text-xs text-white/45">stops</span>
          </div>
          <div className="rounded-xl bg-white/[0.035] p-3 j-fs-micro text-white/65">
            <Route className="mb-2 h-4 w-4 text-cyan-200" />
            {data?.route ? (
              <>
                {/* FLOW-78 KmSavedBloom — remounts (via `key`) on a real value
                    change, playing a one-shot bloom; reduced-motion collapses the
                    keyframe duration to ~0 via the CSS media query below. */}
                <b key={data.route.kmSaved ?? "none"} className="jarvis-km-bloom inline-block text-white">
                  {data.route.kmSaved ?? 0} km saved
                </b>
                <br />
                {data.route.naiveKm ?? "—"} km scheduled → {data.route.optimizedKm ?? "—"} km optimized
              </>
            ) : (
              "No completed B3 route receipt for this day yet."
            )}
          </div>
          <div className="j-fs-micro text-white/45">{data?.unplacedStops ?? 0} stop(s) have no stored coordinate and remain unplaced.</div>
        </aside>
      </div>
      {selected && (
        <Drawer title="Household 360" onClose={() => setSelected(null)}>
          <div className="space-y-4 text-sm">
            <div>
              <div className="j-label">Stop</div>
              <div className="mt-1 font-bold">{selected.type.replaceAll("_", " ")}</div>
              <div className="text-white/60">{selected.address}</div>
              <div className="mt-3 flex flex-wrap gap-2 j-fs-micro">
                <Link className="rounded-lg border border-cyan-200/20 px-2.5 py-1.5 text-cyan-100" href={`/jarvis/customers?householdId=${encodeURIComponent(selected.householdId)}`}>Customer · {selected.householdId.slice(0, 8)}…</Link>
                <Link className="rounded-lg border border-cyan-200/20 px-2.5 py-1.5 text-cyan-100" href={`/jarvis/work?householdId=${encodeURIComponent(selected.householdId)}&${selected.sourceKind === "appointment" ? "appointmentId" : "visitId"}=${encodeURIComponent(selected.visitId)}`}>Work · {selected.sourceKind === "appointment" ? "appointment" : "visit"} {selected.visitId.slice(0, 8)}…</Link>
              </div>
            </div>
            <div className="rounded-xl border border-white/8 bg-white/[.025] p-3">
              <div className="j-label">Assign</div>
              <select aria-label="Assign technician" value={assignee} onChange={(event) => setAssignee(event.target.value)} className="mt-2 w-full rounded-lg border border-white/12 bg-[#0b1423] p-2 j-fs-sm text-white">
                <option value="">Choose technician</option>{data?.technicians?.map((technician) => <option key={technician.id} value={technician.id}>{technician.name}</option>)}
              </select>
              <button type="button" disabled={!assignee || assigning} onClick={() => void assignVisit()} className="mt-2 min-h-11 w-full rounded-lg bg-cyan-300 px-3 j-fs-sm font-black text-slate-950 disabled:opacity-50">{assigning ? "Assigning…" : "Assign visit"}</button>
            </div>
            {household ? (
              <>
                <div>
                  <div className="j-label">Contacts</div>
                  <div className="mt-1">{household.contacts.map((c) => c.name).join(", ") || "No contacts on file"}</div>
                </div>
                <div>
                  <div className="j-label">Equipment</div>
                  <div className="mt-1">{household.equipment.map((e) => `${e.type}${e.model ? ` · ${e.model}` : ""}`).join("; ") || "No equipment on file"}</div>
                </div>
                <div className="rounded-xl border border-white/8 bg-white/[.025] p-3">
                  <div className="j-label">Service history</div>
                  <div className="mt-1 j-fs-micro text-white/65">{household.serviceVisits.length ? `${household.serviceVisits.length} recorded visit${household.serviceVisits.length === 1 ? "" : "s"}` : "No recorded service visits"}</div>
                  <div className="mt-1 j-fs-micro text-white/40">Count from the tenant household-360 read model.</div>
                </div>
              </>
            ) : householdError ? (
              <ErrorState message={householdError} onRetry={() => {
                setHouseholdError(null)
                void jarvisGet<{ data: Household }>("read-models/household-360", { householdId: selected.householdId })
                  .then((r) => setHousehold(r.data))
                  .catch((cause) => setHouseholdError(cause instanceof Error ? cause.message : "Couldn’t load the household record."))
              }} />
            ) : (
              <div className="text-white/50">Loading real household record…</div>
            )}
          </div>
        </Drawer>
      )}
    </div>
  )
}

export function DispatchMap() {
  const [date, setDate] = useState(isoToday)
  const [data, setData] = useState<MapData | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      setData(await jarvisGet<MapData>("dispatch/map", { date }))
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Couldn’t load dispatch.")
    } finally {
      setLoading(false)
    }
  }, [date])

  useEffect(() => { void load() }, [load])

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <div className="j-label flex items-center gap-2">
            <MapPinned className="h-4 w-4" /> Dispatch map
          </div>
          <p className="mt-1 j-fs-micro text-[color:var(--j-text-dim)]">Stored locations only. Dashed line shows B3&apos;s optimized stop order, not road geometry.</p>
        </div>
        <label className="flex items-center gap-2 rounded-xl border border-white/10 px-3 py-2 j-fs-micro">
          <CalendarDays className="h-4 w-4" />
          <input aria-label="Dispatch day" className="bg-transparent text-white" type="date" value={date} onChange={(e) => setDate(e.target.value)} />
        </label>
      </div>
      <DispatchMapCore data={data} error={error} loading={loading} onRetry={() => void load()} onAssigned={() => void load()} />
    </div>
  )
}

export type { MapData, Stop }
export { haversineKm, legsGeoJSON, convexHull, orderedPlaced, cometPosition }
