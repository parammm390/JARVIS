# JARVIS FRONTEND MAESTRO STATE — v2

**Plan:** `/Users/paramdave/FINNOR/JARVIS-FRONTEND-MAESTRO-PLAN.md` (v2, authored 2026-07-29 by Opus 5)
**Baseline commit:** `c205cb6`
**v1 history:** archived at `JARVIS-FRONTEND-MAESTRO-STATE-v1-ARCHIVE.md` — the F-track (F1–F12)
that produced the ~100 FLOW motion primitives. That work is **not deleted and not wasted**;
Phase 10 of this plan promotes it out of `/jarvis/stage` and into the product.

---

## HOW TO USE THIS FILE

**Every session:**
1. Read this file top to bottom.
2. Go to `## NEXT EXACT TASK`. That is your work.
3. `git rev-parse HEAD` → must match `Latest verified commit` below.
4. Read the phase's `Source files to read` in the plan **in full**.
5. Run the phase's `Discovery commands`; paste output into the phase's `Discovery output` slot.
6. Do the tasks in order.
7. Check boxes **only** with pasted evidence. Fill `Evidence:` under each.
8. Record any adaptation in that task's `Deviation:` slot.
9. Append one `## Session Log` line.
10. Update `Latest verified commit` and `## NEXT EXACT TASK`.
11. Commit as `jarvis-fe P<n>.T<m>: <what changed>`.

**Checkbox law.** A box is checked **only** with `Evidence:` filled by a commit SHA, a pasted
command + output, a screenshot path, or a measured number. Never "looks right", never
"should work", never an empty slot.

**Blocked?** Write it under `## BLOCKERS`, implement the rest of the phase around it, and
report it. **Do not invent an architecture decision** (plan §0.1).

**Lost context?** Plan §0.5. Never restart a phase from scratch — checked boxes with pasted
evidence are trustworthy.

---

## STATUS

| | |
|---|---|
| **ACTIVE PHASE** | **P0 — Regression Net & Instrumentation** |
| **Latest verified commit** | `c205cb6` |
| **Phases complete** | 0 / 15 |
| **Sessions logged** | 0 |
| **Audit date** | 2026-07-29 |

## NEXT EXACT TASK

> **P0.T1** — Add Vitest + `@testing-library/react` to `package.json` (the only dependency
> addition authorised anywhere in this plan) and add the script `"test:unit": "vitest run"`.
> Confirm `npm run test:unit` exits 0 with zero tests. Paste the output.
>
> Before starting, read plan §0 (all), §1, §2, and §19's **PHASE 0** section in full.

---

## OVERALL COMPLETION LEDGER

| Phase | Name | Status | Sessions est. | Exit gate |
|---|---|---|---|---|
| P0 | Regression Net & Instrumentation | ⬜ not started | 1–2 | ⬜ |
| P1 | Truth Layer | ⬜ not started | 2–3 | ⬜ |
| P2 | The Kernel | ⬜ not started | 3 | ⬜ |
| P3 | Instruction Trace (+ backend) | ⬜ not started | 3–4 | ⬜ |
| P4 | Realtime Transport | ⬜ not started | 2–3 | ⬜ |
| P5 | Command Rail & Thinking Theater | ⬜ not started | 3 | ⬜ |
| P6 | Clarification & Approval Cockpit | ⬜ not started | 2–3 | ⬜ |
| P7 | Execution, Verification & Receipts | ⬜ not started | 3 | ⬜ |
| P8 | Failure, Recovery & Degraded | ⬜ not started | 3 | ⬜ |
| P9 | Renderer Completeness | ⬜ not started | 2 | ⬜ |
| P10 | Motion & Sound Promotion | ⬜ not started | 3–4 | ⬜ |
| P11 | IA Cutover — Bridge becomes JARVIS | ⬜ not started | 4 | ⬜ |
| P12 | Roles, Mobile & Design Sweep | ⬜ not started | 3 | ⬜ |
| P13 | Demo, Dealer Zero & Onboarding Truth | ⬜ not started | 2 | ⬜ |
| P14 | Certification | ⬜ not started | 2–3 | ⬜ |

Legend: ⬜ not started · 🟡 in progress · ✅ complete (exit gate green) · 🔴 blocked

---

## DEFECT LEDGER — live tracking

From plan §5. Update `Status` as phases close them. **Do not mark closed without evidence.**

| ID | Sev | Defect | Fix phase | Status | Evidence |
|---|---|---|---|---|---|
| C-01 | CRIT | Failed requests render as confident zeros (`KpiStrip.tsx:34-41`) | P1 | 🔴 open | |
| C-02 | CRIT | `"Param"` hardcoded in the greeting (`HeaderBand.tsx:66`) | P1 | 🔴 open | |
| C-03 | HIGH | `stats.pending` (unbounded) vs `actions/pending` (`.limit(100)`) | P1 | 🔴 open | |
| C-04 | HIGH | `readModelsDegraded` computed, largely ignored | P1 | 🔴 open | |
| C-05 | MED | "LIVE OPS" header over `sim ·` rows | P1 | 🔴 open | |
| C-06 | MED | Live/Simulation chip renders a loading race as fact | P1 | 🔴 open | |
| C-07 | CRIT | 3 backend action types unrendered, incl. `clarification_request` | P6 / P9 | 🔴 open | |
| C-08 | HIGH | `cancelled` + `escalated` run states unrendered | P8 | 🔴 open | |
| C-09 | MED | `/api/events` is not a stream | P3 / P4 | 🔴 open | |
| C-10 | MED | Proxy cannot stream (`route.ts:151-153`) | P4 | 🔴 open | |
| C-11 | MED | `useLiveQuery` SSE branch is dead code | P4 | 🔴 open | |
| C-12 | MED | Backend routes exist that the proxy blocks | P9 | 🔴 open | |
| C-13 | CRIT | Orb states semantically false (`Bridge.tsx:73-88`) | P2 / P5 | 🔴 open | |
| C-14 | CRIT | Instruction journey has no intermediate states | P3 / P5 | 🔴 open | |
| C-15 | HIGH | Signed-out 401 storm (~90 req/min, no backoff) | P1 | 🔴 open | |
| C-16 | MED | `views.tsx` polls independently (second data island) | P11 | 🔴 open | |
| C-17 | CRIT | Immersive surface unreachable (`PersonalizedHome.tsx:61`) | P11 | 🔴 open | |
| C-18 | HIGH | ~100 motion primitives quarantined in `/jarvis/stage` | P10 | 🔴 open | |
| C-19 | HIGH | Five subsystems exist twice | P11 | 🔴 open | |
| C-20 | MED | `views.tsx` = 47 KB / 9 views in one file | P11 | 🔴 open | |
| C-21 | MED | Perf baseline unreproducible (56/95/98) | P14 | 🔴 open | |

