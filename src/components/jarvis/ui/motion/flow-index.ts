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

  // ---- Band F2 — Command Surface (38-49) ----
  { id: 38, key: "OrbAuraRipple", band: "F2", phase: "F2", status: "planned", dataSource: "SSE/poll events (pulse-bus)" },
  { id: 39, key: "EventMeteor", band: "F2", phase: "F2", status: "planned", dataSource: "same event, orb->feed row" },
  { id: 40, key: "PulseLiquidGauges", band: "F2", phase: "F2", status: "planned", dataSource: "GET /api/vitals" },
  { id: 41, key: "NavCurrent", band: "F2", phase: "F2", status: "planned", dataSource: "route state" },
  { id: 42, key: "SceneDock", band: "F2", phase: "F2", status: "planned", dataSource: "UI scene switch" },
  { id: 43, key: "HeaderTide", band: "F2", phase: "F2", status: "planned", dataSource: "data-core events/min ring buffer" },
  { id: 44, key: "BridgeBoot", band: "F2", phase: "F2", status: "planned", dataSource: "session state" },
  { id: 45, key: "VitalsBreath", band: "F2", phase: "F2", status: "planned", dataSource: "worker_heartbeat age" },
  { id: 46, key: "OrbSpeechSync", band: "F2", phase: "F2", status: "planned", dataSource: "@vapi-ai/web volume-level (honest cut if SDK lacks it)" },
  { id: 47, key: "TickerGlide", band: "F2", phase: "F2", status: "planned", dataSource: "ticker items" },
  { id: 48, key: "CommandGravity", band: "F2", phase: "F2", status: "planned", dataSource: "focus state" },
  { id: 49, key: "ConstellationLink", band: "F2", phase: "F2", status: "planned", dataSource: "hand-authored KPI lineage map" },

  // ---- Band F3 — Decision Theater (50-58) ----
  { id: 50, key: "GateValve", band: "F3", phase: "F3", status: "planned", dataSource: "action status" },
  { id: 51, key: "InkBleed", band: "F3", phase: "F3", status: "planned", dataSource: "decision" },
  { id: 52, key: "RiskCharge", band: "F3", phase: "F3", status: "planned", dataSource: "riskTier" },
  { id: 53, key: "DiffWipe", band: "F3", phase: "F3", status: "planned", dataSource: "price-book provenance" },
  { id: 54, key: "BatchDeckShuffle", band: "F3", phase: "F3", status: "planned", dataSource: "batch selection" },
  { id: 55, key: "ConsequenceTrail", band: "F3", phase: "F3", status: "planned", dataSource: "real post-decision refetch" },
  { id: 56, key: "UndoRing", band: "F3", phase: "F1", status: "shipped", dataSource: "revert window (undo countdown)", note: "F1.T2 pre-delivered the ring inside the F1 Toast shell (ApprovalCockpit's UndoToast); F3.T1 owns full decision-theater polish" },
  { id: 57, key: "EscalateBeacon", band: "F3", phase: "F3", status: "planned", dataSource: "decision" },
  { id: 58, key: "KeymapHUD", band: "F3", phase: "F3", status: "planned", dataSource: "real keydown" },

  // ---- Band F8 — Pipeline Theater amplifier (59-66) — LOCKED behind main D4 ----
  { id: 59, key: "ChamberPressure", band: "F8", phase: "F8", status: "planned", dataSource: "workflow_steps.attempts", note: "LOCKED — prereq main D4 GATE-GREEN" },
  { id: 60, key: "FlowParticulate", band: "F8", phase: "F8", status: "planned", dataSource: "run events (steps/min)", note: "LOCKED — prereq main D4" },
  { id: 61, key: "StepIgnition", band: "F8", phase: "F8", status: "planned", dataSource: "step transitions", note: "LOCKED — prereq main D4" },
  { id: 62, key: "CompensationRewind", band: "F8", phase: "F8", status: "planned", dataSource: "compensation steps", note: "LOCKED — prereq main D4" },
  { id: 63, key: "DLQGravityWell", band: "F8", phase: "F8", status: "planned", dataSource: "DLQ events", note: "LOCKED — prereq main D4" },
  { id: 64, key: "RunConstellation", band: "F8", phase: "F8", status: "planned", dataSource: "runs+steps", note: "LOCKED — prereq main D4" },
  { id: 65, key: "WatchdogFlare", band: "F8", phase: "F8", status: "planned", dataSource: "A4 watchdog flags", note: "LOCKED — prereq main D4" },
  { id: 66, key: "TriageWhisper", band: "F8", phase: "F8", status: "planned", dataSource: "A4.T3 suggested_disposition", note: "LOCKED — prereq main D4" },

  // ---- Band F4 — Voice Theater (67-73) ----
  { id: 67, key: "WaveformTruth", band: "F4", phase: "F4", status: "planned", dataSource: "Vapi volume events" },
  { id: 68, key: "TranscriptTide", band: "F4", phase: "F4", status: "planned", dataSource: "transcript" },
  { id: 69, key: "IntentSpark", band: "F4", phase: "F4", status: "planned", dataSource: "real created domain_actions" },
  { id: 70, key: "CallOrbit", band: "F4", phase: "F4", status: "planned", dataSource: "call state" },
  { id: 71, key: "VoiceMoodWash", band: "F4", phase: "F4", status: "planned", dataSource: "voiceState" },
  { id: 72, key: "HoldBreath", band: "F4", phase: "F4", status: "planned", dataSource: "call state (honest cut if SDK lacks hold)" },
  { id: 73, key: "HangupSettle", band: "F4", phase: "F4", status: "planned", dataSource: "call end event" },

  // ---- Band F9 — Geo Cinema (74-80) — LOCKED behind main D5 ----
  { id: 74, key: "PinDrop", band: "F9", phase: "F9", status: "planned", dataSource: "map data", note: "LOCKED — prereq main D5" },
  { id: 75, key: "RouteInk", band: "F9", phase: "F9", status: "planned", dataSource: "B3 route legs", note: "LOCKED — prereq main D5" },
  { id: 76, key: "TechComet", band: "F9", phase: "F9", status: "planned", dataSource: "position/replay data", note: "LOCKED — prereq main D5" },
  { id: 77, key: "DayScrub", band: "F9", phase: "F9", status: "planned", dataSource: "visit schedule", note: "LOCKED — prereq main D5" },
  { id: 78, key: "KmSavedBloom", band: "F9", phase: "F9", status: "planned", dataSource: "B3 result", note: "LOCKED — prereq main D5" },
  { id: 79, key: "ZoneBreath", band: "F9", phase: "F9", status: "planned", dataSource: "job counts", note: "LOCKED — prereq main D5" },
  { id: 80, key: "MapFocusDive", band: "F9", phase: "F9", status: "planned", dataSource: "UI pin click", note: "LOCKED — prereq main D5" },

  // ---- Band F5 — Data-Viz Language (81-87) ----
  { id: 81, key: "AxisEtch", band: "F5", phase: "F5", status: "planned", dataSource: "any chart" },
  { id: 82, key: "BarSettle", band: "F5", phase: "F5", status: "planned", dataSource: "read-models" },
  { id: 83, key: "DonutCarve", band: "F5", phase: "F5", status: "planned", dataSource: "read-models" },
  { id: 84, key: "SparkPulse", band: "F5", phase: "F5", status: "planned", dataSource: "live series" },
  { id: 85, key: "DeltaShimmer", band: "F5", phase: "F5", status: "planned", dataSource: "real diffs" },
  { id: 86, key: "BandBreath", band: "F5", phase: "F5", status: "planned", dataSource: "B3 forecasts (fixture until shipped, labeled)" },
  { id: 87, key: "AnomalyFlare", band: "F5", phase: "F5", status: "planned", dataSource: "B3 anomalies (fixture until shipped, labeled)" },

  // ---- Band F6 — State Narratives (88-93) ----
  { id: 88, key: "EmptyTerrarium", band: "F6", phase: "F6", status: "planned", dataSource: "row counts" },
  { id: 89, key: "ErrorFracture", band: "F6", phase: "F6", status: "planned", dataSource: "error state" },
  { id: 90, key: "OfflineDrift", band: "F6", phase: "F6", status: "planned", dataSource: "degraded state" },
  { id: 91, key: "FirstRunTide", band: "F6", phase: "F6", status: "planned", dataSource: "real emptiness" },
  { id: 92, key: "StaleFog", band: "F6", phase: "F6", status: "planned", dataSource: "lane timestamps" },
  { id: 93, key: "PermissionVeil", band: "F6", phase: "F6", status: "planned", dataSource: "auth state" },

  // ---- Band F7 — Continuity (94-97) ----
  { id: 94, key: "RouteHandoff", band: "F7", phase: "F7", status: "planned", dataSource: "navigation" },
  { id: 95, key: "DrawerToPage", band: "F7", phase: "F7", status: "planned", dataSource: "UI" },
  { id: 96, key: "ListToDetail", band: "F7", phase: "F7", status: "planned", dataSource: "UI" },
  { id: 97, key: "BackTrace", band: "F7", phase: "F7", status: "planned", dataSource: "scene history" },

  // ---- Band F10 — Ambient Intelligence (98-100) — LOCKED behind main D6 ----
  { id: 98, key: "GreetingCurrent", band: "F10", phase: "F10", status: "planned", dataSource: "real deltas", note: "LOCKED — prereq main D6" },
  { id: 99, key: "FrecencyGlow", band: "F10", phase: "F10", status: "planned", dataSource: "D6.T3 frecency store", note: "LOCKED — prereq main D6" },
  { id: 100, key: "QuietHours", band: "F10", phase: "F10", status: "planned", dataSource: "D6 prefs", note: "LOCKED — prereq main D6" },
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
