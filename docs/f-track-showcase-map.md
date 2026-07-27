# F-Track Showcase Map — for main D8 (Showtime)

**Written by:** F12 (The Unforgettable Pass), JARVIS-FRONTEND-MAESTRO-PLAN.md §5.
**Purpose:** tells D8's Showtime which F-track signature moments to script, with the
honesty label each one needs. D8 itself is already COMPLETE (main STATE) — this map
feeds its next iteration or a follow-up Showtime enhancement, per plan §7 ("D8 consumes
F12.T4's showcase map; F-track builds no demo mode" — nothing here is a new demo
surface, only a pointer to real, already-shipped components).

Every moment below reuses a REAL production component — never a Stage-only lookalike.
Recordings referenced were captured this session via throwaway Playwright harnesses
(`e2e/f12-signature-moments.spec.ts`, deleted before commit) that mount the exact same
exported components each owning F-phase already shipped.

## 1. Bridge boot

- **Component:** `bridge/Bridge.tsx`'s `BridgeShell` — rails slide in, orb ignites with
  one bloom, panels cascade (FLOW-44 BridgeBoot).
- **Trigger:** first `/jarvis/bridge` visit of a browser session (sessionStorage-gated,
  `jarvis_bridge_boot_shown`). Session log: F2.
- **Honesty label:** REAL — fires on genuine cold-session state, not a demo flag. Clear
  `sessionStorage` (or use a fresh incognito context) to replay it for a recording.
- **Duration:** ≤1.4s, skippable by click.
- **Recording:** `1-bridge-boot.webm` (Stage's own `BridgeBootDemo` replay — same
  `choreo` timing as the real Bridge, fixture-driven since Stage doesn't hold a live
  session).

## 2. First approve chain

- **Component:** `bridge/ApprovalCockpit.tsx`'s `decide()` verb "confirm" path —
  GateValve rotates open → InkBleed crystallizes the border → optimistic stamp/flight →
  odometer `Ticker` decrements → ConsequenceTrail chip flies to the activity feed anchor
  (FLOW-50/51/55, the full F3 Decision Theater chain).
- **Trigger:** clicking Approve (or pressing "a") on a real pending action, once the
  POST to `actions/:id/confirm` resolves.
- **Honesty label:** REAL choreography, but the full genuinely-successful chain has
  never been recorded against a real signed-in session — no `TEST_OWNER_EMAIL`/
  `PASSWORD` exists (standing limitation carried since D2). This session's recording
  intercepted the POST at the network layer (Playwright `page.route`, disclosed in the
  spec file) purely to complete the animation sequence for tuning; Showtime must NOT
  reuse that interception — it should record this moment live, the first time a real
  owner approves something with Showtime open, or accept the open gap.
- **Recording:** `2-first-approve-chain.webm` (network-mocked, disclosed above — tuning
  reference only, not a claim of production behavior).

## 3. Live-call arrival

- **Component:** `panels/LiveCallPanel.tsx` — `WaveformStrip` (real mic levels),
  `CallOrbitRing` (orbit body while live), `IntentSparkTray` (a real pending action
  spawned during the call flies in) — FLOW-67/69/70, F4 Voice Theater.
- **Trigger:** a live Vapi call connecting through `useVapiSession`.
- **Honesty label:** REAL component, FIXTURE-driven recording (no real Vapi call in
  this sandbox — same standing limitation). Showtime should record this the first time
  a real call comes in with Showtime open; until then, use the fixture recording with a
  visible "FIXTURE" label, never presented as a live call.
- **Recording:** `3-live-call-arrival.webm` (Stage's `VoiceTheaterCatalogSection`
  replay — same real exported components LiveCallPanel mounts).

## 4. Workflow completion

- **Component:** `panels/WorkflowTheater.tsx`'s `Graph`/`GraphNodeCard` — a step
  transitioning into "leased" fires `StepIgnition`'s cyan burst; completion reuses the
  existing `jarvis-shockwave` crystallize class (FLOW-61, F8 Pipeline Theater).
- **Trigger:** a real workflow step completing (any of the 41 real action types D3
  wires through the orchestrator).
- **Honesty label:** REAL choreography, FIXTURE-driven recording (no live fault-
  injected or genuinely-completing run in this sandbox — standing limitation, same
  category F8 already documented). Showtime should prefer a real completing run once
  one is observable with Showtime open.
- **Recording:** `4-workflow-completion.webm` (Stage's `PipelineTheaterCatalogSection`
  replay — same real exported `Graph`/`GraphNodeCard`/`NODE_TONE` production mounts).

## 5. Offline → relight

- **Component:** `bridge/Bridge.tsx`'s `useOfflineDrift()` — root `data-mood` swaps to
  "standalone" (aurora dims) on a genuine `data.statsDegraded` transition, then a
  one-shot gradient "relight" sweep plays on real recovery (FLOW-90 OfflineDrift, F6
  State Narratives).
- **Trigger:** the fast-lane poll genuinely failing then recovering (a real network
  drop, or F6's own established method of stopping the dev API briefly).
- **Honesty label:** REAL signal and REAL relight animation — F6's own STATE evidence
  includes one genuine degraded screenshot captured by stopping the dev API. Showtime
  can trigger this deliberately (stop/restart the API) for a real recording rather than
  relying on the fixture demo.
- **Recording:** `5-offline-relight.webm` (Stage's `OfflineDriftDemo` toggle — same
  language/copy as the real Bridge banner, not the live aurora dim itself since Stage
  doesn't mount `ConsoleAtmosphere`).

## Standing gap common to moments 2–4

All three share the SAME root cause: no `TEST_OWNER_EMAIL`/`TEST_OWNER_PASSWORD` exists
in any environment this track has run in, so no F-phase (D2 through F12) has ever
recorded a genuinely-successful approve, a genuine live call, or a genuine live-
completing run against a real backend. Every recording of those three moments across
the whole F-track is fixture- or interception-based, disclosed as such at the point of
capture. This is not an F-track gap to close — it is the same standing limitation the
main plan's own STATE file has carried since A1/A2/B1/D1. Showtime is the first real
opportunity to close it, the moment a real owner session exists.
