# JARVIS FRONTEND MAESTRO PLAN — v4
## LIVEFRAME: a living execution canvas, shipped in 6 phases

**Authored:** 2026-08-02 · Codex high-reasoning planning session · planning only, no product code modified  
**Execution target:** Luna Max · execution only; visual, motion, state, copy, scope, and evidence decisions are fixed below  
**Planning baseline:** `cb27d47093651ec37ebd8454600e7c907c290d2a` plus the current dirty integrated `/jarvis` worktree — **never reset it**  
**State file:** `JARVIS-FRONTEND-MAESTRO-STATE-v4.md`  
**Inherited contracts:** `JARVIS-FRONTEND-MAESTRO-PLAN-v3.md` §§0, 3, 4, 6.8 and its truth/authority rules remain binding  
**Route scope:** `/jarvis` only. `/demo`, marketing pages, `/jarvis/stage`, and motion catalogs are not product targets.

---

## WHY v4 EXISTS

v3 solved the right truth problems but did not deliver the intended experience. The live product now has real kernel state, voice state, approvals, workflow runs, receipts, recovery, an Orb, particles, atmosphere, and many motion primitives. Yet the production screenshot still reads as a **static setup page with a glowing wallpaper**.

That failure is not a missing-animation count. It is a failure of composition and state ownership:

1. **The live route has effects, but no interaction director.** `ThreadAtmosphere.tsx` emits small disconnected cues while `ThreadBridge.tsx`, `Thread.tsx`, `WorkflowTheater.tsx`, `ApprovalCockpit.tsx`, and `CommandRail.tsx` each animate locally. Nothing composes those reactions into one scene.
2. **The most important object is visually demoted.** The Orb is 44 px in the header at rest. It cannot feel like a living voice-native presence from there.
3. **The setup state swallows the command product.** `FirstRunScene` occupies the visual focus with implementation language, a nested empty panel, and an external Connect action. The user sees configuration debt before possibility.
4. **The page reports internals instead of meaning.** `blocked` and `polling` appear as peer status chips. One describes business posture, the other transport. Together they look contradictory and technical.
5. **The workflow theater is powerful but not staged as the consequence of the active instruction.** It appears only inside the execution block and retains panel/dashboard visual language. The causal handoff from approval → action → workflow → evidence is not cinematic or spatially obvious.
6. **The field is decorative, not legible.** The full-screen grid, faint dots, low-opacity gradients, and tiny cue ring produce texture without attention, direction, or consequence.
7. **The command rail carries almost the entire interaction burden.** The rest of the viewport does not invite, guide, acknowledge, or respond strongly enough.
8. **Too many borders, pills, uppercase labels, and low-contrast microcopy make the page look assembled from AI UI conventions.** Glow exists, but it is not selectively earned by live state.

v4 does not replace the backend, kernel, Instruction Thread, safety model, or truth grammar. It creates the missing **experience layer**: one derived interaction projection that makes the entire canvas respond coherently to real events.

> **Target:** a user can mute the audio, hide all labels, and still understand whether JARVIS is listening, thinking, asking, waiting for approval, working, verifying, succeeding, failing, or recovering from the movement and spatial focus alone.

The planning/execution split is deliberate: a high-reasoning brief fixes the decisions; Luna Max executes bounded tasks and proves them. This is the same brief-first, execution-second pattern Codex builders report using successfully. That report is not evidence of quality; only the gates in this plan are.

---

# §0. EXECUTION PROTOCOL

## 0.1 The executor’s contract

**You are executing, not redesigning.** Every customer-visible decision is made in this file. Do not add another visual concept, interaction model, animation family, panel, status vocabulary, or workflow surface.

You may decide only implementation details that do not alter the contract: helper names, test decomposition, and whether a small pure function stays local or moves to the named sibling file.

If source contradicts this plan, source wins. Record the exact contradiction in the v4 state file under the task’s `Deviation:` field. If the source lacks a required real signal, record a blocker and ship the truthful static/degraded variant. Never simulate business activity on `/jarvis`.

## 0.2 Luna Max execution prompt contract

Each Luna Max task prompt must contain only:

1. `Read JARVIS-FRONTEND-MAESTRO-STATE-v4.md top to bottom.`
2. `Execute only NEXT EXACT TASK and its phase contract in JARVIS-FRONTEND-MAESTRO-PLAN-v4.md.`
3. `Preserve the dirty worktree; /jarvis only; /demo untouched; no design decisions.`
4. `Do not stop at code-complete: produce every evidence item, update state, and leave the next task exact.`

Do not paste this whole plan into every prompt. The files are the context. One task per execution prompt. A task may span multiple tool calls, but it may not silently absorb the next task.

## 0.3 Dirty-worktree binding

The integrated v3/rescue work is currently uncommitted across many frontend and backend files. It is user-owned baseline, not disposable noise.

- Never run `git reset --hard`, `git checkout --`, bulk snapshot regeneration, or cleanup commands against existing changes.
- Before each task: `git status --short`, `git diff -- <task files>`, and read every touched task file in full.
- Change only named files unless a source-proven dependency requires one additional file. Record that file before editing.
- Do not commit, push, or deploy unless the user explicitly authorizes that execution session. This plan itself authorizes none of those actions.

## 0.4 Evidence rules

| Evidence | Counts | Does not count |
|---|---|---|
| Source | exact `path:line`, derived state table, pasted discovery output | “already wired” |
| Visual | production-shaped screenshot at 1440, 768, and 390; named state | catalog, Storybook, or description |
| Motion | recording or deterministic frame/state assertion tied to a real event | screenshot of an animated component |
| Runtime | event timestamp → painted state timestamp; browser console/network log | “felt responsive” |
| Interaction | pointer, keyboard, touch, and voice transcript where applicable | click-only happy path |
| Truth | real tenant data or visibly labelled fixture used only in tests | unlabeled fixture or timer-made activity |
| Performance | 5 cold runs, median + worst; FPS/p95 during the specified scene | warm run or bare Lighthouse headline |

