# JARVIS FRONTEND MAESTRO PLAN v1 — THE LIVING CONSOLE

**Planned by:** Fable 5 (max) · 2026-07-23 · source-verified against the real tree the same day
**Executed by:** Sonnet 5 (high) sessions, one phase in focus per session; 2-session phases are normal.
**State file:** `/Users/paramdave/FINNOR/JARVIS-FRONTEND-MAESTRO-STATE.md` — same checkbox+evidence convention as JARVIS-MAESTRO-STATE.md.
**Relationship to the main plan:** COMPANION to `/Users/paramdave/FINNOR/JARVIS-MAESTRO-PLAN.md`, never a replacement. The main plan stays authoritative for everything it owns — all A/B backend phases, C1–C3 (shipped), D1–D3 (shipped), and the not-yet-built D4–D9. This plan owns one thing: the **F-track** — turning the already-real, already-honest JARVIS frontend into a singular, cinematic, live operations instrument. F-phases deepen shipped surfaces now and amplify D4–D9 surfaces after those phases go green. Nothing here duplicates, rewrites, or front-runs a main-plan task except where §7 declares an explicit coordination contract.
**Mission:** extend the FLOW catalog 25 → 100 catalogued, state-driven behaviors; unify every pixel under one design codex; kill everything generic — while preserving truth-first data, approval safety, keyboard completeness, accessibility, reduced-motion discipline, and 55–60fps.

---

## §0 — EXECUTION PROTOCOL (mandatory, every session)

**Kickoff prompt Param pastes (the only thing he ever types):**

