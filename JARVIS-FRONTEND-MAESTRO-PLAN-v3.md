# JARVIS FRONTEND MAESTRO PLAN — v3
## The Instruction Thread: a voice-native command product, shipped in 7 phases

**Authored:** 2026-07-29 · Opus 5 (audit + design session — no product code modified)
**Executed by:** Sonnet 5 (high). **Execution only. Every product, visual, and architecture decision is made below.**
**Baseline commit:** `c205cb6`
**State file:** `JARVIS-FRONTEND-MAESTRO-STATE-v3.md`
**Evidence appendix:** `JARVIS-FRONTEND-MAESTRO-PLAN.md` (v2) — its §1–§6 source audit remains valid and is cited, not repeated. Its *plan* (§19 phases) is superseded.

---

## WHY v3 EXISTS

v2 was a correct audit attached to the wrong plan. It delayed the compelling product to Phase 11, demanded legacy parity before proving anything, budgeted for 44 custom renderers and ~100 motion primitives, and specified the voice experience in one paragraph. v3 keeps every verified finding and inverts the order: **the product ships first, in Phase 2, on a real revenue workflow, with real voice.**

Three findings from this session's re-audit materially change the plan and were **not** in v2:

**NEW-1 · The browser voice session is architecturally incapable of acting.**
`useVapiSession.tsx:283` calls `vapi.start(VAPI_ASSISTANT_ID)` — a **web** call. The Vapi webhook resolves the caller via `callMeta?.customer?.number` (`webhooks/vapi/route.ts:188`), which a web call does not have. `identity` → `null` → `staffCtx` → `null` → every instruction hits the `if (!staffCtx)` branch: a handoff is created and the assistant replies *"I can't verify this line yet, so I can't make any changes."* **Today, talking to JARVIS in the browser can only ever produce a refusal.** §3 fixes this correctly and cheaply.

**NEW-2 · The voice OS is far more mature than v2 credited — on the phone path.**
`webhooks/vapi/route.ts` already implements `finnor_instruct` → `handleInstruction` with `sessionId: vapi:{callId}`, and `finnor_confirm` → spoken approval bound to **this session's** `pending_confirmations` rows (not "newest pending for the tenant"), with honest failure reporting. Short-term turn memory is written per session with a 30-minute TTL. **Follow-up references and spoken approval are solved problems — on the phone.** The browser needs an equivalent identity binding, which §3 specifies.

**NEW-3 · Invoice-to-Cash is the only workflow with a built-in prediction contract.**
`domain-plugins/invoice-to-cash/index.ts:55-72`'s `simulate()` returns a structured `predicted` object — `amountUsd`, `fieldChanges`, `steps`, `expectedResult`. Predicted-versus-actual, the sharpest moat asset, is **already implemented server-side for this one workflow**. It decides the golden journey (§1).

---

# §0. EXECUTION PROTOCOL

## 0.1 The executor's contract

**You are executing, not designing.** Every product decision, component boundary, state name, motion timing, microcopy string, colour and file path is fixed below. If you find yourself deciding what something should look like, say, or be called — **stop, you have gone off-plan.**

**You MAY decide only:** internal helper names inside a file you are writing; assertion order within a test; whether a 10-line pure helper is inline or a sibling file.

**You MUST NOT decide:** anything visual, any string a user reads, any state name, any file path, any dependency, any deletion, any timing value, any workflow scope.

**If the plan did not decide it:** write the question under `## BLOCKERS` in the state file, build the rest of the phase around it, report it. **Never improvise product or architecture.**

## 0.2 Anti-hallucination rules

1. The repository is the only source of truth. If this plan contradicts the source, the source wins — record it in the task's `Deviation:` slot and continue.
2. Never claim a route works unless you loaded it. Never claim a test passes unless you ran it and pasted output. Never write a count you did not derive from a command.
3. **Never fabricate business data, cognition, or activity.** No data → the designed truthful state (§6.7). Fixtures are legal only in `/jarvis/stage`, catalogs, and tests, and must render a visible `FIXTURE` label.
4. Never mark a task complete without pasted evidence. If you did part of a task, say which part.
5. **Never claim a voice capability §3.1 does not list as verified.**

## 0.3 Session loop

1. Read the state file top to bottom. 2. Go to `## NEXT EXACT TASK`. 3. `git rev-parse HEAD` must match `Latest verified commit`. 4. Read the phase's `Source files` in full. 5. Run `Discovery`, paste output. 6. Execute tasks in order. 7. Gather every required evidence type. 8. Update state: boxes + evidence + `Latest verified commit` + `NEXT EXACT TASK` + one session-log line. 9. Commit `jarvis-v3 P<n>.T<m>: <what>`. 10. If the exit gate is green, advance the phase.

## 0.4 Evidence types

| Kind | Counts as | Does not count |
|---|---|---|
| Source | `path:line`, or pasted command + output | "I read it" |
| Test | pasted command + full output | "tests pass" |
| Visual | screenshot in `qa-screenshots/v3-P<n>/`, **1440px and 390px** | a description |
| Runtime | pasted console list, network list, or measured ms | "no errors seen" |
| A11y | pasted axe output or keyboard transcript | "should be fine" |
| Perf | Lighthouse scores **with cache state stated**, or measured ms/fps | a bare score |

Perf is always **5 cold runs, headline the cold number, report median and worst.** v2 §0.4 proved why: the existing baseline spans perf 56→98 and TBT 1,460→30 ms across three runs of one page.

## 0.5 Resume after context loss

Read the state file → `git status` + `git diff HEAD` (uncommitted work is where you stopped) → re-read the current phase completely → re-run discovery and compare to the pasted output → resume at the first unchecked task. **Never restart a phase.** Checked boxes with evidence are trustworthy.

## 0.6 Hard rules

1. **Ship the product first.** The Bridge becomes the real experience in Phase 2 behind `/jarvis/next` + an owner flag. No phase may defer user-visible value to "later."
2. **No legacy parity requirement.** Legacy is preserved only where §7 lists it. Everything else stays at `/jarvis` untouched until Phase 6 flips the default.
3. **No new runtime dependency** except the two named in P1.T1.
4. **No number renders without a `Truth<T>` status** (§6.7). `?? 0` on network data is a lint error.
5. **Every motion is in the §5.3 table.** Not in the table → does not ship.
6. **Reduced motion never loses information.** Every cue has a specified static equivalent.
7. **≤ 2 ambient loops per viewport.**
8. **No raw JSON on any customer-facing surface.**
9. **Every phase leaves `/jarvis` and `/jarvis/next` both working.**
10. **Never widen scope to a fourth workflow or a renderer outside §7.2.**

---

# §1. GOLDEN WORKFLOW SELECTION

## 1.1 The decision

**GOLDEN: Invoice-to-Cash — "collect the money we're owed."**
Spoken form: *"JARVIS, chase everyone who's more than thirty days overdue."*

## 1.2 Scored against the five criteria

| Criterion | Invoice-to-Cash **(chosen)** | Lead → Water Test | Proposal → Installation |
|---|---|---|---|
| **1. Value to a 20–50 person water co.** | **Highest.** AR collection is the #1 cash lever; overdue receivables are a daily, quantified pain with an owner who already knows the number. | High — books revenue, but future cash. | High but rare; a multi-week arc. |
| **2. Backend maturity** | **Highest.** 212 lines; 3 workflow steps (`create_payment_link` → `send_message` → `sync_invoice`) **plus** payment webhook + reconciliation; idempotent by `invoiceId`; `dry_run`; duplicate detection; typed failure kinds; Stripe tool + honest sandbox fallback. | Moderate. 3 steps (`hold_appointment` → `send_confirmation_call` → `confirm_appointment`); depends on capacity data + outbound voice. | 5 steps but depends on signed proposals **and** procurement — cannot run clean. |
| **3. Real frontend consequences** | **Most, and most legible.** Overdue KPI ↓, Collected KPI ↑, invoice rows change status, `cash-collections` read-model recomputes, comms feed gains rows, activity gains events, workflow theater runs 3 steps ×N, receipt, **and later the payment webhook flips actual vs predicted.** | Map + technician + appointment surfaces. Good, but fewer money surfaces. | Inventory + work orders; slowest to observe. |
| **4. Sales-demo impact** | **Highest.** One sentence → a list of real debtors with real dollars → an approval that names the blast radius → links sent → a receipt. Then minutes later a webhook lands and the receipt turns green. Nothing else in the codebase closes a loop with external ground truth. | Strong, industry-flavoured. | Weak in a demo window. |
| **5. Runs without fabricated data** | **Yes.** `invoices` is seeded; `cashCollections` read-model already exists and is already polled. If Stripe/QuickBooks are unconfigured, `packages/tools/src/sandbox.ts` writes real DB rows to `sandbox_outbox` — a **truthfully labelable** path, not a fake one. | Yes, if technicians/capacity seeded. | No — needs signed proposals. |

**The tiebreaker is NEW-3.** `invoice-to-cash`'s `simulate()` already returns `{amountUsd, fieldChanges, steps, expectedResult}`. It is the only plugin that hands the frontend a real prediction to verify against a real outcome. Predicted-versus-actual is the moat; this workflow is the only one where it is honest on day one.

## 1.3 The two secondary flagships

**FLAGSHIP B — Lead → Water Test → Dispatch.** *"Book a water test for the Hendersons this week and give it to whoever's closest."*
Chosen for: the water-treatment ontology (the actual moat), and because it lights up an entirely different surface set — scheduling, technician capacity, the dispatch map, My Day. Backend: `start_water_test_workflow` + `assign_technician_to_visit`.

**FLAGSHIP C — Bulk Customer Notification.** *"Tell every customer on a softener plan that we're doing free hardness checks next month."*
Chosen for one reason no other workflow provides: **blast radius**. It is the only action where approval must communicate *"this will message 47 real people"* — the strongest possible demonstration that approvals are real and enforceable, plus it exercises quiet-hours and policy interaction. Backend: `bulk_notify_existing_customers`.

**Not chosen, and not to be added:** proposal-to-installation, procurement, ads, web research, compliance docs. §7.2 caps the renderer work.

---

# §2. THE PRODUCT EXPERIENCE CONTRACT

## 2.1 The one sentence

> You tell JARVIS what you want; you watch it understand the real business, ask when uncertain, propose the work, wait for permission, execute it and prove exactly what changed.

## 2.2 The central design decision — **The Instruction Thread**

JARVIS is **not** a dashboard, and **not** a chat window. It is **one vertical thread down which an instruction writes itself into a document.**

An instruction never navigates away. It **expands in place**, downward, through six blocks. The user watches a record of the work being composed in real time, and at the end that same object *is* the receipt.