Every task needs at least one source/test artifact. Every phase needs visual evidence at 1440 and 390. P4–P6 also require 768.

## 0.5 Session loop

1. Read the state file top to bottom.  
2. Execute `NEXT EXACT TASK`, nothing else.  
3. Read the current phase and all named source files.  
4. Run and paste Discovery.  
5. Implement in task order.  
6. Run focused tests before broad tests.  
7. Capture required evidence.  
8. Update task checkbox, `Evidence`, `Deviation`, status, score, and next exact task.  
9. Stop. Do not begin the next task in the same execution prompt.

## 0.6 Hard rules

1. **One projection, one scene.** `LIVEFRAME` derives presentation from the existing kernel; it is not a second state machine and owns no business truth.
2. **Real events move pixels.** An animation implying work may run only while its corresponding instruction/action/run/step/voice/transport fact is true.
3. **At rest, only two loops may run:** Orb breathing and Field drift. Everything else is a one-shot response or a live-progress animation.
4. **No timer theatre.** Timers may decay an event impulse or animate physics; they may never invent a workflow step, status, count, progress, or cognitive claim.
5. **No dashboard regression.** The Instruction Thread remains the causal spine. The workflow plane appears because the active instruction executes; it is not a permanent card grid.
6. **No mascot, marketing concierge, custom marketing cursor, or demo chrome on `/jarvis`.** JARVIS itself is the Orb and the operating scene.
7. **No technical status as primary copy.** `polling`, `SSE`, sequence numbers, and lane cadence belong in diagnostics. Primary status describes what JARVIS means to the user.
8. **No fake zeros.** Existing v3 `Truth<T>`, `data-source`, authorization, approval, and receipt rules remain binding.
9. **No raw JSON.** No exception for failure, debug, workflow, or receipt states.
10. **No new runtime animation dependency.** Use the existing Framer Motion, Three.js Orb, SVG/CSS transforms, kernel choreography, and browser APIs.
11. **Animate transforms and opacity by default.** Height/layout animation is allowed only for Thread continuity and must be measured for jank.
12. **Reduced motion preserves hierarchy and causality.** It replaces travel/scale/shake with instant state, colour, border, copy, and focus changes.
13. **Glow is semantic, not wallpaper.** Only focus, a live edge, or a one-shot event gets a strong bloom.
14. **The canonical route is the proof.** Catalogs and fixture harnesses support development but cannot close a phase alone.
15. **The score cannot be declared 95/100 from code completion.** P6 evidence calculates it.

---

# §1. BASELINE DIAGNOSIS AND THE 95/100 CONTRACT

## 1.1 Screenshot diagnosis — 2026-08-02, production `/jarvis`

| Visible failure | Why it reads as “vibecoded” | Binding correction |
|---|---|---|
| 44 px yellow Orb trapped in header | decorative logo, not intelligent presence | Orb is the primary rest/listen focus; docks only after work begins |
| `blocked` + `polling` + `Low power off` peer pills | technical and contradictory hierarchy | one human primary status; transport and power move to secondary diagnostics/settings |
| giant First-run card | configuration debt becomes the product | compact Setup Rail; user can still issue available actions |
| snake-case and plugin language | exposes implementation model | user outcome copy; exact capability details behind disclosure |
| nested empty permission panel | card inside card, no momentum | one blocker row with consequence, provider count, and a single clear action |
| full-screen retro grid | generic sci-fi wallpaper | perspective grid limited to the lower field and deforms only from real impulses |
| tiny floating dots | motion too weak to communicate anything | state-driven energy field with bounded, directional event impulses |
| large dead middle | no spatial story or next affordance | Orb/intent prompt at rest; Thread/Workflow focus occupies the canvas during work |
| command rail detached at bottom | one input widget pasted onto a canvas | Command Dock participates in listen/capture/commit and remains visually tethered to the Orb/Thread |
| faint `$0`/approval line | looks fabricated or broken even when truthful | semantic recommendations from known facts; unavailable/partial states use explicit truth grammar |
| hard borders and uppercase everywhere | template-like component assembly | fewer containers; sentence case for meaning; uppercase only for micro labels |
| mascot/pet at top right | competing assistant identity | forbidden on `/jarvis`; JARVIS presence is singular |

## 1.2 Baseline score

| Category | Weight | Baseline | Why |
|---|---:|---:|---|
| Spatial composition and hierarchy | 15 | 2 | empty canvas, setup card dominates, Orb demoted |
| State-coupled motion | 20 | 2 | cues exist but are visually peripheral and weak |
| Live workflow legibility | 20 | 1 | not visible in the captured resting/blocked product; causal handoff absent |
| Voice and command tactility | 15 | 2 | rail exists; canvas barely acknowledges input |
| Decision, consequence, and recovery | 15 | 1 | real components exist but do not define the overall scene |
| Visual craft and originality | 10 | 1 | generic grid, pills, nested dark cards, inconsistent glow |
| Performance, accessibility, responsiveness | 5 | 1 | basic width checks exist; certification gates remain open |
| **TOTAL** | **100** | **10/100** | user’s rating accepted as the planning baseline |

## 1.3 Definition of 95/100

P6 scores the same table. To ship as v4:

- total score **≥ 95/100**;
- no category below **90% of its own weight**;
- all critical interaction paths green;
- no open severity-1 visual or interaction defect;
- motion/performance targets met at 1440, 768, and 390;
- a human review recording confirms the interface reads correctly without audio and with labels hidden for the state-recognition test.

This is a release bar, not a promise that taste can be mathematically proven. If the score is 94, the state says 94.

## 1.4 Explicitly not being built

- no new backend architecture;
- no dashboard home;
- no decorative 3D environment unrelated to work;
- no avatar face or second assistant identity;
- no fake terminal stream;
- no infinite workflow animation when no run exists;
- no animation catalog promotion by quantity;
- no redesign of `/demo` or marketing;
- no rewrite of the kernel, Vapi transport, approval authority, workflow runtime, or receipt model.

---