---

## BLOCKERS

<!-- Append: date · phase.task · what is blocked · what is needed · who can unblock -->

**Standing limitations carried from v1 (verify before assuming they still hold):**
- No `TEST_OWNER_EMAIL` / `TEST_OWNER_PASSWORD` exists — signed-in Playwright recordings are
  substituted by debug-harness fixture runs, labelled as such. Several plan phases
  (P5–P8, P11, P12, P14) need authenticated journeys. **If credentials still do not exist
  when P5 begins, raise it here before starting, not after.**
- `AWS_BEDROCK_API_KEY` unset → `critic_review` typically returns null. P6 must render this
  honestly ("not run — needs key"), never as a fake pending state.
- `finnor-os/apps/api`'s Vercel deployment may be stale relative to the local repo. Verify
  before attributing a 404/500 to frontend code.

---

# PHASE 0 — Regression Net & Instrumentation

**Status:** ⬜ not started · **Est.** 1–2 sessions · **Depends on:** none
**Plan section:** §19 → PHASE 0

### Discovery output
```
<!-- paste: ls e2e/...-snapshots | wc -l ; npx playwright test --list ; cat playwright.config.ts -->
```

### Tasks

- [ ] **P0.T1** Add Vitest + `@testing-library/react`; script `"test:unit": "vitest run"`
      *(the only dependency addition authorised in this plan)*
      **Evidence:**
      **Deviation:**
- [ ] **P0.T2** `scripts/gen-action-types.mjs` → `src/lib/jarvis/backend-action-types.generated.ts`;
      script `"gen:action-types"`. **Must emit 44.** If it does not, fix the parser, not the count.
      **Evidence:**
      **Deviation:**
- [ ] **P0.T3** Extend `e2e/jarvis-visual-snapshots.spec.ts` with signed-out `/jarvis/bridge`
      snapshots (overview, pipeline) at 1440 and 375
      **Evidence:**
      **Deviation:**
- [ ] **P0.T4** New `e2e/jarvis-degraded.spec.ts` — route-abort all `/api/jarvis/**`, snapshot
      `/jarvis`. Captures today's *wrong* degraded rendering as the "before" baseline.
      **Evidence:**
      **Deviation:**
- [ ] **P0.T5** New `e2e/jarvis-network-hygiene.spec.ts` — signed-out `/jarvis`, 30 s, count
      `/api/jarvis/**` requests. Record the number (expect ≈ 45). Assert only that it is recorded.
      **Evidence:**
      **Deviation:**
- [ ] **P0.T6** New `scripts/lighthouse-cold.mjs` — 5 cold runs, prints median + worst
      **Evidence:**
      **Deviation:**

### Exit gate
- [ ] `npm run test:unit` exits 0 — **Evidence:**
- [ ] `npx playwright test` green; snapshot count increased — **Evidence:**
- [ ] `backend-action-types.generated.ts` contains **44** entries — **Evidence:**
- [ ] Cold Lighthouse baseline (5 runs, median + worst) — **Evidence:**
- [ ] Signed-out 30 s request count recorded — **Evidence:**

---

# PHASE 1 — Truth Layer

**Status:** ⬜ not started · **Est.** 2–3 sessions · **Depends on:** P0
**Plan section:** §19 → PHASE 1 · **Closes:** C-01 C-02 C-03 C-04 C-05 C-06 C-15

### Discovery output
```
<!-- paste the 4 discovery greps from the plan -->
```

### Tasks

- [ ] **P1.T1** `kernel/types.ts` — `Truth<T>`, `TruthSource` exactly per plan §7.2
      **Evidence:**
      **Deviation:**
- [ ] **P1.T2** `kernel/selectors.ts` — the 11 selectors of plan §12.1
      **Evidence:**
      **Deviation:**
- [ ] **P1.T3** Rewrite `lib/Metric.tsx` → `value: Truth<number>`; delete the `source` prop
      **Evidence:**
      **Deviation:**
- [ ] **P1.T4** Rewrite `panels/KpiStrip.tsx` onto selectors + `Metric`; remove all six `?? 0`
      **Evidence:**
      **Deviation:**
- [ ] **P1.T5** **C-02** — `HeaderBand.tsx:66` literal `"Param"` → real user first name;
      signed-out shows no name. Unit test included.
      **Evidence:**
      **Deviation:**
- [ ] **P1.T6** **C-03** — `selectPendingApprovals`; update all 6 consumers to one `Truth`
      **Evidence:**
      **Deviation:**
- [ ] **P1.T7** **C-15** — gate private lanes on session; stop lane on 401 → `denied`;
      exponential backoff per plan §13.5
      **Evidence:**
      **Deviation:**
