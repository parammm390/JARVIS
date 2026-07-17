# JARVIS Cinematic Frontend — the definitive spec for finnorai.com/jarvis

This document is self-contained: an execution session needs THIS file plus the
existing code it names — nothing else. It supersedes §5 of
`jarvis-live-command-center-plan.md` (whose §2 ship-state repair is done/underway and
whose endpoint truths are repeated here so you never have to cross-reference).

**The bar:** a person opening finnorai.com/jarvis should feel like they walked into
Tony Stark's workshop pointed at a real water-treatment business — everything
breathing, flowing, counting, speaking — and every single number on screen is real or
visibly labeled ambient. Spectacle AND honesty, never one at the expense of the other.

---

## 0. Non-negotiables (read twice, they are why the last attempt looked like 2%)

1. **This is the MARKETING repo** (`/Users/paramdave/FINNOR`, `src/…`). Tailwind and
   framer-motion are already installed and used site-wide. USE THEM HARD. The console
   phase's "zero new dependencies, plain CSS" rule does NOT apply here — that rule is
   why the console looks flat. No OTHER new deps though: no three.js, no chart libs,
   no cmdk — everything below is achievable with tailwind + framer-motion + SVG +
   canvas, and each extra dependency is another way for the build to break.
2. **Zero backend changes.** Consume only the endpoints in §4. All exist in the
   deployed/deploying API.
3. **Never touch the production Vapi assistant config.** Browser-mic via the page's
   existing `@vapi-ai/web` wiring only.
4. **The Honesty Engine (§2) is law.** No invented metrics, no fake deltas, no
   live-looking animation bound to non-live data.
5. **Preserve what works:** approve/reject optimistic flow, the 7 sidebar views in
   `views.tsx`, the Vapi voice session, LIVE/SIMULATION badging, the SSR-shell +
   `mounted`-flag hydration pattern. Refactor around them, never through them.
6. **Copy style:** no em-dashes in any user-facing string. Never "AI receptionist".
7. **Never run `next build` while `next dev` is serving** (corrupts `.next`; symptom
   is an eternal "Waking JARVIS…" with zero console errors; fix: stop dev,
   `rm -rf .next`, restart).
8. **Hydration safety:** no `Math.random()`/`Date.now()` in render paths. Ambient
   layers use deterministic seeds (index-derived), exactly like `atmosphere.tsx`
   already does. Client-only content mounts behind the existing `mounted` flag.

---

## 1. What exists and is REUSED (do not rebuild)

`src/components/jarvis/`:
- `atmosphere.tsx` — aurora blobs, film grain, bubble field, caustic band, `Glass`
  gradient-border card. KEEP; §3 extends `Glass` with a `glow` prop.
- `sound.ts` — WebAudio cues (approve/reject/tick/voiceOn/voiceOff/send), gain 0.12,
  mute toggle. KEEP; §10 adds 4 cues to the same synth (no audio files).
- `CustomCursor.tsx` — KEEP untouched.
- `views.tsx` (500 lines) — 7 working sidebar views. KEEP; gains an 8th (Activity).
- `JarvisCommandCenter.tsx` (808 lines) — shell, sidebar, ticker, command bar,
  approve/reject, Vapi session, LIVE/SIM badge. This file gets REFACTORED: shell +
  routing stays, its home-view body is replaced by the §6 layout, its inline data
  fetching moves into the §5 data core. Extract, don't rewrite: the Vapi handlers and
  decide() calls move verbatim into their new homes.

---

## 2. The Honesty Engine — three data classes, enforced in code

Every visual element belongs to exactly one class, and the class决定 what it may do:

- **LIVE** — value read from a §4 endpoint. May animate on CHANGE (count-up, pulse,
  flow). Carries the shared `<LiveDot/>` (teal pulse) somewhere in its panel header.
- **DERIVED** — computed client-side from LIVE data only: rates, per-hour buckets,
  ages, session deltas ("+3 since you opened this page" — computed from poll history
  in memory, genuinely true). Rendered like LIVE. A "vs yesterday" delta is allowed
  ONLY when both windows come from real `/api/events` timestamps; otherwise show the
  number with no delta. NEVER a hardcoded percentage.