# §2. PRODUCT EXPERIENCE CONTRACT — LIVEFRAME

## 2.1 The one sentence

> JARVIS is a living operating surface: your voice creates intent, intent becomes an executable plan, permission ignites real workflows, and the scene settles only when evidence proves the outcome.

## 2.2 The central interaction decision

**LIVEFRAME** is a pure presentation projection over the existing kernel. It turns current truth into five coordinated surfaces:

| Surface | Purpose | Rest posture | Active posture |
|---|---|---|---|
| **Presence Core** | Orb, aura, listening/meaning | central, 112–132 px desktop; 84 px mobile | docks beside the active causal block; energy follows state |
| **Action Spine** | Instruction Thread | invitation and source-backed recommendations | continuous Heard → Context → Plan → Approval → Execution → Evidence document |
| **Execution Weave** | real workflow nodes/edges | absent; latest real result may appear as one quiet row | expands from the approved action and shows only linked real runs/steps |
| **Signal Field** | ambient depth and event direction | one slow source-backed field drift | colour, density, direction, and impulses respond to real lifecycle edges |
| **Command Dock** | voice, text, shortcuts | visually tethered to Presence Core | compresses, changes affordance, and never competes with approval/execution focus |

These are not five cards. They are layers of one continuous canvas.

## 2.3 Scene modes

`LIVEFRAME` exposes exactly these presentation modes, derived from existing facts:

1. **ready** — no active instruction; Presence Core central; one clear invitation; compact setup/connection notices.
2. **listening** — mic open; Orb and Dock become one input instrument; partial transcript is spatially attached.
3. **thinking** — captured/understanding/planning; Action Spine draws downward as real trace facts arrive.
4. **decision** — clarification or approval; unrelated depth recedes; one required human act is dominant.
5. **working** — executing; Execution Weave occupies the secondary focus; active step owns motion.
6. **verifying** — workflow has ended but evidence is still reconciling; motion slows and converges.
7. **resolved** — receipt/evidence blooms; field settles into the new real posture.
8. **fault** — failed/partial/offline/blocked; fault is localised and one recovery action becomes primary.

No component invents a ninth mode.

## 2.4 Canonical desktop composition

At **≥ 1180 px**:

```text
┌──────────────────────────── 64 px semantic header ────────────────────────────┐
│ JARVIS + one primary status                         diagnostics · settings     │
├──────── Presence 220 ─────── Action Spine minmax(640,840) ─── Weave 320 ─────┤
│ Orb / source pulse          causal document                 active runs only   │
│                              approval may span Spine+Weave                     │
├────────────────────────── Command Dock 760 max ────────────────────────────────┤
```

- Canvas max width: **1360 px**; horizontal padding **24–40 px**.
- Header: **64 px**, no more than one primary status chip and one diagnostics affordance.
- Action Spine: **760 px default**, may grow to **840 px** for execution/receipt.
- Execution Weave: absent unless there is a linked run, a real terminal run for the active instruction, or the user explicitly opens evidence.
- No empty column reserves space. When the Weave is absent, Presence + Spine centre as one composition.
- No vertical dead zone larger than **96 px** between meaningful elements at rest or **48 px** during an active instruction.

## 2.5 Canonical tablet and mobile composition

At **768–1179 px**:

- Presence Core and Action Spine share one column.
- Execution Weave becomes an in-document full-width plane directly below the approved action.
- Header status becomes a single sentence; diagnostics opens from one icon/button.
- Command Dock width is viewport minus **32 px**.

At **≤ 767 px**:

- 16 px page gutters; safe-area aware.
- Presence Core is **84 px** at ready/listening and **48 px** docked during work.
- Command Dock minimum touch targets **48 px**, bottom offset includes `env(safe-area-inset-bottom)`.
- Workflow nodes become a vertical causal list with a visible connecting rail; never a scaled-down unreadable desktop graph.
- Approval is a full-height focus sheet with the consequence header and one decision group reachable by thumb.
- No fixed control may overlap the Dock, keyboard, setup notice, or active decision.

## 2.6 First-run and degraded posture

First run is not a separate page-sized experience.

- Replace the large `FirstRunScene` panel with a **Setup Rail** above the invitation.
- Primary copy: **“Finish setup to unlock every action.”**
- Secondary copy derives a real count: **“N connections need attention.”** If the count is unavailable: **“Connection status is unavailable.”**
- Primary action: **“Review setup”** using the existing authoritative setup destination.
- Detailed providers/action types live in an expandable disclosure; humanised names only.
- The Command Dock remains available for any action the backend says is available.
- If a submitted action is blocked by configuration, the blocker appears inside that action’s causal position—not as a permanent empty centre card.

---

# §3. CANONICAL INTERACTION PROJECTION

## 3.1 Location and responsibility

Add one pure derivation module at:

`src/components/jarvis/kernel/liveframe.ts`

It derives presentation from existing kernel/voice/data signals. It must not fetch, subscribe, mutate, authorize, approve, execute, or persist business state.

```ts
type LiveFrameMode =
  | "ready" | "listening" | "thinking" | "decision"
  | "working" | "verifying" | "resolved" | "fault"

type LiveFrameFocus =
  | "presence" | "thread" | "clarification" | "approval"
  | "workflow" | "receipt" | "recovery"

interface LiveFrameProjection {
  mode: LiveFrameMode
  focus: LiveFrameFocus
  presence: Presence
  energy: number              // 0..1, derived
  activity: number            // 0..1, real linked run/step pressure
  voiceEnergy: number         // 0..1, local mic only
  transportPosture: "healthy" | "degraded" | "offline"
  activeActionIds: string[]
  activeRunIds: string[]
  activeStepIds: string[]
  latestImpulse: LiveFrameImpulse | null
}
```

The actual implementation may narrow fields if source proves one unavailable, but may not add independent product modes.

## 3.2 Input priority

Resolve focus in this exact order:

1. explicit approval/clarification requiring a person;
2. active instruction execution or recovery;
3. verifying/reconciling outcome;
4. active microphone/assistant speech;
5. planning/understanding;
6. completed/partial/failed terminal decay;
7. ready.

Transport degradation modifies posture but does not erase a more important user decision. An action needing approval may coexist with polling; the primary copy remains **“Needs your approval”**, while diagnostics records polling.

## 3.3 Variable energy

Variable motion is derived, never random:

```text
voiceEnergy  = clamp(localVolumeLevel, 0, 1) when mic is open; otherwise 0
activity     = clamp(activeLinkedSteps / 6, 0, 1)
eventImpulse = exponential decay from the latest real event, 1 → 0 over its named duration
energy       = clamp(base(mode) + 0.45*voiceEnergy + 0.25*activity + 0.20*eventImpulse, 0, 1)
```

`base(mode)`:

| mode | base |
|---|---:|
| ready | 0.12 |
| listening | 0.28 |
| thinking | 0.32 |
| decision | 0.38 |
| working | 0.48 |
| verifying | 0.34 |
| resolved | 0.24 |
| fault | 0.30 |

The Orb, Signal Field, active glow, and live edge speed consume the same energy. They do not derive competing values.

## 3.4 Human status vocabulary

| Mode/focus | Primary visible status |
|---|---|
| ready | Ready |
| listening | Listening |
| thinking | Understanding / Building the plan |
| clarification | Needs one detail |
| approval | Needs your approval |
| working | Working |
| verifying | Verifying the outcome |
| resolved | Done |
| partial | Partially completed |
| recoverable fault | Needs attention |
| offline | Connection lost |

`polling`, `reconnecting`, `trace unavailable`, sequence IDs, event rates, and low-power mode are not primary chips. They are available in a compact Diagnostics disclosure and accessible text.

---

# §4. VISUAL, MOTION, AND INTERACTION SYSTEM

## 4.1 Material language

- Base: near-black navy, not pure black.
- Panels: use one surface and one elevated surface; eliminate card-inside-card where hierarchy can be achieved with spacing/dividers.
- Borders: 6–10% white at rest; semantic colour only on focus/fault/success.
- Radius: 16 px for main surfaces, 12 px for controls, full-pill only for compact statuses/actions that are genuinely pill-shaped.
- Uppercase: micro labels only. Meaningful sentences, statuses, buttons, and workflow names use sentence case.
- Grid: perspective floor limited to lower **38%** of the viewport at rest; opacity **≤ 0.10**. It may ripple from a real impulse but never continuously scan.
- Glow levels:
  - ambient: `0 0 24px` at ≤ 10% semantic colour;
  - focused/live: `0 0 48px` at ≤ 22%;
  - event bloom: `0 0 84px` at ≤ 34% for ≤ 760 ms;
  - never apply focused/event glow to more than two elements simultaneously.
- Copy: explain outcomes first. Plugin names, action types, transport, and policy internals are disclosure details.

## 4.2 LIVEFRAME motion signatures

| ID | Name | Real trigger | Pixels affected | Full-motion contract | Reduced-motion equivalent |
|---|---|---|---|---|---|
| LF-01 | Presence Breath | mode `ready` | Orb shell + faint aura | 4.2 s, scale 1→1.025→1, opacity ±0.06; one ambient loop | static aura |
| LF-02 | Mic Resonance | local mic level | Orb displacement, aura thickness, Dock waveform | spring follows `voiceEnergy`; max scale +8%, no fake waveform | live level meter width/colour |
| LF-03 | Transcript Ink | real partial transcript | Dock text → Heard line | 90 ms crossfade per replacement; final locks in 180 ms | instant text replacement + final weight change |
| LF-04 | Intent Launch | authenticated submit accepted | Dock, Orb, Heard block | Dock impulse travels to Heard anchor in 260 ms | focus + solid Heard state |
| LF-05 | Context Constellation | `context_retrieved` facts | context chips + Field points | each real fact attracts from field to block, 220 ms; batched facts ≤45 ms stagger | chips appear together with source labels |
| LF-06 | Plan Draw | real plan/action node appears | plan node and edge | edge draws 240 ms; node resolves 160 ms; no placeholder node | complete node appears with changed border |
| LF-07 | Question Focus | clarification required | canvas depth + question | unrelated layers dim to 42% in 220 ms; question rises 8 px | instant dim + focus |
| LF-08 | Gate Rise | awaiting approval | Plan + Approval cockpit | cockpit expands from action boundary, 280 ms; background depth 35% | instant cockpit + focus heading |
| LF-09 | Decision Wave | authoritative approve/reject/escalate success | selected action, field, workflow origin | green/red/amber radial impulse, 520 ms; no success before response | semantic state + status announcement |
| LF-10 | Workflow Ignition | linked run becomes real | approved node → Execution Weave | causal edge connects in 300 ms; first leased node lights only when observed | linked run appears with “Running” |
| LF-11 | Leased Current | real leased step | active edge/node only | directional flow; speed 1.4→0.8 s from `energy`; live-progress loop | solid cyan edge + active icon |
| LF-12 | Step Spark | step completion event | completed node + next edge | 340 ms local spark/check; next edge receives impulse | check + next state instant |
| LF-13 | Fault Fracture | real failed/blocked step | failed node and its incoming edge | local 160 ms shake ≤4 px, edge breaks/red; never shake page | red edge + error icon + focus |
| LF-14 | Compensation Rewind | compensating/compensated | affected workflow path | amber reverse current follows actual compensation order | amber reversed arrow/state |
| LF-15 | Verification Converge | verifying | Weave → receipt evidence | motion slows; active paths converge into evidence anchor over 420 ms | focus transfers to evidence |
| LF-16 | Evidence Bloom | receipt/fact update | predicted↔actual and changed facts | changed rows reveal 50 ms apart, max 400 ms; seal at end | highlight changed rows + Done status |
| LF-17 | Recovery Relight | degraded/offline → healthy | affected local region then canvas | 700 ms left-to-right relight once; no repeating sweep | restored badge + focus return |
| LF-18 | Spatial Continuity | any causal block/focus transition | Action Spine/Weave/Dock | FLIP/layout 260–380 ms; preserve mounted controls and scroll anchor | instant layout, preserved focus |

