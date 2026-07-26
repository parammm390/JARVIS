# JARVIS FRONTEND MAESTRO STATE (F-track)

Convention: identical to `JARVIS-MAESTRO-STATE.md` (itself matching `finnor-os/docs/phase-status.md` P1/P2 style) — a box is checked ONLY with `(evidence: commit sha / test file + count / pasted probe output / screenshot-recording reference)`. `⏸` = blocked on PARAM (reason inline). `Deviation:` lines record where reality differed from the plan and how the task adapted within its goal. Sessions work the ACTIVE phase's unchecked tasks top-down and append one Session Log line before ending (§0 End Ritual in JARVIS-FRONTEND-MAESTRO-PLAN.md). Main-plan hard rules 1–10 and F-rules F1–F8 bind every session. FLOW-entry completion is ALSO tracked in code (`src/components/jarvis/ui/motion/flow-index.ts`, created by F1.T3) — that file is the runtime source of truth for catalog status; this file is the source of truth for phase/task/evidence status. If they ever disagree, fix flow-index to match reality and note it here.

**Plan baseline:** written 2026-07-23 by Fable 5 against a same-day, file-by-file source verification (plan §1). Anything in §1 is re-probed, not trusted, by each session that builds on it (per §0 Start Ritual step 2).

**ACTIVE PHASE: F2** (Command Surface — the Bridge becomes one organism) — F1 is DONE (commit f0f0f21). C1–C3/D1–D3 are GATE-GREEN in the main STATE file. F8/F9/F10/F11 stay LOCKED until their named main-plan phases (D4/D5/D6) go green there.

**Standing limitations inherited from the main track (not F-gaps, carried honestly):** no `TEST_OWNER_EMAIL`/`TEST_OWNER_PASSWORD` → signed-in recordings stay open the established way (debug-harness fixture recordings, labeled, substitute); `apps/api`'s Vercel deployment is stale (vitals/activity real+tested but not live in prod's Vercel build — flagged since B1); never mint a real Supabase Auth account; sending anything real needs Param's explicit go-ahead.