- **AMBIENT** — pure decoration: waveform strips, particle fields, orb breathing,
  grid shimmer. May NEVER contain a numeral, a unit, or a data-shaped label. If a
  panel's endpoint is unreachable it degrades to its ambient/empty state and its
  badge flips to `SIMULATION` (existing page convention).

Implementation hook: `<Metric source="live"|"derived" …/>` component renders every
number on the page; it is the single place count-up + formatting live. Grep-able
definition of done: no raw `{number}` interpolations inside panel JSX.

---

## 3. Design system — exact recipes (tailwind-first)

**Palette (CSS vars in `src/components/jarvis/jarvis-theme.css`, imported by the
page):** stays inside the site's slate-950/teal identity, tinted toward the reference
image's electric cyan:

```css
.jarvis-root {
  --j-bg: #020617;            /* slate-950 — page base */
  --j-panel: rgba(8, 17, 36, 0.72);
  --j-border: rgba(56, 189, 248, 0.14);      /* cyan-400 @ 14% */
  --j-border-hot: rgba(34, 211, 238, 0.45);
  --j-text: #e2f3ff; --j-text-dim: #7c94b5; --j-text-faint: #46607f;
  --j-cyan: #22d3ee; --j-teal: #2dd4bf; --j-blue: #3b82f6;
  --j-violet: #8b5cf6; --j-amber: #fbbf24; --j-red: #f87171; --j-green: #34d399;
  --j-glow-cyan: 0 0 24px rgba(34,211,238,.35), 0 0 64px rgba(34,211,238,.12);
  --j-glow-teal: 0 0 20px rgba(45,212,191,.30), 0 0 56px rgba(45,212,191,.10);
  --j-glow-green: 0 0 20px rgba(52,211,153,.35);
  --j-glow-red: 0 0 20px rgba(248,113,113,.30);
}
```

**Glass recipe** (extend the existing `Glass`): `background: var(--j-panel);
backdrop-blur-xl; border 1px solid var(--j-border); rounded-[1.5rem]` (panels) /
`rounded-[2rem]` (hero cards, matching the site); inner top highlight via
`before:` gradient (white 4% → transparent). New prop `glow?: "cyan"|"teal"|"green"|
"red"|"none"` → applies the matching `--j-glow-*` box-shadow. Hover: border →
`--j-border-hot` + translateY(-2px), 150ms.