No other customer-facing motion ships in v4 without being added to this table by a planning revision.

## 4.3 Interaction signatures

1. **Orb press:** same visible mic control as the Dock; tap toggles, hold ≥360 ms push-to-talk, release stops. There is one mic session.
2. **Canvas intent:** clicking the ready invitation focuses the Dock; it does not open a modal.
3. **Thread blocks:** completed blocks remain spatially present; click/Enter toggles detail; active block cannot be collapsed.
4. **Approval:** one pointer/keyboard/touch decision group. Destructive/high-risk confirmation retains existing typed confirmation rules.
5. **Workflow nodes:** selecting a node reveals its evidence in-place or a bounded drawer; selection never navigates away from the active thread.
6. **Failure:** the first valid recovery action receives focus, but nothing auto-executes.
7. **Receipt:** changed facts are linkable and copyable; “Copy receipt” copies a useful summary, not only an ID.
8. **Diagnostics:** one disclosure owns transport, low-power, source freshness, and retry. These details never compete with the user’s current task.

## 4.4 Sound

Keep the existing muted-by-default sound system. Sound reinforces LF-04, LF-06, LF-09, LF-12, LF-16, and faults only. No continuous hum. During a live Vapi speaking turn, cues duck or remain silent per the existing sound contract.

---

# §5. LIVE WORKFLOW AND RESPONSIVENESS CONTRACT

## 5.1 The action-to-evidence choreography

```text
voice/text
  → HEARD locks the exact instruction
  → CONTEXT gathers source-labelled facts
  → PLAN draws real actions and dependencies
  → DECISION isolates the required human act
  → APPROVAL RESPONSE sends LF-09 only after authority confirms
  → WORKFLOW IGNITION connects approved action IDs to real run IDs
  → LEASED CURRENT follows only the actual leased step
  → STEP SPARK advances from real step events
  → VERIFYING converges workflow state into evidence
  → RECEIPT BLOOM shows predicted ↔ actual and source-linked changes
  → RECOVERY stays in the same causal position if any leg fails
```

The user must never wonder whether the workflow shown belongs to this instruction. `actionIds` are mandatory for the active Execution Weave. Tenant-wide blueprint/replay mode does not render automatically on the canonical action path.

## 5.2 Workflow state appearance

| State | Appearance | Motion |
|---|---|---|
| pending | quiet outline, named step, no glow | none |
| leased | cyan focus, live edge, attempt/elapsed detail available | LF-11 |
| completed | solid edge, green check, evidence available | LF-12 once |
| failed | red local fracture, exact reason, recovery | LF-13 once |
| compensating | amber reverse direction | LF-14 live |
| compensated | settled amber, literal “Rolled back” | none |
| cancelled | neutral stopped path, reason | one fade-down |
| escalated | amber human handoff, owner/role named if known | one focus transfer |

## 5.3 Responsive acceptance

All primary paths must pass at **390×844**, **768×1024**, and **1440×1000**:

- no horizontal page overflow;
- no fixed-element collision;
- keyboard does not hide the active input/approval control;
- touch targets ≥48 px on mobile and ≥44 px elsewhere;
- active focus is visible at 200% zoom;
- the workflow graph is legible without pinch zoom;
- Command Dock, approval, and recovery remain reachable with one thumb on 390;
- no meaningful copy below the inherited 11 px floor;
- no state is communicated by colour or motion alone.

## 5.4 Performance targets

- `/jarvis` initial JS **≤ 250 KB gzip**.
- 5 cold Lighthouse runs: desktop and mobile median **≥ 90**, worst **≥ 85**; accessibility **≥ 95** every run.
- ready/listening scene **≥ 58 FPS p95 frame rate** on the test machine.
- six-lane execution **≥ 55 FPS p95 frame rate**.
- event→pixel: SSE median **≤ 500 ms**, p95 **≤ 1200 ms**; poll median **≤ 1500 ms**, p95 **≤ 5000 ms**.
- input feedback: pointer/keyboard press → visible response **≤ 100 ms**.
- layout shift after first interactive paint: **CLS ≤ 0.03**.
- at most two ambient loops and one live-progress loop per active workflow path.

---

# §6. THE SIX PHASES

## PHASE 1 — LIVEFRAME Shell and Visual Hierarchy
**Sessions:** 1 · **Depends on:** current integrated v3 worktree

### Exact user-visible result

The resting `/jarvis` scene no longer looks like a setup form. JARVIS has one strong presence, one human status, one invitation, one compact Setup Rail, and no competing mascot or technical-chip clutter.

### Source files

`bridge/ThreadBridge.tsx` · `bridge/FirstRunScene.tsx` · `bridge/ModeChip.tsx` · `bridge/ThreadField.tsx` · `bridge/ThreadAtmosphere.tsx` · `jarvis-theme.css` · `kernel/presence.ts` · `kernel/store.tsx` · `components/layout/GlobalChrome.tsx`

### Discovery

Capture the current production-shaped authenticated ready/setup scene at 1440, 768, and 390. Record visible primary statuses, fixed elements, z-index owners, component bounding boxes, and every ambient animation. Confirm whether the screenshot mascot comes from repository code, browser chrome, or an external overlay before changing anything.

### Architecture decisions already made

`LIVEFRAME` is a pure derived projection. The Action Spine remains the Instruction Thread. First run becomes a Setup Rail. One primary human status replaces peer technical pills. Technical diagnostics remain available but secondary.

### Ordered tasks

