# JARVIS FRONTEND MAESTRO STATE (F-track)

Convention: identical to `JARVIS-MAESTRO-STATE.md` (itself matching `finnor-os/docs/phase-status.md` P1/P2 style) — a box is checked ONLY with `(evidence: commit sha / test file + count / pasted probe output / screenshot-recording reference)`. `⏸` = blocked on PARAM (reason inline). `Deviation:` lines record where reality differed from the plan and how the task adapted within its goal. Sessions work the ACTIVE phase's unchecked tasks top-down and append one Session Log line before ending (§0 End Ritual in JARVIS-FRONTEND-MAESTRO-PLAN.md). Main-plan hard rules 1–10 and F-rules F1–F8 bind every session. FLOW-entry completion is ALSO tracked in code (`src/components/jarvis/ui/motion/flow-index.ts`, created by F1.T3) — that file is the runtime source of truth for catalog status; this file is the source of truth for phase/task/evidence status. If they ever disagree, fix flow-index to match reality and note it here.

**Plan baseline:** written 2026-07-23 by Fable 5 against a same-day, file-by-file source verification (plan §1). Anything in §1 is re-probed, not trusted, by each session that builds on it (per §0 Start Ritual step 2).

**ACTIVE PHASE: F1** (Codex, Interaction Grammar, Stage 2.0, De-Generic Strike) — first F-phase, no main-plan prerequisite; C1–C3/D1–D3 are GATE-GREEN in the main STATE file. F8/F9/F10/F11 stay LOCKED until their named main-plan phases (D4/D5/D6) go green there.

**Standing limitations inherited from the main track (not F-gaps, carried honestly):** no `TEST_OWNER_EMAIL`/`TEST_OWNER_PASSWORD` → signed-in recordings stay open the established way (debug-harness fixture recordings, labeled, substitute); `apps/api`'s Vercel deployment is stale (vitals/activity real+tested but not live in prod's Vercel build — flagged since B1); never mint a real Supabase Auth account; sending anything real needs Param's explicit go-ahead.

## Session Log
<!-- date · phase · tasks done · next task · blockers -->
(none yet — F-track not started)

---