**Type scale:** page uses the site font. Display numbers `font-black tabular-nums`
text-4xl; panel titles `text-[11px] font-bold uppercase tracking-[0.18em]
text-[color:var(--j-text-dim)]` (the site's label style, verbatim); body text-sm.

**Neon line style (workflow edges, sparklines):** stroke `--j-cyan`, strokeWidth
1.5–2, with a duplicated blurred stroke underneath (same path, strokeWidth 6,
opacity .25, `filter: blur(4px)`) — two paths, no SVG filters (filters are the #1
SVG perf killer at this density).

**Motion constants** (one exported object, used everywhere so the page feels like one
organism): `EASE = [0.22, 1, 0.36, 1]`; durations: micro 0.15s, panel 0.5s, stagger
0.06s; spring for pops `{type:"spring", stiffness:260, damping:22}`. Every animation
respects `useReducedMotion()` from framer-motion: reduced → opacity-only fades,
ambient layers static, flows off.

---

## 4. Endpoint truths (verified against the code — copy exactly, headers included)

`const API = process.env.NEXT_PUBLIC_OS_API_URL` (localhost:3100 in dev). Headers on
every call: `{"content-type":"application/json","x-tenant-id":TENANT,
"x-user-role":"owner"}` (existing constant, line 47).

| # | Endpoint | Shape (fields you may bind to) |
|---|---|---|
| 1 | `GET /api/stats` | `{pending, blocked, recentActions:[{id,actionType,status,summary,createdAt}]}` |
| 2 | `GET /api/actions/pending?filter=pending\|blocked` | `{actions:[{id,actionType,summary,payload,status,createdAt, groundedPayload?:[{field,status:"verified"\|"not_found"\|"unverifiable"}]}]}` |
| 3 | `POST /api/actions/:id/confirm` / `/reject` | `{result?:{status,error?}}` |
| 4 | `GET /api/workflows/runs?status=running` (also without filter → +latest 20 terminal) | `{runs:[{id,workflowType,status:"running"\|"completed"\|"failed"\|"compensating"\|"compensated",createdAt,updatedAt,steps:[{id,stepType,sequence,status:"pending"\|"leased"\|"completed"\|"failed"\|"compensating"\|"compensated",attempts,terminalReason,updatedAt}]}]}` |
| 5 | `GET /api/events` (`?before=` cursor) | `{events:[{id,entityType,entityId,eventType,payload,occurredAt,source}]}` — newest 50 |
| 6 | `GET /api/read-models/pipeline-health` | `{leadsByStatus:[{status,count}],quotesByStatus:[…],proposalsByStatus:[…]}` |
| 7 | `GET /api/read-models/cash-collections` | `{invoicesByStatus:[{status,count,totalUsd}],totalCollected,paymentLinksAwaitingPayment}` |
| 8 | `GET /api/read-models/sla-breaches` | `{stuckWorkflowRuns,openReconciliationCases}` |
| 9 | `GET /api/read-models/stock-risk` | `{belowThreshold:[{sku,name,quantity,reorderThreshold}],openProcurementOrders}` |
| 10 | `GET /api/read-models/follow-up-debt` | `[{entityType,entityId,householdId,status,lastActivityAt}]` |
| 11 | `GET /api/read-models/technician-load` | `[{technicianId,name,upcomingAppointments,openWorkOrders}]` |
| 12 | `GET /api/read-models/service-due` | `[{agreementId,householdId,cadence,status,renewalDate}]` |
| 13 | `GET /api/read-models/data-quality` | `{byTypeAndSeverity:[…],totalUnresolved}` |
| 14 | `GET /api/comms` | `{outbox:[{id,channel,toNumber,content,simulated,createdAt}]}` |
| 15 | `GET /api/insights` | learning digest: `{actionTypeStats,criticFindings,topConcerns:[string]}` |
| 16 | `GET /api/health`, `GET /api/setup/status` | liveness; per-action-type config readiness |
| 17 | `GET /api/resources/households\|inventory\|invoices\|technicians\|visits` | row lists (views.tsx already binds these) |

Every fetch goes through ONE hook (§5). Any non-200 → that slice enters `degraded`
and its panels show SIMULATION states. The page must be beautiful with the API dead.

---

## 5. The data core — `useJarvisData` + the Variables Table

New file `src/components/jarvis/lib/data-core.ts`. One React context provider
(`<JarvisDataProvider>`) owns ALL polling; panels only `useJarvis()` — no panel ever
fetches for itself (this is what killed cohesion before: 6 uncoordinated pollers).

**Poll cadences** (staggered starts so requests don't thundering-herd):
fast lane 4s → #1, #2, #4; medium 8s → #5, #14; slow 30s → all read-models, #15;
sanity 60s → #16. Pause ALL polling when `document.visibilityState === "hidden"`;
resume + immediate refresh on visible.

**Poll-history ring buffer:** keep the last 30 snapshots of the fast lane (~2 min).
This is what powers honest motion: session deltas, change detection, arrival events.

**Change events:** after each poll, diff against previous snapshot and emit typed
events on an in-module emitter: `event:new-business-event`, `event:step-completed`,
`event:run-completed`, `event:new-pending-action`, `event:action-decided`. Panels
subscribe for pulses/sounds/toasts. THIS is the nervous system that makes the page
feel alive — every flash traces to a real state change.

**THE VARIABLES TABLE.** All DERIVED client-side from the endpoints above — this is
the "lots of live variables" demand, satisfied honestly. `useJarvis()` exposes every
one, typed:

| Variable | Derivation |
|---|---|
| `pendingCount`, `blockedCount` | #1 |
| `pendingOldestAgeMin` | min createdAt in #2 → ticking age (recompute each render tick) |
| `approvalsThisSession`, `rejectionsThisSession` | count of decide() calls this session |
| `newPendingSinceOpen` | ring buffer diff |
| `runsInFlight` | #4 running count |
| `runCurrentStep(run)` | first step with status leased/pending |
| `runProgressPct(run)` | completed steps / total steps |
| `runAgeMin(run)`, `stepAgeSec(step)` | ticking ages from createdAt/updatedAt |
| `stepsCompletedToday` | #4 all-runs steps with completed status + updatedAt today |
| `runsCompletedToday`, `runsFailedToday` | same, run-level |
| `avgStepAttempts` | mean attempts across today's steps |
| `eventsPerHour[24]` | #5 bucketed by occurredAt hour → sparklines |
| `eventsToday`, `eventsLastHour` | bucket sums |
| `busiestHourToday` | argmax of buckets |
| `latestEventAgeSec` | ticking |
| `eventMixToday` | counts by eventType family (quote_*, appointment_*, payment…) |
| `leadsOpen`, `leadsByStatus` | #6 |
| `quotesAwaitingSignature` | #6 quotes status="sent" |
| `quoteAcceptRateToday` | #5 quote_accepted vs quote_declined events today (only if ≥1 of each window is nonzero, else hide delta) |
| `collectedUsd`, `overdueUsd`, `overdueCount` | #7 (`invoicesByStatus` status="overdue") |
| `paymentLinksOpen` | #7 |
| `stuckRuns`, `openReconciliations` | #8 |
| `skusBelowThreshold`, `worstStockItem` | #9 |
| `followUpDebtCount`, `oldestNeglectedDays` | #10 |
| `techLoad[]`, `busiestTech` | #11 |
| `renewalsDue30d` | #12 |
| `dataQualityOpen` | #13 |
| `messagesProduced`, `lastMessageAgeMin`, `messagesByChannel` | #14 |
| `topConcerns[]` | #15 (real sentences, rotate in ticker) |
| `systemStatus` | #16: ok+configured → "Optimal"; ok+unconfigured actions → "Partial config"; unreachable → "Standalone" (never claim Optimal when degraded) |
| `configuredActionsPct` | #16 setup/status ready ratio |
| `apiLatencyMs` | measured per fast-lane poll (real!) — the geekiest honest stat on the page |
| `uptimeSincePageOpenSec` | ticking session counter labeled "session", never "uptime" |
| `voiceState` | idle/connecting/live/speaking from Vapi events |
| `callDurationSec`, `callTranscriptLines` | live session |
| `volumeLevel` | Vapi `volume-level` event (0..1) |

That's 40+ genuinely live/derived variables. Panels below name which they bind.

---

## 6. Layout blueprint (desktop ≥1280px; the reference image's grid, our content)

```
┌──────────┬────────────────────────────────────────────────────────────────────┐
│          │ HEADER BAND: title+LIVE • SystemStatus chip • clock • ambient wave │
│ SIDEBAR  ├────────────────────────────────────────────────────────────────────┤
│ (exists, │ GREETING: "Good evening, Param." + real-counts sentence            │
│ restyled)│ KPI STRIP: 5 Metric cards, count-up + sparkline + session delta    │
│          ├──────────────────────────────────────────────┬─────────────────────┤
│ orb +    │ WORKFLOW THEATER (col-span 2)                │ LIVE CALL PANEL     │
│ uptime   │ live node-graph / blueprints                 │ orb, waveform,      │
│ card,    │                                              │ transcript, ctrls   │
│ profile  ├───────────────┬───────────────┬──────────────┴──┬──────────────────┤
│ (exist)  │ PIPELINE      │ APPROVAL DOCK │ COMMS FEED      │ SYSTEM ACTIVITY  │
│          │ PULSE bars    │ gated cards   │ outbox+voice    │ event rail       │
│          ├───────────────┴───────────────┴─────────────────┴──────────────────┤
│          │ COMMAND BAR: orb • input w/ animated border • send • Speak Now     │
└──────────┴────────────────────────────────────────────────────────────────────┘
```

Tailwind: `grid grid-cols-12 gap-4`; theater `col-span-8`, call `col-span-4`; bottom
row four `col-span-3`. <1024px: theater and call stack full-width, bottom row 2×2.
<640px: single column, sidebar becomes the existing mobile pattern, command bar
sticks bottom. The 7 existing sidebar views render in the content area exactly as
today (they replace the home grid when selected).

---

## 7. Component specs

Create `src/components/jarvis/panels/` + `src/components/jarvis/lib/`. Each spec:
DATA (variables bound) / VISUAL / MOTION / DEGRADED.

### 7.1 `lib/CountUp.tsx` + `lib/Metric.tsx`
CountUp: framer-motion `useSpring(useMotionValue(v))`, render via
`useTransform(spring, n => format(n))`; springs to new values on change (never
re-animates from 0 on poll). Metric: label (tracking style), CountUp value, optional
unit, optional delta chip (only when derivation exists), optional 24-bucket sparkline
(pure SVG polyline + soft under-glow path, 96×28).

### 7.2 `panels/JarvisOrb.tsx` — the identity element
DATA: `voiceState`, `volumeLevel`, `systemStatus`.
VISUAL: layered CSS orb (no canvas needed): core radial-gradient disc (cyan→blue),
2 conic-gradient rings rotating at 18s/31s (opposite directions), outer glow shadow.
Sizes: sidebar 64px, command bar 44px, call panel 120px (one component, `size` prop).
MOTION: idle = scale breathing 1↔1.04 @ 4s ease-in-out; voice live = ring speed ×3 +
scale pulses keyed to `volumeLevel` (spring, stiffness 300); speaking = teal hue
shift; degraded systemStatus = slower, dimmer, amber tint. Reduced-motion: static
with glow only.

### 7.3 `panels/HeaderBand.tsx`
DATA: `systemStatus`, `configuredActionsPct`, `apiLatencyMs`, clock.
VISUAL: left: "REAL-TIME OPERATIONS COMMAND CENTER" label style + LiveDot. Right:
System Status chip (`Optimal` teal / `Partial config` amber / `Standalone` dim —
popover lists unconfigured action types from setup/status, real ones), live clock
(1s tick, tabular-nums), latency readout `▁ 84ms` (real measured), ambient waveform
strip (AMBIENT: 60 bars, heights from `sin(i*seed)` deterministic, subtle 3s loop).
GREETING below: time-of-day + name; sentence built ONLY from nonzero real counts:
"You have {pendingCount} approvals waiting and {eventsToday} business events today."
Zero-data state: "Systems idle. Speak to Finnor to make something happen." (honest).

### 7.4 `panels/KpiStrip.tsx` — five cards
1. Awaiting approval — `pendingCount`, sparkline `eventsPerHour`, chip
   `+{newPendingSinceOpen} this session` when >0; glow cyan when >0.
2. Collected — `collectedUsd` ($, CountUp), sub `{paymentLinksOpen} links open`.
3. Overdue — `overdueUsd` ($) + `{overdueCount} invoices`, glow red when >0.
4. Open leads — `leadsOpen`, sub `{quotesAwaitingSignature} quotes awaiting signature`.
5. Ops health — `runsInFlight` in-flight, sub `{stuckRuns} stuck · {openReconciliations}
   reconciling`, glow amber when either >0.
MOTION: cards stagger-in 60ms; on variable change → 400ms border-hot flash. Card
click → deep-links (queue view, invoices view, etc.).

### 7.5 `panels/WorkflowTheater.tsx` — THE CENTERPIECE (budget the most effort here)
DATA: #4 full response; `runCurrentStep`, `runProgressPct`, ticking ages; change
events `step-completed`, `run-completed`.
VISUAL: panel header "LIVE WORKFLOW" + LiveDot + `{runsInFlight} in flight`. Body:
one row per running run (max 3 visible, rest behind "+N more"):
- Run title: workflowType humanized ("Invoice to cash"), age chip, progress bar
  (thin, cyan fill = runProgressPct, animated width).
- **Node chain**: each step a 150×88 mini-Glass node — icon by stepType (map:
  generate_document→file, request_signature→pen, reserve_stock→box,
  create_payment_link→link, send_message/send_confirmation_call→paper-plane,
  hold/confirm_appointment→calendar, sync_invoice→refresh, create_work_order→wrench,
  record_deposit_payment→dollar; inline SVG paths, one shared `<StepIcon/>`),
  stepType humanized, sublabel = status + (attempts>1 ? `retry ${attempts}` : ticking
  age). Node state styles: pending = dim glass; **leased = the hero state**: border-hot,
  cyan glow, icon pulse, tiny orbiting dot (CSS `offset-path: border-box` or rotate
  wrapper); completed = teal border + check badge; failed = red glow + terminalReason
  in a tooltip; compensating = amber pulse.
- **Edges**: absolutely-positioned SVG layer behind nodes; horizontal cubic beziers
  node→node. Completed edge: solid teal. Edge INTO the leased step: the flow
  animation — `strokeDasharray="6 10"` + CSS `@keyframes dashflow {to
  {stroke-dashoffset:-64}}` 1.2s linear infinite + the blurred under-stroke.
  Future edges: faint dotted, static.
- Layout math (keep it dumb): fixed node width+gap; `x(i) = i*(150+28)`;
  horizontal scroll-snap when steps overflow; edge endpoints from the same formula —
  no measurement, no layout effects, zero thrash.
MOTION: on `step-completed` → node scale-pop (spring), check draws in (SVG pathLength
0→1, 0.4s), edge fills teal, `tick` sound. On `run-completed` → whole row border
sweeps teal (gradient sweep via background-position animation), `approve` sound, then
row gracefully collapses out after 6s (AnimatePresence).
DEGRADED/EMPTY: no running runs (the common demo state) → **Blueprint mode**: the four
vertical workflows (Lead to water test / Water test to signed proposal / Proposal to
installation / Invoice to cash) rendered as the same node chains from a hardcoded
step-map, all nodes dim, ambient slow shimmer traveling the edges (one direction,
8s), a `BLUEPRINT` badge where LIVE would be, and a one-line CTA: "Say 'book a water
test for the Petersons' to watch one run live." Blueprint nodes NEVER show ages,
attempts, or counts (Honesty Engine: ambient may not look like data). Click a live
run → drawer (framer-motion slide) listing every step's real evidence: timestamps,
attempts, terminalReason.

### 7.6 `panels/LiveCallPanel.tsx`
DATA: `voiceState`, `callDurationSec`, `callTranscriptLines`, `volumeLevel`.
VISUAL idle: 120px JarvisOrb, "Speak to Finnor", mic button (starts the existing Vapi
session — move the existing handler here verbatim). VISUAL live: header `ON CALL`
(red LiveDot), duration timer (tabular, 1s tick), **the waveform ring**: 48 radial
bars around the orb, canvas-drawn at 30fps, bar length = smoothed volumeLevel ×
deterministic per-bar factor; teal while caller speaks, cyan while
`speech-start`→`speech-end` (SDK events) with an "AI is speaking…" caption; rolling
transcript (last 6 lines, existing capture logic moved here; YOU dim / FINNOR cyan);
controls: Mute (SDK `setMuted(true/false)`, state-reflecting), End (red). Footer
note when idle, small print: "Browser session. Customer phone calls run
server-side." (honest scope, kills the fake-incoming-call temptation).
DEGRADED: Vapi env keys missing → the existing config hint, orb still breathing.

### 7.7 `panels/ApprovalDock.tsx`
DATA: #2 pending list; existing decide() moved here verbatim (optimistic slide-out,
inflight ref, rollback on error — behavior byte-identical).
VISUAL: title "AWAITING YOUR APPROVAL" + count badge. Cards: summary sentence
(text-sm, the human-readable heart of the product), actionType chip, ticking age,
groundedPayload badges (`✓ householdId` teal / `✗ invoiceId` red / `? field` dim),
Approve (teal, glow-teal) / Reject (ghost red). MOTION: enter from 8px below;
approve → card sweeps right with teal trail + `approve` sound; reject → sweeps left,
`reject` sound. Empty: "Nothing needs you. Finnor is holding the line." + slow orb
shimmer.

### 7.8 `panels/CommsFeed.tsx`
DATA: #14 outbox newest 8, `messagesProduced`, `lastMessageAgeMin`; live transcript
lines interleave while a voice session is active (labeled `voice · live`).
VISUAL: chat-style rows: channel icon (sms/call/email), toNumber masked
(`…555-0134`), first 90 chars, age; `simulated delivery` amber chip where
`simulated=true` (existing honesty convention, keep it). New arrivals (poll diff)
slide in + `send` cue.

### 7.9 `panels/ActivityRail.tsx`
DATA: #5 newest 20; `latestEventAgeSec`.
VISUAL: the reference image's right rail, ours: colored dot by family (quote_*
violet, appointment_* blue, payment/invoice green, contact/lead cyan, work_order
amber, everything else dim), humanized eventType, relative time, entityType chip.
"View all activity →" switches to the new 8th sidebar view (same component,
`limit=50`, plus entity filter buttons). MOTION: new events (diff) push in from top
with a brightness flash; the rail NEVER reorders under the cursor (pause insertions
on hover, queue them, flush on mouseleave).