1. **P1.T1** Baseline audit and visual evidence; update the failure ledger with source ownership and exact bounding boxes.
2. **P1.T2** Add pure `kernel/liveframe.ts` projection and exhaustive tests for all eight modes/focus priority. No fetching or business state.
3. **P1.T3** Recompose `ThreadBridge` into Presence Core + Action Spine + optional Weave zones; ready state centres Presence Core and invitation.
4. **P1.T4** Replace the giant first-run card with the exact Setup Rail contract in §2.6; humanise action/provider copy.
5. **P1.T5** Replace primary `blocked`/`polling`/power pills with §3.4 status + one Diagnostics disclosure.
6. **P1.T6** Constrain the grid/field/material system to §4.1; remove redundant borders, pills, uppercase, and nested empty panels.
7. **P1.T7** Verify route isolation: no mascot, marketing concierge, custom cursor, demo chrome, or `/demo` modifications.

### Evidence required

Before/after screenshots at 1440/768/390; mode-priority unit table; DOM assertion of one primary status; animation inventory proving only LF-01 and Field drift loop at rest; zero console errors.

### Rollback

Projection is additive. Shell changes remain isolated to the named bridge/theme files and can be reverted without changing kernel truth.

### Exit gate

- [ ] Ready/setup scene has one obvious focus and one primary status at all three widths
- [ ] Setup Rail occupies ≤ 96 px collapsed desktop and ≤ 128 px mobile
- [ ] Presence Core is ≥112 px desktop ready / 84 px mobile ready
- [ ] No mascot/concierge/marketing chrome on `/jarvis`
- [ ] No dead vertical zone >96 px at rest
- [ ] Exactly two ambient loops or fewer
- [ ] P1 visual score ≥ 75/100

---

## PHASE 2 — Presence Core, Voice, and Command Tactility
**Sessions:** 1–2 · **Depends on:** P1

### Exact user-visible result

JARVIS visibly listens. The Orb, aura, transcript, Dock, and Heard block behave as one instrument. Tap, hold, keyboard Space, `/`, typing, partial transcript, final transcript, commit, silence, failure, and retry are unmistakable.

### Source files

`bridge/Orb3D.tsx` · `bridge/OrbAuraRipple.tsx` · `bridge/CommandRail.tsx` · `bridge/ThreadBridge.tsx` · `lib/useVapiSession.tsx` · `lib/voice-intent.ts` · `kernel/choreography.ts` · `kernel/liveframe.ts` · `sound.ts`

### Discovery

Record the real Vapi state/event sequence for tap, long press, release during connection, silence watchdog, partial transcript, final transcript, assistant speech, and barge-in. Confirm local mic level and remote speaker level remain distinct.

### Ordered tasks

1. **P2.T1** Bind LF-01/LF-02 to shared `energy`, using real local mic amplitude and existing Three.js Orb; no random energy source.
2. **P2.T2** Make Orb and Dock one accessible mic control surface while preserving exactly one Vapi session and existing tap/hold/Space semantics.
3. **P2.T3** Implement LF-03 partial/final transcript continuity; the heard phrase remains visible until authenticated submission is acknowledged or fails.
4. **P2.T4** Implement LF-04 Intent Launch and immediate ≤100 ms tactile feedback; failure returns the instruction to an editable retry state.
5. **P2.T5** Give every voice state exact visible copy: unavailable, permission denied, connecting, listening, hearing, silence, speaking, retrying, stopped.
6. **P2.T6** Verify barge-in, assistant cue ducking, keyboard, touch cancellation, window blur, and reduced motion.

### Evidence required

Real or device-backed voice recording; deterministic Vapi state tests; mobile pointer trace; keyboard transcript; response timing; 1440/390 recordings; no duplicate session; no assistant-output amplitude driving mic visuals.

### Rollback

Voice authorization and submission remain on the current authenticated kernel path. Motion can fall back to static state without changing voice execution.

### Exit gate

- [ ] A first-time observer identifies listening/hearing/speaking/silence without reading diagnostics
- [ ] Tap and long-press work on 390; release during connection cannot strand the mic
- [ ] Partial transcript is live; final transcript survives submit latency
- [ ] Visible press response ≤100 ms
- [ ] Barge-in visual response ≤200 ms with device evidence
- [ ] One Vapi instance and one authenticated submit path
- [ ] P2 cumulative visual/interaction score ≥ 82/100

---

## PHASE 3 — Action Spine and Spatial Choreography
**Sessions:** 1 · **Depends on:** P2

### Exact user-visible result

An instruction visibly writes itself into one continuous causal document. No block pops in as a detached card, no layout collapses into blank space, and focus/scroll follow the real state without stealing control.

### Source files

`bridge/Thread.tsx` · `bridge/ThreadBlocks.tsx` · `bridge/ThreadStack.tsx` · `bridge/ThreadField.tsx` · `kernel/instruction.ts` · `kernel/apply-trace-events.test.ts` · `kernel/choreography.ts` · `kernel/trace-metrics.ts`

### Discovery

Capture every current state edge: ready→captured→understanding→planning→clarifying/approval→executing→verifying→terminal, including retry and refresh restore. Measure layout shift, scroll movement, focus movement, and the time between event receipt and visible state.

### Ordered tasks

1. **P3.T1** Implement LF-05 Context Constellation from real context trace facts and source labels.
2. **P3.T2** Implement LF-06 Plan Draw from real action nodes/dependencies; batched nodes never pretend to stream separately.
3. **P3.T3** Implement LF-07 Question Focus and clarification return continuity.
4. **P3.T4** Implement LF-18 for all Thread block transitions; controls stay mounted, active block cannot collapse, focus is preserved.
5. **P3.T5** Replace repetitive bordered card styling with one causal spine, separators, and semantic active treatment.
6. **P3.T6** Make recent threads/history a deliberate collapsed audit trail, not competing tiles.
7. **P3.T7** Verify refresh/reconnect restores the same spatial state and does not replay completed one-shot motion.

### Evidence required

State-edge recording at 1440/390; layout-shift trace; focus/keyboard transcript; event→pixel metrics; refresh recording; reduced-motion comparison; source-labelled fact assertions.

### Rollback

Thread state and data stay unchanged. Choreography components remain wrappers around current blocks.

### Exit gate

