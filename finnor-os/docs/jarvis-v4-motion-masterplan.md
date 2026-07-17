# JARVIS v4 Motion Masterplan - the event-driven cinematic upgrade

EXECUTION DOC. Written for a literal-minded executor: follow phases IN ORDER, verify
each gate in the browser BEFORE the next phase, never improvise data. Every design
decision is already made here. If something is not specified, do the smallest thing
that passes the gate; do NOT invent new data sources, metrics, or dependencies.

The product: finnorai.com/jarvis must feel like a living machine. The rule that
makes it feel alive: EVERY visual event traces to a REAL state change, and every
real state change produces a SPECIFIC choreographed visual. This doc is that
choreography, fully specified.

---

## 0. Ground truth you inherit (read, do not re-derive)

Repo: /Users/paramdave/FINNOR (marketing site, Next.js 14 app router, Tailwind,
framer-motion 11, lucide-react. NOTHING else. Adding any dependency is failure.)

Files that exist and matter (all under src/components/jarvis/ unless noted):

| File | Role |
|---|---|
| JarvisCommandCenter.tsx | Shell: sidebar, ticker strip, view router, mounts everything |
| lib/data-core.ts | THE data provider. 4 poll lanes (4s/8s/30s/60s), typed state, change-event emitter `onJarvisEvent`, `metricHistory`, `latencyHistory`, `terminalRuns`, `lastPollAtMs` |
| lib/api.ts | fetch layer via same-origin proxy /api/jarvis/*; `onJarvisRequest` telemetry tap (method/path/status/ms) |
| lib/charts.tsx | AreaSparkline, Donut, GradientBar (pure SVG) |
| lib/CountUp.tsx, lib/Metric.tsx | spring number display |
| lib/CommandPalette.tsx, lib/BootSequence.tsx, lib/AdminKeyPrompt.tsx, lib/useVapiSession.ts | palette, boot overlay, key gate, voice hook |
| panels/WorkflowTheater.tsx | node-graph engine: Graph/GraphNodeCard/GraphEdges/LiveRunRow/ReplayRow/ReplayTheater/BLUEPRINTS, modes live>replay>blueprint |
| panels/JarvisOrb.tsx | SVG arc-reactor orb (size/voiceState/volumeLevel/degraded props) |
| panels/SystemConsole.tsx | live telemetry terminal (subscribes onJarvisRequest) |
| panels/KpiStrip.tsx, HeaderBand.tsx, LiveCallPanel.tsx, AnalyticsRow.tsx, ApprovalDock.tsx, CommsFeed.tsx, ActivityRail.tsx, PipelinePulse.tsx, OpsTicker.tsx, CommandBar.tsx, StepIcon.tsx | the panels |
| jarvis-theme.css | design tokens (--j-*), .j-panel/.j-label/.j-chip/.j-hud skins, keyframes: jarvis-dashflow, jarvis-blueprint-shimmer, jarvis-pulse-ring, jarvis-scan, jarvis-breathe, jarvis-listening-bar, jarvis-dot-blink, jarvis-gridscroll (.jarvis-gridfloor), jarvis-cursor, jarvis-rise (with --rise-to end-opacity var), .j-scroll, .j-num-glow |
| src/app/api/jarvis/[...path]/route.ts | server proxy. DO NOT TOUCH except if a phase says so |

Change events already emitted by data-core (subscribe with
`onJarvisEvent(type, cb)`, returns unsubscribe):
`poll-landed` (every successful 4s poll, detail {latency}) · `new-pending-action` ·
`action-decided` ({verb}) · `step-completed` · `run-completed` · `new-business-event`.

Sounds (sound.ts, all synth, mute-aware): sfx.approve/reject/tick/voiceOn/voiceOff/
send/stepTick/runDone/bootHum, eventPingThrottled().

Dev loop: browser preview server name `finnor-dev` (port 3000). Page: /jarvis.
Typecheck: `npx tsc --noEmit -p tsconfig.json` (ignore lines starting `.next/`).
Lint: `npx eslint src/components/jarvis src/app/jarvis --ext .ts,.tsx`.
Deploy: `vercel --prod --yes` from repo root (aliases finnorai.com). NEVER run
`next build` while the dev server is running.

---

## 1. Hard laws (violating any one = the work is rejected)

1. HONESTY ENGINE. Three classes for every visual: LIVE (from an endpoint), DERIVED
   (computed client-side from LIVE only), AMBIENT (decoration: may NEVER contain a
   numeral, unit, count, or data-shaped label). No invented metrics, no hardcoded
   deltas, no live-looking animation bound to non-live data. Replays of real
   terminal runs are allowed ONLY with the visible REPLAY label + real completion
   age (already implemented; keep the pattern).
   - ALLOWED example: particles burst from a node when `step-completed` fires
     (ambient reaction to a real event).
   - FORBIDDEN example: a ticking counter of "events today" fed by a timer; a
     wiggly sparkline generated from sin(); "+12% vs yesterday" without two real
     time windows.
2. ZERO new npm dependencies. Tailwind + framer-motion + SVG + canvas only.
3. MOTION RELIABILITY DOCTRINE (learned the hard way): framer `initial`/`animate`
   entrance animations on components that MOUNT LATE (after data arrives) are
   flaky in this app. Therefore:
   - Entrances/reveals: CSS keyframes (`.jarvis-rise` pattern; add variants the
     same way, parameterize end-state with CSS vars like `--rise-to`).
   - Continuous loops: CSS animations or framer `animate` with `repeat: Infinity`
     (these are reliable).
   - Interactive springs (hover/tap/drag) and value springs (CountUp): framer.
   - Enter/exit lists: `AnimatePresence initial={false}` ONLY (exit anims work;
     never rely on presence-driven initial mounts).
   - Progress bars / width-height: plain CSS `transition-[width]` + inline style.
4. PERFORMANCE BUDGET: animate only transform/opacity/stroke-dashoffset/
   background-position. ONE requestAnimationFrame loop app-wide (see Phase 1
   raf-bus; the call-panel waveform must migrate onto it). One 1s interval for all
   ticking (data-core `now` already provides it; never add per-component 1s
   timers). All CSS loops carry class `jarvis-ambient` so the existing
   `[data-hidden="true"]` pause keeps working. Poll pause on hidden tab stays.
5. HYDRATION: no Math.random()/Date.now()/new Date() in render paths. Deterministic
   seeds from indexes. Client-only content mounts behind the existing `mounted`
   flag. `next/dynamic ssr:false` for canvas components.
6. COPY: no em-dashes in user-facing strings. Never "AI receptionist".
7. Preserve working behaviors: approve/reject optimistic flow + rollback, 7 sidebar
   views, Vapi session, LIVE/SIMULATION badging, SSR-shell + mounted flag, admin-key
   gate, kill-API degradation with zero console errors.
8. `prefers-reduced-motion`: every new animation must be inert or near-instant
   under it (extend the existing media block; MotionConfig reducedMotion="user" is
   already set).

---

## 2. THE EVENT -> REACTION MATRIX (the heart; implement ALL of it)

Notation: each row = real trigger -> exact reactions. "Flash(el)" = add a class for
600ms then remove (helper built in Phase 2). Colors from tokens.

| # | Real trigger | Reactions (all of them) |
|---|---|---|
| E1 | `poll-landed` (4s) | (a) header sync beacon ring ping (scale 1->1.9 fade, cyan); (b) SystemConsole lines stream (already); (c) sidebar EKG extends (already); (d) a single "data pulse" dot travels the top edge of the page left->right in 700ms (ambient, 2px, cyan, CSS keyframe translate) |
| E2 | `new-pending-action` | (a) page edge-glow: 300ms cyan inner-shadow pulse on `.jarvis-root` via `[data-fx="ping"]`; (b) KPI "Awaiting Approval" card Flash(border-hot) + count-up springs; (c) ApprovalDock: new card enters with `.jarvis-rise` + a one-shot horizontal scanline sweep across the card (gradient translate 600ms); (d) sidebar Command Center badge scale-pops (CSS jarvis-pop keyframe); (e) orb double-pulse (scale 1->1.08->1->1.06->1 over 900ms, one-shot class); (f) eventPingThrottled() |
| E3 | `action-decided` {verb:confirm} | (a) dock card exits right with teal trail (AnimatePresence exit x:80, opacity, plus ::after gradient streak); (b) KPI approvals Flash(teal) + decrement spring; (c) AiPerformance "Decisions made" bumps; (d) orb single teal pulse; (e) sfx.approve (already) |
| E4 | `action-decided` {verb:reject} | mirror of E3 leftward with red trail, sfx.reject |
| E5 | `step-completed` | (a) theater: completed node check pops (already) PLUS shockwave: absolutely-positioned expanding ring div at node center (scale 0.4->1.6, opacity .5->0, 500ms, one-shot); (b) 6 ambient sparks fly from node (Phase 8 canvas, deterministic angles i*60deg); (c) progress bar springs; (d) sfx.stepTick (already) |
| E6 | `run-completed` | (a) row border conic gradient sweep once (CSS `@property --sweep` angle animation 900ms, fallback: linear-gradient background-position sweep); (b) every edge of that row flashes solid green then settles; (c) KPI "Runs In Flight" Flash + decrement; (d) sfx.runDone (already); (e) row collapses out after 6s (AnimatePresence initial={false}) |
| E7 | `new-business-event` | (a) ActivityRail: row pushes in from top with brightness flash (CSS jarvis-rise + Flash); (b) rail pauses insertions while hovered (queue + flush on mouseleave, per spec 7.9); (c) eventPingThrottled |
| E8 | new comms row (diff by id in CommsFeed) | slide-in + sfx.send + channel icon ring ping |
| E9 | voiceState idle->connecting | orb rings accelerate (already via props); command pill border speeds to 1.4s; "Voice ready" pill text -> "Connecting..." with jarvis-dot-blink dots |
| E10 | voiceState ->live (MOOD: VOICE, Phase 5) | (a) `data-mood="voice"` on root: aurora intensity var up, page vignette (inset box-shadow overlay opacity .0->.35), accent hue shifts teal; (b) listening pill expands (width auto, bars animate from REAL volume buckets); (c) LiveCallPanel becomes j-panel-hot; (d) waveform strip live (already); (e) transcript lines type-reveal (CSS clip-path steps, 200ms each, on REAL final transcripts only) |
| E11 | voiceState ->speaking | orb hue teal (already), caption "Finnor is speaking..." (already), waveform bars switch cyan (canvas color param) |
| E12 | voiceState ->idle | mood back to prior, vignette fades 600ms, pill contracts |
| E13 | degraded flip (statsDegraded true) (MOOD: STANDALONE) | (a) `data-mood="standalone"`: ALL LiveDots amber (swap via CSS var --live-dot-color consumed by LiveDot), panel borders desaturate (border var -> amber 10%), gridfloor + aurora dim 50%; (b) LIVE badge morphs to SIMULATION with vertical flip (rotateX 90 swap, 400ms); (c) telemetry lines red; (d) orb amber slow (prop exists); (e) OpsTicker `sim ·` prefix (already) |
| E14 | relight (statsDegraded false after true) | reverse of E13 PLUS staggered "re-ignition": panels get one-shot `.jarvis-rise` re-trigger top-to-bottom 60ms apart (Phase 6 helper re-mounts via key bump) |
| E15 | KPI value change (any card, diff prev vs next in KpiStrip) | Flash(card accent) + number spring (spring exists; add the flash) |
| E16 | command submit in-flight | pill ring 7s->1.4s (already) + send button becomes spinner (already) + input subtle pulse; on planned>0: pill emits one expanding ring + note text types in |
| E17 | palette open | backdrop blur-in 200ms, panel scale .96->1, sfx.tick (already) |
| E18 | hover a graph node | that node scale 1.03 + border-hot; SIBLING nodes AND edges dim to .35 (CSS: group-hover on graph container + :hover exception. Implement with `data-node` + container `:has()` selector; if :has unsupported fallback to JS mouseenter setting container attr) |
| E19 | hover any j-panel | existing border brighten + translateY(-2px) 150ms (verify all panels have it via .j-panel:hover; add transform) |
| E20 | boot (once/session) | Phase 7 choreography |

---

## 3. Phases (each ends with a browser-verified gate; commit after each phase)

### PHASE 1: raf-bus + Mood Engine (foundation, no visible change yet)
Files: NEW lib/raf-bus.ts, NEW lib/mood.ts, edit LiveCallPanel.tsx, JarvisCommandCenter.tsx, jarvis-theme.css.

1. lib/raf-bus.ts:
```ts
"use client"
type Frame = (t: number) => void
const subs = new Set<Frame>()
let running = false
function loop(t: number) {
  if (subs.size === 0) { running = false; return }
  subs.forEach((f) => f(t))
  requestAnimationFrame(loop)
}
export function onFrame(f: Frame): () => void {
  subs.add(f)
  if (!running) { running = true; requestAnimationFrame(loop) }
  return () => subs.delete(f)
}
```
2. Migrate LiveCallPanel WaveformStrip to `onFrame` (delete its own rAF calls, keep
   its 30fps throttle internally). Grep the whole jarvis dir for
   `requestAnimationFrame` afterwards: the ONLY hits allowed are raf-bus.ts and
   CustomCursor.tsx (leave the cursor alone).
3. lib/mood.ts:
```ts
export type Mood = "idle" | "voice" | "standalone"
export function deriveMood(args: { voiceLive: boolean; degraded: boolean }): Mood {
  if (args.degraded) return "standalone"
  if (args.voiceLive) return "voice"
  return "idle"
}
```
4. Shell: compute mood every render from `session.voiceState` + `data.statsDegraded`,
   set `data-mood={mood}` on the `.jarvis-root` div (alongside existing classes).
5. jarvis-theme.css: add mood variable blocks + 600ms transition:
```css
.jarvis-root { --live-dot-color: #2dd4bf; --aurora-opacity: 1; --accent: var(--j-cyan); transition: background-color .6s; }
.jarvis-root[data-mood="voice"] { --accent: var(--j-teal); }
.jarvis-root[data-mood="standalone"] { --live-dot-color: #fbbf24; --aurora-opacity: .45; --accent: var(--j-amber); }
```
   Edit atmosphere.tsx LiveDot to use `background: var(--live-dot-color)` (both the
   ping span and the solid span) instead of hardcoded teal classes. Wrap the aurora
   container (the fixed atmosphere wrapper in the Shell) with
   `style={{ opacity: "var(--aurora-opacity)" as string }}`.
GATE 1: typecheck+lint clean; page renders identical; DevTools: exactly one rAF
driver (breakpoint in raf-bus.loop fires; no other rAF besides cursor); kill the
API (stop dev, set NEXT_PUBLIC_OS_API_URL=https://dead-api.invalid in .env.local,
restart) -> every LiveDot turns amber simultaneously; restore env + restart.

### PHASE 2: EventFX conductor + Flash toolkit
Files: NEW lib/EventFX.tsx, jarvis-theme.css, JarvisCommandCenter.tsx, small edits
in KpiStrip/ApprovalDock/ActivityRail.

1. CSS one-shot classes (all end-state-neutral, 600ms max):
```css
@keyframes jarvis-flash { 0% { box-shadow: 0 0 0 1px var(--accent), 0 0 22px color-mix(in srgb, var(--accent) 45%, transparent); } 100% { box-shadow: none; } }
.jarvis-flash { animation: jarvis-flash .6s ease-out; }
@keyframes jarvis-pop { 0% { transform: scale(1); } 40% { transform: scale(1.25); } 100% { transform: scale(1); } }
.jarvis-pop { animation: jarvis-pop .45s cubic-bezier(.22,1,.36,1); }
@keyframes jarvis-edgepulse { 0% { opacity: 0; } 25% { opacity: 1; } 100% { opacity: 0; } }
@keyframes jarvis-datapulse { from { transform: translateX(-4vw); } to { transform: translateX(104vw); } }
@keyframes jarvis-scanline { from { transform: translateX(-110%); } to { transform: translateX(110%); } }
```
2. lib/EventFX.tsx exports:
   - `flash(el: HTMLElement | null, cls = "jarvis-flash")`: adds class, removes on
     animationend (fallback timeout 700ms).
   - `useFlashRef(event: JarvisEventType, cls?)`: returns a ref; subscribes and
     flashes that element on the event.
   - `<EventFXLayer/>`: fixed overlay (pointer-events-none, z-30) rendering:
     (a) top-edge data pulse dot on every `poll-landed` (remount a span keyed by
     counter with class running jarvis-datapulse 700ms linear);
     (b) page edge glow on `new-pending-action`: a full-viewport div with inset
     box-shadow `inset 0 0 60px -20px var(--j-cyan)` animated via jarvis-edgepulse.
   Mount `<EventFXLayer/>` once in the Shell (inside jarvis-root, after atmosphere).
3. Wire matrix rows E2b/d, E3b, E7a, E15:
   - KpiStrip: keep `prev` values in a ref; on change of a card's value, flash that
     card's root (store per-card element refs in a Map by key).
   - Sidebar badge: give the pending badge `key={data.stats?.pending}` + class
     jarvis-pop (remount pops it).
   - ApprovalDock new-card scanline: card root gets `relative overflow-hidden` plus
     a child `<span class="pointer-events-none absolute inset-y-0 w-1/3 bg-gradient-to-r from-transparent via-cyan-300/20 to-transparent" style="animation: jarvis-scanline .7s ease-out both">`
     rendered only on first mount (useState(true) -> setTimeout false 800ms).
   - ActivityRail hover-pause: keep a `paused` ref + `queue` state; while hovered,
     new events append to queue; on mouseleave, prepend queue then clear.
GATE 2: with dev running, POST a real instruction through the command bar (needs
owner key) or via curl to /api/jarvis/actions with x-jarvis-key; watch in ONE
browser view: edge glow + KPI flash + dock scanline card + badge pop all fire on
the same poll tick; approving fires E3 set. Zero console errors.

### PHASE 3: Workflow Theater v4 (the centerpiece upgrade)
Files: panels/WorkflowTheater.tsx, jarvis-theme.css.

1. Node ports: each GraphNodeCard gets two 6px port dots (absolute, left -3px and
   right -3px, vertically centered, rounded-full, border 1px var(--j-border),
   background #0a1324). Ports of leased node glow cyan.
2. Edge junctions: in GraphEdges, where two edges share a target x (the branch
   merge in Proposal to Installation), draw a 3px junction circle at the meeting
   point, stroke cyan 40%.
3. Energy packets: for `flowing` edges replace the single traveling dot pair with a
   3-dot packet: three `<circle>` with the same animateMotion path, `begin`
   offsets 0s/.15s/.3s, radii 3/2.2/1.6, opacities 1/.7/.45.
4. Leased node progress ring: around the icon circle render an SVG 40x40 arc
   (stroke var(--j-cyan), strokeDasharray "70 40", fill none) spinning via CSS
   `animation: spin 1.2s linear infinite` (add `@keyframes spin { to { transform: rotate(360deg) } }`,
   transform-origin center). Purely indeterminate = honest (no fake %).
5. Focus dim (E18): Graph container gets `data-graph`; CSS:
```css
[data-graph]:has(.j-node:hover) .j-node:not(:hover) { opacity: .35; }
[data-graph]:has(.j-node:hover) svg { opacity: .45; }
.j-node { transition: opacity .25s, transform .2s; }
.j-node:hover { transform: scale(1.03); }
```
   Add `j-node` class to GraphNodeCard root (keep inline opacity for status; the
   :has rule wins during hover).
6. Step shockwave (E5a): in GraphNodeCard, when status transitions to completed
   (track prev via ref), render one-shot `<span class="jarvis-shockwave">` at
   center:
```css
@keyframes jarvis-shockwave { from { transform: scale(.4); opacity: .55; } to { transform: scale(1.7); opacity: 0; } }
.jarvis-shockwave { position: absolute; inset: -8px; border: 1.5px solid var(--j-green); border-radius: 14px; animation: jarvis-shockwave .5s ease-out both; pointer-events: none; }
```
7. Run-complete sweep (E6a): on LiveRunRow when run.status flips completed, add
   one-shot class:
```css
@keyframes jarvis-sweep { from { background-position: -200% 0; } to { background-position: 200% 0; } }
.jarvis-sweep { background-image: linear-gradient(100deg, transparent 30%, rgba(52,211,153,.18) 50%, transparent 70%); background-size: 200% 100%; animation: jarvis-sweep .9s ease-out both; }
```
8. ReplayRow: apply the SAME packets/ring/shockwave (they key off status strings,
   so this is automatic if implemented at GraphNodeCard/GraphEdges level).
GATE 3: replay mode alone must show: packets flowing into leased node, spinner
ring on leased icon, shockwave when each node completes, focus-dim on hover, ports
on all nodes. Then run ONE real workflow end-to-end (see Runbook below) and
verify identical behavior on live data + sweep on completion.

### PHASE 4: KPI band v3 (density + reactivity)
Files: panels/KpiStrip.tsx.
1. Layout per card: row1 = LiveDot+label left, delta chip right; row2 = big number
   (text-[30px], add class j-num-glow) left, AreaSparkline right (w-24 h-10);
   row3 = sub text. Padding p-3.5. Card min-height 118px so the grid is tight.
2. Add real DERIVED deltas ONLY where computable: approvals card shows
   `+{newPendingSinceOpen} this session` (exists); runs card shows warn chip
   (exists). Do NOT add percent-vs-yesterday anywhere (no real windows yet).
3. Card accent glow seep stays; number uses CountUp (exists).
4. E15 flash wiring from Phase 2 must visibly work on all five cards.
GATE 4: cards visually match: number+sparkline on one row, tight, glowing digits;
create a pending action -> approvals card flashes + delta chip appears.

### PHASE 5: Voice set piece (mood VOICE full choreography)
Files: JarvisCommandCenter.tsx (vignette layer), HeaderBand.tsx, jarvis-theme.css,
panels/LiveCallPanel.tsx (color param only).
1. Vignette: in Shell, inside jarvis-root add
   `<div class="pointer-events-none fixed inset-0 z-20 transition-opacity duration-700" style={{ boxShadow: "inset 0 0 140px 30px rgba(2,6,16,.85)", opacity: mood === "voice" ? .5 : 0 }} />`
2. Listening pill (HeaderBand): when voiceLive, bars use REAL volume: accept
   `session` (already passed), keep the 9 bars but scaleY = .3 + volumeLevel*1.4
   via inline style transform updated from prop (no rAF; prop updates suffice).
   Pill gains class j-panel-hot while live.
3. Command pill: while mood voice, its gradient duration 3s (pass a prop or read
   `document.documentElement` var; simplest: CommandBar already receives session,
   compute live there: duration = busy ? 1.4 : live ? 3 : 7).
4. Waveform color param: WaveformStrip takes `color` prop; speaking -> "rgba(34,211,238,.9)", else teal.
GATE 5: click Start Session (mic permission in preview may fail; if Vapi cannot
connect in the harness, temporarily verify by hardcoding voiceState="live" in a
scratch render and REVERT before commit; the mood/vignette/pill reactions must
visibly engage). No layout shift when pill expands (use fixed height).

### PHASE 6: Degraded/relight wave (mood STANDALONE)
Files: JarvisCommandCenter.tsx, jarvis-theme.css.
1. Badge morph: LIVE/SIMULATION chip wraps text in a keyed span
   (`key={live ? "live" : "sim"}`) with CSS:
```css
@keyframes jarvis-flip-in { from { transform: rotateX(90deg); opacity: 0; } to { transform: rotateX(0); opacity: 1; } }
.jarvis-flip-in { animation: jarvis-flip-in .4s ease-out both; transform-origin: bottom; display: inline-flex; }
```
2. Relight cascade: Shell keeps `const [igniteKey, setIgniteKey] = useState(0)`;
   subscribe: when statsDegraded goes true->false, setIgniteKey(k=>k+1). The home
   grid's top-level sections get `key={igniteKey + "-" + idx}` and class
   jarvis-rise with `style={{ animationDelay: `${idx * 60}ms` }}`. (Remount
   re-runs the CSS entrance = the re-ignition wave. idx = section order.)
3. Panel border desaturation: `.jarvis-root[data-mood="standalone"] .j-panel { border-color: rgba(251,191,36,.12); }`
GATE 6: kill-API drill (env swap + restart dance from Gate 1): SIMULATION flip
animation plays, everything ambers/dims, ZERO console errors over 60s; restore ->
badge flips back and the panel cascade re-ignites top to bottom. Confirm with the
window.__jarvisErrs counter trick: install
`window.__jarvisErrs=[]; console.error=(...a)=>{window.__jarvisErrs.push(1)}` after
load, assert length 0 after 60s degraded.

### PHASE 7: Boot choreography v2
Files: lib/BootSequence.tsx.
1. Keep the honest fetch-driven checklist EXACTLY (each line settles on its real
   request; 2.5s hard cap; sessionStorage once-per-session; click to skip).
2. Visual upgrade: orb starts as 3 separated arc fragments (three SVG arcs with
   rotate offsets 0/120/240 and translate outward 14px) that converge (CSS
   keyframe to translate 0/rotate aligned, .9s) into the JarvisOrb; then checklist
   lines appear with the type-reveal clip-path pattern
   (`clip-path: inset(0 100% 0 0)` -> `inset(0 0 0 0)` steps(18), 350ms each,
   animation-delay i*120ms); background gridfloor fades in last (opacity 0->1 1s).
3. Release: overlay dissolves (opacity+scale 1.04, exists) AND the home sections
   run the same ignition cascade as Phase 6 (bump igniteKey on boot done).
GATE 7: sessionStorage.removeItem("jarvis_boot_shown") + reload: fragments
converge, lines type in AND still reflect real settle states (kill API first to
see amber STANDALONE lines typed), cascade follows, total feel < 3.5s.

### PHASE 8: Ambient particle field (reactive starfield)
Files: NEW panels/ParticleField.tsx, JarvisCommandCenter.tsx, WorkflowTheater.tsx
(burst hook), lib/EventFX.tsx (position channel).
1. ParticleField: one full-viewport canvas (fixed, -z, pointer-events-none),
   `next/dynamic ssr:false`. 48 particles, deterministic init from index i:
   x=(i*127%100)vw, y=(i*211%100)vh, r=.6+ (i%3)*.5, drift vy=-(4+(i*13%10))px/s,
   alpha .12+(i%5)*.04, cyan/blue alternating. Wrap at edges. Subscribes onFrame
   (raf-bus). Skips drawing when document hidden. Under prefers-reduced-motion:
   render nothing.
2. Event bursts: EventFX exports `burstAt(x, y)` pushing 6 short-lived sparks
   (life 600ms, angles k*60deg, speed 40px/s, deterministic) into ParticleField
   via a module-level queue array both files import. WorkflowTheater: on the
   shockwave trigger, call `burstAt(rect.centerX, rect.centerY)` using
   getBoundingClientRect of the completing node.
3. Ambient rule check: sparks carry no numerals = legal.
GATE 8: stars drift; complete a replay step -> sparks fly from that exact node;
`ps` the frame cost: with DevTools performance for 5s, main thread idle > 80%,
no long tasks > 50ms attributable to canvas.

### PHASE 9: Micro-interaction + consistency sweep
Files: all panels, small diffs only.
1. Unify EVERY panel header to: `<div class="flex items-center justify-between border-b border-white/6 px-4 py-2.5">` with j-label left and an optional chip right
   (SystemConsole/LiveCallPanel already do this; apply to KPI-less panels:
   PipelinePulse, ApprovalDock, CommsFeed, ActivityRail, AnalyticsRow trio).
   Content area becomes px-4 py-3.
2. Buttons: all primary pills get whileTap scale .96 (framer ok, interactive).
3. Drawer physics: RunDrawer transition -> spring {stiffness 300, damping 30}.
4. Palette: item hover bg accent 12%, Enter selects (exists), add subtle
   footer hint row "enter select · esc close".
5. Focus visibility: add `focus-visible:ring-2 ring-cyan-300/60` to all
   interactive elements missing it (buttons, inputs, nodes).
6. Sidebar active item: animated layoutId glow bar exists; add icon color
   transition .2s.
7. Kill remaining inconsistencies: any leftover `text-[11px] font-bold uppercase tracking-[0.18em]` inline header strings replaced by `.j-label`.
GATE 9: click through all 9 sidebar views: consistent headers, no unstyled
stragglers, tab-key traversal shows focus rings, everything responds to hover
within 200ms.

### PHASE 10: Full QA + deploy + honest report
1. `rm -rf .next && npx tsc --noEmit -p tsconfig.json` clean (dev server STOPPED),
   `npx next build` route table: /jarvis first-load < 190kB.
2. Kill-API drill (Gate 6 procedure) recorded with screenshots of both states.
3. 375px pass (resize preset mobile): no horizontal scroll on body, KPI 2-col,
   theater scrolls internally, command pill usable.
4. Reduced-motion: with the media emulated or OS toggle, page is static but
   complete (no invisible content, no stuck opacity-0 elements: grep-audit every
   `initial={{ opacity: 0` that remains and confirm each is inside
   AnimatePresence initial={false} or replaced by CSS).
5. Run the LIVE workflow proof (Runbook) once on production after deploy; capture
   the flowing state.
6. `vercel --prod --yes`, verify finnorai.com/jarvis: LIVE badge, telemetry
   streaming, replay theater animating, then write the panel-by-panel LIVE vs
   SIMULATION table with screenshots. Do not claim done without it.

---

## 4. Runbook: producing a REAL live workflow on demand
1. Local worker must be running (steps do not advance otherwise):
   `cd finnor-os && set -a && source <prod-env-file> && set +a && npm run dev --workspace @finnor/worker`
   (env file with DATABASE_URL etc.; in this session it lives at the scratchpad
   path api.env. If missing, `vercel env pull` from finnor-os with the api
   project.)
2. Get a sent invoice id:
   `curl -s https://finnorai.com/api/jarvis/resources/invoices | jq '.rows[] | select(.status=="sent") | .id'`
3. Plan: POST /api/jarvis/actions with header `x-jarvis-key: <JARVIS_ADMIN_KEY>`
   body `{"instruction":"Start the invoice-to-cash workflow for invoice <id>"}`.
4. Approve: take planned[0].id -> POST /api/jarvis/actions/<id>/confirm (same
   header). Watch the theater: 3 steps advance ~5s apart.
5. NEVER fabricate a run row client-side. If the worker is down, the honest
   states are: run stuck at pending (true) or replay mode (labeled).

## 5. Pitfall codex (every one of these already bit us; do not repeat)
- Framer initial/animate on late-mounted components silently sticks at initial
  (opacity 0). Use CSS .jarvis-rise pattern. Audit with the DOM-opacity check.
- `animation-fill-mode: both` overrides inline opacity; parameterize keyframe
  end with var(--rise-to).
- Progress-bar width via framer animate without initial -> starts at auto/100%.
  Use CSS width transition + inline style.
- AnimatePresence mode="wait" around custom components: enter never fires. Use
  keyed remount for enters; AnimatePresence initial={false} for exits only.
- Next dev + `next build` concurrently corrupts .next (symptom: eternal "Waking
  JARVIS..." with zero errors). Stop dev, rm -rf .next, restart.
- Console message reader accumulates STALE errors across reloads; verify with a
  fresh window.__jarvisErrs counter, not the raw log.
- macOS overlay scrollbars look like white bars in screenshots; .j-scroll hides
  them on internal scrollers.
- API 401 "Missing bearer token" = you bypassed the proxy; the page must ONLY
  call /api/jarvis/*.
- data-core is the ONLY poller. Never add fetch calls inside panels.
- Ages: use ageLabel (42s/12m/5h/3d), never raw minute counts.

## 6. Definition of done
Every matrix row E1-E20 demonstrably fires from its REAL trigger on production;
all 10 gates passed with screenshots; zero console errors in a 60s degraded soak;
zero new deps (`git diff package.json` empty); honesty audit: grep the diff for
`Math.random|Date.now()` in render paths (only data-core/raf-bus/sound allowed
outside render), and confirm no numeral appears in any ambient layer.