- [ ] **P1.T8** **C-06** — add `resolving`; chip shows "Connecting…" until first success
      **Evidence:**
      **Deviation:**
- [ ] **P1.T9** **C-05** — `OpsTicker` header → `SAMPLE OPS` when any row is `sim ·`
      **Evidence:**
      **Deviation:**
- [ ] **P1.T10** ESLint: block `?? 0` on `useJarvis()` fields; block `useJarvis` imports
      outside `kernel/` and `lib/data-core.ts`
      **Evidence:**
      **Deviation:**
- [ ] **P1.T11** `e2e/jarvis-network-hygiene.spec.ts` → assert **< 5 requests / 30 s**
      **Evidence:**
      **Deviation:**

### Exit gate
- [ ] `grep -rn "?? 0" src/components/jarvis/panels` → 0 for network values — **Evidence:**
- [ ] `grep -rn '"Param"' src/` → 0 — **Evidence:**
- [ ] Signed-out `/jarvis` shows no `$0`/`0` for private metrics — **Screenshot:**
- [ ] < 5 requests / 30 s signed out — **Network log:**
- [ ] All 6 pending-count consumers render the same `Truth` — **Evidence:**
- [ ] ESLint rule active; `npm run lint` green — **Evidence:**
- [ ] Selector unit tests green — **Evidence:**

---

# PHASE 2 — The Kernel

**Status:** ⬜ not started · **Est.** 3 sessions · **Depends on:** P1
**Plan section:** §19 → PHASE 2 · **Closes:** C-13

### Discovery output
```
<!-- paste greps + the 4 schema.ts enum excerpts (lines 193, 345, 921, 943) -->
```

### Tasks

- [ ] **P2.T1** `kernel/types.ts` — all entity/state types per plan §7.3/§7.5.
      **Copy the 4 backend enums verbatim from `schema.ts`.**
      **Evidence (both sides pasted):**
      **Deviation:**
- [ ] **P2.T2** `kernel/machine.ts` — plan §7.4 table as a pure reducer; unknown pairs no-op + warn
      **Evidence:**
      **Deviation:**
- [ ] **P2.T3** `kernel/store.tsx` — provider wrapping `JarvisDataProvider`; dedup/ordering/
      restore per plan §7.6
      **Evidence:**
      **Deviation:**
- [ ] **P2.T4** `kernel/presence.ts` — plan §7.5 derivation in the stated order; all 12 unit-tested
      **Evidence:**
      **Deviation:**
- [ ] **P2.T5** `kernel/transport.ts` — `ConnectionState` + `applyServerFacts` (polling only)
      **Evidence:**
      **Deviation:**
- [ ] **P2.T6** **C-13** — `Orb3D` takes `Presence` (12 states); extend `STATE_COLOR`/
      `STATE_ENERGY`/`STATE_SPIN`; **delete `useOrbLiveState()` from `Bridge.tsx:73-88`**
      **Evidence:**
      **Deviation:**
- [ ] **P2.T7** Mount `JarvisKernelProvider` in both `Bridge` and `JarvisCommandCenter`
      **Evidence:**
      **Deviation:**
- [ ] **P2.T8** `panels/JarvisOrb.tsx` (2D) reads `presence` too
      **Evidence:**
      **Deviation:**

### Exit gate
- [ ] Enum values byte-match `schema.ts` — **Evidence:**
- [ ] `grep -rn "useOrbLiveState" src/` → 0 — **Evidence:**
- [ ] All §7.4 transitions unit-tested green — **Evidence:**
- [ ] 12 presence screenshots from `/jarvis/stage` — **Path:**
- [ ] No component outside `kernel/` computes presence — **Grep:**

---

# PHASE 3 — Instruction Trace (backend additions + cognition pipeline)

**Status:** ⬜ not started · **Est.** 3–4 sessions · **Depends on:** P2
**Plan section:** §19 → PHASE 3 · **Closes:** C-14 (backend half), C-09 (partial)

> ⚠️ **This phase touches the backend and the database.** Read plan §13.2 exactly. Every
> addition is additive and backwards compatible. **Do not restructure `handleInstruction`.**

### Discovery output
```
<!-- paste appendEpisode grep, migrations tail, correlationId grep -->
```

### Tasks

- [ ] **P3.T1** Migration: `instruction_sessions`, `instruction_events`,
      `domain_actions.instruction_id` per plan §13.2, with tenant scoping/RLS
      **Evidence (`\d` output):**
      **Deviation:**
- [ ] **P3.T2** `orchestration/src/instruction-trace.ts` — `emitInstructionEvent`, monotonic `seq`
      **Evidence:**
      **Deviation:**
- [ ] **P3.T3** Instrument `handleInstruction` with the fixed phase vocabulary.
      **Context payloads carry counts + source labels only — never raw memory contents.**
      **Evidence:**
      **Deviation:**
- [ ] **P3.T4** `POST /api/actions` accepts optional `instructionId`; **response shape unchanged**
      **Evidence:**
      **Deviation:**
- [ ] **P3.T5** `GET /api/instructions/{id}` and `GET /api/instructions/{id}/events?after=`
      **Evidence:**
      **Deviation:**
- [ ] **P3.T6** Proxy allowlist: `instructions`, `instructions/:id`, `instructions/:id/events`
      **Evidence:**
      **Deviation:**
- [ ] **P3.T7** `kernel/instruction.ts` — `submitInstruction`, 400 ms trace poll, 120 s ceiling
      **Evidence:**
      **Deviation:**
- [ ] **P3.T8** Restore-after-refresh from `sessionStorage` + `GET /api/instructions/{id}`
      **Evidence:**
      **Deviation:**