```
        ╔═ FIELD ══════════════ depth 0 · ambient, data-driven, ≤2 loops ═╗
        ║                                                                ║
        ║      ORB          ┌──────────────────────────────────┐         ║
        ║     (docked,      │  ① HEARD                         │         ║
        ║      64px,        │  ② UNDERSTOOD  (context)         │         ║
        ║      presence)    │  ③ PLAN        (+ policy)        │  depth 1║
        ║                   │  ④ APPROVAL    (rises to depth 2)│  THREAD ║
        ║                   │  ⑤ EXECUTION   (live steps)      │  720px  ║
        ║                   │  ⑥ RECEIPT     (predicted↔actual)│         ║
        ║                   └──────────────────────────────────┘         ║
        ║                                                                ║
        ╚═ COMMAND RAIL ═ pinned, always focusable, / · ⌘K · push-to-talk ╝
```

**Why this beats a dashboard:** the causal chain is *spatially literal*. Context is above the plan because it produced the plan. Approval sits between plan and execution because it gates it. The receipt is the bottom of the same object, so "what did it do" and "what did it promise" are one scroll apart, permanently.

**Blocks never disappear.** They collapse to a 40 px summary row when the next block opens, and re-expand on click. A completed thread is a scrollable audit trail. Threads stack newest-first; older threads collapse to a single row.

## 2.3 Depths

| Depth | What | Rules |
|---|---|---|
| **0 · Field** | The tenant's operational state as ambient backdrop. **Not decorative.** Renders real overdue invoices as points in a slow drift — warmer and larger with age. Empty business → empty field, honestly. | ≤ 2 loops. Opacity 0.10–0.22. Never carries a number. Disabled in low-power. |
| **1 · Thread** | The instruction document. `max-width: 720px`, centred. | One active thread expanded at a time. |
| **2 · Cockpit** | Approval only. Rises from the plan block, `backdrop-filter: blur(20px)`, dims depth 0–1 to 35 %. | Only approvals and receipt-evidence may occupy depth 2. Nothing else. |

## 2.4 What we are explicitly not building

No KPI grid on the command path. No 13-item sidebar. No card wall. No second data island. No page navigation during an instruction. Ops metrics live behind one deliberate `⌘K → Ops` destination and are never the landing surface.

---

# §3. VOICE FEASIBILITY — VERIFIED, NOT PROMISED

Everything in §3.1 was verified this session against `node_modules/@vapi-ai/web/dist/vapi.d.ts` (v2.6.1), `src/components/jarvis/lib/useVapiSession.tsx`, and `finnor-os/apps/api/app/api/webhooks/vapi/route.ts`. Everything in §3.3 is verified **absent**.

## 3.1 Verified available — LAUNCH CRITICAL

| # | Capability | Verified how | Status today |
|---|---|---|---|
| **V1** | **Partial (interim) transcripts** | Vapi `message` events carry `transcriptType`; `useVapiSession.tsx:200` filters `transcriptType === "final"` | **Available and currently discarded.** Free win. |
| **V2** | Final user transcript | same handler | working |
| **V3** | **JARVIS speaks arbitrary text mid-session** | `SayMessage { type:'say', message, interruptionsEnabled?, interruptAssistantEnabled? }` in `vapi.d.ts` | supported, unused |
| **V4** | **Barge-in / interruption** | server-side VAD + `speech-start`/`speech-end` events + `SayMessage.interruptionsEnabled` | supported, unused |
| **V5** | Mute / duck the assistant | `ControlMessages { control: 'mute-assistant' \| 'unmute-assistant' }` | supported, unused |
| **V6** | Inject context into the conversation | `AddMessageMessage { type:'add-message', message, triggerResponseEnabled? }` | supported, unused |
| **V7** | Real user-mic level (not assistant level) | `local-volume-level` event; already used by the mic watchdog | working |
| **V8** | **Follow-up references ("move that one")** | backend writes turn memory scoped to `sessionId`, 30-min TTL (`orchestration/src/index.ts`); `SubmitInstructionSchema` accepts `sessionId` | **backend ready; the frontend never sends `sessionId`** — `CommandBar.tsx:51` posts `{instruction}` only. Gap closed in P3. |
| **V9** | Persistent conversational thread | `voice_sessions` table (`active`/`ended`), `appendVoiceTurn` | exists, phone path only |

## 3.2 The browser-voice architecture decision — **binding**

**Verified problem (NEW-1):** a browser web call has no `customer.number`, so the webhook's identity resolution yields `null`, `staffCtx` is `null`, and every instruction is refused with a handoff.

**DECISION: the browser Vapi session is a transcription and speech surface. It never authorizes and never executes.**

```
 mic ──► Vapi web call ──► transcript events (partial + final)
                                    │
                                    ▼
                    submitInstruction(text, {source:"voice", sessionId})
                                    │
                    POST /api/actions  ── caller's own Supabase bearer ──►  backend
                                    │                                        (requireContext
                                    ▼                                         is the authority)
                    kernel state ──► Thread renders ──► vapi.send({type:"say", …})
```

**Why this and not the alternatives:**
- Passing `tenantId`/`userId` via `assistantOverrides.metadata` (which the SDK *does* support) is **client-supplied and therefore unusable for authorization**. Rejected.
- Building a signed web-session binding into the webhook is real work with a real auth surface, and it buys nothing at launch because the browser user is **already authenticated over HTTP**. Deferred to §3.3-D1.
- This choice also satisfies a rule we want anyway: **voice and text are one code path.** A voice instruction and a typed instruction are byte-identical from `submitInstruction` onward. That is why the golden journey works the same in both modes and why we only test one lifecycle.

**The phone path is untouched.** `finnor_instruct` / `finnor_confirm` / `pending_confirmations` keep working exactly as they do. Do not modify `webhooks/vapi/route.ts` in Phases 1–6.

**Configuration task (P2.T2):** the web assistant must not advertise `finnor_instruct`, or its refusal will be spoken over our own flow. If the web assistant ID is shared with the phone assistant, P2.T2 creates a **separate web assistant** whose only job is transcription + TTS, and puts its id in `NEXT_PUBLIC_VAPI_WEB_ASSISTANT_ID`. Verify before assuming they are shared.

## 3.3 Verified NOT available — do not promise, do not build