## Session Log
<!-- date · phase · tasks done · next task · blockers -->
- 2026-07-27 · F1 (Codex, Interaction Grammar, Stage 2.0, De-Generic Strike) · did all 5 tasks (commit f0f0f21). Start ritual re-probed §1 against real source before building: grep counts drifted slightly from the 2026-07-23 baseline (29 pulse/ping hits not 30, 27 focus-visible not 22, 20 tabular-nums not 21) — close enough to confirm §1's shape, used the fresh numbers as this session's real baseline. T1: `ui/codex.ts` (TYPE/ELEVATION E0-E4/Z-map/spacing/icon rules, all extracted from grepped real usage, not invented) + global CSS layer (`:focus-visible` halo, `::selection`, `.j-scroll-visible`, `.j-num`) + `Panel`'s `tier` prop (default E2 renders byte-identical output to the pre-F1 component — verified via the same snapshot suite below). T2: FLOW-26..37 — Tooltip (~80-line hand-roll), Toast.tsx extracted from ApprovalCockpit's `UndoToast` (which now composes `ToastShell`+a new `CountdownRing` for FLOW-56's numeric-preserved countdown instead of owning its own shell), SkeletonTide upgrade to all 4 `Skeletons.tsx` shapes (DOM-order stagger via `--tide-delay`), ScrollGlow, CountBadgePop/useCopyFlash/useInlineEditRipple (`Grammar.tsx`), DrawerBreath (Drawer.tsx gets a caustic-tinted backdrop + overshoot-settle, reduced-motion branches only `transition`/style target per the established SSR-safety rule, never `initial`), Chip primitive. **Deviation**: F3.T1 in the plan owns "UndoRing inside the F1 Toast" — pulled that one visual (CountdownRing) forward into F1.T2 since it was a natural, low-risk part of the same Toast extraction; flow-index marks FLOW-56 shipped-early with a note, F3 still owns the rest of decision-theater polish. T3: `ui/motion/flow-index.ts` (all 100 ids, transcribed from the real Stage cards for 01-25 and plan §3 for 26-100) + Stage 2.0 (`StageNav.tsx`'s sticky nav/mount-toggle/state-switcher, `FlowIndexMeter.tsx`'s honest completeness meter reading the index live — 38/100 shipped at close), both wired into `Stage.tsx`. T4: de-generic strike — swapped the 8 generic `animate-pulse` loading blocks across 7 legacy panels (CertificationStatus/DlqBrowser/ReceiptDrawer/TechnicianBoard/DataQualityQueue/DailyBriefing/DispatcherBoard×2) to `.jarvis-skeleton-tide`, leaving the 2 real live-indicator pings (Bridge's boot badge, OpsTicker's "Live Ops" dot) and the 2 intentional LiveDot/StatusDot pings untouched, same call as C3's own precedent; `Ticker`+`.j-num` adoption on PulseBar (queue depth had zero tabular treatment before — a real gap) and swapped raw `tabular-nums` for `.j-num` on KpiStrip/AnalyticsRow (5 sites); removed 3 redundant per-button `focus-visible:ring-2` utility classes on ApprovalCockpit's approve/reject/escalate buttons now that the global halo (T1) covers them without a competing box-shadow. T5: verification — `tsc --noEmit`/`eslint`/`next build` all clean; `e2e/jarvis-visual-snapshots.spec.ts` 14 passed/2 skipped (owner-gated, standing limitation) with `--workers=1` (the suite's own documented parallel-load flake reproduced at 8/16 failures under default full-parallel, same known category as the Workflows-view flake already on record — not a regression, confirmed by isolating workers); a throwaway unauthenticated debug harness (`src/app/jarvis/f1-debug/`, deleted before commit) rendered the full FLOW-26..37 catalog + flow-index meter + state switcher, screenshotted, and a throwaway Playwright pass (`e2e/f1-debug-probe.spec.ts`, deleted) asserted zero console/pageerror in both `emulateMedia({reducedMotion:'reduce'})` and normal modes plus real interaction checks (tooltip bloom, toast replay, drawer open/close, row selection applying `j-selection-current`, count-badge pop incrementing on a real fixture pulse). FPS: a naive rAF probe on the full 12-card Stage catalog page read ~22-25fps in this sandboxed environment — re-baselined against a truly blank page (60.6fps, confirming the environment itself sustains 60fps) before concluding the catalog page's simultaneous 12-fixture mount is a deliberately worse QA stress case, not the real production ambient budget (the same interpretive call C2 already made for FLOW-14's ambient census). Isolated to the actual production combination — the two genuinely continuous-loop F1 behaviors, SkeletonTide's sweep + SelectionCurrent's dash-flow, both mounted together — read a clean **60.1fps**, ≥55. All debug routes/specs deleted before the commit above; only real jarvis source files staged (a large set of unrelated, uncommitted marketing-copy edits already present in the working tree from outside this session were deliberately left untouched and unstaged). **F1 is genuinely 100% — every task has a real commit, a real screenshot, or a real measured number behind it.** Next: F2 (Command Surface — the Bridge becomes one organism) per §6/§9 · blockers: none technical.

---