### 7.10 `panels/PipelinePulse.tsx`
DATA: #6, `quoteAcceptRateToday` (shown only when computable), #9 worstStockItem,
#12 renewalsDue30d.
VISUAL: three segmented horizontal bars (leads/quotes/proposals) — segments = status
counts, animated width on change, legend chips with counts; footer micro-stats row:
stock warning (name + qty/threshold, red when 0 available), renewals due chip.

### 7.11 `panels/OpsTicker.tsx` (upgrade existing ticker in place)
DATA: rotate through REAL sentences only: `topConcerns[]` (#15), newest event
humanized, `apiLatencyMs`, oldest pending age. When API degraded: the existing
ambient OPS_STREAM lines stay BUT prefix each with `sim ·` (they currently
masquerade as real — fix that while touching it).

### 7.12 `panels/CommandBar.tsx` + `lib/CommandPalette.tsx`
CommandBar: existing input + animated gradient border kept; add 44px orb at left
(state-linked), thin AMBIENT waveform inside the input while `voiceState==="live"`,
send button pulse when input nonempty. Submitting routes through the EXISTING
instruct pipeline unchanged; while awaiting response, the border animation
accelerates (a real "thinking" indicator bound to the in-flight promise).
Palette (`⌘K` / `ctrl+K`): hand-rolled, `role="dialog"`, focus-trapped, fuzzy filter
over: 8 view navigations, "Approve queue", theme-independent actions, and 6 canned
instructions that PREFILL the command bar (never auto-submit): "Book a water test
for …", "Create an invoice for …", "What is our overdue total?", "Show me stuck
workflows", "Send the proposal to …", "Give me the business overview". Enter =
select; Escape = close; palette opening = `tick` cue.

### 7.13 Boot sequence — `lib/BootSequence.tsx` (the movie moment, honest)
On first mount (per session, `sessionStorage` flag): full-viewport overlay, orb
center, and a staged checklist that is DRIVEN BY THE REAL FIRST FETCHES — each line
resolves when its actual request settles: "Linking Finnor OS core…" (#16 health) /
"Hydrating operational read models…" (first read-model settle) / "Streaming business
events…" (#5) / "Arming approval gate…" (#2) / "Voice systems standing by." (Vapi SDK
constructor resolves). Line states: pending dim → settling cyan spinner → `✓ ONLINE`
teal (or `— STANDALONE` amber on failure, no fake ✓). Max 2.5s hard cap: whatever
hasn't settled shows its real pending state and the overlay releases anyway
(dissolve + scale, panels stagger in behind it). Skippable on click. Runs once per
session, not per navigation.

---

## 8. Sound map (extend `sound.ts`, same synth, four new cues, all ≤80ms, gain ≤0.1)
`stepTick` (step completed, soft high blip) · `runDone` (short rising two-note) ·
`eventPing` (new activity, barely-there) · `bootHum` (boot overlay, low swell, once).
Rate-limit: max 1 `eventPing` per 3s regardless of burst. All behind the existing
mute toggle; default state follows the existing page default.

## 9. Performance + correctness guardrails (each one is a past or certain failure)
1. Animate ONLY transform/opacity/stroke-dashoffset; never width/height/box-shadow in
   loops (KPI border flash: pseudo-element opacity, not shadow animation).
2. One `requestAnimationFrame` loop total (call-panel canvas); everything else CSS/
   framer. No rAF in React state (no setState per frame).
3. Ticking ages: ONE 1s interval in the data core updating a single `now` value;
   components derive ages from it (not 30 separate intervals).
4. `AnimatePresence` needs stable keys = row ids from the API, never array index.
5. All polling pauses on hidden tab (§5); ambient CSS animations pause via
   `animation-play-state` tied to a `[data-hidden]` attr the core sets.
6. Poll diffing by id sets, not JSON.stringify (events list is 50 rows × 8s).
7. `next/dynamic` with `ssr:false` for the canvas call panel; everything else SSRs
   the static shell per the existing mounted-flag pattern (page must not regress its
   hydration fix).
8. Lighthouse sanity after build: the page stays under ~300KB first-load JS delta
   (no new deps makes this automatic; verify anyway).

## 10. Build order — checkpoints a low-effort session MUST follow in sequence
Each checkpoint: typecheck clean + page loads in browser before proceeding. Never
more than one unverified layer.
1. `jarvis-theme.css` + Glass glow prop + Metric/CountUp/LiveDot + data-core with
   fast lane only (#1,#2,#4) → render raw variable values in a temporary debug list
   on the page. VERIFY numbers match curl.
2. Full data core (all lanes, ring buffer, change events, visibility pause) + ticker
   upgrade. VERIFY change events fire (approve something, watch the console log).
3. Layout grid + HeaderBand + KpiStrip. VERIFY count-ups + sparklines on real data.
4. WorkflowTheater blueprints mode → then live mode: start
   `start_water_test_workflow` via the command bar, approve it, WATCH the graph
   advance as the worker processes steps. This checkpoint is mandatory-live, not
   imagined. VERIFY flow animation sits on the leased edge only.
5. ApprovalDock (move decide() verbatim) + CommsFeed + ActivityRail + PipelinePulse.
   VERIFY approve/reject byte-identical behavior incl. error rollback (kill API mid-
   decide).
6. LiveCallPanel + orb states (needs Vapi keys; degrade gracefully without).
7. CommandBar/Palette + BootSequence + sounds.
8. Kill-API pass: stop local API → every panel in labeled SIMULATION state, zero
   console errors, badge flips. Restart API → panels relight without reload.
9. 375px pass. Reduced-motion pass (OS toggle). Lighthouse sanity.
10. Deploy finnor-agency (root tsconfig still excludes `finnor-os`, `.vercelignore`
    still excludes it — check both), verify live at finnorai.com/jarvis, screenshot
    every panel state, report which panels are LIVE vs SIMULATION in prod.

## EXECUTION PROMPT (paste into a fresh session)

```
/goal Implement finnor-os/docs/jarvis-frontend-cinematic-spec.md — the JARVIS
cinematic frontend for finnorai.com/jarvis, in the MARKETING repo
(/Users/paramdave/FINNOR, src/components/jarvis/). Read the ENTIRE spec first, then
the five existing jarvis files it lists in §1. The §0 non-negotiables are law: zero
finnor-os backend changes, only §4's endpoints, the §2 Honesty Engine on every number
(LIVE/DERIVED/AMBIENT — no invented metrics, no data-shaped ambient), preserve the
five working behaviors named in §0.5, tailwind+framer-motion hard but zero NEW
dependencies, no em-dashes in copy, never next build while dev serves, no
Math.random/Date.now in render. Build strictly in §10's checkpoint order and verify
each checkpoint in the browser before the next — checkpoint 4 (WorkflowTheater) must
be proven against a genuinely running workflow you start and approve yourself, and
checkpoint 8's kill-the-API degradation pass is mandatory. The Variables Table in §5
is the contract for the data core: expose every variable listed, derived exactly as
specified. When done: deploy the marketing site per §10.10 and report, panel by
panel, what is LIVE versus SIMULATION in production, with screenshots. Do not
declare done without the deploy and the honest panel report.
```