- [ ] Every state edge is spatially continuous
- [ ] No active-state blank gap or layout jump >0.03 CLS
- [ ] Context and plan motion fires only from real facts/nodes
- [ ] Active block remains visible and keyboard reachable
- [ ] Refresh restores state without replaying completed event blooms
- [ ] Event→pixel meets §5.4 for context/plan edges
- [ ] P3 cumulative score ≥ 87/100

---

## PHASE 4 — Execution Weave and Live Workflow Theater
**Sessions:** 2 · **Depends on:** P3

### Exact user-visible result

Approval visibly ignites the exact linked workflow. Real runs and steps light, flow, complete, fail, compensate, and settle inside the instruction’s causal space. There is no tenant-wide blueprint masquerading as active work.

### Source files

`panels/WorkflowTheater.tsx` · `bridge/ThreadBlocks.tsx` · `bridge/ThreadBridge.tsx` · `kernel/execution-presentation.ts` · `kernel/workflow-presentation.ts` · `lib/data-core.ts` · `lib/pulse-bus.ts` · `lib/EventFX.tsx` · workflow run/step API types

### Discovery

For one real action, map `instructionId → actionIds → commandId → workflowRunIds → workflowStepIds → receipts`. Record every event currently available and whether the production database has migration 0062. Do not modify backend architecture; record missing release configuration as a blocker.

### Ordered tasks

1. **P4.T1** Make active `actionIds` the mandatory scope for the in-thread Execution Weave; remove automatic blueprint/replay from the active path.
2. **P4.T2** Implement LF-09 only after the authoritative decision response and LF-10 only after a linked real run is observed.
3. **P4.T3** Implement LF-11/LF-12 for leased/completed steps using real events and current state; prevent duplicate impulses on poll/SSE reconciliation.
4. **P4.T4** Implement LF-13/LF-14 for failed, blocked, compensating, and compensated paths, with exact recovery/evidence linkage.
5. **P4.T5** Recompose desktop Weave as the optional right plane; tablet as an in-document plane; mobile as a vertical causal rail.
6. **P4.T6** Make node selection reveal real step evidence without losing the Thread; no raw JSON.
7. **P4.T7** Validate 1, 3, and 6 linked lanes, terminal partial counts, action/run races, and no-run trace outcomes.
8. **P4.T8** Measure six-lane FPS and event→pixel; remove/defer expensive non-active theater code until budgets pass.

### Evidence required

Real linked-workflow recording; mapping output; 1/3/6 lane screenshots at all widths; duplicate-event test; failure/compensation recording; FPS and event→pixel report; no blueprint in active path assertion.

### Rollback

The existing scoped `WorkflowTheater` remains the data renderer. New composition/motion must be removable without changing run control or APIs.

### Exit gate

- [ ] Approval → linked real workflow is visually causal
- [ ] Pending/leased/completed/failed/compensating/compensated/cancelled/escalated are distinct
- [ ] No active animation without a matching real run/step state
- [ ] No tenant-wide blueprint/replay on the active instruction path
- [ ] Six-lane execution ≥55 FPS p95
- [ ] Linked progress and terminal partial counts are truthful
- [ ] P4 cumulative score ≥ 92/100

---

## PHASE 5 — Decision, Evidence, Failure, and Recovery
**Sessions:** 1 · **Depends on:** P4

### Exact user-visible result

Approval feels consequential, receipts feel like proof, and failures feel recoverable rather than broken. The canvas visibly transfers focus from plan → decision → execution → verification → evidence.

### Source files

`bridge/ApprovalCockpit.tsx` · `bridge/approval-consequence.ts` · `bridge/ThreadVerification.tsx` · `bridge/RecoveryPanel.tsx` · `lib/ReceiptDrawer.tsx` · `lib/receipt-nav.ts` · `kernel/recovery.ts` · `kernel/execution-presentation.ts`

### Discovery

Record all real decision response variants, all receipt shapes, all failure kinds, available recovery operations, and which controls are currently inert/absent. Verify each consequence string against action payload and prediction data.

### Ordered tasks

1. **P5.T1** Implement LF-08 Gate Rise around the active instruction; consequence header names real blast radius, money, recipients, and policy only when known.
2. **P5.T2** Implement LF-09 decision feedback after server confirmation; failed decisions remain in place with exact reason and retry/escalation.
3. **P5.T3** Implement LF-15 Verification Converge and LF-16 Evidence Bloom from the same receipt updating in place.
4. **P5.T4** Make changed facts, tool outcomes, sandbox labels, policy/version, timing, and predicted↔actual legible without nested drawers or raw JSON.
5. **P5.T5** Implement LF-13/LF-17 recovery focus for every source-supported failure kind. Do not render an affordance without an operation.
6. **P5.T6** Make receipt anchors, “Copy receipt,” retry, correct, view, escalate, and setup links perform their literal promise.
7. **P5.T7** Verify approval and recovery on pointer, keyboard, touch, reduced motion, and refresh.

### Evidence required

Approval recording; before/after same-receipt evidence; all failure-kind screenshot grid; interaction tests for every visible control; copy-receipt assertion; source provenance; 1440/768/390.

### Rollback

Authority, decision endpoints, workflow controls, and receipt storage remain untouched. Presentation wraps existing operations.

### Exit gate

- [ ] Decision consequence is understandable before approval
- [ ] No success motion precedes authoritative response
- [ ] Same receipt grows from predicted to actual evidence
- [ ] Every visible recovery control works; unsupported controls do not render
- [ ] Failure and recovery are legible without motion or colour alone
- [ ] Receipt links/copy survive refresh
- [ ] P5 cumulative score ≥ 94/100

---

## PHASE 6 — Responsive Polish, Performance, and 95/100 Certification
**Sessions:** 1–2 · **Depends on:** P5

### Exact user-visible result

The complete `/jarvis` experience is polished, fast, accessible, responsive, production-tested, and honestly scored. Nothing is marked complete because it merely exists in source.

### Source files

All v4-touched files · `e2e/jarvis-*` relevant specs · `docs/jarvis-v4-certification-<date>.md` · build manifests · production `/jarvis`