## F1 — Codex, Interaction Grammar, Stage 2.0, De-Generic Strike
Status: NOT STARTED (ACTIVE — next session starts here)
- [ ] F1.T1 — codex tokens (`ui/codex.ts`: TYPE extracted from real usage, ELEVATION E0–E4, Z-map, spacing, icon rules) + CSS layer (global `:focus-visible` halo FLOW-27, `::selection`, designed scrollbars, `.j-num`) + `<Panel tier>` prop (default E2, zero visual change at existing call sites — snapshot-proven)
- [ ] F1.T2 — grammar components FLOW-26..37 (`.j-lift`/`.j-sink`, Tooltip ~80-line hand-roll, Toast manager extracted from ApprovalCockpit's UndoToast and re-consumed there, SkeletonTide, ScrollGlow, SelectionCurrent, CountBadgePop bound to onJarvisEvent diffs only, CopyFlash, InlineEditRipple, DrawerBreath)
- [ ] F1.T3 — `ui/motion/flow-index.ts` (all 100 ids → name/band/phase/status/dataSource) + Stage 2.0 (sticky section nav, per-section mount toggles for isolated FPS, fixture-state switcher, honest completeness meter)
- [ ] F1.T4 — de-generic strike (snapshot-guarded): generic `animate-pulse` skeletons → SkeletonTide (grep-listed sites; baseline 30 pulse/ping hits, intentional LiveDot pings stay); Ticker + `.j-num` adoption on KpiStrip/PulseBar/AnalyticsRow; `ui/primitives/Chip.tsx` consolidation (new call sites + only snapshot-safe or deliberately-rebaselined legacy swaps); focus-visible adoption on Bridge nav / cockpit cards / drawer+toast controls
- [ ] F1.T5 — verification pass: reduced-motion probe both modes zero errors; FPS ≥55 on grammar Stage section; snapshot suite green (deliberate baseline updates evidenced with before/after PNGs)
EXIT GATE: FLOW-26..37 on Stage w/ fixtures + reduced fallbacks + data-source lines · flow-index live w/ honest statuses · before/after screenshots of ≥3 de-genericized surfaces · grep deltas pasted · snapshots green · FPS proof
- [ ] Gate bullet: catalog band on Stage (12/12)
- [ ] Gate bullet: flow-index honest + completeness meter rendering
- [ ] Gate bullet: before/after evidence + grep deltas
- [ ] Gate bullet: snapshots green + FPS ≥55 + reduced-motion clean

## F2 — Command Surface: the Bridge becomes one organism
Status: NOT STARTED (prereq: F1)
- [ ] F2.T1 — `lib/pulse-bus.ts` layered over existing sources (onJarvisEvent + ActivityTheater arrivals), no new transport; EventFX consumes it
- [ ] F2.T2 — orb choreography: OrbAuraRipple (38, ≥3s throttle), EventMeteor (39, directed-flight emitter inside ParticleField's one canvas), OrbSpeechSync (46, real Vapi volume event verified in discovery — honest `cut` if the SDK lacks it)
- [ ] F2.T3 — bridge kinetics: SceneDock (42), NavCurrent (41), VitalsBreath (45), PulseLiquidGauges (40), HeaderTide (43, ring-buffer event rate), TickerGlide (47), CommandGravity (48), ConstellationLink (49, hand-authored lineage map), BridgeBoot (44, ≤1.4s skippable session-gated) — with the per-state ≤2-ambient-loop ruling encoded in comments
- [ ] F2.T4 — bridge responsive (<lg: top bar + bottom dock sheet, no information loss) + mobile-375 baselines for /jarvis/bridge
- [ ] F2.T5 — verification: full-Bridge FPS ≥55 w/ F2 ambient; one-beat causality recording (fixture-injected, labeled); reduced-motion clean; snapshots green
EXIT GATE: causality recording · FPS pasted · mobile-375 bridge baselines committed · FLOW-38..49 on Stage · reduced-motion clean
- [ ] Gate bullet: one-beat causality recording
- [ ] Gate bullet: FPS ≥55 full Bridge
- [ ] Gate bullet: mobile-375 baselines
- [ ] Gate bullet: band on Stage + reduced-motion clean

## F3 — Decision Theater
Status: NOT STARTED (prereq: F1; F2 recommended)
- [ ] F3.T1 — decision choreography FLOW-50..57 (GateValve, RiskCharge hover/focus-only, InkBleed on ApproveStamp, DiffWipe, UndoRing in the F1 Toast, EscalateBeacon, ConsequenceTrail w/ real post-decision refetch, BatchDeckShuffle)
- [ ] F3.T2 — KeymapHUD (58): "?" overlay of the REAL bindings, keys light on real keydown, focus-trapped, aria-modal
- [ ] F3.T3 — receipt depth: ReceiptDrawer stagger-unfurl + evidence source iconography + risk material header (presentation only, no new data)
EXIT GATE: mouse-free approve chain recorded (FIXTURE-labeled harness) · FLOW-50..58 on Stage · snapshots green · reduced-motion clean · keyboard path re-verified
- [ ] Gate bullet: approve-chain recording (stamp→ink→flight→odometer)
- [ ] Gate bullet: band on Stage
- [ ] Gate bullet: snapshots + reduced-motion + keyboard walk evidence

## F4 — Voice Theater
Status: NOT STARTED (prereq: F2)
- [ ] F4.T1 — WaveformTruth (67) in LiveCallPanel + VoiceCallScene live state (real levels only, flatline idle)
- [ ] F4.T2 — TranscriptTide (68) + IntentSpark (69, tray lists REAL created domain_actions; correlation method labeled in UI copy)
- [ ] F4.T3 — CallOrbit (70, DOM ring not WebGL), VoiceMoodWash (71), HoldBreath (72, only if discovery confirms hold state — else honest cut), HangupSettle (73)
EXIT GATE: call-lifecycle recording (real call only w/ Param's go-ahead, else DEMO-labeled fixture) · FLOW-67..73 (or honest cuts) on Stage · reduced-motion clean · waveform provably level-driven only
- [ ] Gate bullet: lifecycle recording
- [ ] Gate bullet: band on Stage w/ honest cut notes if any
- [ ] Gate bullet: reduced-motion + no-fake-amplitude assertion

## F5 — Data-Viz Language
Status: NOT STARTED (prereq: F1 · load `dataviz` skill before chart code — main hard rule #6)
- [ ] F5.T1 — chart grammar in `lib/charts.tsx` (extend hand-rolled, no chart lib): AxisEtch (81), BarSettle (82), DonutCarve (83), SparkPulse (84), DeltaShimmer (85)
- [ ] F5.T2 — BandBreath (86) + AnomalyFlare (87) on labeled fixtures + graceful-absent wiring for B3's future real outputs
- [ ] F5.T3 — adoption: AnalyticsRow / KpiStrip sparkline / PulseBar sparkline (snapshot-guarded, deliberate rebaselines evidenced)
EXIT GATE: FLOW-81..87 on Stage · AnalyticsRow before/after · snapshots green · reduced-motion clean · contrast spot-check pasted
- [ ] Gate bullet: band on Stage
- [ ] Gate bullet: before/after + snapshots
- [ ] Gate bullet: reduced-motion + contrast numbers

## F6 — State Narratives
Status: NOT STARTED (prereq: F1)
- [ ] F6.T1 — EmptyTerrarium (88): per-plugin-family dioramas (≤1 gentle loop each, pause offscreen), EmptyState API extended backward-compatibly
- [ ] F6.T2 — ErrorFracture (89), StaleFog (92, real lane timestamps), PermissionVeil (93), OfflineDrift (90, formalizes standalone relight), FirstRunTide (91, genuinely-zero-row only)
- [ ] F6.T3 — adoption on Bridge-side consumers only (ActivityTheater/PulseBar/cockpit); legacy panels belong to main D7.T3's sweep (§7 contract)
EXIT GATE: all 6 on Stage driven by the state switcher · one REAL degraded screenshot (dev API stopped) · snapshots green · reduced-motion clean
- [ ] Gate bullet: band on Stage w/ state switcher
- [ ] Gate bullet: real degraded screenshot
- [ ] Gate bullet: snapshots + reduced-motion

## F7 — Continuity
Status: NOT STARTED (prereq: F2)
- [ ] F7.T1 — RouteHandoff (94): 250ms caustic wipe veil on /jarvis/* route changes; orb continuity between Bridge scenes only; NO Shell/layout refactor (honest scope note in flow-index)
- [ ] F7.T2 — DrawerToPage (95), ListToDetail (96), BackTrace (97) within Bridge
EXIT GATE: recordings of all 4 · zero hydration errors both motion modes · snapshots green
- [ ] Gate bullet: 4 recordings
- [ ] Gate bullet: hydration-clean both modes
- [ ] Gate bullet: snapshots green

## F8 — Pipeline Theater Amplifier
Status: LOCKED — prereq main **D4** GATE-GREEN (not started there as of 2026-07-23)
- [ ] F8.T1 — FLOW-59..62 on D4's live run view (ChamberPressure real attempts, FlowParticulate real steps/min, StepIgnition tied to existing shockwave/sweep, CompensationRewind)
- [ ] F8.T2 — FLOW-63..66 on run browser + DLQ v2 (DLQGravityWell, RunConstellation, WatchdogFlare real cadence, TriageWhisper real suggested_disposition)
EXIT GATE: fault-injected run recording w/ full choreography · FLOW-59..66 on Stage · theater FPS ≥55 · reduced-motion clean
- [ ] Gate bullet: fault-run recording
- [ ] Gate bullet: band on Stage
- [ ] Gate bullet: FPS + reduced-motion

## F9 — Geo Cinema
Status: LOCKED — prereq main **D5** GATE-GREEN (not started there as of 2026-07-23)
- [ ] F9.T1 — PinDrop (74), RouteInk (75, real leg durations), TechComet (76, live-source-or-scrubber-only honesty), DayScrub (77)
- [ ] F9.T2 — KmSavedBloom (78, real B3 number), ZoneBreath (79), MapFocusDive (80)
EXIT GATE: recording over real Houston-metro seed · pan/scrub FPS ≥55 · FLOW-74..80 on Stage · reduced-motion recorded
- [ ] Gate bullet: seed recording
- [ ] Gate bullet: FPS while panning
- [ ] Gate bullet: band on Stage + reduced-motion

## F10 — Ambient Intelligence + Mobile Polish
Status: LOCKED — prereq main **D6** GATE-GREEN (not started there as of 2026-07-23)
- [ ] F10.T1 — GreetingCurrent (98, D3-renderer mini-scenes, real deltas, skippable), FrecencyGlow (99, real frecency store), QuietHours (100, prefs-driven + F11 auto-mute hook)
- [ ] F10.T2 — mobile polish: one-thumb cockpit decisive actions (typed-confirm preserved), vibrate hooks behind D6 pref (off default), mobile-375 baselines for cockpit + activity
EXIT GATE: two-role + quiet-hours recordings · mobile baselines committed · FLOW-98..100 on Stage
- [ ] Gate bullet: recordings
- [ ] Gate bullet: mobile baselines
- [ ] Gate bullet: band on Stage

## F11 — Sonic & Haptic Identity
Status: LOCKED — prereq main **D6** (prefs); coordinates with main D9.T1 per plan §7
- [ ] F11.T1 — soundscape v2 extending `sound.ts` (per-family timbre, cues ≤180ms, master ducking, throttle preserved) + **default OFF + D6 prefs toggle + QuietHours auto-mute** (pre-delivers main D9.T1 — record in BOTH state files; D9's session verifies + checks its own box per the A2.T5 found-done precedent)
- [ ] F11.T2 — haptics: vibrate patterns (approve 10 / reject 30 / error 10-30-10), mobile only, same pref, off default
EXIT GATE: cue-set audio recording · fresh-profile-silent proof · prefs round-trip · cross-reference note in main STATE D9 block (note only, never their checkbox)
- [ ] Gate bullet: audio recording
- [ ] Gate bullet: silent-by-default proof
- [ ] Gate bullet: prefs round-trip + cross-reference note

## F12 — The Unforgettable Pass
Status: NOT STARTED (prereq: F1–F7 minimum; ideally F1–F11; pairs with main D8/D9)
- [ ] F12.T1 — FLOW-100 certification: flow-index matrix (shipped|cut w/ reasons; floor ≥60 new / ≥85 total), completeness meter green, per-band FPS spot-checks
- [ ] F12.T2 — signature-moments tuning ×5 (Bridge boot · first approve chain · live-call arrival · workflow completion · offline→relight) w/ recordings + timing notes
- [ ] F12.T3 — perf & a11y proof for all F-work: FPS matrix · bundle delta table vs pre-F1 baseline · ambient-loop census (≤2/viewport per state) · full reduced-motion catalog QA (100 cards, both modes) · contrast re-audit on new materials · keyboard re-verification
- [ ] F12.T4 — `docs/f-track-showcase-map.md` handoff for main D8 (which moments Showtime scripts, with honesty labels)
EXIT GATE: certification matrix pasted · 5 recordings · FPS/bundle/census/a11y numbers pasted · full snapshot suite green · zero regressions
- [ ] Gate bullet: matrix + counts
- [ ] Gate bullet: 5 signature recordings
- [ ] Gate bullet: perf/a11y numbers
- [ ] Gate bullet: snapshots green, zero regressions