> Read /Users/paramdave/FINNOR/JARVIS-FRONTEND-MAESTRO-PLAN.md §0–§2 fully, plus §3's band and §5's section for the target phase, then /Users/paramdave/FINNOR/JARVIS-FRONTEND-MAESTRO-STATE.md fully. Also read JARVIS-MAESTRO-PLAN.md §0+§1 and the relevant blocks of JARVIS-MAESTRO-STATE.md (both files' rules bind here too). Execute phase **<F-ID>**: work its unchecked tasks top-down. Evidence for every checkbox. Close with the End Ritual.

### Start Ritual
1. Read this plan's §0/§1/§2, the target phase's §5 section in full, its FLOW band in §3, and its block in the F-STATE file. Read the main plan §0+§1 and the main STATE blocks for any phase the target phase touches or depends on (§6 lists them).
2. Read every file on the phase's `Read:` line BEFORE writing code; run every `discover:` step first. Verify any §1 claim you are about to build on — §1 was true 2026-07-23; re-probe, don't trust.
3. Orient: `git log --oneline -8` + `git status` at repo root. Note anything dirty before touching it.
4. If the F-STATE file shows the phase complete, say so and stop — never redo green work. If a main-plan prerequisite in §6 isn't GATE-GREEN in the main STATE file, stop and report — never build an amplifier on an unshipped surface.

### Work Loop
- Tasks strictly in order (T1, T2, …). Commit per task or coherent group, message style matching repo history.
- A checkbox is checked ONLY after its verification ran, with `(evidence: …)` — commit sha, test file + count, pasted output, or screenshot/recording reference. Mirror the main STATE file's evidence style exactly.
- `Deviation:` lines for small adaptations; STOP and write findings (not code) if reality differs in a way that changes design.
- **Reuse before build** — this codebase already contains an unusual amount of finished machinery (§1 inventories it). Grep before creating anything with a similar name or purpose. The F-track's whole method is extending `ui/motion`, `ui/fx`, `ui/primitives`, `ui/renderers`, `EventFX`, `data-core`'s emitter, `sound.ts` — never parallel systems.

### Hard rules (main plan rules 1–10 all bind; these add F-specifics)
- **F1. Catalog or it doesn't exist.** Every new visual/motion behavior gets a FLOW id from §3, an entry in `ui/motion/flow-index.ts`, a Stage card with fixture + reduced-motion fallback text + data-source line. No uncatalogued decoration.
- **F2. Real state or labeled state.** Every behavior binds to real data, real workflow state, real user intent, or a fixture explicitly labeled FIXTURE/DEMO on its Stage card and never shown as live in the app. The repo's eslint ban on `Math.random()` under jarvis scope stands; deterministic hash for any jitter.
- **F3. Motion is meaning.** Use the §2 motion-semantics table: value changes tick, arrivals cascade, causality flies, attention pulses, rejection shatters, completion crystallizes, ambience respires. If a proposed behavior doesn't map to a row, it's decoration — cut it.
- **F4. Perf is a feature of the design, not a cleanup phase.** GPU-safe props only (transform/opacity/filter/clip-path/stroke-dash); ≤2 ambient loops per viewport (census in F12); everything pauses offscreen (IntersectionObserver) and on `visibilitychange`; reduced-motion handled INSIDE primitives/choreo; low-power collapse follows Orb3D's `deviceMemory<=2` precedent. FPS ≥55 proof via the established Playwright method for every phase that adds a loop or a scene.
- **F5. SSR discipline** (three real bug classes already caught and fixed — never reintroduce): `initial` never branches on `useReducedMotion()` (choreo.ts header documents why); no `Date.now()`/`new Date()` at module scope in fixtures; all date formatting through `fields.ts`'s locale-pinned `formatDateTime/formatDateOnly/formatTimeOnly` — never bare `toLocaleString()`.
- **F6. No new runtime deps without a listed approval.** Already in-tree and fair game: framer-motion, three (+@types), lucide, tailwind, zod, Playwright. gsap/lenis/split-type are MARKETING-SITE machinery (verified: zero imports under jarvis scope) — do not import them into jarvis; framer + hand-rolled canvas/SVG is the jarvis way. Pre-approved when their phase arrives (per main plan §6): cmdk (D7 only), maplibre-gl (D5 only). Charts stay hand-rolled in `lib/charts.tsx`.
- **F7. Strangler discipline continues.** `apps/console` untouchable; legacy `/jarvis` Shell and its ~15 panels stay snapshot-protected; F-work lands on Bridge-side surfaces and shared `ui/*` kits. Mechanical adoption inside legacy panels is allowed only when the snapshot suite guards it and the diff is reviewed against baselines (update baselines deliberately, with evidence, never casually).
- **F8. Honest language everywhere.** Never "AI receptionist"; EMU/sandbox/DEMO labels preserved; signed-out surfaces say sample/sign-in, never fake live; empty states state truth + next action.

### Verification toolkit (established by C2/C3/D1–D3 — reuse by name, don't reinvent)
- **Debug-harness route**: throwaway unauthenticated page under `src/app/jarvis/<phase>-debug/` rendering the component tree with fixtures; screenshot/interact; DELETE before commit. (Stage is owner-gated; `TEST_OWNER_EMAIL/PASSWORD` still unset — the accepted substitute for signed-in recordings.)
- **Playwright FPS probe**: headless page (`hasFocus:true`), rAF counter over ≥2.5s, per-surface isolation honoring the ≤2-loop production ceiling. In-app browser tabs are throttled (`fps:1`) — never measure there.
- **Reduced-motion probe**: `page.emulateMedia({reducedMotion:'reduce'})` + assert zero console/pageerror in both modes.
- **Snapshot guard**: `e2e/jarvis-visual-snapshots.spec.ts` re-run after any change near legacy panels; known full-parallel flake on 2–3 views (documented since C1.T4) — isolate before calling it a regression.
- **Always**: `tsc --noEmit`, `npm run lint`, `npm run build` clean before commit.

### Context budget + End Ritual
Same as main plan §0: at ~25–30% context left, stop starting tasks, run the End Ritual (tests+typecheck pasted, commit, STATE update with evidence + one Session Log line, report with the exact next kickoff line). Multi-session phases are planned for.

---

## §1 — GROUND TRUTH (source-verified 2026-07-23, file-by-file, this session)

**Routes:** `/jarvis` (legacy Shell, 11 sidebar views), `/jarvis/bridge` (D1 Bridge), `/jarvis/stage` (owner-gated catalog harness), `/jarvis/login`. Proxy `src/app/api/jarvis/[...path]/route.ts` allowlists ~32 GETs incl. `vitals` + `activity` (route.ts:67-68).

**Design system (live):** `src/components/jarvis/jarvis-theme.css` (390 lines) — `--j-*` color tokens; `.j-panel` recipe (every card); `.j-label`/`.j-chip`/`.j-hud` brackets/`.j-num-glow`/`.j-scroll`; ~30 keyframes with per-block reduced-motion media queries; mood system `data-mood` (default cyan / voice teal / standalone amber — **no light theme exists, confirmed again**); daypart tint `data-daypart` (D1.T5). `atmosphere.tsx`: ConsoleAtmosphere (aurora ×3, caustic band, 14 deterministic bubbles, grain, vignette), exported `GRAIN` + `GLOW_SHADOW` + `Glass` (+noise) + `LiveDot`.

**Motion stack (live):** `ui/motion/` — `tokens.ts` (DURATION 150/250/400ms, SPRING stiff(380,34)/soft(260,28), EASE standard/decelerate/accelerate/overshoot); `primitives.tsx` (Enter/Stagger/Ticker/Flight/Press, reduced-motion inside, SSR-safe `initial` rule documented in-file); `choreo.ts` (13 presets, each `{variants, reducedVariants}`, initial-parity rule in header); `FlowCard/FlowCatalog/FlowCatalogAmbient` (FLOW-01..25 on Stage); `FpsMeter.tsx` HUD. **FLOW-14's Stage card is a labeled 2D placeholder; the real orb is `bridge/Orb3D.tsx`.**

**FX + primitives (live):** `ui/fx/` — BorderBeam, DecryptText (deterministic scramble), Glass/Glow (re-exports of atmosphere vocabulary), GridBackdrop (Bridge-only), ParticleBurst (re-export of `panels/ParticleField.tsx` 68-line canvas engine + `lib/EventFX.tsx`'s `burstAt`, already fired by real WorkflowTheater completions). `ui/primitives/` — Panel, StatCard, RiskBadge (3 real materials: green glass/amber steel/red obsidian, WCAG-audited in C3), StatusDot, Skeletons, EmptyState (next-action), ErrorState (recovery), Drawer (extracted from ReceiptDrawer), Sparkline (extracted from Metric), Chip does NOT exist yet.

**Renderers (live, D3):** `ui/renderers/` — registry.ts maps all 41 real action types (11 flagship-tier → 7 scenes; VoiceCallScene keyed on `calls` rows separately; 30 standard w/ hand-authored field specs from real zod schemas); `fields.ts` owns the ONLY safe date formatters (locale-pinned "en-US" — the SSR-locale bug class lives here, fixed); ActionRenderer consumed by ApprovalCockpit + ActivityTheater + ReceiptDrawer (same component, 3 real contexts); FallbackRenderer is debug-gated, zero raw-JSON surfaces.

**Bridge (live, D1/D2):** `bridge/Bridge.tsx` — 3-rail layout (left w60: Orb3D+2-scene nav+PulseBar · center: GridBackdrop+CausticHeader+cameraPan scene switch (overview/pipeline only) · right w80: ActivityTheater+ApprovalCockpit). **NOT responsive — rails are fixed-width `shrink-0` with no breakpoint handling; below ~1100px the Bridge is effectively broken.** `Orb3D.tsx`: real Three.js shader point-cloud (~14k pts), 5 FLOW-14 states from real app state, IntersectionObserver+visibility pause, static-gradient fallback (reduced-motion / deviceMemory≤2), mounted-flag hydration convention. `PulseBar` (real /api/vitals, EMU-tagged binding lights), `ActivityTheater` (real /api/activity, SSE-first via `NEXT_PUBLIC_JARVIS_SSE_URL` → B1's live Railway gateway, polling fallback), `ApprovalCockpit.tsx` (33KB: tilt cards, RiskBadge, price-book provenance, critic chip (real machinery, currently always null — no Bedrock key), graceful-absent B2/B6 fields, ApproveStamp/RejectGhost/DeckFan/ShakeDeny overlays, roving tabindex j/k/Enter/a/r/u, UndoToast → real `POST actions/:id/revert`; **undo's "unclaimed" window is sub-millisecond today** — decide() executes synchronously; honest "already claimed" is the designed norm).

**Legacy Shell (live, snapshot-protected):** `JarvisCommandCenter.tsx` — 11 views; CommandCenterHome stacks ~15 panels with uniform `jarvis-rise` 60ms-step entrances; `views.tsx` (960 lines, 9 views on a shared `useResource(kind, sample)` hook — signed-out = labeled sample mode); `lib/` — data-core.ts (4-lane poller: 4s/8s/30s/60s, 30-snapshot ring buffer, **typed event emitter `onJarvisEvent`** — every flash traces to a real diff), EventFX.tsx (flash/useFlashRef/burstAt conductor bound to that emitter), CommandPalette (basic ⌘K: fuzzy views + canned prefills — D7.T2 owns its cmdk upgrade), BootSequence (+`shouldShowBoot`), CustomCursor, sound.ts (**synthesized Web Audio sfx, wired app-wide, currently ON by default (`soundOn=true` in Shell) — contradicts main D9.T1's "off by default"; F11/D9 contract in §7 resolves this**), useVapiSession, mood.ts, raf-bus.ts.

**Data spine:** `src/lib/jarvis-client.ts` (typed paths over jarvisGet/jarvisPost) + `src/lib/jarvis/useLiveQuery.ts` (SSE-first hook w/ Last-Event-ID, adaptive 2-3s/15-30s polling) + `openapi-types.ts`. B1's SSE gateway is LIVE on both Railway envs (main STATE B1).

**Tests:** `e2e/jarvis-visual-snapshots.spec.ts` — 13 desktop baselines (11 views + stage gate + bridge gate); owner-content tests honestly `test.skip`-gated on `TEST_OWNER_EMAIL/PASSWORD` (never set — standing repo-wide limitation; debug-harness convention is the accepted substitute). `mobile-375` Playwright project exists with **zero baselines**. Known parallel-load flake on 2–3 views, documented.

**Deps reality:** framer-motion 11, three 0.184+types, lucide, tailwind 3.4, zod, @vapi-ai/web 2.5, @sentry/nextjs, supabase-js, Playwright. gsap+lenis+split-type = marketing site only (0 jarvis imports, grepped). No @tanstack/*, no cmdk, no maplibre-gl, no recharts installed yet.

**Standing gaps that bind F-work:** (1) no test-owner creds → signed-in recordings stay open the honest way, fixture harnesses substitute; (2) `apps/api`'s Vercel deploy is stale — vitals/activity real+tested but not live in prod's Vercel build yet (flagged since B1); (3) 2 pre-existing finnor-os readiness_log RLS test failures, not frontend's; (4) main D4–D9 not started — F8/F9/F10 amplify them only after green.

---

## §2 — THE CODEX: one liquid system

**Thesis.** JARVIS runs a water-treatment business, and the console already whispers water — aurora, bubbles, caustics, liquid fill, pipes, an orb that is literally a water sphere. The F-track commits fully: **the console is a living body of water and light, and every photon is caused by data.** Events are drops; feeds are currents; panels are vessels; the approval gate is a valve; receipts are the sediment of decisions; the Orb is the heart. Not a theme — a physics: one material logic, one lighting logic, one motion logic, all state-driven. When nothing happens, the system respires. When something happens, you can watch causality move — from the orb, along a current, into a feed, onto a receipt. Spectacle and honesty are the same feature: **motion exists to show where data came from and where it went.**

**Hierarchy — the elevation ladder (E0–E4).** E0 flush (ticker chips, rail meta — no border, no blur) · E1 utility (compressed cards, thin border, no glow) · E2 standard (`.j-panel` as shipped) · E3 hero (`.j-panel` + `j-hud` brackets + caustic/AND-only-here ambient; max 1–2 per scene) · E4 overlay (drawers, palette, toasts — deepest shadow, backdrop dim). Every surface declares its tier; two adjacent surfaces never share a tier by accident. F1 encodes this as tokens + a `<Panel tier>` prop; phases assign tiers scene by scene.

**Typography (extract, then enforce — F1.T1 audits real values before freezing):** display 15px/900/tight · metric 22–28px/900/tabular+`j-num-glow` · title 12.5–13px/700 · body 11–12px/`--j-text-dim` · label = `.j-label` (11px/700/caps/0.18em) · micro 8.5–10px/700/caps/0.28em/faint. All numerals tabular everywhere (21 uses today; F1 sweeps the rest).

**Color semantics (already true — now law):** cyan = command/live/focus · teal = voice/flow/healthy-live · green = confirmed/complete · amber = blocked/degraded/standalone/medium-risk · red = error/high-risk · violet = planning/intelligence · blue = structure. Materials: green glass / amber steel / red obsidian (RiskBadge's three, reused wherever risk appears). Mood (`data-mood`) and daypart (`data-daypart`) modulate; they never contradict semantics.

**Motion semantics (the one table every behavior maps to — hard rule F3):**
| Meaning | Motion | Primitive lineage |
|---|---|---|
| value changed | roll/tick, never fade-swap | Ticker |
| entity arrived | surface + cascade | Enter/Stagger |
| causality (A→B) | flight/trail along the path | Flight, meteor, ConsequenceTrail |
| needs human | pulse (≤2 loops/viewport, else static badge) | ValvePulse/PinAura |
| rejected/destroyed | shatter/sink | ShatterReject |
| completed/confirmed | crystallize/bloom, one-shot ≤600ms, end-state-neutral | EventFX classes |
| system alive (idle) | respiration, period ≥4s, pauses hidden | breathe/aurora |
| mode changed | tide (2s wash), never a hard swap | ThemeTide/CameraPan |

**Duration ladder:** micro 150 · standard 250 · scene 400 · cinematic 600–1400 (anything >800 skippable). **Density:** data-first — motion never displaces information; effects live in borders, backdrops, and one-shots, not between the user and a number. **Interaction states (every interactive element):** rest → hover (lift) → focus-visible (halo) → active (sink) → busy (designed, never native) → disabled (aria-disabled + reason tooltip — the ShakeDeny lesson). **Responsive:** desktop = full theater; <lg = docks and sheets, same information, ambience halved; touch = one-thumb decisive actions. **Loading/error/empty:** geometry-matched skeleton tide / fracture+recovery / terrarium+next-action — specified as FLOW-88..93, never a bare spinner or "No data".

---

## §3 — THE FLOW-100 CATALOG (bands; FLOW-26..100 are the F-track's 75 new entries)

Format per entry: **id Name (trigger → behavior → reduced fallback · data source)**. Owning phase implements, registers in `flow-index.ts`, and mounts a Stage card. IDs are stable identifiers grouped by theme, NOT execution order (band F8's ids 59–66 ship after band F4's 67–73 — deliberate; the index tracks status). Existing FLOW-01..25: shipped by C2, unchanged.

**Band F1 — Interaction Grammar (26–37):**
26 HoverLift (pointer over any E1–E3 surface → translateY −2px + border-hot + shadow deepen → border color only · UI state) · 27 FocusHalo (:focus-visible → 2px accent ring + soft glow bloom → plain ring · keyboard) · 28 PressSink (:active → scale .985 + shadow tighten → none · pointer) · 29 SkeletonTide (loading → geometry-matched skeletons shimmer with one slow water-sweep, staggered by DOM order → static blocks · lane state) · 30 ToastSurface (toast → surfaces bottom-right, soft spring, stack compression, countdown ring → fade · app events) · 31 CopyFlash (copy → value flashes accent + "copied" chip at cursor → chip only · clipboard) · 32 TooltipBloom (hover/focus 400ms → scales 0.9→1 from anchor → instant · UI) · 33 DrawerBreath (drawer open → backdrop caustic dim + panel overshoot-settle → slide · UI) · 34 ScrollGlow (overflow exists → top/bottom fades + edge glow while scrollable → static fade · scroll state) · 35 SelectionCurrent (row selected → left bar with flowing dash current while selected → static bar · selection) · 36 CountBadgePop (count increments → pop 1.25 + single ripple (formalizes `jarvis-pop`) → color tick · real diffs via onJarvisEvent) · 37 InlineEditRipple (field saved → ripple along underline → underline color · form state)

**Band F2 — Command Surface (38–49):**
38 OrbAuraRipple (pulse-bus event → one aura ring off the orb, color by event kind, ≥3s throttle → static aura · SSE/poll events) · 39 EventMeteor (new activity row → light particle flies orb→feed row, lands as row glow → row glow only · same event) · 40 PulseLiquidGauges (vitals → queue/DLQ as tiny liquid vessels w/ meniscus → bars · /api/vitals) · 41 NavCurrent (active nav → left bar becomes flowing current; hover = still bar → static · route state) · 42 SceneDock (scene switch → outgoing scene shrinks to a dock chip, incoming unfurls → crossfade · UI) · 43 HeaderTide (event rate ↑ → caustic intensity follows real events/min from data-core ring buffer; hue follows daypart → static · ring buffer) · 44 BridgeBoot (cold visit → rails slide in, orb ignites with one bloom, panels cascade, ≤1.4s, skippable, session-gated like shouldShowBoot → instant · session) · 45 VitalsBreath (heartbeat fresh → dot breathes at period f(heartbeat age); stale → flatline sweep + amber → color only · worker_heartbeat age) · 46 OrbSpeechSync (assistant speaking → orb surface amplitude follows real Vapi volume events → state color only · @vapi-ai/web volume-level, verified in discovery) · 47 TickerGlide (ops ticker → inertial glide, pause on hover → step · ticker items) · 48 CommandGravity (command input focus → stage dims 8%, bar lifts+glows → outline · focus) · 49 ConstellationLink (KPI hover → faint lines draw to that KPI's real source panels (hand-authored lineage map) → highlight only · data lineage)

**Band F3 — Decision Theater (50–58):**
50 GateValve (approval card → valve glyph; approve rotates it open, reject seals it → color swap · action status) · 51 InkBleed (approve → stamp ink bleeds into card border 400ms then crystallizes → border flash · decision) · 52 RiskCharge (card focused/hovered → tier material animates (obsidian shimmer/steel sheen/glass calm); static at rest (ambient budget) → static materials · riskTier) · 53 DiffWipe (provenance toggle → before/after values wipe with a scanline → swap · price-book provenance) · 54 BatchDeckShuffle (batch select → deck fans, selected cards magnetize together pre-decision → list · selection) · 55 ConsequenceTrail (approve lands → receipt chip flies card→activity feed while pending-count odometer decrements in the same beat → counts update · real post-decision refetch) · 56 UndoRing (undo window → 5s draining ring, color shifts as it drains → numeric countdown · revert window) · 57 EscalateBeacon (escalate → beacon pulse travels up the right rail → chip · decision) · 58 KeymapHUD (? pressed → keyboard map overlay, keys light on real presses → static overlay · keydown)

**Band F8 — Pipeline Theater amplifier (59–66) [ships after main D4]:**
59 ChamberPressure (step attempts ↑ → chamber border luminance rises with real attempt count → badge · workflow_steps.attempts) · 60 FlowParticulate (throughput → pipe particulate density ∝ real steps/min → dash speed only · run events) · 61 StepIgnition (step starts/completes → valve pulse + chamber fill begins / shockwave + crystallize (reuses existing shockwave) → color steps · step transitions) · 62 CompensationRewind (compensation path → unfurls in reverse hue with backward particulate → static path · compensation steps) · 63 DLQGravityWell (dead-letter → row sinks with heavy settle; replay lifts with escape velocity → slide · DLQ events) · 64 RunConstellation (run browser → mini step-constellations mirror live step states → status dots · runs+steps) · 65 WatchdogFlare (stuck-run flag → badge flares at real watchdog cadence → static badge · A4 watchdog flags) · 66 TriageWhisper (DLQ row expand → suggested disposition types itself in (DecryptText) → instant text · A4.T3 suggested_disposition)

**Band F4 — Voice Theater (67–73):**
67 WaveformTruth (live call → waveform from real volume events; idle = flatline; never synthetic → level bars · Vapi volume) · 68 TranscriptTide (transcript line → surfaces with per-word timing when timestamps exist, else line-enter → line fade · transcript) · 69 IntentSpark (planner spawns action during call → chip sparks at that transcript moment, flies to spawned-actions tray listing REAL created domain_actions → chip appears · pending actions correlated to call) · 70 CallOrbit (call active → small orbiting body around orb w/ live duration → chip · call state) · 71 VoiceMoodWash (voice session starts → existing mood swap animated as a 2s tide → instant swap · voiceState) · 72 HoldBreath (call hold, if state exists in SDK (discovery) → orb slows, waveform shallow sine → label · call state) · 73 HangupSettle (call ends → orbit body spirals into activity feed as the call row → row appears · call end event)

**Band F9 — Geo Cinema (74–80) [ships after main D5]:**
74 PinDrop (new job/visit pin → drops with mass + dust ring → pin appears · map data) · 75 RouteInk (optimized route → draws with ink width ∝ real leg duration → static route · B3 route legs) · 76 TechComet (technician position updates → comet w/ fading trail; scrubber-replay-only if no live position source (honest) → dot · position/replay data) · 77 DayScrub (scrub timeline → sun-angle gradient shifts + pins ignite in real visit order → step · visit schedule) · 78 KmSavedBloom (optimizer beats naive → counter blooms once with the real number → count · B3 result) · 79 ZoneBreath (active jobs in area > 0 → service polygon breathes softly → static fill · job counts) · 80 MapFocusDive (pin click → camera dive w/ parallax + household drawer opens in sync → pan+open · UI)

**Band F5 — Data-Viz Language (81–87):**
81 AxisEtch (chart mounts → axes etch first, then data draws → static · any chart) · 82 BarSettle (bars → rise with per-bar spring settle, staggered by value order → instant · read-models) · 83 DonutCarve (donut → segments carve with lathe motion; active segment lifts → static · read-models) · 84 SparkPulse (sparkline → latest point pulses (LiveDot lineage) → static point · live series) · 85 DeltaShimmer (delta changes → one green/red shimmer, tabular-nums enforced → color · real diffs) · 86 BandBreath (forecast bands → breathe subtly → static bands · B3 forecasts, fixture until then, labeled) · 87 AnomalyFlare (anomaly point → ring flare + annotation card unfurl → marker · B3 anomalies, fixture until then, labeled)

**Band F6 — State Narratives (88–93):**
88 EmptyTerrarium (empty panel → tiny ambient diorama per plugin family + next-action CTA → static illustration + CTA · row counts) · 89 ErrorFracture (panel error → border fractures at a corner + recovery action; retry seals it → red border + retry · error state) · 90 OfflineDrift (API unreachable → aurora dims, panels take a drift film; reconnect relights in cascade (formalizes standalone relight) → banner · degraded state) · 91 FirstRunTide (tenant has zero rows → panels fill left-to-right as first real data arrives → plain render · real emptiness) · 92 StaleFog (data older than its lane SLA → subtle fog + "as of" timestamp → timestamp only · lane timestamps) · 93 PermissionVeil (unauthorized → frosted veil + honest reason, never fake data → text · auth state)

**Band F7 — Continuity (94–97):**
94 RouteHandoff (route change within /jarvis/* → 250ms caustic wipe veil; orb/rail continuity where mounted → fade · navigation) · 95 DrawerToPage (receipt drawer expand → drawer morphs into a center-stage receipt scene, scroll preserved → navigate · UI) · 96 ListToDetail (feed row → row is the shared element expanding into detail header → navigate · UI) · 97 BackTrace (back → forward transition replayed mirrored, 250ms → fade · scene history)

**Band F10 — Ambient Intelligence (98–100) [ships after main D6]:**
98 GreetingCurrent (return visit → D6's FLOW-23 digest extended with mini-scene handoffs using D3 renderers, typed orb narration, skippable → text · real deltas) · 99 FrecencyGlow (panel frecency → most-used surfaces warm subtly, rare stay cool → no tint · D6.T3 frecency store) · 100 QuietHours (configured quiet hours → whole ambient layer respires slower + sound auto-muted → label · D6 prefs)

---

## §4 — ANTI-GENERIC AUDIT (what makes it ordinary today, and the exact kill)

Verified against source 2026-07-23. Each item: symptom → root cause → fix → executing phase.

1. **Flat panel hierarchy.** ~22 panels share identical `.j-panel` chrome; CommandCenterHome is a 15-panel scroll wall; nothing is the hero. → No elevation system. → E0–E4 ladder + `<Panel tier>` + per-scene tier assignment; heroes get HUD brackets + the ONLY ambient. → F1 (system), F2 (Bridge assignment), D-phase amplifiers thereafter.
2. **Tailwind defaults leaking through.** `rounded-full bg-cyan-300 px-2` pills hand-rolled at many call sites; no Chip primitive; 30 `animate-pulse/ping` hits (some intentional LiveDot, many generic skeletons); native focus outlines (only 22 focus-visible styles app-wide); default scrollbars outside `.j-scroll`. → No grammar layer. → Chip primitive, FocusHalo global, SkeletonTide replacement, designed scrollbars, `::selection`. → F1.
3. **Numbers don't feel alive.** Ticker adopted in only 2 files; raw value swaps elsewhere; tabular-nums on just 21 sites → layout jitter on update. → Adoption gap. → Ticker+tabular sweep on KpiStrip/PulseBar/AnalyticsRow + DeltaShimmer. → F1.T4, F5.
4. **Uniform entrances.** Everything enters via `jarvis-rise` with 60ms steps regardless of meaning. → No motion semantics. → §2 table enforced; entrance style keyed to content kind. → F1 onward, every phase.
5. **Atmosphere is wallpaper.** Aurora/bubbles/gridfloor run identically forever, decoupled from system state. → Decoration, not physics. → HeaderTide (event-rate-coupled), VitalsBreath, OfflineDrift, QuietHours — ambience becomes a state display. → F2, F6, F10.
6. **Causality is invisible.** An approval updates counts somewhere, an event appears somewhere else — nothing shows A causing B. → No lineage motion. → EventMeteor, ConsequenceTrail, ConstellationLink, IntentSpark, HangupSettle. → F2/F3/F4.
7. **The Bridge breaks on small screens** (fixed `w-60`/`w-80` rails, no breakpoints) and legacy mobile is plain pill buttons. → Desktop-only layout. → Edge-dock/sheet system + mobile-375 baselines. → F2.T4, F10.T2.
8. **Text-only empty/error states** (EmptyState/ErrorState exist but are plain). → No narrative layer. → FLOW-88..93. → F6.
9. **Hard cuts between routes and drawer/page contexts.** → No continuity design. → FLOW-94..97 (honest scope: veil + in-Bridge morphs now; full shared-element route persistence only after the legacy Shell is strangled — never a Shell refactor for this). → F7.
10. **Charts are competent but mute** (hand-rolled, no draw-in, no live pulse, donut/bars static). → No viz grammar. → FLOW-81..87 with the `dataviz` skill loaded first (main hard rule #6). → F5.
11. **Sound exists but is un-designed and defaults ON** (contradicts main D9.T1). → Legacy default. → F11 designs the identity, flips default OFF behind prefs; §7 contract with D9. → F11.
12. **The palette is a fuzzy filter** (fine — but it's D7.T2's job to make it the flagship; F-track only feeds it grammar). → Non-collision noted. → D7 owns.

---

## §5 — THE F-TRACK PHASES

### F1 — Codex, Interaction Grammar, Stage 2.0, De-Generic Strike (≈2 sessions)
Read: `jarvis-theme.css` · `ui/motion/{tokens,primitives,choreo}.ts(x)` · `ui/primitives/*` · `ui/fx/*` · `Stage.tsx` · `atmosphere.tsx` · `.eslintrc.cjs` · `lib/EventFX.tsx` · discover: `grep -rn "animate-pulse\|animate-ping" src/components/jarvis --include="*.tsx"` (baseline 30) · `grep -rn "focus-visible" src/components/jarvis` (22) · `grep -rn "tabular-nums" src/components/jarvis` (21) · audit real font sizes/weights in use before freezing the type scale.
- T1 **Codex tokens**: `ui/codex.ts` — TYPE (extracted stops, not invented), ELEVATION E0–E4, Z-map, spacing rhythm, icon rules. CSS in jarvis-theme.css: global `.jarvis-root :focus-visible` halo (FLOW-27), `::selection`, designed scrollbars (`.j-scroll-visible`), `.j-num` (tabular) utility. `<Panel tier>` prop (default E2 — zero visual change at existing call sites, verified by snapshots).
- T2 **Grammar components** (FLOW-26..37): `.j-lift`/`.j-sink` CSS recipes; `ui/primitives/Tooltip.tsx` (~80-line hand-roll); `ui/primitives/Toast.tsx` (extract ApprovalCockpit's UndoToast shell into the manager, cockpit re-consumes it — one toast system); SkeletonTide upgrade in `Skeletons.tsx`; ScrollGlow wrapper; SelectionCurrent recipe; CountBadgePop formalizing `jarvis-pop` (bind to `onJarvisEvent` diffs only); CopyFlash util; InlineEditRipple; DrawerBreath upgrade in `Drawer.tsx`.
- T3 **flow-index + Stage 2.0**: `ui/motion/flow-index.ts` — all 100 ids → {name, band, phase, status: shipped|planned|cut, dataSource}; Stage gains sticky section nav, per-section mount toggles (isolated FPS), fixture-state switcher (normal/empty/error/loading where relevant), and a completeness meter reading flow-index (honest counts).
- T4 **De-generic strike** (snapshot-guarded): replace generic `animate-pulse` skeletons under jarvis with SkeletonTide (grep-listed sites); Ticker + `.j-num` adoption on KpiStrip/PulseBar/AnalyticsRow numerics; `ui/primitives/Chip.tsx` consolidating `.j-chip` usage (new call sites + mechanical legacy swaps only where snapshots confirm pixel-safe or baselines updated deliberately); focus-visible adoption on Bridge nav, cockpit cards, drawer/toast controls.
- T5 **Verification pass**: reduced-motion probe both modes zero errors; FPS ≥55 on the grammar Stage section; snapshot suite green (any deliberate baseline updates evidenced with before/after PNGs).
EXIT GATE: FLOW-26..37 on Stage w/ fixtures + reduced fallbacks + data-source lines · flow-index live with honest statuses · before/after screenshots of ≥3 de-genericized surfaces · grep deltas pasted (generic pulse skeletons ~0) · snapshots green · FPS proof.

### F2 — Command Surface: the Bridge becomes one organism (≈2 sessions)
Read: `bridge/*` (all 5 files) · `lib/EventFX.tsx` · `lib/data-core.ts` (emitter + ring buffer sections) · `src/lib/jarvis/useLiveQuery.ts` · `panels/OpsTicker.tsx` · `lib/BootSequence.tsx` · main STATE D1+B1 blocks · discover: confirm `@vapi-ai/web`'s volume event name from its installed types (`node_modules/@vapi-ai/web/dist/*.d.ts`) before FLOW-46; confirm which ambient loops currently run on the Bridge (aurora, gridfloor, orb) to plan the ≤2-loop budget per state.
- T1 **pulse-bus**: `lib/pulse-bus.ts` — thin subscribe/emit layered over the EXISTING sources (data-core's onJarvisEvent + ActivityTheater's SSE/poll arrivals), no new transport, no polling of its own. EventFX consumes it; all F2 behaviors subscribe to it. One event, many honest pixels.
- T2 **Orb choreography**: OrbAuraRipple (38, ≥3s throttle mirroring eventPingThrottled), EventMeteor (39 — extend ParticleField's engine with a directed-flight emitter, still one canvas), OrbSpeechSync (46 — real volume uniform; if the SDK genuinely lacks the event, ship state-color-only and mark FLOW-46 `cut` with the finding, never a fake amplitude).
- T3 **Bridge kinetics**: SceneDock (42), NavCurrent (41), VitalsBreath (45), PulseLiquidGauges (40), HeaderTide (43 — events/min from the ring buffer, clamped curve), TickerGlide (47), CommandGravity (48), ConstellationLink (49 — hand-authored KPI→source map, documented in-file), BridgeBoot (44 — ≤1.4s, skippable, session-gated). Ambient-budget ruling encoded in code comments: per state, which ≤2 loops win (e.g. voice: orb+waveform; idle: orb+aurora; others pause).
- T4 **Bridge responsive**: <lg the left rail becomes a top bar (orb + scene tabs + sheet trigger), right rail becomes a bottom dock sheet with live badge counts; no information loss; `mobile-375` Playwright baselines added for `/jarvis/bridge` (signed-out gate + debug-harness content shot).
- T5 **Verification**: full-Bridge FPS ≥55 with F2 ambient active; event→pixel demo (fixture-injected event, labeled) recorded showing ripple+meteor+row+ticker in one beat; reduced-motion probe clean; snapshots green.
EXIT GATE: the one-beat causality recording · FPS number pasted · mobile-375 bridge baselines committed · FLOW-38..49 on Stage · reduced-motion clean.

### F3 — Decision Theater (≈1–2 sessions)
Read: `bridge/ApprovalCockpit.tsx` IN FULL · `ui/renderers/{ActionRenderer,registry}` · `lib/ReceiptDrawer.tsx` · `choreo.ts` (stamp/shatter/deck) · main STATE D2 block (the sub-millisecond-undo finding) · F1's Toast extraction.
- T1 **Decision choreography** (FLOW-50..57): GateValve glyph (SVG, rotates by real status); RiskCharge (materials animate ONLY while card hovered/focused — ambient budget); InkBleed extending ApproveStamp; DiffWipe on provenance rows; UndoRing inside the F1 Toast (numeric fallback preserved); EscalateBeacon; ConsequenceTrail (Flight layoutId card→feed + pending-count Ticker decrement fed by the real post-decision refetch, same beat); BatchDeckShuffle (magnetize on top of DeckFan).
- T2 **KeymapHUD** (58): "?" overlay documenting the REAL bindings (j/k/Enter/a/r/u + batch confirm), keys light on real keydown; focus-trapped, Esc closes, `aria-modal`.
- T3 **Receipt depth**: ReceiptDrawer sections stagger-unfurl; evidence rows get source iconography; risk material on the header — no new data, presentation of what the receipt already carries.
EXIT GATE: mouse-free approve chain recorded on the debug harness (labeled FIXTURE) showing stamp→ink→flight→odometer in sequence · FLOW-50..58 on Stage · snapshots green · reduced-motion clean · keyboard path re-verified (activeElement walk pasted, D2's method).

### F4 — Voice Theater (≈1–2 sessions)
Read: `panels/LiveCallPanel.tsx` · `views.tsx` VoiceConsoleView block · `lib/useVapiSession.ts` · `ui/renderers/flagships/VoiceCallScene.tsx` · main plan B1.T4 · discover: Vapi SDK volume/hold event support from installed types; how transcript entries are timestamped today; whether any call→action correlation id exists (grep callId across data-core/orchestration client shapes).
- T1 WaveformTruth (67) in LiveCallPanel + VoiceCallScene's live state — real levels only, flatline when idle.
- T2 TranscriptTide (68) + IntentSpark (69 — tray lists REAL domain_actions created during the call; correlation by callId if it exists, else a labeled time-window correlation, the label visible in UI copy).
- T3 CallOrbit (70 — DOM ring around the orb container, not WebGL), VoiceMoodWash (71 — animate the existing mood transition), HoldBreath (72 — only if discovery confirms a hold state; else mark `cut` with evidence), HangupSettle (73 — orbit body → activity row Flight).
EXIT GATE: full call-lifecycle recording (real Vapi test call if Param initiates one, else emulated-call fixture labeled DEMO) · FLOW-67..73 (or honest cuts) on Stage · reduced-motion clean · no fake amplitude anywhere (code-level assertion: waveform component takes levels only from the SDK event).

### F5 — Data-Viz Language (1 session) — **load the `dataviz` skill BEFORE writing chart code** (main hard rule #6)
Read: `lib/charts.tsx` · `panels/AnalyticsRow.tsx` · `panels/KpiStrip.tsx` · `ui/primitives/Sparkline.tsx` · read-model shapes in `data-core.ts`.
- T1 Chart grammar inside `lib/charts.tsx` (extend the hand-rolled components, no chart lib): AxisEtch (81), BarSettle (82), DonutCarve (83), SparkPulse (84), DeltaShimmer (85) — all fed by data already flowing.
- T2 BandBreath (86) + AnomalyFlare (87) built against labeled fixtures now, graceful-absent wiring for B3's real outputs (the D2-established pattern for not-yet-shipped backend fields).
- T3 Adoption: AnalyticsRow, KpiStrip sparkline, PulseBar sparkline swap to grammar versions — snapshot-guarded, baselines updated deliberately with before/after evidence.
EXIT GATE: FLOW-81..87 on Stage · AnalyticsRow before/after screenshots · snapshots green · reduced-motion clean · contrast spot-check on any new chart colors (C3's Node-script method).

### F6 — State Narratives (1 session)
Read: `ui/primitives/{EmptyState,ErrorState,Skeletons}.tsx` · `panels/DegradedBanner.tsx` · `views.tsx` `useResource` (sample-mode honesty pattern) · `data-core.ts` degraded/lane-timestamp logic.
- T1 EmptyTerrarium (88): one diorama per plugin family (SVG, atmosphere vocabulary, ≤1 gentle loop each, pause offscreen), EmptyState API extended backward-compatibly.
- T2 ErrorFracture (89), StaleFog (92 — real lane timestamps), PermissionVeil (93), OfflineDrift (90 — formalize the standalone relight as a catalogued behavior), FirstRunTide (91 — fires only on genuinely-zero-row tenants; Stage fixture labeled).
- T3 Adoption on Bridge-side consumers (ActivityTheater empty, PulseBar error, cockpit empty). Legacy panels receive these via main D7.T3's sweep — §7 contract, do not sweep them here.
EXIT GATE: all 6 on Stage with F1.T3's state switcher driving them · one REAL degraded screenshot (stop the dev API, honest) · snapshots green · reduced-motion clean.

### F7 — Continuity (1 session)
Read: `src/app/jarvis/{page,layout?,bridge,stage,login}` structure · `Bridge.tsx` scene switch · `lib/ReceiptDrawer.tsx` · `next.config.mjs` (Sentry wrapper — don't disturb) · note: Next 14.2 has no stable View Transitions integration — framer-based veil/morphs only, document this in-file.
- T1 RouteHandoff (94): a 250ms caustic wipe veil component on /jarvis/* route changes. HONEST SCOPE: no layout.tsx refactor to persist the Shell (hard rule F7/#8); orb continuity only between Bridge scenes. Full cross-route persistence is deferred until the legacy Shell is strangled — written into flow-index as a scope note.
- T2 DrawerToPage (95 — receipt drawer expands into a center-stage receipt scene within Bridge, Flight lineage, scroll preserved), ListToDetail (96 — feed row as shared element into the drawer header), BackTrace (97 — Bridge scene history with mirrored CameraPan).
EXIT GATE: recordings of all 4 · zero hydration errors both motion modes · snapshots green.

### F8 — Pipeline Theater Amplifier (1 session) — **prereq: main D4 GATE-GREEN**
Read: whatever D4's STATE evidence lists as its shipped files (discover first — do not assume names) · `panels/WorkflowTheater.tsx` · `choreo.ts` bypassUnfurl/valvePulse · A4's watchdog/triage columns.
- T1 FLOW-59..62 on D4's live run view: ChamberPressure (real attempts), FlowParticulate (real steps/min), StepIgnition (tie to the existing shockwave/sweep classes), CompensationRewind.
- T2 FLOW-63..66 on run browser + DLQ v2: DLQGravityWell, RunConstellation, WatchdogFlare (real flag cadence), TriageWhisper (real suggested_disposition text).
EXIT GATE: fault-injected run recording w/ full choreography (reuse D4's own fault machinery + A3's EMULATOR_FAULTS) · FLOW-59..66 on Stage · theater FPS ≥55 · reduced-motion clean.

### F9 — Geo Cinema (1 session) — **prereq: main D5 GATE-GREEN**
Read: D5's shipped map/my-day files (discover from its STATE evidence) · maplibre integration as D5 built it.
- T1 PinDrop (74), RouteInk (75 — width from real leg durations), TechComet (76 — live positions only if D5 shipped a real source; else scrubber-replay-only, honest), DayScrub (77).
- T2 KmSavedBloom (78 — the real B3 number), ZoneBreath (79), MapFocusDive (80 — camera + drawer in sync).
EXIT GATE: recording over the real Houston-metro seed · pan/scrub FPS ≥55 · FLOW-74..80 on Stage · reduced-motion (static route, no trail) recorded.

### F10 — Ambient Intelligence + Mobile Polish (1 session) — **prereq: main D6 GATE-GREEN**
Read: D6's shipped prefs/role-scenes/digest/frecency files (discover) · F2.T4's responsive docks.
- T1 GreetingCurrent (98 — extend D6's digest with D3-renderer mini-scenes; skippable; real deltas only), FrecencyGlow (99 — real frecency store), QuietHours (100 — prefs-driven ambient slowdown + auto-mute hook for F11).
- T2 Mobile polish: cockpit one-thumb decisive actions (bottom-sheet approve/reject with typed-confirm preserved), `navigator.vibrate` hooks behind the D6 pref (default off; patterns land in F11), mobile-375 baselines for cockpit + activity.
EXIT GATE: two-role + quiet-hours recordings · mobile baselines committed · FLOW-98..100 on Stage.

### F11 — Sonic & Haptic Identity (1 session) — **prereq: main D6 (prefs); coordinates with D9.T1 per §7**
Read: `sound.ts` IN FULL · every `sfx.*` call site (grep) · main plan D9.T1 · D6's prefs surface.
- T1 Soundscape v2 by EXTENDING sound.ts (never a second engine): per-family timbre map (decision/flow/alert/ambient), refined cues ≤180ms (boot hum exempt), master ducking (voice live → ambience −6dB), event-ping throttle preserved. **Flip default OFF; wire the D6 prefs toggle (+ QuietHours auto-mute from F10).** This intentionally pre-delivers main D9.T1's checklist — record it in BOTH state files; D9's session verifies and checks its own box per the found-done precedent (A2.T5).
- T2 Haptics: `navigator.vibrate` patterns (approve 10ms · reject 30ms · error 10-30-10), mobile only, same pref, off by default.
EXIT GATE: audio recording of the cue set · fresh-profile-silent proof (no pref → no sound) · prefs round-trip evidence · cross-reference note added to main STATE's D9 block (a note, never a checked box in the other file).

### F12 — The Unforgettable Pass (≈1–2 sessions) — **prereq: F1–F7 minimum; run after F8–F11 where possible; pairs with main D8/D9**
Read: `flow-index.ts` · full Stage · all F-phase evidence · main D8/D9 sections.
- T1 **FLOW-100 certification**: flow-index matrix — every id shipped|cut with reasons; quality bar over count: tasteless/laggy/unclear entries get tuned or honestly cut (floor: ≥60 new entries shipped, ≥85 total with C2's 25); Stage completeness meter green; per-band FPS spot-checks.
- T2 **Signature-moments tuning**: five moments perfected frame-by-frame — Bridge boot · first approve chain · live-call arrival · workflow completion · offline→relight. A recording of each, with timing notes in the STATE evidence.
- T3 **Perf & a11y proof for all F-work** (feeds D9's gates, replaces nothing): FPS matrix across Bridge/cockpit/theaters (Playwright method) · bundle delta table vs pre-F1 baseline (`next build` output compared) · ambient-loop census proving ≤2/viewport per state · full reduced-motion catalog QA (all 100 cards, both modes, zero errors) · contrast re-audit on every new material (C3's script) · keyboard-path re-verification on cockpit + KeymapHUD + palette.
- T4 **Showcase handoff**: `docs/f-track-showcase-map.md` (root repo) telling main D8 exactly which signature moments to script into Showtime, with the honesty labels each needs.
EXIT GATE: certification matrix pasted (counts + cuts) · 5 signature recordings · FPS/bundle/census/a11y numbers pasted · full snapshot suite green · zero regressions.

---

## §6 — PHASE ORDER MAP + dependencies

| Order | Phase | Prereqs (all must be GATE-GREEN where named) |
|---|---|---|
| 1 | F1 | none (C1–C3, D1–D3 already green) |
| 2 | F2 | F1 |
| 3 | F3 | F1 (F2 recommended for ConsequenceTrail's feed target) |
| 4 | F4 | F2 (orb hooks) |
| 5 | F5 | F1 |
| 6 | F6 | F1 |
| 7 | F7 | F2 |
| 8 | F8 | F1 + **main D4** |
| 9 | F9 | F1 + **main D5** |
| 10 | F10 | F2 + **main D6** |
| 11 | F11 | **main D6** (prefs) |
| 12 | F12 | F1–F7 minimum; ideally all; before/alongside **main D8/D9** |

Suggested interleave with the main plan's remaining §9 order (Param's call each session): F1 → F2 → F3 → [main B2/D4] → F5 → F6 → F8 → F7 → F4 → [main D5] → F9 → [main D6] → F10 → F11 → [main D7] → F12 → [main D8 → A7 → D9]. F-phases never block main phases; main phases gate only F8/F9/F10/F11 as listed. ~15–18 focused sessions for the F-track.

---

## §7 — NON-COLLISION CONTRACTS (binding)

- **D4/D5/D6 (unbuilt):** F8/F9/F10 are amplifiers that run strictly AFTER those gates go green, on the files those phases actually shipped (discovered, not assumed). F-track never pre-builds a D-phase surface.
- **D7.T2 (cmd-K):** untouched by F-track. The existing basic CommandPalette stays as-is until D7; F1's grammar (FocusHalo/Toast/Tooltip) is available to it for free.
- **D7.T3 (effects sweep):** that sweep APPLIES the F1 grammar + F6 states to the remaining legacy panels — F-track deliberately leaves legacy-panel adoption to it (except snapshot-safe mechanical swaps F1.T4 explicitly lists).
- **D8 (Showtime):** consumes F12.T4's showcase map; F-track builds no demo mode.
- **D9.T1 (sound):** F11 pre-delivers it (extend sound.ts, off-default, prefs) and records the cross-reference; D9's session verifies and checks its own box (A2.T5 found-done precedent). D9.T2–T4 (perf/a11y/Lighthouse gates) remain main-plan-owned; F12.T3 feeds them evidence early.
- **Legacy Shell + apps/console:** never refactored by F-track. Bridge is where the F-track lives; the Shell is strangled on the main plan's schedule, not this one's.
- **Backend:** F-track makes zero backend changes. Any needed field that doesn't exist yet renders graceful-absent (D2's pattern) or stays a labeled fixture — never a new route/migration from an F-session.