### Exit gate
- [ ] Migration applied; 3 schema objects exist — **Evidence:**
- [ ] A real instruction produces ≥ 5 ordered `instruction_events` — **Pasted rows:**
- [ ] First trace event ≤ 800 ms after submit — **Timing:**
- [ ] `POST /api/actions` without `instructionId` behaves identically — **Test:**
- [ ] Trace poll stops on terminal — **Network log:**

---

# PHASE 4 — Realtime Transport

**Status:** ⬜ not started · **Est.** 2–3 sessions · **Depends on:** P3
**Plan section:** §19 → PHASE 4 · **Closes:** C-09 C-10 C-11

> Ship behind `NEXT_PUBLIC_JARVIS_SSE=0` kill switch.

### Discovery output
```
<!-- paste sseUrl grep, upstream.text() grep, outboxEvents grep -->
```

### Tasks

- [ ] **P4.T1** Backend `GET /api/stream` — SSE, tenant-scoped, 25 s heartbeat, `Last-Event-ID`
      **Evidence:**
      **Deviation:**
- [ ] **P4.T2** **New** `src/app/api/jarvis/stream/route.ts`, edge runtime, pipes `upstream.body`
      — **no `.text()`**
      **Evidence:**
      **Deviation:**
- [ ] **P4.T3** Test asserting the catch-all does not capture `stream`
      **Evidence:**
      **Deviation:**
- [ ] **P4.T4** `kernel/transport.ts` — SSE connect, 2-failure fallback to polling, backoff retry
      **Evidence:**
      **Deviation:**
- [ ] **P4.T5** Restore-on-`live` per plan §7.6 (snapshot-refetch → buffer → replay)
      **Evidence:**
      **Deviation:**
- [ ] **P4.T6** **C-11** — migrate `useLiveQuery` callers to pass `sseUrl`
      **Evidence:**
      **Deviation:**
- [ ] **P4.T7** Slow poll lanes when `live`: fast 4 s→20 s, medium 8 s→30 s
      **Evidence:**
      **Deviation:**
- [ ] **P4.T8** Pulse Strip renders `ConnectionState` honestly, incl. `reconnecting`
      **Evidence:**
      **Deviation:**

### Exit gate
- [ ] Event→pixel median ≤ 1200 ms over ≥ 20 events — **Measurement:**
- [ ] Stream kill → polling fallback ≤ 10 s — **Test:**
- [ ] Reconnect produces no duplicate entities — **Test:**
- [ ] Requests/min dropped — **Before/after:**
- [ ] `grep -rn "sseUrl" src/` shows real callers — **Evidence:**

---

# PHASE 5 — Command Rail & Thinking Theater

**Status:** ⬜ not started · **Est.** 3 sessions · **Depends on:** P3, P4
**Plan section:** §19 → PHASE 5 · **Closes:** C-14 (UI half)

> **Binding: voice and text produce an identical journey. No filler animation — every
> thinking element is backed by a real `instruction_events` row.**

### Discovery output
```
<!-- paste FLOW- greps from CommandSurfaceCatalog + VoiceTheaterCatalog -->
```

### Tasks

- [ ] **P5.T1** `bridge/CommandRail.tsx` — pinned bottom rail; `/` focus, `⌘K`, push-to-talk;
      presence-reactive ring (not a permanent loop)
      **Evidence:**
      **Deviation:**
- [ ] **P5.T2** `bridge/ThinkingTheater.tsx` — instruction echo, context chips, plan DAG forming,
      elapsed timer, cancel
      **Evidence:**
      **Deviation:**
- [ ] **P5.T3** Wire `submitInstruction` + trace events
      **Evidence:**
      **Deviation:**
- [ ] **P5.T4** Voice final transcript → the same `submitInstruction`
      **Evidence:**
      **Deviation:**
- [ ] **P5.T5** Scene auto-switching via `selectSceneForState`
      **Evidence:**
      **Deviation:**
- [ ] **P5.T6** Promote FLOW-38..49 and FLOW-67..73 into the rail/theater per plan §8.2
      **Evidence:**
      **Deviation:**
- [ ] **P5.T7** Presence + scene switcher added to `/jarvis/stage`
      **Evidence:**
      **Deviation:**

### Exit gate
- [ ] Command Rail visible without scrolling at 1440 and 375 — **Screenshots:**
- [ ] Voice and text produce identical journeys — **Both E2E:**
- [ ] Every thinking element traces to a real event row — **Mapping:**
- [ ] `thinking` reached ≤ 1.5 s after submit — **Timing:**
- [ ] Reduced-motion variant carries the same information — **Screenshot:**

---

# PHASE 6 — Clarification & Approval Cockpit

**Status:** ⬜ not started · **Est.** 2–3 sessions · **Depends on:** P5
**Plan section:** §19 → PHASE 6 · **Closes:** C-07 (the critical type)

> **Binding: a clarification renders Answer / Skip / Cancel. NEVER Approve / Reject.
> It must not count toward approvals.**

### Discovery output
```
<!-- paste: grep -rn "clarif" src/ | wc -l   (expect 0 before this phase) -->
```

### Tasks

- [ ] **P6.T1** `ui/renderers/ClarificationScene.tsx` per plan §14.1
      **Evidence:**
      **Deviation:**
- [ ] **P6.T2** Register `clarification_request` with `tier: "interactive"`
      **Evidence:**
      **Deviation:**
- [ ] **P6.T3** Route clarifications out of the approval queue; exclude from
      `selectPendingApprovals` + unit test
      **Evidence:**
      **Deviation:**
- [ ] **P6.T4** Answering POSTs a new instruction with `parentInstructionId`; continuous thread
      **Evidence:**
      **Deviation:**
- [ ] **P6.T5** `ApprovalCockpit` into the `approval` scene, wired to kernel selectors
      **Evidence:**
      **Deviation:**