### Ordered tasks

1. **P6.T1** Run the complete 390/768/1440 collision, safe-area, keyboard, zoom, focus, and one-thumb sweep; fix every severity-1/2 issue.
2. **P6.T2** Run reduced-motion and forced-colours/contrast checks; state recognition must survive without travel, glow, or colour alone.
3. **P6.T3** Reduce initial JS to ≤250 KB gzip and meet Lighthouse/CLS/input/FPS budgets without deleting meaningful interaction.
4. **P6.T4** Certify the eight v4 critical paths in §7.2 with real production-shaped data and explicit fixture labels where real external action is unsafe.
5. **P6.T5** Run the blind state-recognition review: audio muted and labels hidden; ≥90% correct across the eight modes.
6. **P6.T6** Score the seven categories with linked evidence; fix until ≥95 or report the exact lower score and blockers.
7. **P6.T7** Produce `docs/jarvis-v4-certification-<date>.md`, motion ledger, screenshots, recordings, metrics, and open-blocker list.
8. **P6.T8** Only after explicit user authorization: deploy, then repeat HTTP, console, viewport, voice, and one real safe workflow smoke against production.

### Evidence required

Full certification document; 5-run metrics; bundle report; eight path recordings; state-recognition result; console/network capture; production screenshots if deployment is authorized.

### Rollback

Deploy only a proven build. Preserve the previous production deployment reference and the current `/jarvis` route rollback path.

### Exit gate — definition of done

- [ ] Score ≥95/100 with every category ≥90% of its weight
- [ ] Eight critical paths green
- [ ] 390/768/1440 collision-free and keyboard-safe
- [ ] Reduced motion preserves every state and action
- [ ] Initial JS ≤250 KB gzip
- [ ] Lighthouse/FPS/CLS/input/event→pixel meet §5.4
- [ ] Zero unexpected console errors on certified paths
- [ ] Blind state recognition ≥90%
- [ ] No severity-1/2 defects open
- [ ] Production smoke green if deployment was authorized

---

# §7. CERTIFICATION

## 7.1 Weighted scorecard

| Category | Weight | Required |
|---|---:|---:|
| Spatial composition and hierarchy | 15 | ≥14 |
| State-coupled motion | 20 | ≥18 |
| Live workflow legibility | 20 | ≥18 |
| Voice and command tactility | 15 | ≥14 |
| Decision, consequence, and recovery | 15 | ≥14 |
| Visual craft and originality | 10 | ≥9 |
| Performance, accessibility, responsiveness | 5 | ≥5 |
| **TOTAL** | **100** | **≥95** |

Each point must link to visual/runtime evidence. A reviewer may lower a score when the evidence passes mechanically but the result still lacks hierarchy, clarity, or craft.

## 7.2 Eight critical paths

1. ready + first-run/degraded setup;
2. typed instruction through plan;
3. voice instruction with partial transcript and barge-in;
4. clarification and return to plan;
5. approval → 3+ lane real execution → receipt;
6. rejection/escalation and truthful stop;
7. step failure → recovery/compensation → evidence;
8. transport loss mid-run → truthful degraded posture → restore without duplicates.

Every path runs at 1440 and 390; paths 5, 7, and 8 also run at 768. Reduced-motion variants run for paths 3, 5, and 7.

---

# §8. SESSION LEDGER

```text
P1  LIVEFRAME shell + hierarchy                 1
P2  Presence Core + voice + command             1–2
P3  Action Spine choreography                   1
P4  Execution Weave + live workflows            2
P5  Decision + evidence + recovery              1
P6  responsive/perf/certification               1–2
                                                ───
TOTAL                                           7–9 focused sessions
```

P1–P3 must already make the product visibly different. P4 is the decisive “live system” phase. P5 removes the last toy-like decision/recovery seams. P6 proves the result rather than extending scope.

---

# §9. RISKS

| Risk | Mitigation | Rollback |
|---|---|---|
| Luna improvises visual details | exact LIVEFRAME modes, layout, motion IDs, copy, tasks, and evidence gates | stop task; record blocker; reread phase |
| Existing dirty work is overwritten | per-task diff audit; named files; no reset/cleanup | restore only executor-owned hunk with patch |
| More animation lowers clarity/perf | shared energy, two-loop cap, semantic glow, P4/P6 FPS gates | reduced/static posture per signature |
| Workflow animation is not truly linked | mandatory actionId→runId mapping; no blueprint on active path | truthful waiting/trace state |
| Migration 0062 absent in production | preflight verifies migration ledger and route behavior; poll/POST fallback remains labelled | disable SSE and keep truthful degraded transport |
| Voice cannot be device-tested | do not certify P2/P6 voice; preserve deterministic tests and record blocker | typed path remains complete |
| First-run hides backend capability gaps | compact Setup Rail + action-local blockers; no invented availability | show exact unavailable state |
| “95/100” becomes self-awarded marketing | weighted evidence, blind recognition, human review, explicit lower score when gates miss | do not ship claim |
| Visual snapshots bake in bad state | named production-shaped states; review before updating; never bulk-accept | retain previous baseline |

---

# §10. WHAT THE FINISHED PRODUCT FEELS LIKE

At rest, JARVIS feels present but calm. When the user touches the mic, the Orb and Dock become one responsive instrument. The exact phrase becomes a visible instruction. Context arrives from the field into the document. The plan draws itself from real actions. Approval creates tension because the consequence is clear. Permission sends one visible impulse into the exact workflow that starts. Current flows only through the leased step. Completion leaves evidence, not confetti. Failure fractures locally and offers one real recovery. Verification pulls the work into a receipt that becomes more truthful over time.

Nothing moves merely because the page is open. Everything important moves because the business state changed.

> **JARVIS is not a page with animations. It is the visible physics of the operating system.**

---

*Begin at Phase 1, Task 1. Record every result in `JARVIS-FRONTEND-MAESTRO-STATE-v4.md`. Do not execute product work from this planning session.*