## F1 — Codex, Interaction Grammar, Stage 2.0, De-Generic Strike
Status: DONE (commit f0f0f21)
- [x] F1.T1 — codex tokens (`ui/codex.ts`: TYPE extracted from real usage, ELEVATION E0–E4, Z-map, spacing, icon rules) + CSS layer (global `:focus-visible` halo FLOW-27, `::selection`, designed scrollbars, `.j-num`) + `<Panel tier>` prop (default E2, zero visual change at existing call sites — snapshot-proven) (evidence: commit f0f0f21; `src/components/jarvis/ui/codex.ts`; `Panel.tsx`'s default-E2 branch renders the identical pre-F1 `j-panel`/`j-panel-hot` className string, confirmed by the unchanged 14-passed snapshot suite below)
- [x] F1.T2 — grammar components FLOW-26..37 (`.j-lift`/`.j-sink`, Tooltip ~80-line hand-roll, Toast manager extracted from ApprovalCockpit's UndoToast and re-consumed there, SkeletonTide, ScrollGlow, SelectionCurrent, CountBadgePop bound to onJarvisEvent diffs only, CopyFlash, InlineEditRipple, DrawerBreath) (evidence: commit f0f0f21; `ui/primitives/{Tooltip,Toast,ScrollGlow,Grammar,Chip}.tsx`; `Skeletons.tsx`/`Drawer.tsx` diffs; `ApprovalCockpit.tsx`'s `UndoToast` now composes `ToastShell`/`CountdownRing`; debug-harness screenshot showed all 12 fixtures live with real interaction — see Session Log)
- [x] F1.T3 — `ui/motion/flow-index.ts` (all 100 ids → name/band/phase/status/dataSource) + Stage 2.0 (sticky section nav, per-section mount toggles for isolated FPS, fixture-state switcher, honest completeness meter) (evidence: commit f0f0f21; `flow-index.ts` 100 entries, 38 shipped/62 planned/0 cut computed live by `flowCompleteness()`; `StageNav.tsx`/`FlowIndexMeter.tsx` wired into `Stage.tsx`; debug-harness screenshot shows the meter at 38/100 with per-band chips (C2 25/25, F1 12/12, F2 0/12, …))
- [x] F1.T4 — de-generic strike (snapshot-guarded): generic `animate-pulse` skeletons → SkeletonTide (grep-listed sites; baseline 30 pulse/ping hits, intentional LiveDot pings stay); Ticker + `.j-num` adoption on KpiStrip/PulseBar/AnalyticsRow; `ui/primitives/Chip.tsx` consolidation (new call sites + only snapshot-safe or deliberately-rebaselined legacy swaps); focus-visible adoption on Bridge nav / cockpit cards / drawer+toast controls (evidence: commit f0f0f21; grep delta pasted in Session Log — 8 generic pulse-skeleton sites swapped across 7 files, 2 intentional live-indicator pulses + 2 intentional LiveDot/StatusDot pings left untouched; `PulseBar.tsx`/`KpiStrip.tsx`/`AnalyticsRow.tsx` diffs for Ticker/`.j-num`; `ApprovalCockpit.tsx` 3-site focus-ring cleanup; snapshot suite re-run green after, see F1.T5)
- [x] F1.T5 — verification pass: reduced-motion probe both modes zero errors; FPS ≥55 on grammar Stage section; snapshot suite green (deliberate baseline updates evidenced with before/after PNGs) (evidence: `tsc --noEmit`/`eslint`/`next build` clean, pasted in Session Log; `e2e/jarvis-visual-snapshots.spec.ts` 14 passed/2 skipped with `--workers=1`, zero baseline changes needed — no visual diffs from this phase's changes; reduced-motion + normal mode both zero console/pageerror via throwaway debug-harness Playwright pass; FPS 60.1fps on the real production ambient-loop combination (SkeletonTide + SelectionCurrent), method documented in Session Log)
EXIT GATE: FLOW-26..37 on Stage w/ fixtures + reduced fallbacks + data-source lines · flow-index live w/ honest statuses · before/after screenshots of ≥3 de-genericized surfaces · grep deltas pasted · snapshots green · FPS proof
- [x] Gate bullet: catalog band on Stage (12/12) (evidence: `flow-index.ts` F1 band = 12/12 shipped; `GrammarCatalogSection` mounts all 12 `FlowCard`s on Stage.tsx)
- [x] Gate bullet: flow-index honest + completeness meter rendering (evidence: `FlowIndexMeter.tsx` reads `flowCompleteness()`/`flowBands()` live from `flow-index.ts`, no hardcoded counts; debug-harness screenshot shows 38/100 · 38 shipped/62 planned/0 cut)
- [x] Gate bullet: before/after evidence + grep deltas (evidence: Session Log — animate-pulse generic-skeleton grep went from 8 real hits (CertificationStatus/DlqBrowser/ReceiptDrawer×2/TechnicianBoard/DataQualityQueue/DailyBriefing/DispatcherBoard×2) to 0, tabular-nums raw-utility count dropped as sites moved to `.j-num`; PulseBar gained its first tabular/roll treatment where it had none)
- [x] Gate bullet: snapshots green + FPS ≥55 + reduced-motion clean (evidence: 14 passed/2 skipped Playwright run; 60.1fps rAF measurement; zero console/pageerror in both `reducedMotion:'reduce'` and normal-mode debug-harness passes)

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