- [ ] **P6.T6** Approval card shows risk tier, **policy id + version**, evidence, critic verdict
      (or honest "not run — needs key"), price-book provenance, predicted outcome
      **Evidence:**
      **Deviation:**
- [ ] **P6.T7** Promote FLOW-50..58 per plan §8.2
      **Evidence:**
      **Deviation:**
- [ ] **P6.T8** Preserve the existing typed-confirmation gate for high-risk batches
      **Evidence:**
      **Deviation:**

### Exit gate
- [ ] A clarification renders as a **question**, not an approval — **Screenshot:**
- [ ] Registry covers **44/44** — **Contract test:**
- [ ] Clarifications excluded from approval counts — **Unit test:**
- [ ] `FallbackRenderer` mounts zero times across certified paths — **Assertion:**
- [ ] Approval card shows policy id + version + risk tier + predicted outcome — **Screenshot:**

---

# PHASE 7 — Execution Theater, Verification & Receipts

**Status:** ⬜ not started · **Est.** 3 sessions · **Depends on:** P6
**Plan section:** §19 → PHASE 7

> **This phase surfaces the sharpest moat asset: `prediction-diff.ts`, which currently has
> no UI at all. Absent prediction data is stated honestly, never hidden.**

### Discovery output
```
<!-- paste prediction greps (backend + frontend) -->
```

### Tasks

- [ ] **P7.T1** `bridge/ExecutionTheater.tsx` bound to real action + step statuses
      **Evidence:**
      **Deviation:**
- [ ] **P7.T2** Concurrency as **stacked lanes** ordered by most-recent-transition. Never modals.
      **Evidence:**
      **Deviation:**
- [ ] **P7.T3** `bridge/VerificationScene.tsx` — predicted vs actual, diff highlighted
      **Evidence:**
      **Deviation:**
- [ ] **P7.T4** `ReceiptDrawer` promoted to a full `receipt` scene
      **Evidence:**
      **Deviation:**
- [ ] **P7.T5** Every receipt deep-linkable (`/jarvis#receipt-{id}`) via `lib/receipt-nav.ts`
      **Evidence:**
      **Deviation:**
- [ ] **P7.T6** Promote FLOW-59..66 per plan §8.2
      **Evidence:**
      **Deviation:**
- [ ] **P7.T7** *(if needed)* `receipts/[id]` gains `predicted` alongside `actual`
      **Evidence:**
      **Deviation:**

### Exit gate
- [ ] Predicted-vs-actual renders from real backend data — **Screenshot + source:**
- [ ] 3 concurrent runs render as lanes at ≥ 55 fps — **Screenshot + fps:**
- [ ] Every receipt deep-links and restores on refresh — **E2E:**
- [ ] No raw JSON anywhere in the receipt scene — **Grep + screenshot:**
- [ ] Step→pixel latency ≤ 1200 ms — **Measurement:**

---

# PHASE 8 — Failure, Recovery & Degraded States

**Status:** ⬜ not started · **Est.** 3 sessions · **Depends on:** P7
**Plan section:** §19 → PHASE 8 · **Closes:** C-08

> **Exhaustive switches, no `default` branch. Veils, never blanks. Never a fabricated zero.**

### Discovery output
```
<!-- paste escalated/cancelled greps + compensating count -->
```

### Tasks

- [ ] **P8.T1** **C-08** — `cancelled` + `escalated` in `WorkflowTheater`; exhaustive-coverage
      test for all 8 `RunState` and 6 `StepState`
      **Evidence:**
      **Deviation:**
- [ ] **P8.T2** Failure taxonomy (8 kinds) in `kernel/types.ts` + affordance mapping
      **Evidence:**
      **Deviation:**
- [ ] **P8.T3** `bridge/RecoveryPanel.tsx` — cause, blast radius, what was/wasn't done, affordances
      **Evidence:**
      **Deviation:**
- [ ] **P8.T4** Compensation as a first-class visual + compensation receipt
      **Evidence:**
      **Deviation:**
- [ ] **P8.T5** Degraded integrations → `PermissionVeil` + setup deep link
      **Evidence:**
      **Deviation:**
- [ ] **P8.T6** Transport degradation ladder in the Pulse Strip
      **Evidence:**
      **Deviation:**
- [ ] **P8.T7** Promote FLOW-88..93 per plan §8.2
      **Evidence:**
      **Deviation:**
- [ ] **P8.T8** `e2e/jarvis-degraded.spec.ts` upgraded from baseline snapshot to assertions
      **Evidence:**
      **Deviation:**

### Exit gate
- [ ] All 8 `RunState` + 6 `StepState` render distinctly — **Screenshot grid:**
- [ ] Exhaustive-switch test green, no `default` — **Evidence:**
- [ ] Every failure kind offers a recovery affordance — **Screenshots:**
- [ ] API killed mid-run → degraded → recover → relight — **E2E:**
- [ ] Zero blank panels and zero fabricated zeros in degraded states — **Screenshots:**

---

# PHASE 9 — Renderer Completeness & Contract Hardening

**Status:** ⬜ not started · **Est.** 2 sessions · **Depends on:** P6 *(may parallel P7/P8)*
**Plan section:** §19 → PHASE 9 · **Closes:** C-07 (remainder), C-12

### Discovery output
```
<!-- paste gen-action-types output + every jarvisGet path -->
```

### Tasks

- [ ] **P9.T1** `renderers/ManualStepCard.tsx` + `renderers/flagships/RouteScene.tsx`
      **Evidence:**
      **Deviation:**
- [ ] **P9.T2** Registry contract test — **failing-red first**, then green
      **Evidence (both states):**
      **Deviation:**
- [ ] **P9.T3** Correct the false comments in `registry.ts` (the "41" claims)
      **Evidence (diff):**
      **Deviation:**