| # | Thing | Why not | Earliest |
|---|---|---|---|
| **D1** | **Spoken approval in the browser** | Enforceable spoken approval requires a `pending_confirmations` row bound to a *voice session with a resolved identity*. A web call has no resolvable identity (NEW-1). Approving by voice without that binding would be an unenforceable approval — the exact thing §6.6 forbids. | Phase 5 designs the signed binding; ships no earlier than post-certification. **Launch: approval is a deliberate physical act.** This is also better product. |
| **D2** | Word-level transcript timing | Vapi `message` payloads carry no per-word timestamps (verified in the handler's message shape). | never, without a provider change |
| **D3** | Guaranteed "tools run while JARVIS keeps talking" | `add-message` + `say` make it *possible*, but the SDK exposes no ordering or completion guarantee between a `say` and an in-flight HTTP action. | Phase 5 pilots it as **best-effort narration**, explicitly labelled, never as a guarantee |
| **D4** | Client-side hold / resume | absent from `VapiEventNames` and `ControlMessages` | never, without an SDK change |
| **D5** | Speaker diarisation beyond `role` | not provided | never |

## 3.4 Launch voice behaviour — exactly this, nothing more

1. **Press-to-talk** on the Command Rail (`Space` held, or click). Mic opens; Orb → `listening`.
2. **Partial transcript streams into the rail input** in `--j-text-dim`, italic, replacing on each update (V1).
3. **On final transcript**, the text solidifies to `--j-text`, the rail plays `commit`, and `submitInstruction(text, {source:"voice", sessionId})` fires (V2, V8).
4. **JARVIS speaks two things and only two things** (V3): (a) the one-line plan summary when the plan is ready — *"I found 6 invoices over thirty days, totalling four thousand two hundred dollars. Want me to send payment links?"*; (b) the outcome when the thread reaches its receipt — *"Six links sent. I'll tell you as they're paid."*
5. **Barge-in** (V4): the user speaking cancels any queued `say` and returns the Orb to `listening`. `interruptionsEnabled: true` on every `say`.
6. **Approval is never spoken** at launch. When the plan needs approval, JARVIS says the summary and the Approval Cockpit rises. The user approves by click, `Enter`, or tap. If the user *says* "yes", JARVIS replies: *"I need you to approve that one on screen — it moves money."* (literal string).

---

# §4. CANONICAL STATE — the kernel

Carried from v2 §7 with three changes noted. **Do not rename anything.**

## 4.1 Location

`src/components/jarvis/kernel/` — `types.ts` · `machine.ts` · `store.tsx` · `selectors.ts` · `presence.ts` · `choreography.ts` · `instruction.ts` · `transport.ts` · `index.ts`

**The kernel wraps `lib/data-core.ts`; it never replaces it.** `data-core` stays the lane runner (4 s/8 s/30 s/60 s, ring-buffer diffing at `data-core.ts:435-467`). The kernel owns interpretation. This is the strangler seam and it is why P2 is low-risk.

## 4.2 `Truth<T>` — retained verbatim from v2 §7.2

```ts
export type TruthSource =
  | "api:stats" | "api:actions-pending" | "api:workflow-runs" | "api:read-model"
  | "api:activity" | "api:receipts" | "api:instruction" | "derived" | "fixture"

export type Truth<T> =
  | { status: "known";       value: T; source: TruthSource; atMs: number }
  | { status: "stale";       value: T; source: TruthSource; atMs: number; ageMs: number }
  | { status: "partial";     value: T; source: TruthSource; atMs: number; capped: number }
  | { status: "unknown";     reason: "loading" | "never-fetched" }
  | { status: "denied";      reason: "signed-out" | "role" }
  | { status: "unavailable"; reason: "network" | "server" | "not-configured"; sinceMs: number }
```

## 4.3 Entity states — copied byte-for-byte from `finnor-os/packages/db/schema.ts`

```ts
export type ActionState =   // schema.ts:193
  | "draft" | "pending" | "approved" | "rejected" | "executing"
  | "completed" | "failed" | "needs_human_review" | "blocked_integration_unavailable"
export type RunState =      // schema.ts:921
  | "running" | "completed" | "failed" | "compensating" | "compensated"
  | "paused" | "cancelled" | "escalated"
export type StepState =     // schema.ts:943
  | "pending" | "leased" | "completed" | "failed" | "compensating" | "compensated"
export type JobState =      // schema.ts:345
  | "queued" | "running" | "completed" | "failed" | "dead_letter"
```

## 4.4 `InstructionState` — 12 values (v2 had 15; **three merged**)

```ts
export type InstructionState =
  | "idle" | "captured" | "understanding" | "planning" | "clarifying"
  | "awaiting_approval" | "executing" | "verifying"
  | "completed" | "partial" | "failed" | "cancelled"
```

**Changes from v2, deliberate:** `acknowledged`+`retrieving_context` → **`understanding`** (the user cannot perceive the difference and the Thread renders one block for both); `plan_ready`+`awaiting_approval` → **`awaiting_approval`** (an ungated plan goes straight to `executing`, so `plan_ready` was never observable); `dispatching` folded into `executing`.

**Transitions — binding. Unlisted pairs are a no-op + dev warning, never a crash.**

| From | Event | To |
|---|---|---|
| `idle` | `SUBMITTED` | `captured` |
| `captured` | `ACK` | `understanding` |
| `captured` | `SUBMIT_FAILED` | `failed` |
| `understanding` | `TRACE_planning` | `planning` |
| `planning` | `TRACE_clarification` | `clarifying` |
| `planning` | `ACTION_pending` ≥1 | `awaiting_approval` |
| `planning` | `ACTION_executing`, 0 gated | `executing` |
| `planning` | `TRACE_failed` \| `PLAN_EMPTY` | `failed` |
| `clarifying` | `ANSWERED` | `captured` (same thread, new turn) |
| `clarifying` \| `awaiting_approval` | `USER_CANCELLED` | `cancelled` |
| `awaiting_approval` | all decided, ≥1 approved | `executing` |
| `awaiting_approval` | all rejected | `cancelled` |
| `executing` | `TRACE_verifying` | `verifying` |
| `executing` \| `verifying` | all terminal, all ok | `completed` |
| `executing` \| `verifying` | all terminal, mixed | `partial` |
| `executing` \| `verifying` | all terminal, none ok | `failed` |
| `executing` | `ACTION_needs_human_review` \| `RUN_escalated` | `awaiting_approval` |
| any | `RESET` | `idle` |

## 4.5 `Presence` — the Orb's only input

```ts
export type Presence =
  | "dormant" | "listening" | "hearing" | "thinking" | "asking"
  | "proposing" | "working" | "verifying" | "resolved" | "wounded"
  | "obstructed" | "severed"
```

**Derivation order — first match wins:**
1. `transport === "offline" | "degraded"` → `severed`
2. active instruction non-terminal → map: `captured|understanding|planning`→`thinking` · `clarifying`→`asking` · `awaiting_approval`→`proposing` · `executing`→`working` · `verifying`→`verifying` · terminal-ok→`resolved` (4 s decay) · terminal-fail→`wounded`
3. voice: user speaking→`hearing`, mic open→`listening`
4. `blocked > 0 || needsHumanReview > 0` → `obstructed`
5. else → `dormant`

**No component computes presence.** `useKernel().presence` is the sole source. This structurally kills v2's C-13 (the Orb currently reads `voiceState === "connecting"` as "planning" — `Bridge.tsx:73-88`).

## 4.6 Ordering, dedup, restore, optimism

Dedup key `entityType:entityId:seq`, 500-entry LRU. Strictly increasing `seq` per entity; lower or equal → drop. `seq > last+1` → mark `stale`, refetch that entity, **never guess intermediate states**. On mount and on every transport→`live`, refetch the snapshot **before** applying stream events; buffer arrivals and replay filtered by `seq`. Optimistic UI: **only** `approve`, `reject`, `submit`; 6 s ceiling; server always wins; on expiry → `Truth.unknown`.

## 4.7 One fact, one selector

`kernel/selectors.ts` is the only module that produces a displayed fact. Every selector returns `Truth<T>`. **ESLint bans `useJarvis()` outside `kernel/` and bans `?? 0` on network values** (P1.T4).

Golden-journey selectors: `selectOverdueInvoices` · `selectCollectedUsd` · `selectPendingApprovals` · `selectRunsInFlight` · `selectThread(id)` · `selectPresence` · `selectConnection`.

`selectPendingApprovals` resolves v2's C-03 (unbounded `stats.pending` vs `.limit(100)` list): equal → `known`; list at 100 → `partial{capped:100}` rendered as **"100 of 137"**; disagreement below cap → `known` from `/api/stats` (the authority) + dev warning naming both.

---

# §5. THE DESIGN SYSTEM — specific values, not principles

## 5.1 Type — 6 tokens, nothing else. Nothing below 11 px ships.

| Token | px / line-height / weight / tracking | Use |
|---|---|---|
| `--j-fs-micro` | 11 / 1.4 / 700 / 0.14em uppercase | block labels, chips |
| `--j-fs-sm` | 12.5 / 1.5 / 500 / 0 | secondary body, table cells |
| `--j-fs-base` | 14 / 1.55 / 400 / 0 | body, transcript |
| `--j-fs-lg` | 17 / 1.4 / 700 / -0.01em | block titles |
| `--j-fs-xl` | 22 / 1.25 / 800 / -0.02em | the instruction echo |
| `--j-fs-display` | 34 / 1.05 / 800 / -0.03em · `tabular-nums` | the one money number per block |

v2 §6.6 verified a 13-step ad-hoc ramp from `text-[8px]` upward. P6.T5 sweeps it.

## 5.2 Colour semantics — binding

| Token | Means | Never |
|---|---|---|
| `--j-cyan` | JARVIS presence / attention | success |
| `--j-green` | verified success, cash collected | in-progress |
| `--j-amber` | degraded, partial, awaiting human | failure |
| `--j-red` | failure, overdue, destructive | warning |
| `--j-violet` | cognition — understanding & planning only | execution |
| `--j-blue` | execution in flight | idle |

Field (depth 0) colours are **not** semantic and never encode state.

Spacing: 4 base. Allowed **4, 8, 12, 16, 24, 32, 48**. Nothing else.
Surfaces: `j-panel` · `j-panel-hot` (active) · `j-chip`. Blur only on depth 2 and the rail.

## 5.3 MOTION — the complete signature set

**18 named motions. This is the entire vocabulary. Nothing else ships.** Each is a real spec: transform, duration, easing, and the static equivalent that carries the same information under `prefers-reduced-motion`.

`EASE_OUT = cubic-bezier(0.22, 1, 0.36, 1)` · `EASE_SPRING = cubic-bezier(0.34, 1.56, 0.64, 1)` · `EASE_IO = cubic-bezier(0.65, 0, 0.35, 1)`

| # | Name | Fires on | Spec | Reduced-motion equivalent |
|---|---|---|---|---|
| M1 | **RailCommit** | final transcript / Enter | rail border `1px→2px`, cyan sweep L→R 320 ms `EASE_OUT`; input text `opacity .55→1`, `italic→normal`, 180 ms | border goes solid cyan instantly |
| M2 | **ThreadBirth** | `captured` | new thread block `translateY(14px)→0`, `opacity 0→1`, `scaleY .96→1` (origin top), 420 ms `EASE_OUT` | block appears, no transform |
| M3 | **EchoResolve** | `ACK` | instruction text renders char-scrambled → resolved L→R over 520 ms, 24 ms/char cap (reuse `ui/fx/DecryptText.tsx`) | plain text, no scramble |
| M4 | **ContextGather** | `understanding` | each real context chip flies from a random field point (depth 0) to its slot: 380 ms `EASE_OUT`, staggered 60 ms, `scale .8→1` | chips fade in, staggered 60 ms |
| M5 | **PlanDraw** | each `action_created` | node `scale 0→1` 260 ms `EASE_SPRING`; connecting edge `stroke-dashoffset` 100→0 over 340 ms `EASE_IO` | node + solid edge appear |
| M6 | **PolicyClamp** | plan requires approval | a 2 px amber bracket draws down the plan block's left edge, top→bottom, 300 ms `EASE_IO`; block shifts right 4 px | static amber left border |
| M7 | **CockpitRise** | `awaiting_approval` | depth 2 panel `translateY(24px)→0` + `blur(0→20px)` backdrop, 380 ms `EASE_OUT`; depths 0–1 → `opacity .35`, `scale .99` | panel appears; backdrop dims instantly |
| M8 | **BlastRadius** | cockpit opens for a multi-entity action | the count (e.g. `47`) counts up 0→N over 520 ms `EASE_OUT`, and N dots bloom outward from it, 24 ms stagger, capped at 60 rendered | number renders final; dots static |
| M9 | **StampApprove** | approve accepted | stamp `scale 1.6→1` + `rotate -8°→0` 240 ms `EASE_SPRING`, green ink bleeds outward 180 ms | green "Approved" chip appears |
| M10 | **ShatterReject** | reject accepted | card splits into 6 slices, `translateY` 0→18 px with 30 ms stagger, `opacity→0`, 280 ms `EASE_IO` | card fades out 160 ms |
| M11 | **LiquidFill** | step `leased` | step bar fills L→R at the real elapsed/expected ratio; a 2 px leading meniscus at 1.4× brightness; continuous, capped 96 % until `completed` | determinate bar + `"step 2 of 3"` text |
| M12 | **StepSpark** | step `completed` | a 6 px light travels the edge to the next node, 300 ms `EASE_IO`, then the node's ring closes clockwise 240 ms | edge and ring go solid green |
| M13 | **DrainBack** | run `compensating` | `LiquidFill` reverses at 1.6× speed, hue → amber | amber bar + `"Rolling back"` |
| M14 | **FaultShake** | step `failed` | node `translateX ±3px` ×3 over 180 ms, then a red bloom `scale 1→1.8, opacity .5→0` 420 ms | red node + reason text |
| M15 | **ReceiptSeal** | terminal success | receipt block's top edge draws a 1 px green line L→R 400 ms, then a wax-seal dot `scale 0→1` `EASE_SPRING` 260 ms | green top border + seal dot |
| M16 | **TruthReveal** | predicted↔actual arrives | predicted column holds; actual column slides in from `x:12px` 320 ms; matching rows pulse green once (140 ms), differing rows pulse amber and stay outlined | two static columns; diffs outlined |
| M17 | **FieldWarm** | overdue total changes | field points re-target over 900 ms `EASE_IO`; warmth = age | points re-render at new positions |
| M18 | **Relight** | transport `degraded → live` | a 1-shot cyan sweep crosses the viewport L→R over 700 ms at `opacity .12` | fog clears instantly |

**Intensity** `0|1|2|3` from **risk tier and blast radius, never aesthetics.** 0 = reduced-motion/low-power → the static column above. 1 = routine (step done). 2 = consequential (approval, terminal). 3 = critical (failure, escalation, compensation).

**Budget:** ambient loops ≤ 2 per viewport (the Field counts as 1; `LiquidFill` while a run is live counts as the 2nd). Everything else is a one-shot that settles.

## 5.4 Sound — 7 cues, default muted

`sound.ts` already exposes `sfx`, `setMuted`, `setVoiceLive`, `eventPingThrottled`. Extend, do not replace.

| Cue | When | Character |
|---|---|---|
| `commit` | M1 | one soft rising two-note |
| `think` | `understanding` begins | a single low tick, then silence |
| `propose` | cockpit rises | two-note rising, brighter |
| `approve` | M9 | warm resolved third |
| `reject` | M10 | falling minor second |
| `step` | M12 | short high tick, ≤ 1 per 400 ms |
| `seal` | M15 | low resolved chord, 600 ms |

Rules: default muted; pitch encodes outcome (rising = good, falling = bad); master ducks −6 dB while voice is live (already implemented — keep); **max one cue per 400 ms, throttle and drop, never queue**; quiet hours suppress intensity ≥ 2.

## 5.5 Truth grammar — how a non-`known` value renders

| `Truth.status` | Component | Exact copy |
|---|---|---|
| `unknown:loading` | `SkeletonStat` | — |
| `unknown:never-fetched` | `EmptyState` | "Nothing here yet." + the action that creates one |
| `denied:signed-out` | `PermissionVeil` | "Sign in to see this." |
| `denied:role` | `PermissionVeil` | "Your role doesn't include this." |
| `unavailable:network` | `ErrorState` | "Can't reach JARVIS." + Retry + last-known age |
| `unavailable:not-configured` | `EmptyState` amber | "Not connected yet." + setup link |
| `stale` | `StaleFog` over the value | "Last confirmed 2m ago" |
| `partial` | value + chip | "100 of 137 shown" |

**A number never renders for any other status.** This makes v2's C-01 (401s rendering as confident `$0` with sparklines, verified live on production) structurally impossible.

---

# §6. THE GOLDEN JOURNEY — state by state

Every state below specifies all thirteen required dimensions. **Microcopy in quotes is literal — ship exactly those strings.**

Scenario used throughout: owner says *"Chase everyone more than thirty days overdue."* Real tenant data: 6 overdue invoices, $4,200 total.

---

## ⓪ REST — `presence: dormant`

**Desktop (1440):** Field at depth 0. Thread column empty except a single centred prompt at 38 % viewport height. Orb docked left of the thread at `top: 96px`, 64 px. Command Rail pinned bottom, 720 px wide, centred, 56 px tall.
**Mobile (390):** identical, Orb 44 px above the rail; rail full-width minus 16 px, bottom-safe-area inset.
**Primary focus:** the rail. It is auto-focused on mount (desktop only).
**Real data:** one line beneath the prompt, from `selectOverdueInvoices` + `selectPendingApprovals`, rendered only when `known`: `"6 invoices overdue · $4,200 · 2 approvals waiting"`. If either is not `known`, that segment is omitted entirely — never zeroed.
**Interaction & microcopy:** rail placeholder `"Tell JARVIS what you need"`. Below rail, `--j-fs-micro`: `"/ to type · hold Space to talk · ⌘K for anything else"`.
**Voice:** idle. Mic closed.
**Orb:** `dormant` — 22 % energy, 0.05 spin, `--j-cyan` at 40 % saturation. Breathes at 0.25 Hz (ambient loop #1 when the Field is disabled).
**Motion:** M17 FieldWarm on any overdue change.
**Sound:** none.
**Approval:** n/a.
**Surfaces:** Field, rail, Orb.
**Failure:** if `selectOverdueInvoices` is `unavailable`, the line is replaced by `ErrorState` inline: `"Can't reach JARVIS."` + Retry.
**Proof of real:** the overdue count and dollar total come from `read-models/cash-collections`, the same source the Invoices scene uses. Hovering shows `"from cash-collections · 4s ago"`.

---

## ① HEARD — `captured` · `presence: hearing → thinking`

**Desktop:** thread block #1 births at the top of the column. Height 76 px. Contains the instruction text at `--j-fs-xl`, and a right-aligned source chip: `VOICE` or `TYPED`.
**Mobile:** identical, `--j-fs-lg`.
**Primary focus:** the instruction text.
**Real data:** the transcript verbatim. Nothing else.
**Interaction:** a `Cancel` ghost button appears at 800 ms, right-aligned. Microcopy: `"Cancel"`.
**Voice:** while speaking, the partial transcript streams into the **rail** (italic, dim). On final, it leaves the rail and becomes this block. The rail clears to placeholder.
**Orb:** `hearing` while the user speaks — energy scales with `local-volume-level` (V7), real amplitude only, never synthesised. Then `thinking`: violet, energy 0.8, spin 0.55.
**Motion:** M1 RailCommit → M2 ThreadBirth → M3 EchoResolve.
**Sound:** `commit`.
**Approval:** n/a.
**Surfaces:** rail (clears), thread (gains block), Orb.
**Failure:** POST fails → block turns amber, text `"I couldn't send that."` + `Retry` + `Copy text`. The typed text is never lost.
**Proof of real:** the block carries the server-assigned `instructionId` in a hover tooltip once `ACK` lands.

---

## ② UNDERSTOOD — `understanding` · `presence: thinking`

**Desktop:** block #2 opens beneath #1. Label `WHAT I LOOKED AT`. Contains **real context chips** in a 3-column grid, each: an icon, a count, a source label.
**Mobile:** 2-column grid, chips 44 px tall.
**Primary focus:** the chips.
**Real data — every chip is a real retrieved fact from `instruction_events.context_retrieved`:**
`"6 overdue invoices · cash-collections"` · `"$4,200 outstanding · invoices"` · `"6 households · households"` · `"payment links: Stripe sandbox · integrations"`.
**Never render a chip without a source label. Never render a chip the backend did not send.** If zero chips arrive, render `EmptyState`: `"I didn't need any business context for this one."`
**Interaction:** chips are clickable → open the underlying list at depth 2. Hover shows the exact query age.
**Voice:** silent. JARVIS does not narrate this step — it is faster than speech.
**Orb:** `thinking`.
**Motion:** M4 ContextGather — chips fly in from real Field points. This is the moment the ambient backdrop pays off: the user sees context being *drawn out of their business*.
**Sound:** `think`, once.
**Approval:** n/a.
**Surfaces:** thread, Field (points that were used flare 140 ms).
**Failure:** if `context_retrieved` never arrives within 4 s, the block shows `"Still gathering context…"` with a skeleton, and never fabricates chips.
**Proof of real:** each chip's tooltip names the read-model and the row count it came from.

---

## ③ PLAN — `planning` · `presence: thinking → proposing`

**Desktop:** block #3, label `WHAT I'LL DO`. A vertical DAG: one node per action, drawn as they arrive. Each node: action label, the target entity, the money at stake. Below the DAG, the policy line.
**Mobile:** the DAG is a vertical list; edges become 2 px left connectors.
**Primary focus:** the node list, then the policy line.
**Real data:** one node per real `domain_action`. For the golden journey, 6 nodes:
`"Send payment link · Henderson · $890"` … Each node shows its `actionType` in human form, the household, and the amount from the real payload.
Policy line, literal: `"Every one of these needs your approval — policy invoice_to_cash v3 requires it for anything that moves money."` The policy id and version come from the action's real `policyId`/`policyVersion`; **if version is 0, the copy changes to** `"No policy is configured for this yet, so I'm defaulting to asking you."` (v2 verified `defaultPolicy()` returns version 0 for unconfigured — never present that as a real policy).
**Interaction:** each node expands on click to show the full grounded payload as a designed field list — **never raw JSON**.
**Voice:** JARVIS speaks the summary here (V3): `"I found 6 invoices over thirty days, totalling four thousand two hundred dollars. Want me to send payment links?"` `interruptionsEnabled: true`.
**Orb:** `thinking` → `proposing` (cyan, energy 0.6, slow deliberate spin) the instant the last node lands.
**Motion:** M5 PlanDraw per node (260 ms stagger 80 ms), then M6 PolicyClamp.
**Sound:** none during draw; `propose` on the clamp.
**Approval:** not yet — this block only *declares* that approval is required.
**Surfaces:** thread, Orb, rail (disabled with `"JARVIS is planning…"`).
**Failure:** plan returns 0 actions → block renders `"I couldn't turn that into anything I can do."` + the literal suggestion `"Try naming a customer, an invoice, or a time window."` Thread → `failed`. **Never a spinner that never ends.**
**Proof of real:** every node deep-links to its `domain_action` row; the policy chip deep-links to the policy.

---

## ④ CLARIFY — `clarifying` · `presence: asking` *(conditional)*

Entered when the planner returns `clarification_request`. v2 verified this is emitted by design (`planner.ts:80`) and that the frontend has **zero** references to it — it currently renders as an amber "unmapped action type" card the user must Approve or Reject. **That is the single worst bug in the product and this block is its fix.**

**Desktop:** block #3 is *replaced* (not appended) by the clarify block. Label `I NEED ONE THING`. The question at `--j-fs-lg`. Beneath it, one input per `missingFields`. Beneath that, a disclosure: `"Why I'm asking"`.
**Mobile:** identical; inputs 48 px tall; the first is autofocused.
**Primary focus:** the first input, autofocused, on both platforms.
**Real data:** `question`, `missingFields`, `context` from the real action payload.
**Interaction:** buttons are **`Answer` · `Skip` · `Cancel`**. **There is no Approve and no Reject.** `Enter` submits. Answering POSTs a new instruction with `parentInstructionId`; the thread continues in place — no new thread is born.
**Voice:** JARVIS speaks the question verbatim (V3). If the user answers by voice, the transcript fills the first input and requires an explicit `Answer` press — because a mis-transcribed answer must not silently become a plan.
**Orb:** `asking` — amber, energy 0.45, a slow single pulse at 0.5 Hz. Distinct from every other state.
**Motion:** the plan block collapses (M2 reversed, 240 ms), clarify block births with M2.
**Sound:** `propose` at lower pitch.
**Approval:** **a clarification must never count toward `selectPendingApprovals`.** Unit-tested in P2.
**Surfaces:** thread, Orb, rail (placeholder becomes `"Answer above, or ask something else"`).
**Failure:** answer POST fails → inline error, inputs preserved.
**Proof of real:** the question string is the backend's, unedited.

---

## ⑤ APPROVAL — `awaiting_approval` · `presence: proposing`

**Desktop:** the Approval Cockpit rises to **depth 2**, anchored to the plan block. Width 760 px. Header: the blast radius. Body: one card per action, keyboard-navigable. Footer: the decision bar.
**Mobile:** a bottom sheet at 88 % height with the decision bar pinned above the safe area; one-thumb reachable. (`ApprovalCockpit.tsx` already ships a mobile sheet — reuse it, do not rebuild.)
**Primary focus:** the first action card; roving tabindex `j`/`k`.
**Real data per card:** summary · **risk tier** · **policy id + version** · evidence · critic verdict · price-book provenance · **predicted outcome from `simulate()`**. All seven already exist in `/api/actions/pending`'s response (verified) except `predicted`, which P4 adds.
**Critic:** when null, the literal string is `"Second-pass review didn't run (no model key configured)."` — **never a fake "pending".** v2 verified `AWS_BEDROCK_API_KEY` is unset.
**Header microcopy, literal:** `"6 actions · $4,200 · 6 customers will be texted"`.
**Interaction:** `a` approve · `r` reject · `e` escalate · `u` undo · `Enter` confirm · `Esc` close. Batch approve requires typing `APPROVE` when any card is high-risk (already implemented — preserve). Buttons: `"Approve all 6"` · `"Reject"` · `"Escalate"`.
**Voice:** **JARVIS does not accept spoken approval** (§3.3-D1). If the user says "yes", JARVIS replies with the literal string `"I need you to approve that one on screen — it moves money."`
**Orb:** `proposing`, and it **moves**: it docks to the cockpit's top-left for the duration, returning after the decision. This is the only time the Orb leaves its home position, and it is how the user knows the system is waiting on *them*.
**Motion:** M7 CockpitRise, then M8 BlastRadius on the header count. M9/M10 on decision.
**Sound:** `propose` on rise; `approve`/`reject` on decision.
**Approval behaviour:** optimistic for ≤ 6 s, then server truth wins; on expiry the card returns with `"I couldn't confirm that went through."` The backend's `canApprove` is the only authority — the UI never authorises.
**Surfaces:** depth 2 cockpit, thread (plan block dims), Orb (relocates), rail (disabled), approvals count in `⌘K`.
**Failure:** 403 → `"Your role can't approve this."` + `Escalate`. Network → card restored, `ErrorState`, nothing silently lost.
**Proof of real:** every card names its policy id + version and its predicted outcome, both from the backend.

---

## ⑥ EXECUTION — `executing` · `presence: working`

**Desktop:** cockpit descends; block #5 opens with label `DOING IT`. One **lane per action**, stacked, ordered by most-recent transition. Each lane: entity name, a 3-segment step bar (`create_payment_link` → `send_message` → `sync_invoice`), elapsed time, and a control cluster.
**Mobile:** lanes are full-width rows, 64 px; tapping expands one.
**Primary focus:** the topmost active lane.
**Real data:** real `workflow_steps` rows. Segment states are the real 6-value `StepState`. Lane state is the real 8-value `RunState`.
**Interaction:** per-run controls `Pause` · `Resume` · `Cancel` · `Retry` · `Escalate` — all five already exist server-side and are already proxied (verified in v2 §4.2). Owner only; dispatcher sees `Pause`/`Resume`.
**Voice:** silent during execution. **Do not narrate steps** — it is noise, and D3 gives no ordering guarantee.
**Orb:** `working` — blue, energy 1.0, spin 0.35, and its ring subdivides into as many arcs as there are active lanes. Six lanes → six arcs completing independently. This is the single clearest "the machine is doing real work" signal in the product.
**Motion:** M11 LiquidFill per active segment · M12 StepSpark per completion · M13 DrainBack on compensating · M14 FaultShake on failure.
**Sound:** `step`, throttled to ≤ 1 per 400 ms regardless of lane count.
**Approval:** a run that escalates re-opens the cockpit (M7) with the escalated action.
**Surfaces:** thread, Orb, Field (M17 as overdue drops), `⌘K` Ops counts, Activity, Comms.
**Failure:** any failed step → M14, the lane turns red, and the **Recovery affordance** appears inline per §6.8's taxonomy. `compensating`/`compensated` render explicitly as `"Rolling back"` / `"Rolled back"`.
**Proof of real:** each segment deep-links to its `workflow_step` row and its receipt.

---

## ⑦ VERIFICATION & RECEIPT — `verifying → completed` · `presence: verifying → resolved`

**Desktop:** block #6, label `WHAT ACTUALLY HAPPENED`. Two columns: **Predicted** (from `simulate()`) and **Actual** (from the real outcome). Rows align. Matching rows are green; differing rows are amber and stay outlined. Below: evidence — tool calls, timings, `communications_log` / `sandbox_outbox` row links, policy cited, and the immutable action-log trail.
**Mobile:** columns stack; each row shows `predicted → actual` inline.
**Primary focus:** the diff.
**Real data:** predicted comes from `invoice-to-cash`'s real `simulate()` output (`amountUsd`, `steps`, `fieldChanges`, `expectedResult`). Actual comes from the executed run. **If no prediction exists, the column renders `"No prediction was recorded for this action."` — the panel is never hidden.**
**The long tail — this is the moat moment:** the payment webhook lands minutes or hours later. The receipt **updates in place**: `"Actual: 2 of 6 paid · $1,340 collected"`, matching rows flip green, and the Field cools (M17). The thread the user already saw becomes more true over time without them doing anything.
**Interaction:** `"Copy receipt"` · `"Open in Invoices"` · every evidence row deep-links. The whole receipt is addressable at `/jarvis/next#receipt-{id}` and survives refresh.
**Voice:** JARVIS speaks the outcome once (V3): `"Six links sent. I'll tell you as they're paid."` On a partial: `"Four sent. Two couldn't go — no phone number on file."`
**Orb:** `verifying` (green, 0.5 energy, tight fast spin) → `resolved` (a 4 s bloom, then decay to `dormant`).
**Motion:** M16 TruthReveal, then M15 ReceiptSeal.
**Sound:** `seal`.
**Approval:** n/a.
**Surfaces:** thread, Orb, Field, Collected KPI in Ops, Invoices, Activity, Comms.
**Failure:** partial → `partial` state, the receipt shows exactly which succeeded and which did not, each with its recovery affordance. **Never a blanket "done".**
**Proof of real:** the receipt cites `decision_receipts.id`, the policy id + version, every tool call, and — when the provider is unconfigured — the literal label `"Sent via sandbox — no carrier hop. Row in sandbox_outbox."`

---

## 6.8 Failure taxonomy and recovery — 8 kinds, each with one affordance

| Kind | Recovery affordance | Copy |
|---|---|---|
| `transient` | `Retry` | "That timed out. Try again?" |
| `policy_denied` | `Escalate` | "Policy blocked this." |
| `integration_unavailable` | `Connect` → setup | "Stripe isn't connected yet." |
| `invalid_input` | `Correct` → inline edit | "I need a valid phone number for this one." |
| `tool_error` | `Retry` + `View error` | "The tool returned an error." |
| `timeout` | `Retry` | "No response in time." |
| `compensated` | `View rollback` | "Rolled back — nothing was charged." |
| `needs_human` | `Assign` | "This one needs a person." |

**Exhaustive switches, no `default` branch.** A missing case is a compile error.

---

# §7. SCOPE FENCES

## 7.1 Realtime — staged, feasible, truthful

**Stage 1 (P3):** instruction trace by targeted poll at **400 ms, only while an instruction is in flight**, ceiling 120 s. No new infrastructure. This alone delivers the entire cognition experience.
**Stage 2 (P3, same phase, flagged):** SSE at `GET /api/stream`, consumed through a **new non-buffering route** `src/app/api/jarvis/stream/route.ts` (`runtime = "edge"`, pipes `upstream.body`). This is mandatory because v2 verified the existing catch-all proxy does `await upstream.text()` (`route.ts:151-153`) and hard-codes `content-type: application/json` — SSE through it would hang and then arrive as one blob.
Ship behind `NEXT_PUBLIC_JARVIS_SSE`. Ladder: `live` → 2 failures → `polling` → offline → `offline`, every transition visible in the rail's connection dot. Both paths call one `applyServerFacts`. One cache.

## 7.2 Renderers — **7 designed, not 44**

| Renderer | Tier | Workflow |
|---|---|---|
| `ClarificationScene` | interactive | all — **highest priority in the product** |
| `InvoiceToCashScene` | flagship | GOLDEN |
| `WaterTestScene` | flagship | B |
| `SchedulingScene` | flagship | B |
| `BulkNotifyScene` | flagship | C |
| `RouteScene` | flagship | B (dispatch) |
| `SchemaCard` | **generic, designed** | **every other action type** |

`ui/renderers/` already ships `WaterTestScene`, `SchedulingScene`, `BulkNotifyScene`, `InvoiceToCashScene` and a standard field-spec tier (verified). **The real work is `ClarificationScene`, `RouteScene`, and making `SchemaCard` genuinely good** — because it must carry ~37 action types with dignity.

`SchemaCard` spec: plugin-family accent stripe (left, 3 px), human-cased title, field list from the registry's existing `FieldSpec[]` with typed formatting (currency/phone/date/enum/longtext), an evidence footer, and a `"Show details"` disclosure. **It never shows raw JSON.** The `FallbackRenderer` becomes owner-debug-only.

**Do not build custom renderers for the other 37 action types. Ever, in this plan.**

## 7.3 Motion — 18 promoted, not ~100

v2 verified all 15 motion catalogs are imported **only** by `Stage.tsx`. v3 promotes exactly the §5.3 set. The rest **stay in Stage as a catalog** — not deleted, not promoted, not maintained. `docs/motion-promoted.md` records the 18 and the mapping; everything else is explicitly marked "catalog only."

## 7.4 Legacy — preserved only where it serves the three workflows

**Keep and reuse:** `ApprovalCockpit` (52 KB, excellent, has the mobile sheet), `WorkflowTheater` (real graph + run controls), `DispatchMap`, `MyDay`, `ReceiptDrawer`→`ReceiptContent`, `ui/primitives/*`, `ui/fx/*`, `sound.ts`, `lib/haptics.ts`, `lib/quiet-hours.ts`, `data-core.ts`.
**Leave alone at `/jarvis`, do not port:** `KpiStrip`, `AnalyticsRow`, `PipelinePulse`, `CommsFeed`, `DailyBriefing`, `SystemConsole`, `CertificationStatus`, `DataQualityQueue`, `DispatcherBoard`, `TechnicianBoard`, `views.tsx`.
**Delete only in P6, only after the flag flips:** `panels/CommandBar.tsx`, `panels/ApprovalDock.tsx`, `panels/ActivityRail.tsx`, `lib/CommandPalette.tsx`.

---

# §8. THE PHASES

Seven phases. **14–16 sessions.** Every phase ends with a working, demonstrable product.

---

## PHASE 1 — Contract, Foundations & Regression Net
**Sessions: 2** · **Depends on: none**

### Exact user-visible result
None yet by design — but at the end of P1 the tokens, motion specs, `Truth<T>` and the truth-grammar primitives exist, and **the signed-out production page no longer lies**: no `$0` from a 401, no hardcoded `"Param"`, no 401 storm.

### Source files
`package.json` · `playwright.config.ts` · `e2e/*` · `jarvis-theme.css` · `lib/Metric.tsx` · `panels/KpiStrip.tsx` · `panels/HeaderBand.tsx` · `panels/OpsTicker.tsx` · `lib/data-core.ts` · `ui/primitives/*` · `src/app/api/jarvis/[...path]/route.ts`

### Discovery
```bash
grep -rn "?? 0" src/components/jarvis | wc -l
grep -rn '"Param"' src/
grep -c "Degraded" src/components/jarvis/panels/KpiStrip.tsx
ls e2e/jarvis-visual-snapshots.spec.ts-snapshots | wc -l
```

### Architecture decisions already made
Vitest (not Jest). Tokens live in `jarvis-theme.css`. `Truth<T>` is v2 §7.2 verbatim. `Metric` becomes the enforcement point. Motion constants live in `kernel/choreography.ts` as data, never inline.

### Ordered tasks
1. **T1** Add **Vitest** + **@testing-library/react** — *the only dependency additions in this entire plan*. Script `"test:unit": "vitest run"`.
2. **T2** Add the 6 type tokens (§5.1), the 7-value spacing scale, and the 6 colour semantics (§5.2) to `jarvis-theme.css`. Do not sweep call sites yet (that is P6).
3. **T3** `kernel/types.ts` — `Truth<T>`, `TruthSource` exactly per §4.2.
4. **T4** ESLint: ban `?? 0` on `useJarvis()` fields; ban `useJarvis` imports outside `kernel/` and `lib/data-core.ts`. `.eslintrc.cjs`.
5. **T5** Rewrite `lib/Metric.tsx` → `value: Truth<number>`; render per §5.5; delete the `source: "live"|"derived"` prop.
6. **T6** `kernel/selectors.ts` — `selectOverdueInvoices`, `selectCollectedUsd`, `selectPendingApprovals`, `selectRunsInFlight`. `selectPendingApprovals` implements the `partial` cap rule (§4.7).
7. **T7** Rewrite `panels/KpiStrip.tsx` onto selectors + `Metric`. Remove all six `?? 0` (`KpiStrip.tsx:34-41`).
8. **T8** `HeaderBand.tsx:66` — delete the literal `"Param"`; use the signed-in first name; signed-out renders no name. Unit test.
9. **T9** `data-core.ts` — gate private lanes on session presence; stop a lane on 401 → `denied`; backoff 4→8→16→32→60 s on 5xx/network.
10. **T10** `OpsTicker` header → `"SAMPLE OPS"` whenever any row is `sim ·`.
11. **T11** `e2e/jarvis-network-hygiene.spec.ts` — signed-out, 30 s, **assert < 5 requests**.
12. **T12** `e2e/jarvis-golden-baseline.spec.ts` — snapshot `/jarvis` signed-out at 1440 and 390 as the "before".

### Consequence mapping
401 on a read-model → `Truth.denied` → `PermissionVeil` → no number rendered → no contradiction possible.

### Evidence required
**Visual:** signed-out `/jarvis` at 1440 + 390, before/after, showing veils where `$0` used to be. **Runtime:** network log proving < 5 requests / 30 s. **Test:** selector unit tests incl. the `partial` cap and disagreement cases. **Perf:** 5 cold Lighthouse runs — this is the real baseline.

### Rollback
Every task is independent; `git revert` per commit.

### Exit gate
- [ ] `grep -rn "?? 0" src/components/jarvis/panels` → 0 for network values
- [ ] `grep -rn '"Param"' src/` → 0
- [ ] Signed-out `/jarvis` renders **no** `$0`/`0` for private metrics — screenshot
- [ ] **< 5 requests / 30 s** signed out — network log
- [ ] `npm run lint` green with the new rules; `npm run test:unit` green
- [ ] Cold Lighthouse baseline (5 runs, median + worst) pasted

---

## PHASE 2 — The Golden Vertical Slice on the Bridge
**Sessions: 3** · **Depends on: P1**

### Exact user-visible result
**At `/jarvis/next`, signed in as owner, on desktop and mobile:** the user types or speaks *"Chase everyone more than thirty days overdue"* and watches states ⓪→③→⑤→⑥→⑦ of §6 render with **real** invoice data, real approval, real execution and a real receipt. **The product exists at the end of this phase.**

Trace-driven cognition (② with real event chips) lands in P3; in P2 the UNDERSTOOD block renders from the *plan response* (real, just not streamed) and is honestly labelled `"Context used"` without per-event timing.

### Source files
`bridge/Bridge.tsx` · `bridge/ApprovalCockpit.tsx` · `panels/WorkflowTheater.tsx` · `lib/useVapiSession.tsx` · `panels/CommandBar.tsx` (read, not edited) · `lib/ReceiptDrawer.tsx` · `ui/renderers/*` · `kernel/*` · `finnor-os/apps/api/app/api/actions/{route.ts,pending/route.ts}` · `finnor-os/packages/domain-plugins/invoice-to-cash/index.ts`

### Discovery
```bash
grep -rn "clarif" src/ | wc -l            # expect 0
grep -n "VAPI_ASSISTANT_ID" src/components/jarvis/lib/useVapiSession.tsx
grep -n "transcriptType" src/components/jarvis/lib/useVapiSession.tsx
```

### Architecture decisions already made
New route `/jarvis/next`, owner-gated, **flag `NEXT_PUBLIC_JARVIS_NEXT=1`**. `/jarvis` is untouched. The Thread is the only layout. The kernel wraps `data-core`. Browser voice is transcription+TTS only (§3.2). Approval is physical only (§3.3-D1). Reuse `ApprovalCockpit` and `WorkflowTheater` — do not rebuild them.

### Ordered tasks
1. **T1** `kernel/machine.ts` (§4.4 table), `kernel/presence.ts` (§4.5), `kernel/store.tsx` wrapping `JarvisDataProvider`, `kernel/transport.ts` (polling only). Unit-test every transition incl. illegal pairs → no-op.
2. **T2** **Voice**: verify whether `NEXT_PUBLIC_VAPI_ASSISTANT_ID` is shared with the phone assistant. If shared, create a web-only assistant (transcription + TTS, **no `finnor_instruct` tool**) and introduce `NEXT_PUBLIC_VAPI_WEB_ASSISTANT_ID`. Paste the evidence either way.
3. **T3** `useVapiSession.tsx` — stop discarding partials: emit `transcriptType !== "final"` as `partialTranscript`. Add `say(text)` via `vapi.send({type:"say", message, interruptionsEnabled:true})` and `duck()`/`unduck()` via `control`. Do not change the mic watchdog or the Daily processor fix.
4. **T4** `kernel/instruction.ts` — `submitInstruction(text, {source, sessionId})`. **Mint a stable `sessionId` per browser voice session** (`web:{uuid}`) and per typed session, persisted in `sessionStorage`, and **send it in the POST body** — closing the V8 gap (`CommandBar.tsx:51` currently sends `{instruction}` only).
5. **T5** `src/app/jarvis/next/page.tsx` + `bridge/Thread.tsx` — the depth model (§2.3), thread column, block collapse/expand.
6. **T6** `bridge/CommandRail.tsx` — pinned, `/` focus, `⌘K`, hold-`Space` push-to-talk, partial-transcript rendering, connection dot.
7. **T7** Blocks ①②③: `ThreadHeard`, `ThreadUnderstood`, `ThreadPlan`. Policy line with the **version-0 variant** (§6③).
8. **T8** **`ui/renderers/ClarificationScene.tsx`** + register `clarification_request` with `tier:"interactive"`. Exclude clarifications from `selectPendingApprovals` + unit test. Block ④.
9. **T9** Block ⑤ — mount `ApprovalCockpit` at depth 2 with `CockpitRise`; wire to kernel selectors; add the `BlastRadius` header.
10. **T10** Block ⑥ — `ThreadExecution` lanes hosting `WorkflowTheater`'s real graph; per-run controls.
11. **T11** Block ⑦ — `ThreadReceipt` from `ReceiptContent`; deep-link `#receipt-{id}`; restore on refresh.
12. **T12** `Orb3D` takes the 12-value `Presence`; extend `STATE_COLOR`/`STATE_ENERGY`/`STATE_SPIN` (`Orb3D.tsx:45-52`); **delete `useOrbLiveState()`** (`Bridge.tsx:73-88`). Add the lane-arc subdivision for `working`.
13. **T13** Motions M1, M2, M3, M5, M6, M7, M9, M10, M11, M12, M15 wired from `kernel/choreography.ts`. M4, M8, M16 land in P3/P4.
14. **T14** Sounds `commit`, `propose`, `approve`, `reject`, `step`, `seal` with the 400 ms throttle.

### Consequence mapping (partial — completed in P4)
instruction → `POST /api/actions` → `domain_actions` pending → cockpit + Orb `proposing` → approve → `commands` + `workflow_runs` + `workflow_steps` → lanes fill → `decision_receipts` → receipt block.

### Evidence required
**Visual:** every one of states ⓪①②③⑤⑥⑦ at **1440 and 390**, plus ④ with a real clarification. **Runtime:** a real end-to-end run with the network log and zero console errors; measured submit→plan-visible ms. **Test:** unit — all §4.4 transitions, all 12 presences, clarification-excluded-from-approvals. E2E — the golden journey, typed. **A11y:** keyboard-only completion of the whole journey, transcript pasted. **Perf:** ≥ 55 fps during ⑥ with 6 lanes.

### Rollback
`/jarvis/next` is a new route behind a flag. `/jarvis` is untouched. Delete the route to revert.

### Exit gate
- [ ] A real owner completes the golden journey at `/jarvis/next`, typed — screen recording or ordered screenshots
- [ ] The same journey completes **by voice** (partial transcript visible, JARVIS speaks the plan summary and the outcome)
- [ ] A real `clarification_request` renders as a **question with Answer/Skip/Cancel** — screenshot
- [ ] Clarifications do not count toward approvals — unit test
- [ ] `grep -rn "useOrbLiveState" src/` → 0
- [ ] Keyboard-only completion, both widths — transcript
- [ ] Zero console errors across the journey — pasted
- [ ] `/jarvis` still renders unchanged — snapshot diff empty

---

## PHASE 3 — Real Instruction Lifecycle & Feasible Realtime
**Sessions: 2** · **Depends on: P2**

### Exact user-visible result
The UNDERSTOOD block fills with **real context chips streaming in as the backend retrieves them** (M4 ContextGather), and plan nodes appear **one at a time as they are actually created**. The user watches cognition happen instead of waiting for a spinner. Event→pixel drops from ~4 s to ≤ 1.2 s.

### Source files
`finnor-os/packages/orchestration/src/index.ts` (`handleInstruction` ~97-165) · `finnor-os/apps/api/app/api/actions/route.ts` · `finnor-os/packages/db/schema.ts` + `migrations/` · `src/app/api/jarvis/[...path]/route.ts` · `src/lib/jarvis/useLiveQuery.ts` · `kernel/{instruction,transport}.ts`

### Architecture decisions already made
Backend additions are **additive and backwards compatible** — `POST /api/actions`'s response stays `{planned}`. The client mints `instructionId`. Poll first at 400 ms, SSE second behind a flag. Context payloads carry **counts and source labels only, never memory contents**. **Do not restructure `handleInstruction` into a job.**

### Ordered tasks
1. **T1** Migration: table `instruction_sessions`; table `instruction_events` (append-only, unique `(instruction_id, seq)`); column `domain_actions.instruction_id`. Tenant scoping matching neighbouring tables.
   `phase` vocabulary, fixed: `received · context_retrieved · planning · plan_ready · clarification_required · action_created · action_gated · dispatched · executing · step_progress · verifying · verified · completed · failed · cancelled`.
2. **T2** `orchestration/src/instruction-trace.ts` — `emitInstructionEvent(tenantId, instructionId, phase, payload)`, monotonic `seq`.
3. **T3** Instrument `handleInstruction` at each phase. `context_retrieved` payload = `[{label, count, source}]` only.
4. **T4** `POST /api/actions` accepts optional `instructionId`; creates the session row. Response unchanged.
5. **T5** `GET /api/instructions/{id}` and `GET /api/instructions/{id}/events?after={seq}`. Add all three paths to the proxy allowlist.
6. **T6** `kernel/instruction.ts` — start a **400 ms** trace poll on submit; stop on terminal or at a **120 s** ceiling. Feed `TRACE_*` events into the kernel.
7. **T7** Wire M4 ContextGather and per-event M5 PlanDraw. Chips now carry real source labels.
8. **T8** Restore-after-refresh: non-terminal `instructionId` in `sessionStorage` → refetch → resume the thread mid-flight.
9. **T9** Backend `GET /api/stream` (SSE, tenant-scoped, 25 s heartbeat, `Last-Event-ID`).
10. **T10** **New** `src/app/api/jarvis/stream/route.ts`, `runtime = "edge"`, pipes `upstream.body`, **no `.text()`**. Test asserting the catch-all does not capture `stream`.
11. **T11** `kernel/transport.ts` — SSE with 2-failure fallback to polling; both call `applyServerFacts`; restore-on-`live`. Flag `NEXT_PUBLIC_JARVIS_SSE`. Slow the lanes when `live` (fast 4→20 s, medium 8→30 s).
12. **T12** Connection dot in the rail renders `live | polling | reconnecting | offline` honestly.

### Consequence mapping
`instruction_events.context_retrieved` → kernel `TRACE` → UNDERSTOOD chips (M4) → Field points flare · `action_created` → PLAN node (M5) · transport change → rail dot + M18 Relight.

### Evidence required
**Runtime:** a real instruction's full ordered event list with timestamps; **first event ≤ 800 ms after submit**; event→pixel median over ≥ 20 events **≤ 1200 ms**. Network log showing the 400 ms poll **starting and stopping**. **Test:** `POST /api/actions` without `instructionId` behaves identically; stream-kill → polling within 10 s; reconnect produces **no duplicates**. **Visual:** UNDERSTOOD mid-fill and complete, 1440 + 390.

### Rollback
Migration is additive; `instructionId` optional. `NEXT_PUBLIC_JARVIS_SSE=0` forces polling. Frontend trace poll is flagged.

### Exit gate
- [ ] Real instruction produces ≥ 5 ordered `instruction_events` — pasted
- [ ] First trace event ≤ 800 ms — timing
- [ ] Event→pixel median ≤ 1200 ms over ≥ 20 events — measurement
- [ ] `POST /api/actions` without `instructionId` unchanged — test
- [ ] Stream kill → polling ≤ 10 s, no duplicates on reconnect — test
- [ ] Mid-flight refresh resumes the thread — E2E

---

## PHASE 4 — The Complete Consequence Graph
**Sessions: 2** · **Depends on: P3**

### Exact user-visible result
Approving the golden instruction visibly changes **every** affected surface, and the receipt shows **predicted versus actual** — including the long-tail update when the payment webhook lands and rows flip green.

### The golden consequence graph — implement exactly this

```
"Chase everyone more than thirty days overdue"
 ├─ CONTEXT      read-models/cash-collections · invoices · households · integrations/status
 ├─ PLAN         6 × start_invoice_to_cash_workflow   (one per overdue invoice)
 ├─ POLICY       requiresConfirmation = true  → policy id + version on every card
 ├─ PREDICT      simulate() → {amountUsd, steps[3], fieldChanges, expectedResult}   ← ALREADY EXISTS
 ├─ APPROVE      canApprove (backend authority) → domain_actions.approved
 ├─ EXECUTE      submitCommand → commands + workflow_runs + workflow_steps × 3
 │                 create_payment_link → Stripe | sandbox_outbox
 │                 send_message        → communications_log | sandbox_outbox
 │                 sync_invoice        → QuickBooks | sandbox
 ├─ MUTATIONS    invoices.status · communications_log · sandbox_outbox · outbox_events
 ├─ INVALIDATE   selectOverdueInvoices · selectCollectedUsd · selectRunsInFlight
 │                 selectPendingApprovals · activity · comms
 ├─ SURFACES     Thread lanes · Orb arcs · Field (M17) · ⌘K Ops counts
 │                 Invoices scene · Activity · Comms · Approvals badge
 ├─ MOTION       M11 fill · M12 spark per step · M15 seal · M17 field cool
 ├─ RECEIPT      decision_receipts + evidence + policy cited + tool calls + timings
 └─ VERIFY       payment webhook → invoices.paid → reconciliation
                   → M16 TruthReveal updates the SAME receipt in place
```

### Source files
`finnor-os/packages/domain-plugins/invoice-to-cash/index.ts` · `finnor-os/packages/orchestration/src/prediction-diff.ts` · `finnor-os/apps/api/app/api/receipts/[id]/route.ts` · `finnor-os/apps/api/app/api/webhooks/payment/route.ts` · `kernel/selectors.ts` · `bridge/Thread*.tsx`

### Architecture decisions already made
`predicted` is surfaced on `/api/actions/pending` (for the approval card) **and** on `/api/receipts/[id]` (for verification). Absent prediction is **stated**, never hidden. Receipt updates in place — a webhook never creates a second receipt. Sandbox execution is labelled with a literal string, never disguised.

### Ordered tasks
1. **T1** Backend: expose `simulate()`'s `predicted` on `/api/actions/pending` rows and on `/api/receipts/[id]`.
2. **T2** Approval card renders the predicted outcome (§6⑤).
3. **T3** `bridge/ThreadVerification.tsx` — two-column predicted↔actual with M16; the `"No prediction was recorded for this action."` variant.
4. **T4** Wire the payment-webhook consequence: `outbox_events`/stream → kernel → **receipt updates in place** + M17 Field cool + `selectCollectedUsd` recompute.
5. **T5** Cross-surface invalidation — one `applyServerFacts` fan-out; assert every listed surface reacts.
6. **T6** Sandbox honesty: when `create_payment_link`/`send_message` resolve to sandbox, the step and the receipt render the literal `"Sent via sandbox — no carrier hop. Row in sandbox_outbox."`
7. **T7** `⌘K → Ops` — a single deliberate destination with the 4 real counts. **Not a landing page, not a grid on the command path.**
8. **T8** `e2e/golden-consequence.spec.ts` — asserts **every** surface in the graph changed after approval.

### Evidence required
**Visual:** approval card with prediction; receipt before and after the webhook; Field before/after. **Runtime:** the full consequence assertion output; step→pixel ≤ 1200 ms. **Test:** the consequence spec green.

### Rollback
Backend additions are additive fields; the frontend degrades to "no prediction recorded."

### Exit gate
- [ ] Predicted↔actual renders from **real** `simulate()` + real outcome — screenshot + source cited
- [ ] Payment webhook updates the **same** receipt in place — before/after screenshots
- [ ] Every surface in the graph verified changed — spec output
- [ ] Sandbox execution is labelled with the literal string — screenshot
- [ ] No raw JSON anywhere in the receipt — grep + screenshot

---

## PHASE 5 — Flagships B & C, and Voice Continuity
**Sessions: 2–3** · **Depends on: P4**

### Exact user-visible result
Two more instructions work end-to-end with the same Thread: *"Book a water test for the Hendersons this week and send the closest tech"* and *"Tell every softener customer we're doing free hardness checks next month"* — the second showing **"47 customers will be texted"** in the approval header. And a **follow-up reference works**: *"actually make that Thursday"* modifies the previous thread instead of starting a new one.

### Source files
`domain-plugins/{lead-to-water-test,scheduling,bulk-notify,route-optimization}/index.ts` · `panels/DispatchMap.tsx` · `panels/MyDay.tsx` · `ui/renderers/flagships/*` · `kernel/instruction.ts` · `lib/quiet-hours.ts`

### Architecture decisions already made
Flagships reuse the Thread unchanged — **no new layout**. `RouteScene` reuses `DispatchMap`, does not rebuild it. Blast radius (M8) is driven by the real recipient count from the action payload; **if the backend does not return a count, the header reads `"an unknown number of customers"` and the action is forced to high-risk typed confirmation.** Follow-up references rely on the backend's existing session memory via the `sessionId` shipped in P2.T4 — **no new memory system.**

### Ordered tasks
1. **T1** Flagship B: `start_water_test_workflow` + `assign_technician_to_visit` through the Thread. Reuse `WaterTestScene`, `SchedulingScene`.
2. **T2** `ui/renderers/flagships/RouteScene.tsx` wrapping `DispatchMap` — polyline, ordered stops, time saved. Register `route_suggestion`.
3. **T3** Flagship C: `bulk_notify_existing_customers`. Approval header + M8 BlastRadius. Quiet-hours interaction surfaced honestly.
4. **T4** `ui/renderers/SchemaCard.tsx` per §7.2 — the designed generic for all remaining types. Register it as the default tier. `FallbackRenderer` → owner-debug only.
5. **T5** **Follow-up references (V8):** verify a second instruction in the same `sessionId` resolves "that one" against the prior turn. If the backend cannot resolve it, **the Thread must say so** — literal: `"I'm not sure which one you mean."` and fall through to a clarification. **Do not fake resolution.**
6. **T6** **Barge-in (V4):** user speech cancels any queued `say`; Orb → `listening` within 200 ms.
7. **T7** **D3 pilot, explicitly labelled:** while a long action runs, JARVIS may narrate once via `say`. Best-effort. If ordering is wrong in testing, **cut it and record the cut** — do not ship a guarantee.
8. **T8** Thread stacking: multiple threads, newest first, older collapsed to one row; `⌘K → recent threads`.

### Evidence required
**Visual:** both flagships end-to-end at 1440 + 390; the blast-radius header with a real count; `SchemaCard` rendering ≥ 5 different action types. **Runtime:** a real follow-up reference resolving (or honestly failing). **Test:** E2E per flagship.

### Exit gate
- [ ] Flagship B completes end-to-end with the map surface updating — screenshots
- [ ] Flagship C shows a real recipient count and requires typed confirmation — screenshot
- [ ] `SchemaCard` renders ≥ 5 unregistered types with dignity, no raw JSON — screenshots
- [ ] A follow-up reference either resolves or produces a clarification — recording
- [ ] Barge-in cancels TTS ≤ 200 ms — measurement
- [ ] D3 narration shipped **or** cut with the reason recorded

---

## PHASE 6 — Roles, Mobile, Onboarding, Demo & the Cutover
**Sessions: 2** · **Depends on: P5**

### Exact user-visible result
`/jarvis` **is** the new product for owners. Dispatcher and technician have real journeys. A brand-new tenant sees a designed first-run scene, not an empty dashboard. Signed-out visitors see an honest preview with zero fabricated numbers.

### Architecture decisions already made
The flag flips in **its own commit** (one line). Legacy moves to `/jarvis/classic` with a sunset banner. Roles: owner → Thread; dispatcher → Thread + map, escalate-only approvals; technician → My Day + voice-first rail, no approvals. **The backend remains the sole authority** — the UI hides only to avoid dead affordances. Three modes: `production | showcase | preview`, mode is a kernel field, chip is non-dismissible and lives in primary chrome.

### Ordered tasks
1. **T1** Role-scoped rail and scenes per the matrix above.
2. **T2** Technician mobile journey: my day → work order → arrive → log → flag → done, **each step ≤ 2 taps, one-thumb reachable.**
3. **T3** Dispatcher journey: map → assign → escalate.
4. **T4** `bridge/FirstRunScene.tsx` driven by real `setup/status` + `integrations/status`, naming **the exact next action**.
5. **T5** Type/spacing sweep — replace every `text-[Npx]` with a §5.1 token. **Nothing below 11 px.** Contrast audit; measure `--j-text-faint` on `j-panel` and fix if < 4.5:1.
6. **T6** Modes + non-dismissible chip; `preview` renders veils, never zeros; ticker `"SAMPLE OPS"`.
7. **T7** **Flip `/jarvis` for owners to the Thread** (own commit). Legacy → `/jarvis/classic`.
8. **T8** Delete `panels/CommandBar.tsx`, `panels/ApprovalDock.tsx`, `panels/ActivityRail.tsx`, `lib/CommandPalette.tsx` — **each only after a passing snapshot of its replacement.**

### Evidence required
**Visual:** all three roles at 1440 / 768 / 390; first-run scene; all three modes. **A11y:** axe on every scene at both widths; contrast table with measured ratios. **Perf:** mobile cold Lighthouse ≥ 85.

### Rollback
T7 is one line in its own commit. `git revert` restores the legacy home instantly.

### Exit gate
- [ ] Owner `/jarvis` renders the Thread — screenshot
- [ ] `grep -rhoE "text-\[[0-9.]+px\]" src/components/jarvis` → 0
- [ ] Contrast table, all ≥ 4.5:1 — pasted
- [ ] Technician mobile journey ≤ 2 taps per step — E2E + screenshots
- [ ] Preview mode shows zero fabricated numbers — screenshot
- [ ] `/jarvis/classic` still works — screenshot

---

## PHASE 7 — Truth, Recovery, Performance & Certification
**Sessions: 2** · **Depends on: P6**

### Exact user-visible result
Every failure has a visible recovery path; every degraded state is designed; the whole product is measured and signed off.

### Ordered tasks
1. **T1** Failure taxonomy (§6.8) in `kernel/types.ts` + `bridge/RecoveryPanel.tsx`; exhaustive switch, **no `default`**.
2. **T2** Complete run-state coverage — `cancelled` and `escalated` render distinctly (v2 verified both have **zero** references in `WorkflowTheater` despite that file offering both as control verbs). Compile-time exhaustiveness over all 8 `RunState` and 6 `StepState`.
3. **T3** Compensation as first-class: M13 DrainBack, `"Rolled back"`, compensation receipt.
4. **T4** Degraded integrations → `PermissionVeil` on exactly the affected surfaces + setup deep link. Never blank, never zero.
5. **T5** Certified paths, all green: golden desktop · golden mobile · golden by voice · clarification · flagship B · flagship C · failure+recovery · degraded (kill the API mid-run) · signed-out hygiene · first-run.
6. **T6** Contradiction sweep — **automated**: every visible number must carry `data-source` naming its selector.
7. **T7** Perf: 5 cold Lighthouse runs desktop + mobile; bundle ≤ 250 KB gz initial; ≥ 55 fps in execution with 6 lanes; event→pixel median + p95.
8. **T8** `docs/jarvis-v3-certification-<date>.md` with every measurement, plus `docs/motion-promoted.md` (the 18) and the honest voice-capability table (§3.1/§3.3 as shipped).

### Exit gate — the Definition of Done
- [ ] All 10 certified paths green — output
- [ ] Every visible number carries `data-source` — automated check
- [ ] All 8 `RunState` + 6 `StepState` render distinctly — screenshot grid
- [ ] Every failure kind offers a recovery affordance — screenshot per kind
- [ ] API killed mid-run → truthful degraded → recover → relight — E2E
- [ ] Refresh + reconnect restore truthful state — E2E
- [ ] Cold Lighthouse ≥ 85 perf / ≥ 95 a11y, desktop + mobile, 5 runs
- [ ] axe zero violations, every scene, both widths
- [ ] Keyboard-only completes all three role journeys — transcript
- [ ] Zero console errors on all certified paths
- [ ] ≥ 55 fps in execution with 6 lanes; initial JS ≤ 250 KB gz
- [ ] Event→pixel median ≤ 1200 ms (SSE) / ≤ 5000 ms (poll)
- [ ] **The golden journey is flawless, by voice and by keyboard, on desktop and mobile**

---

# §9. SESSION LEDGER

```
P1  Contract, foundations & regression net        2      truth fixed, tokens exist
P2  GOLDEN VERTICAL SLICE ON THE BRIDGE           3   ◄── the product exists here
P3  Instruction lifecycle & realtime              2      cognition becomes visible
P4  Complete consequence graph                    2      predicted↔actual, moat visible
P5  Flagships B & C + voice continuity            2–3    breadth
P6  Roles, mobile, onboarding, demo, CUTOVER      2      /jarvis becomes the product
P7  Truth, recovery, perf, certification          2      signed off
                                              ───────
                                        TOTAL  15–16
```

**Sessions 1–5 (end of P2) deliver a demonstrable, commercially impressive product.** Sessions 6–7 make its cognition visible. Session 8–9 make its moat visible.

---

# §10. RISKS

| Risk | Mitigation | Rollback |
|---|---|---|
| Web Vapi assistant shares the phone assistant and speaks refusals over our flow | P2.T2 verifies first and creates a web-only assistant | env var swap |
| Stripe/QuickBooks unconfigured in the demo tenant | Sandbox path writes **real** rows to `sandbox_outbox`; labelled with a literal string. This is a feature, not a gap | none needed |
| `simulate()` not invoked on the live approval path | P4.T1 verifies; if it is not called, surface `"No prediction was recorded"` rather than forcing it | field is optional |
| SSE hangs on edge | Dedicated non-buffering route, heartbeat, `NEXT_PUBLIC_JARVIS_SSE=0` kill switch | flip the env var |
| Trace events too slow to feel live | 400 ms poll is the floor; if first event > 800 ms, P3 investigates `handleInstruction` ordering, **never fabricates a chip** | the block honestly shows "Still gathering context…" |
| Cutover regresses owners | P6.T7 is one line in its own commit; `/jarvis/classic` retained | `git revert` |
| Sonnet improvises design | §0.1 + literal microcopy + exact ms/px in §5.3 + `## BLOCKERS` | revert; re-read the phase |
| No test credentials for signed-in E2E | Raise in `## BLOCKERS` **before P2**, not after; debug-harness fixture runs are the labelled substitute | — |

---

# §11. WHAT THE FINISHED PRODUCT PROVES

| Moat asset | Where it lives | Where the user sees it |
|---|---|---|
| Water-treatment ontology | 25 domain plugins | Flagship B's water-test scene |
| Real business context | `packages/memory`, `planner-memory.ts` | ② UNDERSTOOD chips, each with a source label |
| Tenant policies | `domain_policies` | ③ policy line + every approval card's policy id + version |
| Grounded planning | `planner.ts`, `plan-dag.ts` | ③ the DAG drawing itself |
| Ask, don't guess | `clarification` plugin | ④ CLARIFY — the block that does not exist today |
| Enforceable approval | `GatedExecutor`, `canApprove` | ⑤ the cockpit at depth 2 |
| Durable execution | `workflow-runtime` | ⑥ lanes; refresh mid-run and it resumes |
| **Predicted vs actual** | **`invoice-to-cash.simulate()` + payment webhook** | **⑦ the receipt that gets truer over time** |
| Receipts | `decision_receipts` | ⑦ evidence, tool calls, policy cited |
| Business memory | session memory, 30-min TTL | "actually make that Thursday" |

> You tell JARVIS what you want; you watch it understand the real business, ask when uncertain, propose the work, wait for permission, execute it and prove exactly what changed.

---

*Begin at Phase 1, Task 1. Record everything in `JARVIS-FRONTEND-MAESTRO-STATE-v3.md`.*
