"use client"

// F9.T1/T2 — FLOW-74..80 (Band F9 — Geo Cinema) demoed on the Stage, same FlowCard
// chrome convention as the other band catalogs. Reuses the SAME real, exported
// `DispatchMapCore` component `panels/DispatchMap.tsx` ships to production (not a
// Stage-only lookalike) — driven here by hand-authored FIXTURE data shaped like a
// real Dealer Zero day (Houston-metro coordinates, same convention DispatchMap's own
// `synthetic` banner already uses for real seeded data), since Stage has no signed-in
// session to fetch a real day through (the standing no-test-creds limitation every
// prior F-phase has carried). Every behavior below — PinDrop, RouteInk, TechComet,
// DayScrub, KmSavedBloom, ZoneBreath, MapFocusDive — is the real DispatchMapCore
// code path, not a re-implementation.

import { DispatchMapCore, type MapData } from "../../panels/DispatchMap"
import { FlowCard } from "./FlowCard"

const FIXTURE_MAP_DATA: MapData = {
  date: "2026-07-27",
  synthetic: true,
  unplacedStops: 1,
  route: { naiveKm: 41.2, optimizedKm: 27.6, kmSaved: 13.6 },
  stops: [
    { visitId: "f9-fixture-1", sourceKind: "service_visit", technicianId: "tech-1", technicianName: "R. Alvarez", householdId: "hh-1", address: "1200 Post Oak Blvd, Houston, TX", latitude: 29.7423, longitude: -95.4614, type: "water_test", scheduledAt: "2026-07-27T13:00:00.000Z", notes: null, optimized: { sequence: 1 } },
    { visitId: "f9-fixture-2", sourceKind: "service_visit", technicianId: "tech-1", technicianName: "R. Alvarez", householdId: "hh-2", address: "5400 Westheimer Rd, Houston, TX", latitude: 29.7392, longitude: -95.4342, type: "install", scheduledAt: "2026-07-27T14:15:00.000Z", notes: null, optimized: { sequence: 2 } },
    { visitId: "f9-fixture-3", sourceKind: "service_visit", technicianId: "tech-1", technicianName: "R. Alvarez", householdId: "hh-3", address: "2100 Travis St, Houston, TX", latitude: 29.7508, longitude: -95.3712, type: "repair", scheduledAt: "2026-07-27T15:30:00.000Z", notes: null, optimized: { sequence: 3 } },
    { visitId: "f9-fixture-4", sourceKind: "service_visit", technicianId: "tech-1", technicianName: "R. Alvarez", householdId: "hh-4", address: "9400 Katy Fwy, Houston, TX", latitude: 29.7789, longitude: -95.5001, type: "delivery", scheduledAt: "2026-07-27T16:45:00.000Z", notes: null, optimized: { sequence: 4 } },
    { visitId: "f9-fixture-5", sourceKind: "service_visit", technicianId: "tech-2", technicianName: "M. Chen", householdId: "hh-5", address: "unstored coordinate", latitude: null, longitude: null, type: "install", scheduledAt: "2026-07-27T17:00:00.000Z", notes: null, optimized: null },
  ],
}

const FIXTURE_ROWS: Array<{ id: number; title: string; fallback: string; note: string }> = [
  { id: 74, title: "PinDrop", fallback: "pin appears instantly, no dust ring", note: "Every marker below dropped with a real one-shot ring on this section's mount." },
  { id: 75, title: "RouteInk", fallback: "static route line, uniform width", note: "Width driven by REAL haversine distance per leg (no per-leg duration field exists in the backend — documented deviation in DispatchMap.tsx's header)." },
  { id: 76, title: "TechComet", fallback: "no comet, scrubber alone", note: "Drag the Day scrub slider below — a fading-trail comet interpolates along the real ordered stop coordinates. No live position source exists anywhere in this codebase, so this is honestly scrubber-replay-only, per the plan's own explicit fallback." },
  { id: 77, title: "DayScrub", fallback: "date picker only, no intra-day scrub" as const, note: "New control — D5.T2's own 'day scrubber' turned out to mean the day-to-day date picker, not an intra-day one; this is that missing piece, built for real against the same ordered-stop data." },
  { id: 78, title: "KmSavedBloom", fallback: "static number, no bloom", note: "The real 13.6 km saved figure blooms once on mount/change (same real component, real value)." },
  { id: 79, title: "ZoneBreath", fallback: "static polygon fill, no breathe", note: "A REAL convex hull over the fixture's 4 placed stops (no configured service-area polygon exists in the backend to bind to instead — documented deviation)." },
  { id: 80, title: "MapFocusDive", fallback: "drawer opens, no camera dive", note: "Click any pin — the map flies to it while the household drawer opens in sync." },
]

export function GeoCinemaCatalogSection() {
  return (
    <section className="j-panel space-y-3 p-5" data-flow-band="F9">
      <div className="mb-1 flex items-center justify-between">
        <h2 className="j-label">F9 — Geo Cinema (FLOW-74..80)</h2>
        <span className="j-chip bg-cyan-400/12 text-cyan-300">7 entries</span>
      </div>
      <p className="j-fs-micro text-[color:var(--j-text-dim)]">
        One real, live <code>DispatchMapCore</code> mount below (FIXTURE Houston-metro data, same shape as a real Dealer Zero
        seeded day) — every FLOW-74..80 behavior fires from real map/marker code, not a lookalike demo. Drag the Day scrub
        slider to see TechComet + the sun-angle gradient move together; click any pin for MapFocusDive.
      </p>
      <div className="rounded-xl border border-white/8 bg-black/20 p-3">
        <DispatchMapCore data={FIXTURE_MAP_DATA} error={null} />
      </div>
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
        {FIXTURE_ROWS.map((row) => (
          <FlowCard key={row.id} id={`FLOW-${row.id}`} title={row.title} reducedFallback={row.fallback}>
            <p className="j-fs-micro leading-relaxed text-white/55">{row.note}</p>
          </FlowCard>
        ))}
      </div>
    </section>
  )
}