- [ ] **P9.T4** Audit every `jarvisGet` path vs the proxy allowlist; add or remove each
      **Evidence (before/after list):**
      **Deviation:**
- [ ] **P9.T5** Verify `DispatchMap` and `MyDay` reach their backends
      **Evidence:**
      **Deviation:**
- [ ] **P9.T6** `FallbackRenderer` removed from customer-facing paths (owner debug only)
      **Evidence:**
      **Deviation:**

### Exit gate
- [ ] Contract test asserts and passes **44/44** — **Evidence:**
- [ ] 44 renderer screenshots committed — **Path:**
- [ ] Zero proxy 404s across certified paths — **Network log:**
- [ ] `registry.ts` comments corrected — **Diff:**

---

# PHASE 10 — Motion & Sound Promotion

**Status:** ⬜ not started · **Est.** 3–4 sessions · **Depends on:** P5, P7, P8
**Plan section:** §19 → PHASE 10 · **Closes:** C-18

> **This is the phase that answers "there are very few animations." Every FLOW primitive is
> bound or retired — nothing stays orphaned.**

### Discovery output
```
<!-- paste FLOW- id count + product-surface motion import count (before) -->
```

### FLOW inventory ledger
| Band | Ids | Bound to (§8.2 row) | Retired | Done |
|---|---|---|---|---|
| FLOW-01..13 | | | | ⬜ |
| FLOW-14..25 | | | | ⬜ |
| FLOW-38..49 | | | | ⬜ |
| FLOW-50..58 | | | | ⬜ |
| FLOW-59..66 | | | | ⬜ |
| FLOW-67..73 | | | | ⬜ |
| FLOW-74..80 | | | | ⬜ |
| FLOW-81..87 | | | | ⬜ |
| FLOW-88..93 | | | | ⬜ |
| FLOW-94..97 | | | | ⬜ |
| FLOW-98..100 | | | | ⬜ |

### Tasks

- [ ] **P10.T1** `docs/flow-inventory.md` — classify **every** primitive: bound or retire
      **Evidence (count):**
      **Deviation:**
- [ ] **P10.T2** Extract bound primitives to `ui/motion/primitives/<Name>.tsx`; catalogs import
      from there (one implementation, two consumers)
      **Evidence:**
      **Deviation:**
- [ ] **P10.T3** Complete `EVENT_TO_PIXEL` for every `KernelEventName`
      **Evidence:**
      **Deviation:**
- [ ] **P10.T4** Exhaustiveness test — a missing entry fails the build
      **Evidence:**
      **Deviation:**
- [ ] **P10.T5** Bind cues at transition sites — kernel events only, never component-local state
      **Evidence:**
      **Deviation:**
- [ ] **P10.T6** Ambient budget audit — assert ≤ 2 loops per viewport; convert/remove the rest
      **Evidence (per-scene audit):**
      **Deviation:**
- [ ] **P10.T7** Sound cues + 400 ms throttle + quiet-hours suppression
      **Evidence:**
      **Deviation:**
- [ ] **P10.T8** Haptics bound to intensity 2–3 cues, mobile only
      **Evidence:**
      **Deviation:**
- [ ] **P10.T9** Retire unused primitives; record the deletion list
      **Evidence:**
      **Deviation:**

### Exit gate
- [ ] `docs/flow-inventory.md` classifies every primitive — **Count:**
- [ ] `EVENT_TO_PIXEL` exhaustiveness test green — **Evidence:**
- [ ] ≤ 2 ambient loops per viewport — **Audit:**
- [ ] Reduced-motion golden journey passes the same assertions — **Evidence:**
- [ ] ≥ 55 fps in the three busiest scenes — **Readings:**
- [ ] Product surfaces import motion primitives (grep > 0) — **Evidence:**

---

# PHASE 11 — IA Cutover: the Bridge becomes JARVIS

**Status:** ⬜ not started · **Est.** 4 sessions · **Depends on:** P5–P10
**Plan section:** §19 → PHASE 11 · **Closes:** C-16 C-17 C-19 C-20

> **Parity precedes deletion. The flip at `PersonalizedHome.tsx:61` goes in its own commit.**

### Parity checklist — all 13 must be ✅ before any deletion
- [ ] Command Center → `command` + `ops` — **Evidence:**
- [ ] Voice Console → Command Rail + `thinking` — **Evidence:**
- [ ] Leads & CRM → `context:lead` + `ops` — **Evidence:**
- [ ] Customers → `context:customer` — **Evidence:**
- [ ] Workflows → `execution` — **Evidence:**
- [ ] Inventory → `ops` — **Evidence:**
- [ ] Invoices → `ops` — **Evidence:**
- [ ] Water Compliance → `ops` — **Evidence:**
- [ ] Web Research → renderers in `thinking`/`receipt` — **Evidence:**
- [ ] Activity → right rail — **Evidence:**
- [ ] Dispatch Map → `map` — **Evidence:**
- [ ] My Day → `day` — **Evidence:**
- [ ] Production Readiness → `ops` (owner) — **Evidence:**

### Tasks

- [ ] **P11.T1** Achieve parity (checklist above)
      **Evidence:**
      **Deviation:**
- [ ] **P11.T2** Split `views.tsx` into `scenes/<Name>Scene.tsx` ×9; delete the file
      **Evidence:**
      **Deviation:**
- [ ] **P11.T3** **C-16** — remove `views.tsx`'s 8 s poll; all data via the kernel
      **Evidence:**
      **Deviation:**
- [ ] **P11.T4** **C-17** — flip `PersonalizedHome.tsx:61` → `<Bridge />` *(own commit)*
      **Evidence (commit SHA):**
      **Deviation:**
- [ ] **P11.T5** Signed-out `/jarvis` → Bridge `preview` shell
      **Evidence:**
      **Deviation:**
