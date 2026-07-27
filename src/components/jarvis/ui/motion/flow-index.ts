// F1.T3 — the FLOW-100 catalog as runtime data. This file is the RUNTIME source of
// truth for catalog status (JARVIS-FRONTEND-MAESTRO-STATE.md §header convention);
// the F-STATE file is the source of truth for phase/task/evidence status. If they
// ever disagree, fix this file to match reality and note it in F-STATE.
//
// FLOW-01..25 names transcribed from the real Stage cards (ui/motion/FlowCatalog.tsx
// + FlowCatalogAmbient.tsx, grepped 2026-07-27) — shipped by C2, unchanged here.
// FLOW-26..100 transcribed from JARVIS-FRONTEND-MAESTRO-PLAN.md §3 (bands F1-F10).
// IDs are stable identifiers grouped by theme, NOT execution order (plan §3).

export type FlowStatus = "shipped" | "planned" | "cut"

export interface FlowEntry {
  id: number
  key: string
  band: string
  phase: string
  status: FlowStatus
  dataSource: string
  note?: string
}

export const FLOW_INDEX: FlowEntry[] = [
  // ---- FLOW-01..25 — C2, shipped ----
  { id: 1, key: "PanelSurface", band: "C2", phase: "C2", status: "shipped", dataSource: "UI state" },
  { id: 2, key: "CascadeStagger", band: "C2", phase: "C2", status: "shipped", dataSource: "UI state" },
  { id: 3, key: "OdometerTicker", band: "C2", phase: "C2", status: "shipped", dataSource: "real numeric props" },
  { id: 4, key: "RipplePress", band: "C2", phase: "C2", status: "shipped", dataSource: "pointer" },
  { id: 5, key: "LiquidFill", band: "C2", phase: "C2", status: "shipped", dataSource: "real fill ratio" },
  { id: 6, key: "PipeFlow", band: "C2", phase: "C2", status: "shipped", dataSource: "workflow step state" },
  { id: 7, key: "ValvePulse", band: "C2", phase: "C2", status: "shipped", dataSource: "needs-human state" },
  { id: 8, key: "BurstFail", band: "C2", phase: "C2", status: "shipped", dataSource: "real step completion (EventFX burstAt)" },
  { id: 9, key: "BypassUnfurl", band: "C2", phase: "C2", status: "shipped", dataSource: "workflow compensation path" },
  { id: 10, key: "StampApprove", band: "C2", phase: "C2", status: "shipped", dataSource: "decision status" },
  { id: 11, key: "ShatterReject", band: "C2", phase: "C2", status: "shipped", dataSource: "decision status" },
  { id: 12, key: "DeckFan", band: "C2", phase: "C2", status: "shipped", dataSource: "batch selection" },
  { id: 13, key: "FlyToDock", band: "C2", phase: "C2", status: "shipped", dataSource: "shared layoutId" },
  { id: 14, key: "OrbStates", band: "C2", phase: "C2", status: "shipped", dataSource: "app state (2D placeholder — real orb is bridge/Orb3D.tsx)", note: "Stage card is a labeled 2D placeholder" },
  { id: 15, key: "CameraPan", band: "C2", phase: "C2", status: "shipped", dataSource: "scene switch" },
  { id: 16, key: "TypeSpeech", band: "C2", phase: "C2", status: "shipped", dataSource: "assistant text" },
  { id: 17, key: "BorderBeam", band: "C2", phase: "C2", status: "shipped", dataSource: "UI state" },
  { id: 18, key: "CausticHeader", band: "C2", phase: "C2", status: "shipped", dataSource: "UI state" },
  { id: 19, key: "RadarSweep", band: "C2", phase: "C2", status: "shipped", dataSource: "real count" },
  { id: 20, key: "DrawSpark", band: "C2", phase: "C2", status: "shipped", dataSource: "UI state" },
  { id: 21, key: "RouteDraw", band: "C2", phase: "C2", status: "shipped", dataSource: "route data" },
  { id: 22, key: "PinAura", band: "C2", phase: "C2", status: "shipped", dataSource: "map pin state" },
  { id: 23, key: "DigestCinematic", band: "C2", phase: "C2", status: "shipped", dataSource: "digest content" },
  { id: 24, key: "ThemeTide", band: "C2", phase: "C2", status: "shipped", dataSource: "daypart/mood state" },
  { id: 25, key: "ShakeDeny", band: "C2", phase: "C2", status: "shipped", dataSource: "action decision status" },

  // ---- Band F1 — Interaction Grammar (26-37) — shipped this phase ----
  { id: 26, key: "HoverLift", band: "F1", phase: "F1", status: "shipped", dataSource: "UI pointer state" },
  { id: 27, key: "FocusHalo", band: "F1", phase: "F1", status: "shipped", dataSource: "keyboard :focus-visible" },
  { id: 28, key: "PressSink", band: "F1", phase: "F1", status: "shipped", dataSource: "pointer :active" },
  { id: 29, key: "SkeletonTide", band: "F1", phase: "F1", status: "shipped", dataSource: "lane loading state" },
  { id: 30, key: "ToastSurface", band: "F1", phase: "F1", status: "shipped", dataSource: "app events" },
  { id: 31, key: "CopyFlash", band: "F1", phase: "F1", status: "shipped", dataSource: "real clipboard write" },
  { id: 32, key: "TooltipBloom", band: "F1", phase: "F1", status: "shipped", dataSource: "UI hover/focus" },
  { id: 33, key: "DrawerBreath", band: "F1", phase: "F1", status: "shipped", dataSource: "UI open/close state" },
  { id: 34, key: "ScrollGlow", band: "F1", phase: "F1", status: "shipped", dataSource: "real scrollTop/scrollHeight" },
  { id: 35, key: "SelectionCurrent", band: "F1", phase: "F1", status: "shipped", dataSource: "selection state" },
  { id: 36, key: "CountBadgePop", band: "F1", phase: "F1", status: "shipped", dataSource: "real diffs via onJarvisEvent" },
  { id: 37, key: "InlineEditRipple", band: "F1", phase: "F1", status: "shipped", dataSource: "real form save" },

  // ---- Band F2 — Command Surface (38-49) — shipped this phase ----
  { id: 38, key: "OrbAuraRipple", band: "F2", phase: "F2", status: "shipped", dataSource: "pulse-bus (data-core onJarvisEvent + activity arrivals)" },
  { id: 39, key: "EventMeteor", band: "F2", phase: "F2", status: "shipped", dataSource: "real new activity-feed row (pulse-bus 'activity' kind), orb->feed anchor rects" },
  { id: 40, key: "PulseLiquidGauges", band: "F2", phase: "F2", status: "shipped", dataSource: "GET /api/vitals (queue.depth, dlq.openCount)" },
  { id: 41, key: "NavCurrent", band: "F2", phase: "F2", status: "shipped", dataSource: "active scene + hover state" },
  { id: 42, key: "SceneDock", band: "F2", phase: "F2", status: "shipped", dataSource: "UI scene switch" },
  { id: 43, key: "HeaderTide", band: "F2", phase: "F2", status: "shipped", dataSource: "pulse-bus event rate, trailing 60s window" },
  { id: 44, key: "BridgeBoot", band: "F2", phase: "F2", status: "shipped", dataSource: "session state (sessionStorage-gated)" },
  { id: 45, key: "VitalsBreath", band: "F2", phase: "F2", status: "shipped", dataSource: "GET /api/vitals heartbeat.ageSeconds/healthy" },
  { id: 46, key: "OrbSpeechSync", band: "F2", phase: "F2", status: "shipped", dataSource: "@vapi-ai/web volume-level via useVapiSession().volumeLevel — real, confirmed live in this SDK" },
  { id: 47, key: "TickerGlide", band: "F2", phase: "F2", status: "shipped", dataSource: "ticker items + real hover state (pause)" },
  { id: 48, key: "CommandGravity", band: "F2", phase: "F2", status: "shipped", dataSource: "real :focus-within + CommandPaletteV2's own backdrop dim" },
  { id: 49, key: "ConstellationLink", band: "F2", phase: "F2", status: "shipped", dataSource: "hand-authored KPI->panel lineage map (ConstellationLink.tsx)" },

  // ---- Band F3 — Decision Theater (50-58) ----
  { id: 50, key: "GateValve", band: "F3", phase: "F3", status: "shipped", dataSource: "action status (decide() verb)" },
  { id: 51, key: "InkBleed", band: "F3", phase: "F3", status: "shipped", dataSource: "decision (extends ApproveStamp)" },
  { id: 52, key: "RiskCharge", band: "F3", phase: "F3", status: "shipped", dataSource: "riskTier, hover/focus state" },
  { id: 53, key: "DiffWipe", band: "F3", phase: "F3", status: "shipped", dataSource: "price-book provenance (D2.T1)" },
  { id: 54, key: "BatchDeckShuffle", band: "F3", phase: "F3", status: "shipped", dataSource: "batch selection" },
  { id: 55, key: "ConsequenceTrail", band: "F3", phase: "F3", status: "shipped", dataSource: "real post-decision refetch + pulse-bus activity-feed anchor" },
  { id: 56, key: "UndoRing", band: "F3", phase: "F1", status: "shipped", dataSource: "revert window (undo countdown)", note: "F1.T2 pre-delivered the ring inside the F1 Toast shell (ApprovalCockpit's UndoToast); F3.T1 owns full decision-theater polish" },
  { id: 57, key: "EscalateBeacon", band: "F3", phase: "F3", status: "shipped", dataSource: "decision (escalate verb)" },
  { id: 58, key: "KeymapHUD", band: "F3", phase: "F3", status: "shipped", dataSource: "real keydown" },

  // ---- Band F8 — Pipeline Theater amplifier (59-66) — shipped this phase ----
  { id: 59, key: "ChamberPressure", band: "F8", phase: "F8", status: "shipped", dataSource: "real workflow_steps.attempts (WorkflowTheater.tsx's GraphNodeCard, leased+retrying nodes only)" },
  { id: 60, key: "FlowParticulate", band: "F8", phase: "F8", status: "shipped", dataSource: "pulse-bus 'step' kind, trailing 60s real steps/min (useStepsPerMinute)" },
  { id: 61, key: "StepIgnition", band: "F8", phase: "F8", status: "shipped", dataSource: "real step status transition into 'leased' (start half); completion half reuses the existing jarvis-shockwave burst" },
  { id: 62, key: "CompensationRewind", band: "F8", phase: "F8", status: "shipped", dataSource: "real 'compensating'/'compensated' step status" },
  { id: 63, key: "DLQGravityWell", band: "F8", phase: "F8", status: "shipped", dataSource: "real replay/discard verb from DlqBrowser's own act()" },
  { id: 64, key: "RunConstellation", band: "F8", phase: "F8", status: "shipped", dataSource: "real workflow_step.status per run (RunBrowser's collapsed rows)" },
  { id: 65, key: "WatchdogFlare", band: "F8", phase: "F8", status: "shipped", dataSource: "real run.watchdogFlagged; flare period = the real A4 watchdog scan cadence (apps/worker's intervalHours: 1/6 = 10min)" },
  { id: 66, key: "TriageWhisper", band: "F8", phase: "F8", status: "shipped", dataSource: "real A4.T3 suggestionReason, revealed on a real row expand" },

  // ---- Band F4 — Voice Theater (67-73) ----
  { id: 67, key: "WaveformTruth", band: "F4", phase: "F4", status: "shipped", dataSource: "Vapi local-volume-level (real mic level)" },
  { id: 68, key: "TranscriptTide", band: "F4", phase: "F4", status: "shipped", dataSource: "transcript (line-enter — no per-word Vapi timestamps)" },
  { id: 69, key: "IntentSpark", band: "F4", phase: "F4", status: "shipped", dataSource: "real pending domain_actions, time-window correlated to call start" },
  { id: 70, key: "CallOrbit", band: "F4", phase: "F4", status: "shipped", dataSource: "call state (voiceState live/speaking)" },
  { id: 71, key: "VoiceMoodWash", band: "F4", phase: "F4", status: "shipped", dataSource: "voiceState via deriveMood()/data-mood" },
  {
    id: 72,
    key: "HoldBreath",
    band: "F4",
    phase: "F4",
    status: "cut",
    dataSource: "call state (no hold event in SDK)",
    note: "@vapi-ai/web's VapiEventNames union (node_modules/@vapi-ai/web/dist/vapi.d.ts) has no client hold/resume event — only a server-side warm-transfer hold flag this browser-mic session never uses. No fake amplitude built for a state the SDK doesn't expose.",
  },
  { id: 73, key: "HangupSettle", band: "F4", phase: "F4", status: "shipped", dataSource: "call end event (voiceState live->idle transition)" },

  // ---- Band F9 — Geo Cinema (74-80) — shipped against D5's real, already-shipped
  // DispatchMap.tsx surface. D5's own EXIT GATE (a live authenticated recording) is
  // separately still open in the main STATE file — that is D5's own gap, not
  // fabricated here; F9 needed D5's real code, which existed. ----
  { id: 74, key: "PinDrop", band: "F9", phase: "F9", status: "shipped", dataSource: "real stored stop coordinates (dispatch/map)" },
  { id: 75, key: "RouteInk", band: "F9", phase: "F9", status: "shipped", dataSource: "real per-leg haversine distance over stored coordinates", note: "no per-leg duration field exists in the backend (verified: RouteOutput only carries naiveKm/optimizedKm/kmSaved aggregates) — used real distance instead, documented in DispatchMap.tsx" },
  { id: 76, key: "TechComet", band: "F9", phase: "F9", status: "shipped", dataSource: "interpolated over real ordered stop coordinates, driven by the FLOW-77 scrub control", note: "no live technician position source exists anywhere in this codebase — honestly scrubber-replay-only, per the plan's own explicit fallback" },
  { id: 77, key: "DayScrub", band: "F9", phase: "F9", status: "shipped", dataSource: "real ordered stop sequence", note: "new intra-day scrub control — D5.T2's 'day scrubber' turned out to mean the day-to-day date picker, not this; built fresh" },
  { id: 78, key: "KmSavedBloom", band: "F9", phase: "F9", status: "shipped", dataSource: "real B3 route_suggestion kmSaved" },
  { id: 79, key: "ZoneBreath", band: "F9", phase: "F9", status: "shipped", dataSource: "real convex hull over today's placed stop coordinates", note: "no configured service-area/zone polygon exists in the backend — used a real computed hull over actual coordinates instead, documented in DispatchMap.tsx" },
  { id: 80, key: "MapFocusDive", band: "F9", phase: "F9", status: "shipped", dataSource: "real pin click + stored coordinate" },

  // ---- Band F5 — Data-Viz Language (81-87) — shipped this phase ----
  { id: 81, key: "AxisEtch", band: "F5", phase: "F5", status: "shipped", dataSource: "any chart (AreaSparkline's real values, opt-in axisEtch prop)" },
  { id: 82, key: "BarSettle", band: "F5", phase: "F5", status: "shipped", dataSource: "read-models (real planner actionTypeStats, ActionMixBars' own sort order)" },
  { id: 83, key: "DonutCarve", band: "F5", phase: "F5", status: "shipped", dataSource: "read-models (real communications-log counts, ChannelDonut)" },
  { id: 84, key: "SparkPulse", band: "F5", phase: "F5", status: "shipped", dataSource: "live series (always-on inside AreaSparkline)" },
  { id: 85, key: "DeltaShimmer", band: "F5", phase: "F5", status: "shipped", dataSource: "real diffs (KpiStrip's delta chip, DeltaChip)" },
  { id: 86, key: "BandBreath", band: "F5", phase: "F5", status: "shipped", dataSource: "Insights.forecastBand (typed in data-core.ts, graceful-absent — B3 hasn't shipped real values yet)", note: "Stage card is FIXTURE-labeled; production wiring (AnalyticsRow) renders nothing until B3 ships forecastBand" },
  { id: 87, key: "AnomalyFlare", band: "F5", phase: "F5", status: "shipped", dataSource: "Insights.anomalies (typed in data-core.ts, graceful-absent — B3 hasn't shipped real values yet)", note: "Stage card is FIXTURE-labeled; production wiring (AnalyticsRow) renders nothing until B3 ships anomalies" },

  // ---- Band F6 — State Narratives (88-93) — shipped this phase ----
  { id: 88, key: "EmptyTerrarium", band: "F6", phase: "F6", status: "shipped", dataSource: "real row counts (ActivityTheater items.length, ApprovalCockpit items.length)" },
  { id: 89, key: "ErrorFracture", band: "F6", phase: "F6", status: "shipped", dataSource: "real error state (useLiveQuery error, decide() POST failure)" },
  { id: 90, key: "OfflineDrift", band: "F6", phase: "F6", status: "shipped", dataSource: "data.statsDegraded (fast-lane reachability, same signal Orb3D's error state already keys on)" },
  { id: 91, key: "FirstRunTide", band: "F6", phase: "F6", status: "shipped", dataSource: "real emptiness (component built; no genuinely-zero-row tenant exists to wire it live)", note: "Stage card is FIXTURE-labeled per the plan's own allowance — no real zero-row-tenant signal exists in this codebase (every seeded/real dealer already has rows), same graceful-absent category as F5's forecastBand/anomalies" },
  { id: 92, key: "StaleFog", band: "F6", phase: "F6", status: "shipped", dataSource: "data-core.slowLastSuccessMs vs SLOW_LANE_STALE_MS (real lane timestamp)" },
  { id: 93, key: "PermissionVeil", band: "F6", phase: "F6", status: "shipped", dataSource: "real auth state (!session guards in ActivityTheater/PulseBar)" },

  // ---- Band F7 — Continuity (94-97) ----
  { id: 94, key: "RouteHandoff", band: "F7", phase: "F7", status: "shipped", dataSource: "real /jarvis/* navigation (src/app/jarvis/template.tsx remount)", note: "orb continuity is Bridge's own LeftRail placement, unchanged by this id; full cross-route persistence deferred until the legacy Shell is strangled" },
  { id: 95, key: "DrawerToPage", band: "F7", phase: "F7", status: "shipped", dataSource: "real receipt id (ActivityTheater → Bridge center-stage scene)", note: "wired for ActivityTheater only — ApprovalCockpit keeps its existing side ReceiptDrawer, a deliberate scope narrowing to avoid touching D2's undo/keyboard machinery" },
  { id: 96, key: "ListToDetail", band: "F7", phase: "F7", status: "shipped", dataSource: "shared layoutId (activity row dot → receipt scene header)" },
  { id: 97, key: "BackTrace", band: "F7", phase: "F7", status: "shipped", dataSource: "real Bridge scene-key history (prevKeyRef)" },

  // ---- Band F10 — Ambient Intelligence (98-100) ----
  // Deviation (disclosed, Param-directed — same precedent as F9/D5): main D6 is
  // `IMPLEMENTED`, not `GATE-GREEN` (JARVIS-MAESTRO-STATE.md:444/450 — physical
  // push-notification tap proof still open, standing no-test-creds limitation).
  // Param explicitly chose to waive the gate for F10 rather than close D6 first.
  // D6's own exit gate is NOT retroactively marked closed by this.
  { id: 98, key: "GreetingCurrent", band: "F10", phase: "F10", status: "shipped", dataSource: "real D6.T4 digest (user-prefs/digest) cross-referenced against real useJarvis().pendingActions", note: "Digest endpoint never returns a full payload (never will — zero backend changes, hard rule); mini-scene renders only for digest items still genuinely in the real pending queue, else graceful-absent to the original plain chip." },
  { id: 99, key: "FrecencyGlow", band: "F10", phase: "F10", status: "shipped", dataSource: "D6.T3 real frecency store (finnor.jarvis.panel-frecency.v1)" },
  { id: 100, key: "QuietHours", band: "F10", phase: "F10", status: "shipped", dataSource: "D6 real user-prefs quietHoursStart/quietHoursEnd" },
]

export function flowCompleteness() {
  const shipped = FLOW_INDEX.filter((f) => f.status === "shipped").length
  const cut = FLOW_INDEX.filter((f) => f.status === "cut").length
  const planned = FLOW_INDEX.filter((f) => f.status === "planned").length
  return { total: FLOW_INDEX.length, shipped, cut, planned }
}

export function flowBands(): string[] {
  return Array.from(new Set(FLOW_INDEX.map((f) => f.band)))
}