- [ ] **P11.T6** Command Center → `/jarvis/classic` with a sunset banner
      **Evidence:**
      **Deviation:**
- [ ] **P11.T7** **C-19** — delete duplicates *(each needs a passing replacement snapshot first)*
      **Evidence (`git rm` list):**
      **Deviation:**
- [ ] **P11.T8** Left rail regrouped into scenes — not 13 flat items
      **Evidence:**
      **Deviation:**

### Exit gate
- [ ] Owner `/jarvis` renders the Bridge — **Screenshot:**
- [ ] All 13 parity boxes checked — **Above**
- [ ] `views.tsx` deleted; 9 scene files exist — **Evidence:**
- [ ] Duplicate subsystems deleted — **`git rm` list:**
- [ ] Exactly one polling provider — **Network log:**
- [ ] Cold Lighthouse ≥ 85, JS ≤ 250 KB — **Evidence:**
- [ ] Zero console errors on every scene — **Evidence:**

---

# PHASE 12 — Roles, Mobile & Design-System Sweep

**Status:** ⬜ not started · **Est.** 3 sessions · **Depends on:** P11 *(may parallel P13)*
**Plan section:** §19 → PHASE 12

### Discovery output
```
<!-- paste: grep -rhoE "text-\[[0-9.]+px\]" src/components/jarvis | sort -u -->
```

### Tasks

- [ ] **P12.T1** Role-scoped rail/scenes/affordances per plan §16
      **Evidence:**
      **Deviation:**
- [ ] **P12.T2** Technician mobile journey end-to-end, **≤ 2 taps per step**, one-thumb
      **Evidence:**
      **Deviation:**
- [ ] **P12.T3** Dispatcher journey: map → assign → escalate
      **Evidence:**
      **Deviation:**
- [ ] **P12.T4** Rails → bottom sheet below 1024 px
      **Evidence:**
      **Deviation:**
- [ ] **P12.T5** Type-scale sweep to the 6 tokens; **nothing below 11 px**
      **Evidence (before/after grep):**
      **Deviation:**
- [ ] **P12.T6** Spacing sweep to the 7-value scale
      **Evidence:**
      **Deviation:**
- [ ] **P12.T7** Contrast audit; fix anything < 4.5:1. **Measure `--j-text-faint` on `j-panel`.**
      **Evidence (contrast table):**
      **Deviation:**
- [ ] **P12.T8** Touch targets ≥ 44 px
      **Evidence:**
      **Deviation:**
- [ ] **P12.T9** `data-weight` per plan §9.4; one primary element per viewport
      **Evidence:**
      **Deviation:**

### Exit gate
- [ ] `grep -rhoE "text-\[[0-9.]+px\]"` → 0 — **Evidence:**
- [ ] Contrast table, all ≥ 4.5:1 — **Table:**
- [ ] Technician mobile journey ≤ 2 taps per step — **E2E + screenshots:**
- [ ] All 3 role journeys green at 375 px — **Evidence:**
- [ ] axe zero violations on every scene — **Evidence:**

---

# PHASE 13 — Demo, Dealer Zero & Onboarding Truth

**Status:** ⬜ not started · **Est.** 2 sessions · **Depends on:** P11 *(may parallel P12)*
**Plan section:** §19 → PHASE 13

### Tasks

- [ ] **P13.T1** `mode: production | showcase | preview` as a kernel field
      **Evidence:**
      **Deviation:**
- [ ] **P13.T2** Persistent, non-dismissible mode chip in the Pulse Strip
      **Evidence:**
      **Deviation:**
- [ ] **P13.T3** `preview` renders veils, never zeros — re-verify after the P11 cutover
      **Evidence:**
      **Deviation:**
- [ ] **P13.T4** Ticker rename per plan §15.2.4
      **Evidence:**
      **Deviation:**
- [ ] **P13.T5** `bridge/FirstRunScene.tsx` — designed first-run state naming the exact next action
      **Evidence:**
      **Deviation:**
- [ ] **P13.T6** Showtime adopts the new scene vocabulary
      **Evidence:**
      **Deviation:**
- [ ] **P13.T7** Assert no demo surface renders an unlabelled number
      **Evidence:**
      **Deviation:**

### Exit gate
- [ ] Mode chip visible and non-dismissible in `showcase` + `preview` — **Screenshots:**
- [ ] Preview shows zero fabricated numbers — **Screenshot:**
- [ ] First-run scene names the exact next action — **Screenshot:**
- [ ] Showtime uses the new scenes — **Screenshot:**

---

# PHASE 14 — Certification

**Status:** ⬜ not started · **Est.** 2–3 sessions · **Depends on:** P0–P13
**Plan section:** §19 → PHASE 14 · **Closes:** C-21

### Tasks

- [ ] **P14.T1** All 8 certified paths green — **Evidence:**
- [ ] **P14.T2** Golden journey green at 1440 **and** 375 — **Evidence:**
- [ ] **P14.T3** Event→pixel latency, 20+ events, SSE + poll; median + p95 — **Evidence:**
- [ ] **P14.T4** Cold Lighthouse ×5, desktop + mobile; median + worst — **Evidence:**
- [ ] **P14.T5** Full axe sweep, every scene, both widths — **Evidence:**
- [ ] **P14.T6** Keyboard-only walkthrough, all three roles — **Transcript:**
- [ ] **P14.T7** Bundle analysis ≤ 250 KB gzipped — **Evidence:**
- [ ] **P14.T8** Refresh/reconnect truth test mid-run — **Evidence:**
- [ ] **P14.T9** Contradiction sweep — every number carries `data-source`, automated — **Evidence:**
- [ ] **P14.T10** Console-error sweep, zero on all certified paths — **Evidence:**
- [ ] **P14.T11** `docs/jarvis-certification-<date>.md` committed — **Evidence:**

### Exit gate = DEFINITION OF DONE (plan §22)

- [ ] 1. No two surfaces show different values for the same fact — **Evidence:**
- [ ] 2. Every visible metric carries `data-source` — **Evidence:**
- [ ] 3. All backend lifecycle states (9 action / 8 run / 6 step / 5 job) represented — **Evidence:**
- [ ] 4. All **44** action types have a renderer, contract-enforced — **Evidence:**
- [ ] 5. Every consequential action supports approval + receipt inspection — **Evidence:**
- [ ] 6. Event→pixel latency measured and within budget — **Evidence:**
- [ ] 7. Refresh and reconnect restore truthful state — **Evidence:**
- [ ] 8. Missing integrations produce designed degraded states — **Evidence:**
- [ ] 9. Demo mode cannot imply production data — **Evidence:**
- [ ] 10. No primary interaction requires a mouse — **Evidence:**
- [ ] 11. Reduced motion retains full meaning — **Evidence:**
- [ ] 12. Low-power mode remains fully usable — **Evidence:**
- [ ] 13. Mobile owner / dispatcher / technician journeys complete — **Evidence:**
- [ ] 14. No customer-facing route exposes raw payloads — **Evidence:**
- [ ] 15. No fake activity, counters or execution — **Evidence:**
- [ ] 16. Zero console errors on all certified paths — **Evidence:**
- [ ] 17. Cold Lighthouse ≥ 85 perf / ≥ 95 a11y, 5 runs, desktop + mobile — **Evidence:**
- [ ] 18. Visual regression protection preceded every rewrite — **Evidence:**
- [ ] 19. Critical contracts have integration tests — **Evidence:**
- [ ] 20. **The golden journey is flawless** — **Evidence:**

---

## SESSION LOG

<!-- Append ONE line per session, newest first:
     YYYY-MM-DD · P<n> · tasks done · key findings · next task · blockers -->

- **2026-07-29 · AUDIT (Opus 5, no code modified)** · Re-audited both repos at `c205cb6` and
  authored plan v2 + this state file. v1 plan and v1 state archived
  (`JARVIS-FRONTEND-MAESTRO-STATE-v1-ARCHIVE.md`). **Verified findings:** 44 backend action
  types vs 41 registered renderers — `clarification_request`, `manual_step_suggestion`,
  `route_suggestion` all fall through to `FallbackRenderer`'s amber "unmapped action type"
  card with a raw-JSON debug toggle, and `grep -rn "clarif" src/` returns **zero** hits
  frontend-wide, so JARVIS asking a question renders as an error the user must Approve or
  Reject. All 15 motion catalogs (~100 FLOW primitives) are imported **only** by
  `Stage.tsx`, an owner-gated dev harness — the direct mechanical cause of "there are very
  few animations." `PersonalizedHome.tsx:61` routes owners to the legacy Command Center,
  making the Bridge, the 52 KB Approval Cockpit, the 3D Orb and the Activity Theater
  unreachable by preference. `Bridge.tsx:73-88` maps orb `"planning"` to "mic is open" and
  `"executing"` to "assistant is talking" — the orb has no input from the instruction
  lifecycle at all. `CommandBar.tsx:44-77` is a single blocking POST with a spinner; the
  backend's rich `planned/executing/verify/verified/critic_review/clarification` episodes
  are written durably and never shown. `HeaderBand.tsx:66` hardcodes the string `"Param"` —
  every anonymous production visitor is greeted by name. `KpiStrip.tsx:34-41` renders `?? 0`
  for six read-model fields and reads no degraded flag (`grep -c "Degraded"` → 0), so the
  live-verified 401s on all seven read-models render as confident `$0`/`0` with sparklines.
  Signed-out visitors fire ≈90 failed requests/min with no backoff. No realtime transport
  exists anywhere, and the proxy's `await upstream.text()` (`route.ts:151-153`) makes SSE
  architecturally impossible without a new route. `workflow_runs.status` `cancelled` and
  `escalated` have zero references in `WorkflowTheater` despite that same file offering both
  as run-control verbs. Lighthouse baseline is unusable: perf 56/95/98, TBT 1460/140/30 ms
  across three runs. **Next:** P0.T1 · **Blockers:** none.

---

## DEVIATION INDEX

<!-- Roll-up of every Deviation: line, so a later session can find them without re-reading. -->
<!-- Format: P<n>.T<m> · what the plan said · what reality was · what was done instead -->

*(none yet)*

---

## BACKEND ADDITIONS LEDGER

Frontend behaviour requires these backend changes. Track them here so they are never lost.

| # | Addition | Phase | Status | Evidence |
|---|---|---|---|---|
| B1 | Table `instruction_sessions` | P3 | ⬜ | |
| B2 | Table `instruction_events` (append-only, unique `(instruction_id, seq)`) | P3 | ⬜ | |
| B3 | Column `domain_actions.instruction_id` | P3 | ⬜ | |
| B4 | `POST /api/actions` accepts optional `instructionId`; emits trace events | P3 | ⬜ | |
| B5 | `GET /api/instructions/{id}` | P3 | ⬜ | |
| B6 | `GET /api/instructions/{id}/events?after={seq}` | P3 | ⬜ | |
| B7 | `GET /api/stream` — SSE, tenant-scoped, `Last-Event-ID` | P4 | ⬜ | |
| B8 | `receipts/[id]` exposes `predicted` alongside `actual` *(if absent)* | P7 | ⬜ | |
| B9 | Proxy allowlist: `instructions*`, and a non-buffering `stream` route | P3/P4 | ⬜ | |

---

*End of state file. Current task is at `## NEXT EXACT TASK`.*
