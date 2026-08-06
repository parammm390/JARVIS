# JARVIS FRONTEND MAESTRO PLAN — v2
## Rebuilding JARVIS into a voice-native command system whose interface reflects real backend cognition

**Authored:** 2026-07-29 by Opus 5 (audit-only session — no product code modified)
**Executed by:** Sonnet 5, phase-by-phase, across many sessions
**Baseline commit:** `c205cb6`
**State file:** `/Users/paramdave/FINNOR/JARVIS-FRONTEND-MAESTRO-STATE.md`

> **This file replaces v1 (the "F-track" plan of 2026-07-23).** v1's central method —
> "catalog or it doesn't exist," every behaviour gets a FLOW id and a Stage card — produced
> ~100 excellent motion primitives that **all render on one owner-only dev route and
> nowhere else** (§3.4, verified). v1's rule F1 is the direct cause of the "there are very
> few animations" complaint: the catalog became the destination instead of the staging
> area. None of v1's counts, claims, or completion states are carried forward. Every fact
> below was re-derived from source at `c205cb6` and carries a `file:line` citation.

---

# §0. EXECUTION PROTOCOL

## 0.1 The contract with the executor

You (Sonnet 5) are executing a plan authored by an architect who read the source.
**Product and architecture decisions are already made.** Your job is faithful, high-quality
implementation — not redesign, not re-derivation.

**You MUST NOT decide:**
- State machine names, state values, or transitions — §7 fixes them
- Event names, payload shapes, or the event→pixel mapping — §8 fixes them
- Component boundaries, file paths, module names — each phase fixes them
- Which surface is the owner's home — §9 fixes it: the Bridge
- Whether a number may fall back to `0` — §12: never. `Truth<T>` or nothing
- Whether to add a dependency — default no; each phase names any allowed addition
- Whether to delete a file — each phase names exact deletions

**You MAY decide** (genuinely local, reversible):
- Internal helper names inside a file you are writing
- Tailwind class ordering; spacing within the §11.2 scale
- Test case naming and assertion order within a test
- Whether a small pure helper lives inline or in a sibling `*.util.ts`

**If the plan did not decide something:** stop, write the question into the state file's
`## Blockers`, implement the rest of the phase around it, report it. **Never invent an
architecture decision and proceed silently.**

## 0.2 Anti-hallucination rules (non-negotiable)

1. **The repository is the only source of truth.** Not this plan, not v1, not code comments.
   If this plan says a file contains X and it does not, the file wins — record it in the
   task's `Deviation` slot and proceed.
2. **Never claim a route works unless you loaded it.** "Should work" is not evidence.
3. **Never claim a test passes unless you ran it and pasted the output.**
4. **Never write a count you did not derive from a command.** Paste command + output.
5. **Never fabricate data to make a surface look populated.** No data → designed empty/
   unknown state (§10.5). Fixtures are permitted only in `/jarvis/stage`, catalogs, and
   tests, and must be visibly labelled `FIXTURE` wherever a human can see them.
6. **Never mark a task complete without pasting its evidence.**
7. **If you did not do part of a task, say so.** Honest partial completion beats a false check.

## 0.3 Session loop

1. Read `JARVIS-FRONTEND-MAESTRO-STATE.md` top to bottom.
2. Find `## NEXT EXACT TASK`. That is your work. Do not skip ahead. Do not batch phases.
3. `git rev-parse HEAD` — confirm it matches `Latest verified commit`. If not, read
   `git log` since then, record it in the session log, continue.
4. Read the phase's `Source files to read` **in full** before writing anything.
5. Run the phase's `Discovery commands`; paste output into the state file.
6. Execute the phase's ordered tasks.
7. Gather every evidence type the phase requires (§0.4).
8. Update the state file: check boxes, paste evidence, update `Latest verified commit`,
   update `## NEXT EXACT TASK`, append a session log entry.
9. Commit. Message format: `jarvis-fe P<n>.T<m>: <what changed>`
10. If the exit gate is fully green, mark the phase complete and point `NEXT EXACT TASK`
    at the next phase's first task.

## 0.4 Evidence requirements

| Kind | What counts | What does not |
|---|---|---|
| **Source** | `path:line` citation, or a pasted command + output | "I looked at the file" |
| **Test** | Pasted command + full pass/fail output | "tests pass" |
| **Visual** | Screenshot under `qa-screenshots/P<n>/`, at **1440px and 375px** | A description |
| **Runtime** | Pasted console errors, network list, or a measured timing | "no errors seen" |
| **A11y** | Pasted axe output, or a keyboard-only walkthrough transcript | "should be accessible" |
| **Perf** | Lighthouse category scores + LCP/TBT/CLS **with cache state stated**, or a measured ms | A score with no run conditions |

**Perf runs must state cache state.** The existing baseline is unusable precisely because
it does not: `lighthouse-run-1.json` scores perf **56**, TBT **1,460 ms**; runs 2 and 3
score **95** and **98**, TBT **140 ms** and **30 ms** — a **48× TBT spread** across three
runs of the same page. Always report the **cold** run as the headline; state the run count.

## 0.5 Resumability after context loss

1. Read the state file. The `Session log` tail says what the last session did.
2. `git status` + `git diff HEAD` — uncommitted work is where you stopped.
3. `git log --oneline -10` vs `Latest verified commit`.
4. Re-read the current phase **completely** before touching anything.
5. Re-run the phase's discovery commands; compare to the pasted output. If they differ, the
   world moved — reconcile first.
6. Resume at the first unchecked task.

**Never restart a phase because you lost context.** Checked boxes with pasted evidence are
trustworthy. Trust them.

## 0.6 Hard rules — every phase

1. **Strangler, never rewrite.** New surfaces built alongside old, swapped behind a route or
   flag. No phase deletes a surface it did not first replace.
2. **Visual regression protection precedes component rewrites.** That is why P0 exists.
3. **No new runtime dependency** unless the phase explicitly authorises it.
4. **No component reads a raw count.** All displayed facts come from `kernel/selectors.ts`.
5. **No `?? 0` on a network value.** Use `Truth<T>` (§7.2).
6. **Every animation is justified by a row in §8.2.** Not in the table → does not ship.
7. **Reduced motion never removes meaning.** Every cue has an informationally-equivalent
   static form.
8. **≤ 2 continuously-running ambient loops per viewport.** Everything else is
   transition-triggered and settles.
9. **Nothing customer-facing renders raw JSON.** Debug payloads: owner-only, behind a toggle.
10. **Every phase leaves the app shippable.** No phase ends with `/jarvis` broken.

---

# §1. SOURCE-VERIFIED BASELINE

All figures derived at `c205cb6` on 2026-07-29.

## 1.1 Repositories

| Item | Value |
|---|---|
| Frontend | `/Users/paramdave/Desktop/FINNOR` — `/Users/paramdave/FINNOR` is a **symlink** to it |
| Backend | `/Users/paramdave/Desktop/FINNOR/finnor-os` — a **nested directory**, not a sibling repo |
| Frontend | Next.js App Router, `src/app` |
| Backend | Next.js route handlers, `finnor-os/apps/api/app/api` |

## 1.2 Verified counts

```bash
find src -name "*.tsx" | wc -l                                    # 185
find src -name "*.ts"  | wc -l                                    #  75
find finnor-os/apps/api/app/api -name "route.ts" | wc -l          #  51
grep -c 'pgTable(' finnor-os/packages/db/schema.ts                #  82
ls finnor-os/packages/domain-plugins | wc -l                      #  25
```

| Thing | Count | Note |
|---|---|---|
| Frontend `.tsx` / `.ts` | 185 / 75 | |
| Backend API routes | 51 | |
| DB tables | 82 | |
| Domain plugins | 25 | |
| **Backend action types** | **44** | §4.5 — enumerated from plugin source |
| **Frontend renderers registered** | **41** | `registry.ts` claims this is "all" |
| **Action types with NO renderer** | **3** | `clarification_request`, `manual_step_suggestion`, `route_suggestion` |
| Motion/effect catalog sections | 15 | **all 15 imported only by `Stage.tsx`** |
| `/jarvis` routes | 6 | `/`, `/bridge`, `/login`, `/reset-password`, `/showtime`, `/stage` |
| Playwright specs | 5 | `e2e/` |
| Visual snapshots | 24 PNG | 12 views × {desktop, mobile-375} |
| `setInterval` sites under `jarvis/` | 19 | §3.5 |

## 1.3 What is genuinely good — do not rewrite

**The most important finding for planning: this codebase is not under-built. It is
mis-wired.** A large amount of high-quality work exists and is unreachable. This plan is
overwhelmingly about *connecting*, not *creating*.

| Asset | Where | State |
|---|---|---|
| ~100 FLOW motion primitives | `ui/motion/*Catalog.tsx` (11 catalogs) | Built · **quarantined** |
| Effects toolkit (BorderBeam, DecryptText, Glass, Glow, GridBackdrop, ParticleBurst) | `ui/fx/` | Built · partly used |
| Primitive kit (Panel, StatCard, RiskBadge, StaleFog, PermissionVeil, EmptyState, ErrorState, Skeletons, Toast, Tooltip…) | `ui/primitives/` (18 files) | Built · under-used |
| Approval Cockpit — batch approve, typed confirm, risk tiers, critic verdict, price-book provenance, keyboard nav | `bridge/ApprovalCockpit.tsx` **52,955 B** | Built · **off the owner's path** |
| Workflow Theater — real node graph, run controls, replay | `panels/WorkflowTheater.tsx` **45,474 B** | Built · real |
| 3D Orb, 5 states × colour/energy/spin | `bridge/Orb3D.tsx` | Built · **fed semantically wrong input** (C-13) |
| Sound (per-family timbre, ducking) + haptics | `sound.ts`, `lib/haptics.ts` | Built · default-muted |
| Data provider: 4 poll lanes, 30-entry ring buffer, poll-diffing event emitter | `lib/data-core.ts` **29,900 B** | Built · solid — **extend, don't replace** |
| `useLiveQuery` with a real `EventSource` branch | `src/lib/jarvis/useLiveQuery.ts` | Built · **no caller passes `sseUrl`** |
| Renderer registry + 41 renderers + 9 flagship scenes | `ui/renderers/` | Built · 3 types short |
| Visual snapshot suite | `e2e/jarvis-visual-snapshots.spec.ts` | Built · 24 snapshots |
| Backend orchestration: planner, plan DAG, critic, reflection, repair, compensation, policy simulation, **prediction diff**, learning, memory | `finnor-os/packages/orchestration/src/` | Built, rich · **almost entirely invisible to the UI** |

## 1.4 What v1 got wrong — do not carry forward

- **"41 action types" is wrong; there are 44.** `registry.ts`'s header comment and its
  `REGISTERED_ACTION_TYPES` docstring both assert 41 and further claim *"none of the 41 real
  ones hit it [FallbackRenderer]"*. Three real backend types hit the fallback today (C-07).
- **The Stage was meant to be a staging area. No primitive ever graduated.** All 15 catalogs
  are imported by exactly one file: `Stage.tsx`.
- **`Metric.tsx`'s docstring claims** it is *"the grep-able definition of done: no raw
  `{number}` interpolations inside panel JSX — everything real goes through here."*
  **`KpiStrip.tsx`, the primary metric surface, does not import it.**

---

# §2. CURRENT ARCHITECTURE MAP

## 2.1 Routes

| Route | File | Renders | Who reaches it |
|---|---|---|---|
| `/jarvis` | `src/app/jarvis/page.tsx` → `PersonalizedHome` | role-switched | everyone |
| `/jarvis/bridge` | `src/app/jarvis/bridge/page.tsx` | `Bridge` | **direct URL only** |
| `/jarvis/login` · `/jarvis/reset-password` | | auth forms | |
| `/jarvis/showtime` | | `Showtime` | Dealer Zero, gated |
| `/jarvis/stage` | | `Stage` | **owner-only dev harness** |

## 2.2 The routing defect at the centre of everything

`src/components/jarvis/PersonalizedHome.tsx`:

```
:25  DEFAULT_HOME = { owner: "bridge", dispatcher: "map", technician: "my-day" }
:26  ALLOWED_HOME = { owner: ["bridge"], … }
:52  if (!session)         return <JarvisCommandCenter />   // signed out → legacy
:61  if (role === "owner") return <JarvisCommandCenter />   // owner    → legacy
:62  const selected = … prefs.homepage … DEFAULT_HOME[role]  // never reached for owner
```

`DEFAULT_HOME.owner` is `"bridge"` and `ALLOWED_HOME.owner` is `["bridge"]` — **but line 61
returns before either is consulted.** The Bridge is unreachable by preference; only by
typing the URL.

The in-file comment (`:53-60`) is honest about why: Bridge *"has no voice entry point at all
(it only reads voiceState to color the orb, never renders a mic control)"* and *"only
Overview/Pipeline scenes exist there today."*

**Consequence:** the immersive surface, the 52 KB Approval Cockpit, the Activity Theater,
the 3D Orb, the PulseBar and the Constellation link are all built and all invisible to the
primary user. **This single line is the largest reason the product does not feel like JARVIS.**

## 2.3 Two parallel frontends

| | Command Center (legacy) | Bridge (new) |
|---|---|---|
| File | `JarvisCommandCenter.tsx` 19,517 B | `bridge/Bridge.tsx` 35,596 B |
| Shape | 13-item sidebar + 16 stacked cards | left rail / centre stage / right rail |
| Scenes | 13 views | 2 (`overview`, `pipeline`) |
| Voice entry | **yes** (`CommandBar`, `VoiceConsoleView`) | **none** |
| Orb | `panels/JarvisOrb.tsx` (2D) | `bridge/Orb3D.tsx` (3D) |
| Approvals | `panels/ApprovalDock.tsx` 12,515 B | `bridge/ApprovalCockpit.tsx` 52,955 B |
| Activity | `panels/ActivityRail.tsx` | `bridge/ActivityTheater.tsx` |
| Palette | `lib/CommandPalette.tsx` | `lib/CommandPaletteV2.tsx` |
| Who sees it | **everyone** | nobody by default |

**Five subsystems exist twice.** Both mount `JarvisDataProvider`. Both are real. Neither is
complete.

## 2.4 Data flow

```
Component ─ useJarvis() ─ React context ─ JarvisDataProvider (lib/data-core.ts)
                                            ├─ pollFast    4 000 ms  stats · actions/pending×2 · workflows/runs
                                            ├─ pollMedium  8 000 ms  events · comms · workflows/runs
                                            ├─ pollSlow   30 000 ms  read-models×7 · insights
                                            └─ pollSanity 60 000 ms  setup/status · integrations/status
                                                 ↓ lib/api.ts jarvisGet()
                                    /api/jarvis/[...path]/route.ts   (Next proxy, allowlist)
                                                 ↓ NEXT_PUBLIC_OS_API_URL
                                       finnor-os/apps/api/app/api/*
```

`data-core.ts` maintains a 30-entry ring buffer of `{pendingIds, stepStatusById,
runStatusById}` and **diffs consecutive polls** to synthesise `new-pending-action`,
`step-completed`, `run-completed` (`data-core.ts:435-467`). This is the only causality in the
system today. It is good work; the kernel (§7) builds on it rather than replacing it.

## 2.5 There is no realtime transport — verified three ways

1. `grep -rn "EventSource" src/` → **3 hits, all inside `src/lib/jarvis/useLiveQuery.ts`**
   (the hook's own implementation). **No caller.**
2. `Stage.tsx:85-87` states it plainly: *"sseUrl intentionally omitted — B1 (the real SSE
   gateway) hasn't shipped."*
3. Backend `/api/events` is a paginated `SELECT … ORDER BY occurred_at DESC LIMIT 50`
   (`finnor-os/apps/api/app/api/events/route.ts`) — **not a stream**, despite the name.

**And it cannot simply be added.** `src/app/api/jarvis/[...path]/route.ts:151-153`:

```ts
const upstream = await fetch(url.toString(), init);
const text = await upstream.text();                    // ← fully buffers the body
return new Response(text, { status: upstream.status,
  headers: { "content-type": "application/json" } });  // ← hard-coded JSON
```

Any SSE routed through this proxy would hang until the stream closed, then arrive as one
JSON blob. **A separate non-buffering route is required** (§13.3, Phase 4).

---

# §3. CURRENT FRONTEND INVENTORY

## 3.1 `src/components/jarvis/` top level

| File | Bytes | Role | Verdict |
|---|---|---|---|
| `JarvisCommandCenter.tsx` | 19,517 | legacy owner shell | **retire P11** |
| `PersonalizedHome.tsx` | 4,468 | role router | **rewrite P11** |
| `views.tsx` | **47,358** | **9 feature views in ONE file** | **split P11** |
| `Stage.tsx` | 11,103 | dev catalog harness | keep, owner-only |
| `Showtime.tsx` | 12,091 | Dealer Zero 60× replay | keep — honest |
| `SinceYouWereAway.tsx` | 3,940 | return digest | keep |
| `atmosphere.tsx` | 7,230 | ambient bg, `LiveDot` | keep |
| `CustomCursor.tsx` | 3,015 | custom cursor | keep, gate `pointer:fine` |
| `PushOptIn.tsx` | 3,063 | web-push opt-in | keep |
| `sound.ts` | 4,912 | `setMuted` `setVoiceLive` `sfx` `eventPingThrottled` | keep, extend P10 |
| `jarvis-theme.css` | 22,192 | tokens + moods | sweep P12 |

## 3.2 `bridge/` — the new surface

`ApprovalCockpit.tsx` 52,955 · `Bridge.tsx` 35,596 · `Orb3D.tsx` 14,146 ·
`PulseBar.tsx` 11,285 · `ActivityTheater.tsx` 9,212 · `KeymapHUD.tsx` 4,969 ·
`ConstellationLink.tsx` 3,137 · `OrbAuraRipple.tsx` 2,066

## 3.3 `panels/` — 24 files

`ActivityRail` `AnalyticsRow` `ApprovalDock` `CertificationStatus` `CommandBar` `CommsFeed`
`DailyBriefing` `DataQualityQueue` `DegradedBanner` `DispatchMap` `DispatcherBoard`
`DlqBrowser` `HeaderBand` `JarvisOrb` `KpiStrip` `LiveCallPanel` `MyDay` `OpsTicker`
`ParticleField` `PipelinePulse` `StepIcon` `SystemConsole` `TechnicianBoard` `WorkflowTheater`

Duplicate pairs to resolve in P11: `ActivityRail`↔`ActivityTheater` ·
`ApprovalDock`↔`ApprovalCockpit` · `JarvisOrb`↔`Orb3D` · `CommandPalette`↔`CommandPaletteV2`.

## 3.4 `ui/` — the quarantined asset **(the answer to "there are very few animations")**

```
ui/motion/     15 files, 11 of them *Catalog.tsx   ── ALL imported only by Stage.tsx
ui/fx/          8 files
ui/primitives/ 18 files
ui/renderers/  16 files (9 flagship scenes)
```

Verification:

```bash
for f in AmbientIntelligenceCatalog CommandSurfaceCatalog ContinuityCatalog \
         DataVizCatalog DecisionTheaterCatalog GeoCinemaCatalog GrammarCatalog \
         PipelineTheaterCatalog StateNarrativesCatalog VoiceTheaterCatalog \
         EffectsCatalog PrimitivesCatalog RendererCatalog FlowCatalog; do
  echo "$f -> $(grep -rl "$f" src | grep -v 'Catalog.tsx' | tr '\n' ' ')"
done
```

→ every one resolves to exactly `src/components/jarvis/Stage.tsx` (plus, for `FlowCatalog`,
internal siblings). `Stage.tsx` is owner-gated (`Stage.tsx:135`: `if (!session || role !==
"owner")`) and self-describes as *"an internal dev harness for visual QA … not a customer
surface."*

**There are roughly a hundred motion primitives. They render on one owner-only dev page.**
P10 promotes them into product by binding them to kernel state transitions.

## 3.5 Polling loops — 19 `setInterval` sites

| File | Interval | Purpose |
|---|---|---|
| `lib/data-core.ts` | 4 s / 8 s / 30 s / 60 s / 1 s | the 4 lanes + clock |
| **`views.tsx`** | **8 s** | **independent reload — a SECOND, uncoordinated data island** |
| `bridge/Bridge.tsx` | 5 s · 5 min | frecency, daypart |
| `panels/WorkflowTheater.tsx` | 5 s ×2 | steps/min |
| `bridge/ApprovalCockpit.tsx` | 200 ms | countdown |
| `panels/OpsTicker.tsx` | 3.2 s | ticker rotation |
| `lib/quiet-hours.ts` | 60 s | quiet-hours |
| `lib/useVapiSession.tsx` | ×2 | mic watchdog |
| `ui/motion/*Catalog.tsx` | ×5 | catalog demos only |

---

# §4. CURRENT BACKEND CONTRACT INVENTORY

## 4.1 Endpoints — 51 route files

```
actions · actions/[id] · actions/pending · activity · admin/migrate · audit · comms
corrections · data-quality/findings · dealer-zero/time-compression · dispatch/map
dlq · dlq/[id] · documents · documents/[id] · events · health · insights
integrations/status · me · overview · policies · policies/[tenantId] · price-book/[tenantId]
push-subscriptions · read-models/[view] · receipts · receipts/[id] · resources/[kind]
setup/status · stats · technician/my-day · user-prefs · user-prefs/digest · vitals
webhooks/{esign,ghl,marketing,payment,vapi} · workflows · workflows/runs
```

## 4.2 Proxy allowlist reality

`src/app/api/jarvis/[...path]/route.ts`:

- **Public** (service token, anonymous OK) — `isPublicGet`, `:31-37`: `stats`,
  `setup/status`, `integrations/status`
- **Allowed GET** (caller's bearer) — `:41-73`: the above + `actions/pending`,
  `workflows/runs`, `events`, `read-models/{12 views}`, `comms`, `insights`,
  `resources/{7 kinds}`, `audit`, `receipts`, `receipts/:id`, `me`, `overview`, `dlq`,
  `dlq/:id`, `corrections`, `vitals`, `activity`, `user-prefs`, `user-prefs/digest`
- **Allowed POST** — `:75-89`: `actions`,
  `actions/:id/{confirm,reject,escalate,revert}`,
  `workflows/runs/:id/{pause,resume,cancel,retry,escalate}`, `dlq/:id/{replay,discard}`,
  `corrections`, `push-subscriptions`, `dealer-zero/time-compression`
- **PUT/DELETE** — `:193-195`: `user-prefs`, `push-subscriptions` only

**Backend routes that exist but the proxy blocks:** `data-quality/findings`, `dispatch/map`,
`documents`, `documents/:id`, `policies`, `price-book`, `technician/my-day`.
`DispatchMap.tsx` and `MyDay.tsx` exist in the frontend — P9 verifies whether they are
calling routes that 404 at the proxy.

## 4.3 Canonical status enums — `finnor-os/packages/db/schema.ts`

**These are authoritative.** The kernel (§7.3) mirrors them byte-for-byte. Never invent a value.

**`domain_actions.status`** — 9 (`schema.ts:193`):
`draft · pending · approved · rejected · executing · completed · failed ·
needs_human_review · blocked_integration_unavailable`

**`workflow_runs.status`** — 8 (`schema.ts:921`):
`running · completed · failed · compensating · compensated · paused · cancelled · escalated`

**`workflow_steps.status`** — 6 (`schema.ts:943`):
`pending · leased · completed · failed · compensating · compensated`

**`jobs.status`** — 5 (`schema.ts:345`): `queued · running · completed · failed · dead_letter`
**`commands.status`** — 4 (`:903`): `approved · running · completed · failed`
**`pending_confirmations.status`** — 4 (`:1259`): `awaiting · confirmed · rejected · expired`
**`voice_sessions.status`** — 2 (`:1233`): `active · ended`
**`dlq`** (`:1189`): `open · replayed · discarded` · **`handoffs`** (`:1273`): `open · acknowledged · resolved`

## 4.4 Lifecycle episodes already written server-side

`action_log.step` values found under `finnor-os/packages/orchestration/src`:

```
planned · executing · verify · verified · confirmed · rejected · critic_review
reflection · repair · compensating · compensated · simulated · clarification
```

**These are real, durable, per-action lifecycle records**, written during
`handleInstruction` (`orchestration/src/index.ts:120`, `:130-146`) — and **never shown to
the user during the instruction**, because the whole orchestration runs inside one
synchronous HTTP request. This is the raw material for the Thinking Theater (Phase 3/5).
**No fabrication is required to make JARVIS look like it is thinking. It already is.**

## 4.5 The 44 backend action types

Derived from `finnor-os/packages/domain-plugins/*/index.ts` `actionTypes` declarations and
their `SCHEMAS` keys / `const ACTION` values:

```
accounting               create_invoice · send_payment_reminder · record_payment · call_overdue_invoices
bulk-notify              bulk_notify_existing_customers
clarification            clarification_request                     ← NO RENDERER
compliance-documentation generate_compliance_summary
crm                      create_lead · update_lead_status · log_interaction · assign_lead_to_technician
customer-comm            answer_customer_question · send_customer_message · send_follow_up
inventory                check_stock_level · flag_reorder_needed · log_stock_used_on_visit
invoice-to-cash          start_invoice_to_cash_workflow
lead-to-water-test       start_water_test_workflow
maintenance-agreement    renew_maintenance_agreement
manual-step              manual_step_suggestion                    ← NO RENDERER
marketing                summarize_ad_performance · launch_ad_campaign · create_review_request
ops-overview             get_business_overview · answer_business_question
proposal-batch           send_proposal_to_recent_installs
proposal-signature       request_proposal_signature
proposal-to-installation start_installation_workflow
quotation                generate_quote · size_equipment_for_household · send_proposal
route-optimization       route_suggestion                          ← NO RENDERER
scheduling               assign_technician_to_visit · check_technician_availability · reschedule_visit
service-reminders        check_reminder_due
technician-reports       log_visit_report · flag_visit_issue
water-domain-knowledge   answer_water_question
water-test               schedule_water_test
web-research             search_web · scan_competitors · check_business_reviews
```

## 4.6 Orchestration capability the UI does not surface

| File | Capability | UI today |
|---|---|---|
| `planner.ts` | LLM planning, grounded, memory-fed | invisible |
| `plan-dag.ts` | multi-action dependency DAG + readiness gating | invisible |
| `critic.ts` | async second-pass review | a chip in the Cockpit only |
| `reflection.ts` | outcome reflection | invisible |
| `repair.ts` | plan repair after terminal failure | invisible |
| `policy-simulation.ts` | simulate policy before applying | invisible |
| **`prediction-diff.ts`** | **predicted vs actual outcome** | **invisible — this is the moat** |
| `learning.ts` | accumulated outcome learning | invisible |
| `planner-memory.ts` | semantic memory retrieval | invisible |
| `tiering.ts` | risk tiering | partially (`RiskBadge`) |
| `dealer-zero-replay.ts` | time-compressed replay | `/jarvis/showtime` |

---

# §5. CONTRADICTION AND BROKEN-CONTRACT LEDGER

Format: **ID · severity · claim · evidence · fix phase.**

## 5.1 Truth defects

**C-01 · CRITICAL · Failed requests render as confident zeros.**
`KpiStrip.tsx:34-41` reads six read-model fields with `?? 0`. `grep -c "Degraded"
KpiStrip.tsx` → **0**: the component reads no failure flag at all.
**Live proof** (`finnorai.com/jarvis`, signed out, captured this session):
`read-models/{cash-collections, sla-breaches, stock-risk, follow-up-debt, technician-load,
service-due, data-quality}` and `insights` **all return 401** — yet the page renders
`COLLECTED $0`, `OVERDUE $0`, `OPEN LEADS 0`, `RUNS IN FLIGHT 0`, each with a sparkline and
a live-dot. **The honest value is "unknown", not zero.** Violates principle #4.  → **P1**

**C-02 · CRITICAL · The greeting hardcodes a person's name.**
`HeaderBand.tsx:66`: `{timeOfDay}, Param <span className="inline-block">👋</span>`.
`"Param"` is a **string literal**. Every anonymous visitor to production is greeted
*"Good morning, Param 👋"* — verified live at 1440 px and 375 px, while the sidebar
simultaneously shows "Sign in" and "Standalone".  → **P1**

**C-03 · HIGH · `stats.pending` and the approval list disagree above 100.**
`/api/stats` returns unbounded `count(*)` over `domain_actions WHERE status='pending'`
(`stats/route.ts`). `/api/actions/pending` applies `.limit(100)` (`actions/pending/route.ts`).
Four surfaces render the aggregate — `JarvisCommandCenter.tsx:229` (sidebar badge),
`Bridge.tsx:457`, `KpiStrip.tsx:41`, `HeaderBand.tsx:46` — while `ApprovalCockpit.tsx:873`
renders `items.length` and `ApprovalDock.tsx:112` renders `visible.length`.
**At 137 pending, the sidebar says 137 and the cockpit says 100, on the same screen.** → **P1**

**C-04 · HIGH · `readModelsDegraded` is computed and largely ignored.**
Set in `data-core.ts`; consumed only by `views.tsx` and `OpsTicker.tsx`. Not by `KpiStrip`,
`HeaderBand`, `DailyBriefing`, `AnalyticsRow`, `PipelinePulse`, `DispatcherBoard`,
`TechnicianBoard`.  → **P1**

**C-05 · MEDIUM · "LIVE OPS" header over `sim ·` rows.**
`OpsTicker.tsx:45,54` correctly prefixes every synthetic line `sim · ` — honest at row
level — but the section label reads **LIVE OPS**. Live proof: header `● LIVE OPS`, row
`sim · inbound call answered — sulfur smell, well water, Fort Wayne`.  → **P1**

**C-06 · MEDIUM · The Live/Simulation chip renders a loading race as a fact.**
`live = !data.statsDegraded && data.stats !== null` (`JarvisCommandCenter.tsx:297`).
Desktop capture showed `SIMULATION`; the mobile capture of the same URL showed `LIVE`, and
system status went `Standalone` → `Partial config`. There is **no "resolving" state**. → **P1**

## 5.2 Broken frontend↔backend contracts

**C-07 · CRITICAL · Three backend action types have no renderer — including the most
important one.**
Backend has **44**; `registry.ts` registers **41**. Missing: `clarification_request`,
`manual_step_suggestion`, `route_suggestion`.
`clarification_request` is emitted **by design** — `planner.ts:80` instructs the model:
*"When an instruction … lacks a required fact or has multiple equally plausible real
targets, return exactly one clarification_request instead of guessing."*
And `grep -rn "clarif" src/` → **zero hits in the entire frontend.**
**Result:** when JARVIS asks a question, `FallbackRenderer.tsx` renders an amber
**"unmapped action type"** card with a *"show raw payload (debug)"* toggle, sitting in the
approval queue awaiting **Approve / Reject**. **The user is asked to approve a question.**
Violates principles #6 (ask rather than guess), #9 (no raw JSON), #12 (no raw payloads), and
breaks the golden journey outright.  → **P6** (this one) · **P9** (the other two)

**C-08 · HIGH · Two workflow-run states have no representation.**
`workflow_runs.status` includes `cancelled` and `escalated`.
`grep -n "escalated\|cancelled\|canceled" panels/WorkflowTheater.tsx` → **0 matches** — even
though the same file **offers `cancel` and `escalate` as run-control verbs**
(`WorkflowTheater.tsx:567` posts `workflows/runs/:id/:verb`).
**The UI can cause a state it cannot render.**  → **P8**

**C-09 · MEDIUM · `/api/events` is not an event stream.** Name implies push; it is
`SELECT … LIMIT 50`, polled at 8 s.  → **P3/P4**
**C-10 · MEDIUM · The proxy cannot stream.** `route.ts:151-153`.  → **P4**
**C-11 · MEDIUM · `useLiveQuery`'s SSE branch is dead code.** Real `EventSource` at
`useLiveQuery.ts:137`; zero callers pass `sseUrl`.  → **P4**
**C-12 · MEDIUM · Backend routes exist that the proxy blocks.** §4.2.  → **P9**

## 5.3 Causality and semantics defects

**C-13 · CRITICAL · The Orb's states are semantically false.**
`Bridge.tsx:73-88`, `useOrbLiveState()`:
```
state = "executing"  ⟸  voiceState === "speaking"   ||  runs.length > 0
state = "planning"   ⟸  voiceState === "connecting" ||  voiceState === "live"
```
with `OrbState = "idle"|"planning"|"executing"|"blocked"|"error"` (`Orb3D.tsx:40`).
So **"planning" actually means "the microphone is open"**, and **"executing" actually means
"the assistant is talking"**. The orb receives **no input from the instruction lifecycle at
all** — during the one moment JARVIS genuinely plans (the blocking `POST /api/actions`), a
typed instruction leaves the orb on `idle`.
**The system's central signifier is wired to the wrong signal.** This is the single most
important defect behind "it doesn't feel like JARVIS."  → **P2/P5**

**C-14 · CRITICAL · The instruction journey has no intermediate states.**
`CommandBar.tsx:44-77`: `sfx.send()` → `setBusy(true)` → `await jarvisPost("actions",
{instruction})` → `setNote("Planned N actions — check the approval dock.")`.
Between submit and result there is **a spinning button and nothing else**. No
acknowledgement, no context retrieval, no planning, no clarification, no streaming.
Meanwhile `orchestration/src/index.ts:102-158` runs: secrets → memory snapshot → LLM plan →
episode append ×N → readiness check → policy load → execute → reflect → critic enqueue →
plan dispatch. **All invisible.**  → **P3/P5**

**C-15 · HIGH · Signed-out visitors trigger an unbounded 401 storm.**
Live-measured this session on `finnorai.com/jarvis`: `actions/pending?filter=pending`,
`?filter=blocked`, `workflows/runs?status=running` **401 every 4 s**; `events`, `comms`,
`workflows/runs` **401 every 8 s**; seven read-models + `insights` 401 on the slow lane.
≈ **90 failed requests per minute, forever, no auth gate, no backoff.** It also pins
`pendingDegraded` / `readModelsDegraded` permanently true, so "degraded" loses all
diagnostic meaning.  → **P1**

**C-16 · MEDIUM · `views.tsx` polls independently of the provider.**
`setInterval(reload, 8000)` inside `views.tsx` — a second data island.  → **P11**

## 5.4 Architecture defects

**C-17 · CRITICAL · The immersive surface is unreachable.** `PersonalizedHome.tsx:61`. → **P11**
**C-18 · HIGH · ~100 motion primitives are quarantined in a dev route.** §3.4. → **P10**
**C-19 · HIGH · Five subsystems exist twice.** §2.3. → **P11**
**C-20 · MEDIUM · `views.tsx` is 47 KB / 9 views in one file.** → **P11**
**C-21 · MEDIUM · The perf baseline is unreproducible.** 56/95/98; TBT 1460/140/30 ms. → **P14**

## 5.5 Ledger summary

| Severity | Count | IDs |
|---|---|---|
| **CRITICAL** | 6 | C-01, C-02, C-07, C-13, C-14, C-17 |
| **HIGH** | 6 | C-03, C-04, C-08, C-15, C-18, C-19 |
| **MEDIUM** | 9 | C-05, C-06, C-09, C-10, C-11, C-12, C-16, C-20, C-21 |

---

# §6. UX AND VISUAL-QUALITY DIAGNOSIS

## 6.1 The core diagnosis

**The interface is a dashboard wearing a command bar, not a command environment.**

`JarvisCommandCenter.tsx:92-138` renders, in DOM order:
`HeaderBand → DegradedBanner → DailyBriefing → KpiStrip → DispatcherBoard → TechnicianBoard
→ [WorkflowTheater | LiveCallPanel] → [SystemConsole | ChannelDonut | ActionMixBars |
AiPerformance] → [PipelinePulse | ApprovalDock | CommsFeed | ActivityRail] →
[DataQualityQueue | DlqBrowser] → CertificationStatus → **CommandBar**`

**The command input is the 16th and last element.** The primary interaction of a
voice-native OS sits below eleven dashboard panels. Verified on mobile: at 375 px you scroll
past five KPI cards and the workflow blueprint before reaching anything you can talk to.

## 6.2 Information architecture

- Navigation is a **13-item flat list** with no grouping — every destination has equal
  weight, so nothing signals where work happens.
- Sidebar is `hidden lg:flex`; mobile gets a horizontally-scrolling chip row of the same 13
  items (`:359-372`) — a worse version of the same flat list.
- **Nothing in the layout changes when work is in flight.** A run executing and a system at
  rest produce the same page.

## 6.3 Density and hierarchy

Sixteen panels at one visual weight; every card is `j-panel`, every heading `j-label`. There
is no primary/secondary/tertiary tier, so the eye has no entry point. The three
operationally-critical metrics (approvals waiting, runs in flight, failures) sit in the same
5-across strip as two financial ones.

## 6.4 Motion

Motion that **ships in product** is decorative: `jarvis-rise` staggered card entry (`:91`,
`delay(idx*60)`), a permanently-animating gradient sweep on the command pill
(`CommandBar.tsx:88-89`, `repeat: Infinity`), particle field, aurora, grid floor.

Motion that is **semantic** — `liquidFill`, `valvePulse`, `bypassUnfurl`, `stampApprove`,
`shatterReject`, `deckFan`, `cameraPan`, `radarSweep`, `drawSpark` (`ui/motion/choreo.ts`)
plus ~100 FLOW primitives — **renders only on `/jarvis/stage`**.

**This is why the product feels static despite an enormous motion investment:** the ambient
loops never stop and never mean anything, while the meaningful cues never play.

## 6.5 State grammar gaps

`ui/primitives/` ships a complete state grammar — `EmptyState`, `ErrorState`, `Skeletons`,
`StaleFog`, `PermissionVeil`. The highest-traffic surface, `KpiStrip`, uses **none** of them:
it has exactly one state — "a number" — which it renders whether the number is known,
unknown, denied or stale.

## 6.6 Typography and colour

`jarvis-theme.css` (22 KB) defines a coherent token set (`--j-text`, `--j-text-dim`,
`--j-text-faint`, `--j-cyan/green/red/violet/blue/amber`, `j-panel`, `j-chip`, `j-label`) and
adoption is good. The problem is **scale discipline, not palette**: font sizes in panel JSX
run `text-[8px] · [8.5px] · [9px] · [9.5px] · [10px] · [10.5px] · [11px] · [11.5px] ·
[12px] · [12.5px] · [13px] · [14px] · [15px]` — a **13-step ad-hoc ramp**, most of it below
the 11 px legibility floor. §11.1 replaces it with a 6-step scale.

## 6.7 The orb

C-13 restated as design: the orb is the product's face. It has five expressive states with
distinct colour, energy and spin (`Orb3D.tsx:45-52`). **Two of the five are wired to
microphone status rather than cognition.** A user watching the orb learns nothing about what
JARVIS is doing.

## 6.8 What is already excellent

Approval Cockpit's risk tiers, typed confirmation for high-risk batches, critic verdicts and
price-book provenance are genuinely above market. Showtime is correctly gated and labelled
synthetic (`Showtime.tsx:115,125`). OpsTicker's `sim ·` row prefix is exactly the right
instinct — §7.2 generalises that instinct into a type.

---

# §7. CANONICAL EVENT/STATE ARCHITECTURE — **THE KERNEL**

**This section is binding. Do not rename, add, or remove.**

## 7.1 Location and shape

New directory `src/components/jarvis/kernel/`:

```
kernel/
  types.ts          entity + state types, Truth<T>, failure taxonomy
  machine.ts        transition tables + reducers (pure, unit-tested)
  store.tsx         JarvisKernelProvider, useKernel()
  selectors.ts      THE ONLY place a displayed fact is derived
  presence.ts       global presence derivation
  choreography.ts   state transition -> motion/sound/haptic cue (EVENT_TO_PIXEL)
  instruction.ts    instruction session client + trace polling
  transport.ts      SSE / polling convergence
  index.ts          barrel
```

**`kernel/` wraps `lib/data-core.ts`; it does not replace it.** `data-core` remains the
network lane runner; the kernel owns interpretation. This is the strangler seam and it is
why P2 is low-risk.

## 7.2 `Truth<T>` — the type that makes fabricated data impossible

```ts
// kernel/types.ts
export type TruthSource =
  | "api:stats" | "api:actions-pending" | "api:workflow-runs" | "api:read-model"
  | "api:activity" | "api:vitals" | "api:receipts" | "api:instruction"
  | "derived" | "fixture"

export type Truth<T> =
  | { status: "known";       value: T; source: TruthSource; atMs: number }
  | { status: "stale";       value: T; source: TruthSource; atMs: number; ageMs: number }
  | { status: "partial";     value: T; source: TruthSource; atMs: number; capped: number }
  | { status: "unknown";     reason: "loading" | "never-fetched" }
  | { status: "denied";      reason: "signed-out" | "role" }
  | { status: "unavailable"; reason: "network" | "server" | "not-configured"; sinceMs: number }
```

Rules (lint-enforced, §12.2):
- No component renders a network-derived number except through `Truth<T>`.
- `?? 0` on a network value is a **lint error**.
- `status:"partial"` is exactly what `/api/actions/pending`'s `.limit(100)` produces — the
  cockpit renders **"100 of 137"** instead of a second, contradictory total. **This is the
  structural fix for C-03.**

## 7.3 Entities and state sets

Backend-mirroring sets are **copied verbatim** from §4.3.

```ts
export type ActionState =            // === domain_actions.status  (schema.ts:193)
  | "draft" | "pending" | "approved" | "rejected" | "executing"
  | "completed" | "failed" | "needs_human_review" | "blocked_integration_unavailable"

export type RunState =               // === workflow_runs.status   (schema.ts:921)
  | "running" | "completed" | "failed" | "compensating" | "compensated"
  | "paused" | "cancelled" | "escalated"

export type StepState =              // === workflow_steps.status  (schema.ts:943)
  | "pending" | "leased" | "completed" | "failed" | "compensating" | "compensated"

export type JobState =               // === jobs.status            (schema.ts:345)
  | "queued" | "running" | "completed" | "failed" | "dead_letter"
```

The **one genuinely new** entity — the instruction session. No backend table today; Phase 3
adds one.

```ts
export type InstructionState =
  | "idle"                   // no active instruction
  | "captured"               // text committed / final transcript received
  | "acknowledged"           // server accepted; instruction id exists
  | "retrieving_context"     // memory snapshot in progress
  | "planning"               // planner running
  | "clarification_required" // planner returned clarification_request
  | "plan_ready"             // plan exists, nothing gated yet
  | "awaiting_approval"      // >=1 action pending
  | "dispatching"            // approved, queued
  | "executing"              // >=1 action/run executing
  | "verifying"              // reflection / prediction-diff running
  | "completed"              // all terminal-success
  | "partially_completed"    // mixed terminal
  | "failed"                 // all terminal-failure
  | "cancelled"              // user cancelled
```

**Transport is separate from entities:**

```ts
export type ConnectionState =
  | "connecting" | "live" | "polling" | "reconnecting" | "degraded" | "offline"
export type FreshnessState = "fresh" | "aging" | "stale"
```

**Why `stale` and `disconnected` are NOT instruction states** (deviating from the brief's
candidate list, deliberately): the candidate list mixes entity lifecycle with transport
health. Conflating them produces exactly the bug class in C-06 — a loading race rendered as
a factual claim. Transport health is orthogonal and composes with every entity state.

## 7.4 Instruction transition table — **binding**

| From | Event | To |
|---|---|---|
| `idle` | `INSTRUCTION_SUBMITTED` | `captured` |
| `captured` | `SERVER_ACK` | `acknowledged` |
| `captured` | `SUBMIT_FAILED` | `failed` |
| `acknowledged` | `TRACE_context_retrieved` | `retrieving_context` |
| `acknowledged` \| `retrieving_context` | `TRACE_planning` | `planning` |
| `planning` | `TRACE_clarification_required` | `clarification_required` |
| `planning` | `TRACE_plan_ready` | `plan_ready` |
| `planning` | `TRACE_failed` | `failed` |
| `clarification_required` | `CLARIFICATION_ANSWERED` | `captured` (new turn, same thread) |
| `clarification_required` | `USER_CANCELLED` | `cancelled` |
| `plan_ready` | `ACTION_pending` (≥1) | `awaiting_approval` |
| `plan_ready` | `ACTION_executing` (0 gated) | `executing` |
| `awaiting_approval` | `ACTION_approved` (all decided) | `dispatching` |
| `awaiting_approval` | `ACTION_rejected` (all rejected) | `cancelled` |
| `awaiting_approval` | `USER_CANCELLED` | `cancelled` |
| `dispatching` | `ACTION_executing` \| `RUN_running` | `executing` |
| `executing` | `TRACE_verifying` | `verifying` |
| `executing` \| `verifying` | all terminal · all success | `completed` |
| `executing` \| `verifying` | all terminal · mixed | `partially_completed` |
| `executing` \| `verifying` | all terminal · all failed | `failed` |
| `executing` | `ACTION_needs_human_review` | `awaiting_approval` |
| any non-terminal | `RUN_escalated` | `awaiting_approval` |
| any | `KERNEL_RESET` | `idle` |

Terminal: `completed`, `partially_completed`, `failed`, `cancelled`.
**Any unlisted (state, event) pair is a no-op that logs a dev warning** — never a crash,
never a silent state change.

## 7.5 Presence — the single input to the Orb

```ts
export type Presence =
  | "dormant"     // idle, nothing in flight
  | "listening"   // mic open, no speech
  | "hearing"     // user speaking
  | "thinking"    // retrieving_context | planning
  | "asking"      // clarification_required
  | "proposing"   // plan_ready | awaiting_approval
  | "working"     // dispatching | executing
  | "verifying"   // verifying
  | "resolved"    // terminal success; 4 s decay -> dormant
  | "wounded"     // failed | partially_completed
  | "obstructed"  // blocked / needs_human_review with no active instruction
  | "severed"     // transport offline/degraded
```

**Binding derivation order — first match wins:**

```
1. transport === "offline" | "degraded"       -> "severed"
2. instruction is non-terminal                 -> map (below)
3. voice speaking / mic open                   -> "hearing" | "listening"
4. blocked > 0 || needsHumanReview > 0         -> "obstructed"
5. otherwise                                   -> "dormant"
```

Instruction→presence: `captured|acknowledged|retrieving_context|planning`→`thinking` ·
`clarification_required`→`asking` · `plan_ready|awaiting_approval`→`proposing` ·
`dispatching|executing`→`working` · `verifying`→`verifying` · terminal-success→`resolved`
(decays) · terminal-fail→`wounded`.

**Rule: no component may compute presence itself.** `useKernel().presence` is the only
source. **This structurally kills C-13** — the orb can no longer be handed voice state.
`Orb3D`'s existing 5-value `OrbState` is superseded; P2 extends `STATE_COLOR` /
`STATE_ENERGY` / `STATE_SPIN` (`Orb3D.tsx:45-52`) to all 12.

## 7.6 Ordering, dedup, restore

- Every kernel event carries `{id, entityType, entityId, seq, atMs}`.
- **Dedup key** `entityType:entityId:seq`, held in a 500-entry LRU.
- **Ordering:** apply strictly increasing `seq` per entity. Lower or equal → drop.
- **Gap detection:** `seq > last + 1` → mark the entity `freshness:"stale"`, trigger a
  targeted refetch, **never guess** the intermediate states.
- **Restore after refresh/reconnect:** on mount and on every transition to `live`, refetch
  the authoritative snapshot **before** applying stream events; buffer arrivals during the
  refetch and replay them after, filtered by `seq`.
- **Optimistic UI is bounded:** an optimistic entity carries `optimisticUntilMs = now +
  6000`. Server truth always overwrites. On expiry without confirmation the entity flips to
  `Truth.status:"unknown"` and the UI says so. **Only three optimistic operations are
  permitted: approve, reject, submit-instruction.** Nothing else.

## 7.7 Realtime and polling converge on one cache

`kernel/transport.ts` exposes a single `applyServerFacts(facts, meta)`. **Both** the poll
lanes and the SSE stream call it. Components cannot tell which produced the data; the only
observable difference is `ConnectionState` and latency. **There is exactly one cache.**

---

# §8. EVENT-TO-PIXEL CONTRACT

## 8.1 The table is code, not prose

`kernel/choreography.ts`:

```ts
export interface PixelResponse {
  scene?: SceneId                 // centre-stage scene to switch to
  panels: PanelId[]               // panels that must visibly react
  motion: MotionCue | null        // FLOW primitive id + intensity
  sound: SoundCue | null          // sfx key; respects mute + quiet hours
  haptic: HapticCue | null        // pattern key; mobile only
  notify: "none" | "toast" | "push"
  deepLink?: (id: string) => string
  reducedMotion: StaticCue        // REQUIRED — never null
  failureFallback: StaticCue      // REQUIRED — renders if the cue cannot play
}
export const EVENT_TO_PIXEL: Record<KernelEventName, PixelResponse>
```

A P10/P14 test asserts `EVENT_TO_PIXEL` covers every `KernelEventName` **exhaustively**.
**A missing entry is a build failure, not a silent gap.**

## 8.2 The binding matrix

| Backend fact | Kernel state | Scene | Panels reacting | Motion | Sound | Notify | Deep link | Reduced-motion | Failure fallback |
|---|---|---|---|---|---|---|---|---|---|
| instruction POST sent | `captured` | command | CommandRail, Orb | orb contract + rail ring accelerate | `sfx.send` | none | — | rail border solid cyan | text "Sent…" |
| server ack (id) | `acknowledged` | command | ThinkingTheater mounts | `DecryptText` on echoed instruction | none | none | — | plain instruction text | text echo |
| episode `context_retrieved` | `retrieving_context` | thinking | ThinkingTheater | `radarSweep` over memory chips | soft tick | none | — | "Retrieving context" + counts | step label |
| episode `plan_ready` | `plan_ready` | thinking | ThinkingTheater, Orb | `drawSpark` along plan-DAG edges | `sfx.tick` | none | — | ordered step list | step list |
| type `clarification_request` | `clarification_required` | clarify | ClarificationScene (focus) | `bypassUnfurl` | distinct 2-tone | toast | `#clarify-{id}` | card + autofocused input | card |
| `domain_actions`→`pending` | `awaiting_approval` | approval | Cockpit, KPI, Orb, rail badge | `deckFan` card in | `sfx.pending` | toast | `#approve-{id}` | card slides, no fan | card appears |
| approve accepted | `dispatching` | approval→execution | Cockpit, Orb | `stampApprove` | `sfx.approve` | none | — | static stamp | "Approved" chip |
| reject accepted | `cancelled` | approval | Cockpit | `shatterReject` | `sfx.reject` | none | — | card fades | card removed |
| `domain_actions`→`executing` | `executing` | execution | ExecutionTheater, Orb, KPI | `liquidFill` on action bar | `sfx.exec` | none | — | determinate bar | bar |
| `workflow_steps`→`leased` | step active | execution | WorkflowTheater | `valvePulse` on node | soft tick | none | — | node outline solid | node highlight |
| `workflow_steps`→`completed` | step done | execution | WorkflowTheater, PulseBar | `drawSpark` edge + particulate | `sfx.step` | none | `#step-{id}` | edge solid | edge colour |
| `workflow_steps`→`failed` | step failed | execution | WorkflowTheater, Alerts | node shake + red bloom | `sfx.fail` | toast | `#step-{id}` | red node + reason | reason text |
| `workflow_runs`→`compensating` | `compensating` | execution | WorkflowTheater | reverse `liquidFill` (drain) | low tone | toast | — | amber "Rolling back" | label |
| `workflow_runs`→`compensated` | `compensated` | execution | WorkflowTheater, Receipt | drain settles | resolve tone | toast | receipt | "Rolled back" | label |
| `workflow_runs`→`paused` | `paused` | execution | WorkflowTheater | motion freezes, dim | none | none | — | dim + "Paused" | label |
| `workflow_runs`→`cancelled` | `cancelled` | execution | WorkflowTheater | fade + strike-through | none | toast | — | strike-through | label |
| `workflow_runs`→`escalated` | `awaiting_approval` | approval | Cockpit, Alerts | `bypassUnfurl` into human lane | alert tone | **push** | `#escalated-{id}` | amber card | card |
| episode `verified` | `verifying`→terminal | verification | VerificationScene | predicted-vs-actual diff reveal | `sfx.resolve` | toast | `#receipt-{id}` | side-by-side table | table |
| instruction terminal success | `completed` | receipt | Receipt, KPI, Activity, Orb | orb `resolved` bloom, 4 s decay | `sfx.complete` | toast | receipt | static bloom frame | "Done" |
| instruction terminal mixed | `partially_completed` | receipt | Receipt, Alerts | split bloom | 2-tone | toast | receipt | "2 of 3 succeeded" | text |
| `dlq` row opens | — | alerts | DlqBrowser, Alerts | pulse badge | alert tone | push | `#dlq-{id}` | badge | badge |
| action→`blocked_integration_unavailable` | `obstructed` | alerts | DegradedBanner, Cockpit | `PermissionVeil` over affected panels | none | toast | setup link | veil + reason | reason text |
| transport→`reconnecting` | — | any | PulseBar + data panels | `StaleFog` fade-in | none | none | — | "Reconnecting" chip | chip |
| transport→`offline` | `severed` | any | global | orb `severed`, aurora dims | none | toast | — | banner | banner |
| transport→`live` after loss | — | any | global | one-shot relight cascade | soft chord | none | — | fog clears | fog clears |

## 8.3 Rules governing this table

1. **No motion outside the table ships.** New motion = new row + review.
2. **`reducedMotion` and `failureFallback` are non-nullable** — a cue that cannot degrade is
   not allowed to exist.
3. **Every `notify:"push"` row is gated by quiet hours** (`lib/quiet-hours.ts`).
4. **Sound stays default-muted** (`sound.ts` already is — preserve it).
5. **Latency budget:** backend fact → pixel change ≤ **1200 ms** on SSE, ≤ **5000 ms** on
   polling fallback. Measured in P14.

---

# §9. TARGET INFORMATION ARCHITECTURE

## 9.1 The global spatial model

One continuous space. Three persistent regions plus a modal layer.

```
┌────────────────────────────────────────────────────────────────────────┐
│  PULSE STRIP — transport · freshness · tenant · mode · mute · low-power │
├───────────┬────────────────────────────────────────────┬───────────────┤
│  LEFT     │             CENTRE STAGE                   │  RIGHT        │
│  RAIL     │   the ONE thing happening now:             │  RAIL         │
│           │   command · thinking · clarify · approval  │               │
│  Orb      │   execution · verification · receipt       │  Activity     │
│ (presence)│   context:{entity} · map · day · ops       │  Alerts       │
│  Scenes   │                                            │  Approvals    │
│  Frecency │   scenes CROSS-FADE (cameraPan);           │  peek         │
│           │   they never stack                         │               │
├───────────┴────────────────────────────────────────────┴───────────────┤
│  COMMAND RAIL — always present, always focusable, "/" · ⌘K · push-to-talk│
└────────────────────────────────────────────────────────────────────────┘
```

**The Command Rail is pinned and never scrolls out of view.** This single change inverts
`JarvisCommandCenter.tsx:135`, where the command bar is the last of sixteen stacked elements.

## 9.2 Scenes

| Scene | Shows | Auto-entered when |
|---|---|---|
| `command` | greeting, suggestions, recent threads | presence `dormant`/`listening` |
| `thinking` | instruction echo, context chips, plan DAG forming | `thinking` |
| `clarify` | the question, answer affordances, why-asked | `asking` |
| `approval` | Approval Cockpit | `proposing` |
| `execution` | Execution Theater + Workflow Theater | `working` |
| `verification` | predicted vs actual | `verifying` |
| `receipt` | full receipt + evidence | terminal, or user opens one |
| `context:{entity}` | customer / lead / invoice / technician 360 | user drills in |
| `map` | Dispatch Map | dispatcher default |
| `day` | My Day | technician default |
| `ops` | KPI, analytics, DLQ, data quality, certification | user opens Ops |

**Scene switching is automatic and reversible.** A "pin" control freezes the scene;
pinning is session-scoped.

## 9.3 Where the 13 legacy views go

| Legacy view | Destination |
|---|---|
| Command Center | dissolved into `command` + `ops` |
| Voice Console | merged into Command Rail + `thinking` |
| Leads & CRM | `context:lead` + `ops` list |
| Customers | `context:customer` |
| Workflows | `execution` |
| Inventory · Invoices · Water Compliance | `ops`, tabbed |
| Web Research | result renderers inside `thinking` / `receipt` |
| Activity | right rail (already persistent) |
| Dispatch Map | `map` |
| My Day | `day` |
| Production Readiness | `ops`, owner-only |

## 9.4 Density and hierarchy rules — binding

- **Exactly one primary element per viewport.** Centre stage owns it.
- **Three weights only** — `primary` (centre-stage focus), `secondary` (rails), `tertiary`
  (pulse strip, footnotes). Encoded as `data-weight` on `Panel`.
- **Rails ≤ 320 px** on desktop; collapse to a bottom sheet below 1024 px.
- **Maximum 5 KPI tiles anywhere**, and only in `ops` — never on the command path.
- **No panel renders > 7 rows without its own scroll container.**

---

# §10. MOTION AND INTERACTION LANGUAGE

## 10.1 Grammar — four families

| Family | Means | Duration | Easing | Examples |
|---|---|---|---|---|
| **Arrival** | new truth entered the system | 260–420 ms | `[0.22,1,0.36,1]` | `deckFan`, `DecryptText` |
| **Progress** | work is happening | continuous, bounded | linear / easeInOut | `liquidFill`, `valvePulse`, `drawSpark` |
| **Consequence** | a decision took effect | 180–320 ms | `[0.34,1.56,0.64,1]` | `stampApprove`, `shatterReject` |
| **Navigation** | the space moved | 320–480 ms | `[0.22,1,0.36,1]` | `cameraPan` |

**Ambient** is not motion grammar — it is atmosphere, capped at **2 running loops per
viewport** (§0.6.8).

## 10.2 Intensity

Every cue takes `intensity: 0|1|2|3`, derived from **risk tier and blast radius**, never
aesthetics: `0` reduced-motion/low-power → static · `1` routine (a step completed) ·
`2` consequential (approval, run terminal) · `3` critical (failure, escalation, compensation).

## 10.3 Sound grammar

Extend `sound.ts` (`sfx`, `setMuted`, `setVoiceLive`, `eventPingThrottled`) — do not replace.
- Default muted; opt-in persisted in `finnor.jarvis.sound-enabled`.
- One family per event class; **pitch encodes outcome** (rising = success, falling = failure).
- Master ducking while voice is live (already implemented — keep).
- **Never more than one cue per 400 ms** — throttle and drop, never queue.
- Quiet hours suppress everything above intensity 1.

## 10.4 Transition grammar

- Scene→scene: `cameraPan`, 380 ms, cross-fade + 2 % scale. **Never a slide-in stack.**
- Panel content swap: cross-fade 180 ms, height reserved — no layout jump.
- Entity state change: the §8.2 cue, anchored to the entity's own DOM node via
  `pulse-bus.ts`'s existing `registerAnchor` / `getAnchorRect` — **reuse, do not reinvent**.

## 10.5 Empty / loading / error / degraded grammar

Reuse `ui/primitives/`. **Binding mapping from `Truth.status`:**

| `Truth.status` | Component | Copy pattern |
|---|---|---|
| `unknown:loading` | `SkeletonStat` / `SkeletonRow` | — |
| `unknown:never-fetched` | `EmptyState` | "Nothing here yet" + the action that creates one |
| `denied:signed-out` | `PermissionVeil` | "Sign in to see this" + link |
| `denied:role` | `PermissionVeil` | "Your role doesn't include this" |
| `unavailable:network` | `ErrorState` | "Can't reach JARVIS" + retry + last-known age |
| `unavailable:not-configured` | `EmptyState` (amber) | "Not connected yet" + setup deep link |
| `stale` | `StaleFog` over the live value | "Last confirmed 2m ago" |
| `partial` | value + chip | "100 of 137 shown" |

**A number never renders for a non-`known`/`stale` status.** This is the mechanism that makes
C-01 structurally impossible.

## 10.6 Reduced motion and low power

- `MotionConfig reducedMotion="user"` already wraps Command Center (`:414`) — extend to Bridge.
- Every §8.2 `reducedMotion` cue must convey **the same information**: if motion showed
  progress, the static cue shows a determinate bar with a number.
- Low-power (`lib/low-power.ts`) disables ambient + 3D orb → a 2D presence badge with the
  same 12 states and colours.

---

# §11. DESIGN-SYSTEM CORRECTIONS

## 11.1 Type scale — replaces the 13-step ad-hoc ramp (§6.6)

| Token | px / line-height | Use |
|---|---|---|
| `--j-fs-micro` | 11 / 1.4 | chips, labels — **absolute floor** |
| `--j-fs-sm` | 12.5 / 1.5 | secondary body, table cells |
| `--j-fs-base` | 14 / 1.55 | body |
| `--j-fs-lg` | 17 / 1.4 | panel titles |
| `--j-fs-xl` | 22 / 1.25 | scene titles |
| `--j-fs-display` | 32 / 1.1 | the one primary number per scene |

**Nothing below 11 px ships.** P12 sweeps out `text-[8px]`…`text-[10.5px]`.

## 11.2 Spacing

4 px base. Allowed: **4, 8, 12, 16, 24, 32, 48**. Nothing else.

## 11.3 Colour semantics — binding

| Token | Means | Never used for |
|---|---|---|
| `--j-cyan` | JARVIS presence / attention | success |
| `--j-green` | verified success, money collected | in-progress |
| `--j-amber` | degraded, partial, needs human | failure |
| `--j-red` | failure, overdue, destructive | warnings |
| `--j-violet` | planning / cognition | execution |
| `--j-blue` | execution in flight | idle |

Atmosphere colours are **not** semantic and must never carry state.

## 11.4 Material

Three surfaces only: `j-panel` (elevated content) · `j-panel-hot` (active/focused) ·
`j-chip` (metadata). Glass blur on rails and modals only — **never on scrolling content**.

## 11.5 Component boundary rules

- **`Panel`** is the only card container; gains `data-weight="primary|secondary|tertiary"`.
- **`Metric`** (`lib/Metric.tsx`) is the only numeric renderer. **P1 rewrites its signature**
  from `value: number; source: "live"|"derived"` to `value: Truth<number>`, making it the
  enforcement point its own docstring already claims it is.
- **`StatusDot`, `RiskBadge`, `Chip`** are the only status affordances.

---

# §12. DATA CONSISTENCY STRATEGY

## 12.1 One fact, one selector

`kernel/selectors.ts` is the **only** module that turns raw responses into displayed facts.
Every selector returns `Truth<T>`.

```ts
export function selectPendingApprovals(k): Truth<{ total: number; shown: number }>
export function selectRunsInFlight(k):     Truth<number>
export function selectBlockedCount(k):     Truth<number>
export function selectCollectedUsd(k):     Truth<number>
export function selectOverdue(k):          Truth<{ count: number; usd: number }>
export function selectOpenLeads(k):        Truth<number>
export function selectQuotesAwaitingSignature(k): Truth<number>
export function selectStuckRuns(k):        Truth<number>
export function selectOpenReconciliation(k): Truth<number>
export function selectPresence(k):         Presence
export function selectSceneForState(k):    SceneId
```

**`selectPendingApprovals` resolves C-03 explicitly:**
- both sources present, `list.length < 100`, equal → `known {total, shown}`
- both present, `list.length === 100` → `partial {value:{total, shown:100}, capped:100}`
- disagreement below the cap → `known` with `total` from `/api/stats` (**the authority**)
  plus a dev-only console warning naming both values
- stats missing → `unknown`

## 12.2 The rule that kills the class of bug

> **No React component may access `useJarvis()` raw fields for a displayed fact.**
> Components call selectors. `useJarvis()` is available **inside `kernel/` only**.

Enforced by ESLint `no-restricted-imports` plus a custom `?? 0` rule, added in P1.

## 12.3 Optimistic constraints

Only `approve`, `reject`, `submit-instruction`. 6 s ceiling. Server always wins. (§7.6)

## 12.4 Cross-surface identity

Every entity carries `entityKey = "{type}:{id}"`. `pulse-bus.ts`'s existing anchor registry
keys off it, so the same entity animates consistently everywhere and `setLineageHover` links
its representations.

---

# §13. REALTIME AND FALLBACK STRATEGY

## 13.1 Staged, not big-bang

**Phase 3 — instruction trace via fast poll.** No new infrastructure. The client mints an
`instructionId` (UUID v4), sends it with `POST /api/actions`, and immediately polls
`GET /api/instructions/{id}/events?after={seq}` at **400 ms** *for the duration of that
instruction only*. The backend writes real episode rows. **This delivers genuine cognition
states with zero streaming risk.**

**Phase 4 — SSE for the global feed**, converging on the same cache via
`kernel/transport.ts`. The instruction trace upgrades to the same stream; the 400 ms poll
remains the automatic fallback.

## 13.2 Required backend additions (Phase 3) — precisely scoped, nothing else

1. **Table `instruction_sessions`** — `id uuid pk · tenant_id uuid · user_id uuid ·
   source text('voice'|'text') · transcript text · status text · correlation_id text ·
   created_at · updated_at`
2. **Table `instruction_events`** (append-only) — `id uuid pk · tenant_id uuid ·
   instruction_id uuid · seq int · phase text · payload jsonb · occurred_at timestamptz`,
   unique `(instruction_id, seq)`.
   **`phase` vocabulary (fixed):** `received · context_retrieved · planning · plan_ready ·
   clarification_required · action_created · action_gated · dispatched · executing ·
   step_progress · verifying · verified · completed · failed · cancelled`
3. **`domain_actions.instruction_id uuid null`** — links actions back to their instruction.
4. **`POST /api/actions`** accepts optional `instructionId`; creates the session row; emits
   `instruction_events` at each stage of `handleInstruction`.
   **Response shape unchanged (`{planned}`) — fully backwards compatible.**
5. **`GET /api/instructions/{id}`** — session + terminal summary (restore after refresh).
6. **`GET /api/instructions/{id}/events?after={seq}`** — ordered events.
7. Proxy allowlist: `instructions`, `instructions/:id`, `instructions/:id/events`.

## 13.3 SSE (Phase 4)

- **Backend** `GET /api/stream` — `ReadableStream`, `text/event-stream`, 25 s heartbeat
  comment frames, `Last-Event-ID` support, tenant-scoped. Source: `outbox_events` +
  `instruction_events`, ordered by `seq`.
- **Frontend proxy** — **new file** `src/app/api/jarvis/stream/route.ts`,
  `export const runtime = "edge"`, pipes `upstream.body` through **without `.text()`**.
  The existing catch-all must **not** match `stream` (Next resolves the more specific
  segment route first — assert this with a test).
- `useLiveQuery` finally gets a caller passing `sseUrl` — closing **C-11**.
- **Fallback ladder:** `live` → (2 consecutive failures) → `polling` → (navigator offline) →
  `offline`. Every transition visible in the Pulse Strip.

## 13.4 Freshness

Per-lane `lastSuccessMs`: `fresh < 1× interval` · `aging < 3×` · `stale ≥ 3×` — reusing the
existing `SLOW_LANE_STALE_MS` convention (`data-core.ts:383`). `stale` →
`Truth.status:"stale"` → `StaleFog`.

## 13.5 Auth gating — fixes C-15

`data-core.ts` must **not** start private lanes without a session:
- no session → **public lane only** (`stats`, `setup/status`, `integrations/status`)
- private lane 401 → **stop that lane**, set `Truth.status:"denied"`, do not retry until the
  auth state changes
- exponential backoff `4 s → 8 s → 16 s → 32 s → cap 60 s` on `unavailable` (5xx/network)

---

# §14. RENDERER COVERAGE STRATEGY

## 14.1 Close the 3-type gap

| Type | Tier | Component | Behaviour |
|---|---|---|---|
| `clarification_request` | **interactive — NOT an approval** | `renderers/ClarificationScene.tsx` | Renders the question, `missingFields` as typed inputs, a "why I'm asking" disclosure, and **Answer / Skip / Cancel**. **Never Approve/Reject.** Answering POSTs a new instruction carrying `parentInstructionId`. |
| `manual_step_suggestion` | standard | `renderers/ManualStepCard.tsx` | Checklist with "I did this" / "Can't do this" → `POST /api/corrections`. |
| `route_suggestion` | flagship | `renderers/flagships/RouteScene.tsx` | Map polyline + ordered stops + time saved. Reuses `DispatchMap`. |

## 14.2 The registry becomes self-verifying

Add `ui/renderers/registry.test.ts`:
1. Import the backend list from a **generated** file
   `src/lib/jarvis/backend-action-types.generated.ts`.
2. Assert every backend type has a registry entry.
3. Assert every registry entry has a fixture.
4. Assert `FallbackRenderer` is reachable by **zero** real types.

Generator `scripts/gen-action-types.mjs` reads
`finnor-os/packages/domain-plugins/*/index.ts`. Wire into `npm run jarvis:types`.
**This makes C-07 permanently impossible.**

## 14.3 Correct the false comments

`registry.ts`'s header and its `REGISTERED_ACTION_TYPES` docstring both assert "41" and
"none of the 41 hit [the fallback]". Update both to the generated count and to the truth.

---

# §15. DEMO AND DEALER ZERO STRATEGY

## 15.1 Three modes, always labelled

| Mode | Data | Label | Where |
|---|---|---|---|
| `production` | real tenant | none | signed-in |
| `showcase` | real Dealer Zero tenant, time-compressed | persistent `SYNTHETIC DAY · 60×` | `/jarvis/showtime` |
| `preview` | public aggregates only | persistent `PUBLIC PREVIEW` | signed-out `/jarvis` |

## 15.2 Binding rules

1. **Mode is a kernel field**, never a per-component guess.
2. **`showcase` and `preview` render a persistent, non-dismissible chip in the Pulse Strip**
   — primary chrome, not a corner badge.
3. **`preview` shows no zeros.** Every private metric is `Truth.denied` → `PermissionVeil`
   with "Sign in to see this." This is the direct fix for the live-verified
   `$0 / $0 / 0 / 0` screen.
4. **The ticker is renamed** — "LIVE OPS" over synthetic rows (C-05) becomes **"SAMPLE OPS"**
   whenever any row is `sim ·`; "LIVE OPS" only when rows are real.
5. **Showtime's existing honesty is the standard** (`Showtime.tsx:115,125`) — match it.

---

# §16. ROLE-BASED EXPERIENCE STRATEGY

Roles come from `/api/me` via `lib/jarvis-auth.tsx`: `owner | dispatcher | technician`.

| | Owner | Dispatcher | Technician |
|---|---|---|---|
| Default scene | `command` | `map` | `day` |
| Command Rail | full | full | voice-first, short commands |
| Left rail | all scenes | map, execution, command | day, command |
| Right rail | activity + alerts + approvals | alerts + approvals | assigned work only |
| Approvals | approve / reject / escalate | escalate only | none |
| Run controls | all 5 verbs | pause / resume | none |
| Ops scene | yes | limited | no |
| Primary device | desktop | desktop + tablet | **mobile** |

**Binding:** the frontend never *authorises* — the backend's `requireContext`/`canApprove`
remains the only authority. The frontend hides what the role cannot do to avoid dead
affordances, and renders `PermissionVeil` when the backend refuses.

**The technician mobile journey is a first-class deliverable in P12**, not a responsive
afterthought: one-thumb reachability; work order → arrive → log → flag issue → done, each
step ≤ 2 taps.

---

# §17. ACCESSIBILITY AND PERFORMANCE STRATEGY

## 17.1 Accessibility targets — binding

- **Zero mouse-required interactions.** Every scene reachable and operable by keyboard.
- Command Rail focus `/` · palette `⌘K` · approvals `j`/`k` + `a`/`r` (already in
  `ApprovalCockpit`) · scene switch `1..9` · `?` opens `KeymapHUD`.
- Presence changes announced via **a single** `aria-live="polite"` region owned by the
  kernel. **Never per-panel live regions** — they collide and produce a screen-reader storm.
- Focus is never lost on scene change: focus moves to the new scene's `h1`.
- Contrast ≥ 4.5:1 for all text ≥ 11 px. `--j-text-faint` on `j-panel` must be **measured**
  in P12 and raised if it fails.
- Touch targets ≥ 44 × 44 px.
- Reduced motion retains full meaning (§10.6).

## 17.2 Performance targets — binding (cold cache, mid-tier laptop, 4× CPU throttle)

| Metric | Target | Current cold (run 1) |
|---|---|---|
| LCP | ≤ 2.0 s | 2.3 s |
| TBT | ≤ 300 ms | **1,460 ms** |
| CLS | ≤ 0.05 | 0.00 ✓ |
| Lighthouse perf | ≥ 85 | **56** |
| Lighthouse a11y | ≥ 95 | 95 ✓ |
| Event→pixel (SSE) | ≤ 1,200 ms | n/a |
| Event→pixel (poll) | ≤ 5,000 ms | ~4,000 ms |
| fps in the execution scene | ≥ 55 | measure |

**Method (binding):** 5 runs, cold cache, report **median and worst**, headline the cold run.
The existing 3-run baseline is void (§0.4).

## 17.3 Budget

- Initial `/jarvis` JS ≤ **250 KB gzipped**.
- `Orb3D`, `WorkflowTheater`, `ApprovalCockpit`, `ActivityTheater`, `DispatchMap`,
  `ParticleField`, `LiveCallPanel` all `dynamic({ssr:false})` — mostly already true, keep it.
- No blocking font. No layout-shifting image.

---

# §18. TESTING AND CERTIFICATION STRATEGY

## 18.1 Layers

| Layer | Tool | Scope |
|---|---|---|
| Unit | **Vitest** *(new dep — authorised in P0 only)* | `machine.ts` transitions · `selectors.ts` · `presence.ts` · `choreography.ts` exhaustiveness |
| Contract | Vitest | registry ↔ generated backend types; `Truth` exhaustiveness |
| Visual | Playwright snapshots | existing 24 + per-scene, desktop + 375 |
| E2E | Playwright | golden journey, role journeys, degraded journeys |
| A11y | Playwright + axe | every scene, keyboard-only walkthrough |
| Perf | Lighthouse | 5 cold runs |

## 18.2 The golden journey test — the certification gate

`e2e/jarvis-golden-journey.spec.ts`:

```
sign in as owner
→ focus Command Rail with "/"
→ type an instruction that plans a gated action
→ assert presence "thinking" within 1.5 s
→ assert ThinkingTheater shows ≥1 REAL context chip and ≥1 REAL plan step
→ assert presence "proposing" and the approval scene auto-enters
→ assert the action card names its risk tier AND its policy id + version
→ approve using the keyboard only
→ assert presence "working" and ExecutionTheater shows a real step advancing
→ assert presence "verifying" then "resolved"
→ assert a receipt exists, is deep-linkable, and shows predicted vs actual
→ assert ZERO console errors across the whole journey
→ assert every number on screen carries data-source naming its selector
```

## 18.3 Certified paths — all must be green to ship

1. Golden journey — owner, desktop
2. Golden journey — owner, 375 px
3. Clarification journey — ask → answer → plan → approve
4. Failure journey — step fails → recovery offered → retry → receipt
5. Degraded journey — kill the API mid-run → `severed` → recover → relight → truthful state
6. Signed-out `/jarvis` — no fabricated numbers, **no 401 storm** (< 5 requests / 30 s)
7. Dispatcher mobile · technician mobile
8. Showtime — labelled synthetic throughout

## 18.4 Regression protection ordering — hard rule

**No component may be rewritten before a snapshot covering it exists.** P0 exists solely to
close the snapshot gaps for surfaces P5–P11 will touch.

---

# §19. ORDERED IMPLEMENTATION PHASES

15 phases, each sized to 1–4 sessions.

---

## PHASE 0 — Regression Net & Instrumentation

**Objective.** Make it safe to change anything.

**Why it exists.** Hard rule §0.6.2. The existing suite covers 12 legacy views but **not**
Bridge scenes, ApprovalCockpit, WorkflowTheater, or any degraded state — precisely the
surfaces later phases rewrite.

**Source files to read.** `playwright.config.ts` · `e2e/*.spec.ts` · `package.json` ·
`bridge/Bridge.tsx` · `bridge/ApprovalCockpit.tsx` · `panels/WorkflowTheater.tsx`

**Discovery commands.**
```bash
ls e2e/jarvis-visual-snapshots.spec.ts-snapshots | wc -l
npx playwright test --list
cat playwright.config.ts
```

**Tasks (ordered).**
1. Add **Vitest** + `@testing-library/react` — **the only dependency addition authorised in
   this entire plan**. Script `"test:unit": "vitest run"`.
2. Create `scripts/gen-action-types.mjs` → emits
   `src/lib/jarvis/backend-action-types.generated.ts` from
   `finnor-os/packages/domain-plugins/*/index.ts`. Script `"gen:action-types"`.
   **Assert it emits 44.** If it does not, the parser is wrong — fix the parser, not the count.
3. Extend `e2e/jarvis-visual-snapshots.spec.ts` with signed-out snapshots of
   `/jarvis/bridge` (overview, pipeline) at 1440 and 375.
4. New `e2e/jarvis-degraded.spec.ts` — route-abort all `/api/jarvis/**`, snapshot `/jarvis`.
   **This captures today's wrong degraded rendering as the "before" baseline.**
5. New `e2e/jarvis-network-hygiene.spec.ts` — load signed-out `/jarvis`, wait 30 s, count
   requests to `/api/jarvis/**`. **Record the number (expect ≈ 45).** Assert only that it is
   recorded; P1 turns it into a hard threshold.
6. New `scripts/lighthouse-cold.mjs` — 5 cold runs, prints median + worst.

**Files expected to change.** `package.json` · `playwright.config.ts` · `e2e/*` (+2 new) ·
`scripts/*` (+2 new) · `src/lib/jarvis/backend-action-types.generated.ts` (new).
**No `src/components/**` changes.**

**Architecture decisions already made.** Vitest, not Jest. Generated file, not
hand-maintained. Degraded baseline captured *before* it is fixed.
**Must not decide.** Skipping snapshots. Adding other dependencies.

**Tests.** `npm run test:unit` exits 0 · `npx playwright test` full suite green.
**Visual.** New snapshot PNGs committed.
**Runtime.** Paste the 30-second request count.
**A11y.** n/a. **Perf.** Paste `lighthouse-cold.mjs` output — **this is the real baseline**.

**Failure/rollback.** Purely additive; revert the commit.
**Exit gate.**
- [ ] `npm run test:unit` exits 0
- [ ] `npx playwright test` green; snapshot count increased and pasted
- [ ] `backend-action-types.generated.ts` exists and contains **44** entries — pasted
- [ ] Cold Lighthouse baseline (5 runs, median + worst) pasted
- [ ] Signed-out 30 s request count recorded

**Dependencies.** none. **Sessions.** 1–2.

---

## PHASE 1 — Truth Layer

**Objective.** Make fabricated data structurally impossible; fix every §5.1 defect.

**Why it exists.** Priority #1. C-01, C-02, C-03, C-04, C-05, C-06, C-15 are **live on
production right now**, and every later phase would inherit them.

**Source files to read.** `lib/data-core.ts` (all) · `lib/Metric.tsx` · `panels/KpiStrip.tsx`
· `panels/HeaderBand.tsx` · `panels/OpsTicker.tsx` · `panels/ApprovalDock.tsx` ·
`bridge/ApprovalCockpit.tsx` (~860–900) · `ui/primitives/` (all) ·
`src/app/api/jarvis/[...path]/route.ts` · `finnor-os/apps/api/app/api/stats/route.ts` ·
`.../actions/pending/route.ts`

**Discovery commands.**
```bash
grep -rn "?? 0" src/components/jarvis | wc -l
grep -rn "stats?.pending\|pendingActions.length" src/
grep -c "Degraded" src/components/jarvis/panels/KpiStrip.tsx
grep -rn "Param" src/components/jarvis/panels/HeaderBand.tsx
```

**Tasks (ordered).**
1. `kernel/types.ts` — `Truth<T>`, `TruthSource` exactly per §7.2.
2. `kernel/selectors.ts` — the 11 selectors of §12.1, as pure functions over today's
   `JarvisDataState`. (The kernel store lands in P2; selectors land first so panels can
   migrate now.)
3. **Rewrite `lib/Metric.tsx`** to take `value: Truth<number>`; render per §10.5. **Delete
   the `source: "live"|"derived"` prop.**
4. **Rewrite `panels/KpiStrip.tsx`** onto selectors + `Metric`. Remove all six `?? 0`
   fallbacks (`:34-41`). Denied/unknown renders `PermissionVeil`/`EmptyState` — **never a zero**.
5. **Fix C-02:** `HeaderBand.tsx:66` — replace the literal `Param` with the signed-in user's
   first name from `useJarvisAuth()`; signed-out renders "Good morning" with no name. Unit
   test: no name renders without a session.
6. **Fix C-03:** implement `selectPendingApprovals` per §12.1; update **all six** consumers
   (`JarvisCommandCenter.tsx:229`, `Bridge.tsx:457`, `KpiStrip.tsx:41`, `HeaderBand.tsx:46`,
   `ApprovalCockpit.tsx:873`, `ApprovalDock.tsx:112`) to render the same `Truth`. The cockpit
   shows `shown of total` when `partial`.
7. **Fix C-15:** in `data-core.ts`, gate private lanes on session presence; stop a lane on
   401 and set `denied`; exponential backoff on 5xx/network per §13.5.
8. **Fix C-06:** add a `resolving` transport state; the Live/Simulation chip renders
   "Connecting…" until the first successful poll — **never a claim**.
9. **Fix C-05:** `OpsTicker` header reads `SAMPLE OPS` whenever any row is `sim ·`.
10. ESLint: block `?? 0` on `useJarvis()` fields; block `useJarvis` imports outside `kernel/`
    and `lib/data-core.ts`. Add to `.eslintrc.cjs`.
11. Update `e2e/jarvis-network-hygiene.spec.ts` to **assert < 5 requests / 30 s** signed out.

**Files expected to change.** `kernel/types.ts`(new) · `kernel/selectors.ts`(new) ·
`lib/Metric.tsx` · `lib/data-core.ts` · `panels/{KpiStrip,HeaderBand,OpsTicker,ApprovalDock}.tsx`
· `bridge/{ApprovalCockpit,Bridge}.tsx` · `JarvisCommandCenter.tsx` · `.eslintrc.cjs` · `e2e/*`

**Architecture decisions already made.** `Truth<T>` shape. Selector names. `/api/stats` is
the authority for totals. Signed-out renders veils, not zeros. No name without a session.
**Must not decide.** That zero is "close enough". Keeping `source:"derived"`.

**Tests.** Unit tests for all 11 selectors, **including the `partial` cap case and the
disagreement case**. `npx playwright test`.
**Visual.** Signed-out `/jarvis` at 1440 + 375 showing veils where zeros were — side-by-side
with the P0 baseline.
**Runtime.** Network list proving **< 5 requests / 30 s**. Console: zero errors.
**A11y.** `PermissionVeil` reachable and announced.
**Perf.** Re-run cold Lighthouse — TBT should improve from removing the 401 storm.

**Failure/rollback.** Each fix is independent; revert individually.
**Exit gate.**
- [ ] `grep -rn "?? 0" src/components/jarvis/panels` → **0** for network values
- [ ] `grep -rn '"Param"' src/` → **0**
- [ ] Signed-out `/jarvis` shows **no** `$0`/`0` for private metrics — screenshot
- [ ] **< 5 requests / 30 s** signed out — network log pasted
- [ ] All 6 pending-count consumers render the same `Truth` — cited
- [ ] ESLint rule active; `npm run lint` green
- [ ] Selector unit tests green — output pasted

**Dependencies.** P0. **Sessions.** 2–3.

---

## PHASE 2 — The Kernel

**Objective.** One canonical state machine driving every representation.

**Why it exists.** Priority #2. Without it, C-13 (the lying orb) and C-14 (no cognition
states) cannot be fixed, and every surface keeps deriving its own truth.

**Source files to read.** `lib/data-core.ts` (all) · `lib/pulse-bus.ts` · `bridge/Orb3D.tsx`
· `bridge/Bridge.tsx:68-110` · `lib/useVapiSession.tsx` · `kernel/*` from P1 ·
`finnor-os/packages/db/schema.ts` lines 193, 345, 921, 943

**Discovery commands.**
```bash
grep -rn "useJarvis()" src/ | wc -l
grep -rn "voiceState ===" src/ | wc -l
sed -n '193,212p;921,932p;943,955p;345,352p' finnor-os/packages/db/schema.ts
```

**Tasks (ordered).**
1. `kernel/types.ts` — add `ActionState`, `RunState`, `StepState`, `JobState`,
   `InstructionState`, `ConnectionState`, `FreshnessState`, `Presence`, `KernelEventName`
   exactly per §7.3/§7.5. **Copy the four backend enums verbatim from `schema.ts`.**
2. `kernel/machine.ts` — the §7.4 table as a pure reducer. Unknown pairs → no-op +
   `console.warn` in dev. Export `reduceInstruction`, `reduceEntities`.
3. `kernel/store.tsx` — `JarvisKernelProvider` wrapping `JarvisDataProvider`. Ingests
   `data-core`'s ring-buffer diffs (`data-core.ts:435-467`) and emits `KernelEvent`s.
   Implements dedup/ordering/restore per §7.6.
4. `kernel/presence.ts` — the §7.5 derivation, **in the stated order**. Unit-test all 12.
5. `kernel/transport.ts` — `ConnectionState` + `applyServerFacts`. Polling only for now;
   P4 adds SSE behind the same function.
6. **Rewire `Orb3D`:** replace the 5-value `OrbState` with the 12-value `Presence`; extend
   `STATE_COLOR`/`STATE_ENERGY`/`STATE_SPIN` (`Orb3D.tsx:45-52`) to all 12 using §11.3
   colour semantics. **Delete `useOrbLiveState()` from `Bridge.tsx:73-88`.**
7. Mount `JarvisKernelProvider` inside **both** `Bridge` and `JarvisCommandCenter` (both
   still live — strangler).
8. Point `panels/JarvisOrb.tsx` (2D) at `presence` too, so low-power matches.

**Files expected to change.** `kernel/*` (5 new) · `bridge/Orb3D.tsx` · `bridge/Bridge.tsx`
· `panels/JarvisOrb.tsx` · `JarvisCommandCenter.tsx`

**Architecture decisions already made.** All state names and values. The presence derivation
order. Kernel wraps rather than replaces `data-core`. **The Orb takes presence only.**
**Must not decide.** Adding/removing/renaming states. Letting a component compute presence.
Introducing a state-management library (no).

**Tests.** Unit: every §7.4 transition **including illegal pairs → no-op**; all 12 presence
derivations; dedup, out-of-order, and gap handling.
**Visual.** All 12 presence states captured from `/jarvis/stage` (add a presence switcher there).
**Runtime.** No transition warnings during a normal session.
**A11y.** The presence `aria-live` region announces once per change, not per render.
**Perf.** Kernel adds no render loop — `FpsMeter` reading unchanged.

**Failure/rollback.** Kernel is additive; revert restores the old orb wiring.
**Exit gate.**
- [ ] Enum values byte-match `schema.ts` — both sides pasted
- [ ] `grep -rn "useOrbLiveState" src/` → **0**
- [ ] All §7.4 transitions unit-tested green — output pasted
- [ ] 12 presence screenshots from `/jarvis/stage`
- [ ] No component outside `kernel/` computes presence — grep pasted

**Dependencies.** P1. **Sessions.** 3.

---

## PHASE 3 — Instruction Trace (backend additions + cognition pipeline)

**Objective.** Make the backend's real cognition visible **while it happens**.

**Why it exists.** C-14 is the root cause of "it doesn't feel like JARVIS." The backend
already writes `planned`, `executing`, `verify`, `verified`, `critic_review`, `clarification`
episodes — the UI just never sees them until the call returns.

**Source files to read.** `finnor-os/packages/orchestration/src/index.ts`
(`handleInstruction`, ~97-165) · `.../planner.ts` · `.../plan-dag.ts` ·
`finnor-os/apps/api/app/api/actions/route.ts` · `finnor-os/packages/db/schema.ts` (migration
conventions) · `panels/CommandBar.tsx` · `src/app/api/jarvis/[...path]/route.ts`

**Discovery commands.**
```bash
grep -n "appendEpisode" finnor-os/packages/orchestration/src/*.ts
ls finnor-os/packages/db/migrations | tail -5
grep -rn "correlationId" finnor-os/packages/db/schema.ts
```

**Tasks (ordered).**
1. **Migration:** `instruction_sessions`, `instruction_events`, `domain_actions
   .instruction_id` exactly per §13.2. Follow the numbering convention in
   `finnor-os/packages/db/migrations`. Add tenant scoping/RLS matching neighbouring tables.
2. `finnor-os/packages/orchestration/src/instruction-trace.ts` —
   `emitInstructionEvent(tenantId, instructionId, phase, payload)` with a monotonic `seq`
   per instruction.
3. Instrument `handleInstruction`: `received` → `context_retrieved` (after
   `buildMemorySnapshot`; **payload = counts + source labels, NEVER raw memory contents**) →
   `planning` → `plan_ready` | `clarification_required` → `action_created` per action →
   `action_gated` | `dispatched` → `executing` → `verifying` → `verified` → terminal.
4. `POST /api/actions` accepts optional `instructionId`; creates the session row.
   **Response shape unchanged.**
5. New routes `GET /api/instructions/{id}` and `GET /api/instructions/{id}/events?after=`.
6. Proxy allowlist: add `instructions`, `instructions/:id`, `instructions/:id/events` to
   `isAllowedGet` in `src/app/api/jarvis/[...path]/route.ts`.
7. Frontend `kernel/instruction.ts` — `submitInstruction(text, source)`: mint UUID, POST,
   start the 400 ms trace poll, feed `TRACE_*` events into the kernel, stop on terminal or
   after a **120 s ceiling**.
8. Restore-after-refresh: on mount, if a non-terminal instruction id is in `sessionStorage`,
   refetch `GET /api/instructions/{id}` and resume.

**Files expected to change.** `finnor-os/packages/db/{schema.ts,migrations/*}` ·
`finnor-os/packages/orchestration/src/{index.ts,instruction-trace.ts}` ·
`finnor-os/apps/api/app/api/{actions/route.ts,instructions/**}` ·
`src/app/api/jarvis/[...path]/route.ts` · `src/components/jarvis/kernel/instruction.ts`

**Architecture decisions already made.** Poll at 400 ms, **not** SSE yet. The client mints
the id. Response shape unchanged for backwards compatibility. The phase vocabulary is fixed
(§13.2). Context payloads carry **counts and source labels only**.
**Must not decide.** Restructuring `handleInstruction` into a background job. Changing the
`{planned}` response shape. Inventing phase names.

**Tests.** Backend unit: `emitInstructionEvent` monotonicity + tenant scoping.
Integration: submit an instruction, assert **≥ 5 events in order with unique `seq`**.
Frontend unit: the trace poll stops on terminal **and** at the ceiling.
**Visual.** none required (P5 renders it).
**Runtime.** Paste a **real** event sequence from a real instruction with timestamps. Assert
the first event is visible **≤ 800 ms** after submit.
**A11y.** n/a. **Perf.** Paste a network log showing the 400 ms poll **starting and stopping**.

**Failure/rollback.** Migration is additive; `instructionId` is optional — omitting it
restores exact current behaviour. Feature-flag the frontend trace poll.
**Exit gate.**
- [ ] Migration applied; three schema objects exist — `\d` output pasted
- [ ] A real instruction produces **≥ 5 ordered `instruction_events`** — pasted
- [ ] First trace event **≤ 800 ms** after submit — timing pasted
- [ ] `POST /api/actions` **without** `instructionId` behaves identically — test pasted
- [ ] Trace poll stops on terminal — network log pasted

**Dependencies.** P2. **Sessions.** 3–4.

---

## PHASE 4 — Realtime Transport

**Objective.** Replace polling with a stream, converging on one cache; keep polling as an
automatic fallback.

**Why it exists.** C-09, C-10, C-11. Event→pixel latency of ~4 s cannot feel causal.

**Source files to read.** `src/lib/jarvis/useLiveQuery.ts` (all) ·
`src/app/api/jarvis/[...path]/route.ts:135-155` · `kernel/transport.ts` ·
`finnor-os/apps/api/app/api/events/route.ts` · `finnor-os/packages/db/schema.ts`
(`outbox_events`)

**Discovery commands.**
```bash
grep -rn "sseUrl" src/
grep -n "upstream.text()" src/app/api/jarvis/*/route.ts
grep -n "outboxEvents" finnor-os/packages/db/schema.ts
```

**Tasks (ordered).**
1. Backend `GET /api/stream` — `ReadableStream`, `text/event-stream`, tenant-scoped, 25 s
   heartbeat comment frames, honours `Last-Event-ID`. Source: `outbox_events` +
   `instruction_events`, ordered by `seq`.
2. **New** frontend route `src/app/api/jarvis/stream/route.ts`, `runtime = "edge"`, piping
   `upstream.body` directly — **no `.text()`**. Forward the caller's bearer.
3. Assert with a test that the catch-all does **not** capture `stream`.
4. `kernel/transport.ts`: connect SSE; after 2 consecutive failures fall back to polling;
   retry SSE with backoff; expose `ConnectionState`. **Both paths call `applyServerFacts`.**
5. On every transition to `live`, run the §7.6 restore: snapshot-refetch → buffer → replay.
6. Migrate `useLiveQuery` callers to pass `sseUrl` — closing **C-11**.
7. Reduce poll lanes to **safety-net cadence** when `live`: fast 4 s → 20 s, medium 8 s →
   30 s. Slow/sanity unchanged.
8. Pulse Strip renders `ConnectionState` honestly, including `reconnecting`.

**Files expected to change.** `finnor-os/apps/api/app/api/stream/route.ts`(new) ·
`src/app/api/jarvis/stream/route.ts`(new) · `kernel/transport.ts` · `lib/data-core.ts` ·
`src/lib/jarvis/useLiveQuery.ts` · `bridge/PulseBar.tsx`

**Architecture decisions already made.** **SSE, not WebSocket** — one-way, proxy-friendly,
resumable via `Last-Event-ID`. A **dedicated non-buffering route**; the catch-all is never
made streaming. **Polling is never removed, only slowed.**
**Must not decide.** WebSocket. A third-party realtime service. Removing polling.

**Tests.** Integration: stream delivers end-to-end; kill it → automatic polling fallback
within 10 s; restore → reconnect with **no duplicates**.
**Visual.** Pulse Strip in `live`, `reconnecting`, `polling`, `offline`.
**Runtime.** **Measure event→pixel latency** — median over ≥ 20 events. Target ≤ 1200 ms.
**A11y.** Connection changes announced once.
**Perf.** Requests/min before vs after — expect a large drop.

**Failure/rollback.** Env flag `NEXT_PUBLIC_JARVIS_SSE=0` forces polling. **Ship behind it.**
**Exit gate.**
- [ ] Event→pixel median **≤ 1200 ms** over ≥ 20 events — pasted
- [ ] Killing the stream falls back to polling **≤ 10 s** — test pasted
- [ ] Reconnect produces **no duplicate entities** — test pasted
- [ ] Requests/min dropped — before/after pasted
- [ ] `grep -rn "sseUrl" src/` shows **real callers**

**Dependencies.** P3. **Sessions.** 2–3.

---

## PHASE 5 — Command Rail & Thinking Theater (golden journey, first half)

**Objective.** Make the instruction the centre of the product, and make cognition visible.

**Why it exists.** Priorities #4 and #6. Fixes C-14's UI half and inverts §6.1.

**Source files to read.** `panels/CommandBar.tsx` · `bridge/Bridge.tsx` ·
`lib/useVapiSession.tsx` · `ui/motion/CommandSurfaceCatalog.tsx` (FLOW-38..49) ·
`ui/motion/VoiceTheaterCatalog.tsx` (FLOW-67..73) · `ui/fx/DecryptText.tsx` · `kernel/*`

**Discovery commands.**
```bash
grep -n "FLOW-" src/components/jarvis/ui/motion/CommandSurfaceCatalog.tsx | head -30
grep -n "FLOW-" src/components/jarvis/ui/motion/VoiceTheaterCatalog.tsx | head -20
```

**Tasks (ordered).**
1. `bridge/CommandRail.tsx` — **pinned bottom rail**. Text input + push-to-talk + `/` focus +
   `⌘K`. Presence-reactive ring whose intensity comes from `presence` — **not a permanent
   loop** (this replaces `CommandBar.tsx:88-89`'s `repeat: Infinity` sweep).
2. `bridge/ThinkingTheater.tsx` — the `thinking` scene, rendered **entirely from real
   `instruction_events`**:
   - the instruction echoed (`DecryptText` on arrival)
   - **context chips** — what was retrieved, with counts and source labels
   - **plan DAG forming** — nodes appear as `action_created` events arrive; edges drawn with
     `drawSpark`
   - elapsed timer, cancel affordance
   **No synthetic "thinking…" filler. Every element is backed by a real event.**
3. Wire `submitInstruction` (P3) to the rail; wire trace events to the theater.
4. **Voice: on final transcript, call the same `submitInstruction`.** Voice and text produce
   an **identical journey** — this is binding.
5. Scene auto-switching per §9.2, driven by `selectSceneForState`.
6. Promote FLOW-38..49 and FLOW-67..73 from the catalogs into the rail/theater per §8.2.
7. Add a presence + scene switcher to `/jarvis/stage` for visual QA.

**Files expected to change.** `bridge/CommandRail.tsx`(new) · `bridge/ThinkingTheater.tsx`(new)
· `bridge/Bridge.tsx` · `Stage.tsx` · `kernel/choreography.ts`

**Architecture decisions already made.** The rail is pinned and bottom-anchored. Voice and
text share one path. Context chips show counts and labels, never memory contents. **No filler
animation.**
**Must not decide.** Returning the command input to the scroll flow. Fabricating thinking
steps when events are slow.

**Tests.** E2E: submit → `thinking` within 1.5 s → **≥ 1 context chip and ≥ 1 plan node, each
traceable to a real event id**.
**Visual.** `thinking` at 1440 + 375, mid-plan and complete; plus the reduced-motion variant.
**Runtime.** Console clean; paste the event→node mapping.
**A11y.** Keyboard-only: `/` → type → submit → theater announced. Transcript pasted.
**Perf.** ≥ 55 fps during plan formation — `FpsMeter` reading pasted.

**Failure/rollback.** Bridge-only; `/jarvis` still routes owners to Command Center until P11.
**Exit gate.**
- [ ] Command Rail visible **without scrolling** at 1440 **and** 375 — screenshots
- [ ] Voice and text produce identical journeys — both E2E green
- [ ] Every thinking element traces to a real `instruction_events` row — mapping pasted
- [ ] `thinking` reached **≤ 1.5 s** after submit — timing pasted
- [ ] Reduced-motion variant carries the same information — screenshot

**Dependencies.** P3, P4. **Sessions.** 3.

---

## PHASE 6 — Clarification & Approval Cockpit

**Objective.** Make JARVIS able to **ask**, and make approval the best surface in the product.

**Why it exists.** C-07 is critical and breaks principle #6 outright.

**Source files to read.** `finnor-os/packages/domain-plugins/clarification/index.ts` ·
`finnor-os/packages/orchestration/src/planner.ts:80` · `bridge/ApprovalCockpit.tsx` (all) ·
`ui/renderers/registry.ts` · `ui/renderers/FallbackRenderer.tsx` ·
`ui/motion/DecisionTheaterCatalog.tsx` (FLOW-50..58)

**Discovery commands.**
```bash
grep -rn "clarif" src/ | wc -l        # expect 0 before this phase
cat finnor-os/packages/domain-plugins/clarification/index.ts
```

**Tasks (ordered).**
1. `ui/renderers/ClarificationScene.tsx` per §14.1.
   **Binding: it renders Answer / Skip / Cancel — never Approve / Reject.**
2. Register `clarification_request` in `registry.ts` with a new `tier: "interactive"`.
3. **Route clarifications out of the approval queue** into the `clarify` scene. A pending
   `clarification_request` **must not increment the approvals count** — update
   `selectPendingApprovals` to exclude it and add a unit test.
4. Answering POSTs a new instruction with `parentInstructionId`; the thread renders as one
   continuous conversation in `ThinkingTheater`.
5. Move `ApprovalCockpit` into the `approval` scene; wire it to kernel selectors.
6. The approval card must show, for every action: risk tier, **policy id + version**,
   evidence, critic verdict (or an honest *"not run — needs `AWS_BEDROCK_API_KEY`"*),
   price-book provenance, and **predicted outcome**.
7. Promote FLOW-50..58 (`stampApprove`, `shatterReject`, `deckFan`) per §8.2.
8. Batch approve keeps its typed-confirmation gate for high-risk tiers (already built —
   **preserve it**).

**Files expected to change.** `ui/renderers/ClarificationScene.tsx`(new) ·
`ui/renderers/{registry,types}.ts` · `bridge/ApprovalCockpit.tsx` · `bridge/Bridge.tsx` ·
`kernel/selectors.ts`

**Architecture decisions already made.** Clarification is a distinct interaction tier, not an
approval. It is excluded from approval counts. Threads are continuous.
**Must not decide.** Auto-answering a clarification. Guessing a missing field. Leaving
clarifications in the approval queue.

**Tests.** E2E clarification journey (certified path #3). Unit: clarifications excluded from
approval counts. Contract: registry covers 44/44.
**Visual.** `clarify` at 1440 + 375; approval card with all provenance fields.
**Runtime.** Console clean; **assert `FallbackRenderer` never mounts** (add a dev assertion).
**A11y.** Clarification input autofocused; the question in an `aria-live` region; full
keyboard approve/reject.
**Perf.** Cockpit with 100 items scrolls at ≥ 55 fps.

**Failure/rollback.** Renderer additions are additive.
**Exit gate.**
- [ ] `grep -rn "clarif" src/` > 0 **and** a clarification renders as a **question**, not an
      approval — screenshot
- [ ] Registry covers **44/44** — contract test output pasted
- [ ] Clarifications excluded from approval counts — unit test pasted
- [ ] `FallbackRenderer` mounts **zero** times across all certified paths — assertion pasted
- [ ] Approval card shows policy id + version + risk tier + predicted outcome — screenshot

**Dependencies.** P5. **Sessions.** 2–3.

---

## PHASE 7 — Execution Theater, Verification & Receipts

**Objective.** Show work happening, then **prove** what happened.

**Why it exists.** Principle #8, and the moat: `prediction-diff.ts` exists in the backend and
has **no UI at all**.

**Source files to read.** `panels/WorkflowTheater.tsx` (all) · `lib/ReceiptDrawer.tsx` ·
`lib/receipt-nav.ts` · `finnor-os/packages/orchestration/src/prediction-diff.ts` ·
`finnor-os/apps/api/app/api/receipts/route.ts` · `.../receipts/[id]/route.ts` ·
`ui/motion/PipelineTheaterCatalog.tsx` (FLOW-59..66)

**Discovery commands.**
```bash
grep -rn "prediction" finnor-os/packages/orchestration/src/ | head
grep -rn "predicted" src/ | head
```

**Tasks (ordered).**
1. `bridge/ExecutionTheater.tsx` — the `execution` scene. Per-action progress bound to real
   `domain_actions.status` + `workflow_steps.status`. Hosts `WorkflowTheater`.
2. **Concurrency:** N simultaneous instructions/runs render as **stacked lanes** ordered by
   most-recent-transition; the focused lane expands. **Binding: never a modal per run.**
3. `bridge/VerificationScene.tsx` — **predicted vs actual, side by side, diff highlighted**.
   If `prediction-diff` data is absent, **say so honestly** — do not hide the panel.
4. Promote `ReceiptDrawer` to a full `receipt` scene: objective, evidence, policy id +
   version, tool calls, timings, actual outcome, links to affected entities.
5. **Every receipt is deep-linkable** (`/jarvis#receipt-{id}`) and reachable from every
   surface that mentions the action — reuse `lib/receipt-nav.ts`.
6. Promote FLOW-59..66 (`liquidFill`, `valvePulse`, particulate) per §8.2.
7. If the backend does not expose predicted outcomes on receipts, **add it**:
   `receipts/[id]` gains `predicted` alongside `actual`. Record as a backend addition.

**Files expected to change.** `bridge/ExecutionTheater.tsx`(new) ·
`bridge/VerificationScene.tsx`(new) · `lib/ReceiptDrawer.tsx` · `panels/WorkflowTheater.tsx`
· `bridge/Bridge.tsx` · possibly `finnor-os/apps/api/app/api/receipts/[id]/route.ts`

**Architecture decisions already made.** Lanes, not modals. Verification is its own scene.
Absent prediction data is **stated, never hidden**. Receipts are deep-linkable.
**Must not decide.** Fabricating a predicted value. Hiding verification when data is thin.

**Tests.** E2E: approve → execute → verify → receipt, all real. Unit: lane ordering.
**Visual.** Execution with 1 lane and with 3 lanes; verification with a diff **and** with
absent data; receipt scene. All at 1440 + 375.
**Runtime.** Console clean during a real run; step→pixel latency pasted.
**A11y.** Lane navigation by keyboard; receipt readable by screen reader (no raw JSON).
**Perf.** 3 concurrent lanes ≥ 55 fps.

**Failure/rollback.** Scenes are additive.
**Exit gate.**
- [ ] Predicted-vs-actual renders from **real** backend data — screenshot + source cited
- [ ] 3 concurrent runs render as lanes at ≥ 55 fps — screenshot + fps
- [ ] Every receipt deep-links and restores on refresh — E2E pasted
- [ ] **No raw JSON anywhere** in the receipt scene — grep + screenshot
- [ ] Step→pixel latency ≤ 1200 ms — pasted

**Dependencies.** P6. **Sessions.** 3.

---

## PHASE 8 — Failure, Recovery & Degraded States

**Objective.** Every failure produces a recovery path; every missing capability produces a
designed state.

**Why it exists.** Priority #5. C-08 and principle #9.

**Source files to read.** `panels/DlqBrowser.tsx` · `panels/DegradedBanner.tsx` ·
`ui/primitives/{ErrorState,StaleFog,PermissionVeil,EmptyState}.tsx` ·
`ui/motion/StateNarrativesCatalog.tsx` (FLOW-88..93) ·
`finnor-os/packages/orchestration/src/repair.ts` ·
`finnor-os/apps/api/app/api/{dlq,integrations/status,setup/status}/route.ts`

**Discovery commands.**
```bash
grep -rn "escalated\|cancelled" src/components/jarvis/panels/WorkflowTheater.tsx
grep -rn "compensating\|compensated" src/components/jarvis | wc -l
```

**Tasks (ordered).**
1. **Complete run-state coverage:** add `cancelled` and `escalated` rendering to
   `WorkflowTheater` per §8.2. Add a test asserting **all 8 `RunState`s and all 6
   `StepState`s** have a visual treatment — **exhaustive switch, no `default` branch**.
2. **Failure taxonomy** in `kernel/types.ts`:
   `transient · policy_denied · integration_unavailable · invalid_input · tool_error ·
   timeout · compensated · needs_human`.
   Recovery affordance per kind: retry · adjust policy · connect integration · correct input
   · escalate · view compensation · assign human.
3. `bridge/RecoveryPanel.tsx` — for any failed entity: cause, blast radius, what was and was
   **not** done, and the affordances above.
4. **Compensation is a first-class visual:** reverse `liquidFill` drain, an explicit "Rolled
   back" state, and a compensation receipt.
5. Degraded integrations → `PermissionVeil` over exactly the affected panels with a deep link
   to setup. **Never a blank panel, never a zero.**
6. Transport degradation ladder rendered in the Pulse Strip (from P4).
7. Promote FLOW-88..93 per §8.2.
8. Upgrade `e2e/jarvis-degraded.spec.ts` from a *baseline snapshot* to *assertions*.

**Files expected to change.** `panels/WorkflowTheater.tsx` · `bridge/RecoveryPanel.tsx`(new)
· `kernel/{types,choreography}.ts` · `panels/DegradedBanner.tsx` · `e2e/*`

**Architecture decisions already made.** The 8-member failure taxonomy and its affordance
mapping. Exhaustive switches with **no `default`**. Veils, never blanks.
**Must not decide.** Swallowing a failure. Showing a generic "Something went wrong."

**Tests.** Unit: exhaustive state coverage (compile-time exhaustiveness + runtime test).
E2E certified paths #4 and #5.
**Visual.** All 8 `RunState`s, all 6 `StepState`s, all 8 failure kinds, all degraded variants.
Organise under `qa-screenshots/P8/`.
**Runtime.** Kill the API mid-run; paste console + recovery screenshots.
**A11y.** Failures announced **assertively** (`aria-live="assertive"`); recovery actions
keyboard-reachable.
**Perf.** No regression.

**Failure/rollback.** Additive.
**Exit gate.**
- [ ] All 8 `RunState` + 6 `StepState` render distinctly — screenshot grid
- [ ] Exhaustive-switch test green, **no `default` branch** — pasted
- [ ] Every failure kind offers a recovery affordance — screenshot per kind
- [ ] API killed mid-run → truthful degraded → recover → relight — E2E pasted
- [ ] **Zero blank panels and zero fabricated zeros** in any degraded state — screenshots

**Dependencies.** P7. **Sessions.** 3.

---

## PHASE 9 — Renderer Completeness & Contract Hardening

**Objective.** 44/44 renderers, self-verifying, with no blocked backend capability.

**Source files to read.** `ui/renderers/*` (all) · `src/app/api/jarvis/[...path]/route.ts` ·
`panels/DispatchMap.tsx` · `panels/MyDay.tsx`

**Discovery commands.**
```bash
node scripts/gen-action-types.mjs
grep -rn 'jarvisGet("' src/ | sed 's/.*jarvisGet("\([^"]*\)".*/\1/' | sort -u
```

**Tasks (ordered).**
1. `renderers/ManualStepCard.tsx` and `renderers/flagships/RouteScene.tsx` (§14.1).
2. Registry contract test (§14.2) — **must be failing-red before** the renderers land, then green.
3. Correct the false comments in `registry.ts` (§14.3).
4. Audit **every** `jarvisGet` path against the proxy allowlist. For each blocked call:
   either add it to the allowlist (with justification) or remove the dead caller.
   **Paste the full before/after list.**
5. Verify `DispatchMap` and `MyDay` actually reach their backends (C-12).
6. Remove `FallbackRenderer` from customer-facing paths — it remains only behind the owner
   debug toggle.

**Files expected to change.** `ui/renderers/*` · `src/app/api/jarvis/[...path]/route.ts` ·
`panels/{DispatchMap,MyDay}.tsx`

**Architecture decisions already made.** Generated types are the source of truth. The
contract test is a build gate.

**Tests.** Contract test 44/44; E2E for the two new renderers.
**Visual.** **Every one of the 44 renderers** captured from `/jarvis/stage`'s
`RendererCatalog` — this is the definitive coverage artefact.
**Runtime.** Zero proxy 404s across all certified paths — network log pasted.
**A11y.** Each renderer keyboard-navigable.
**Perf.** Catalog page under budget.

**Exit gate.**
- [ ] Contract test asserts and passes **44/44** — output pasted
- [ ] 44 renderer screenshots committed
- [ ] Zero proxy 404s across certified paths — log pasted
- [ ] `registry.ts` comments corrected — diff pasted

**Dependencies.** P6. **Sessions.** 2. *(May run in parallel with P7/P8.)*

---

## PHASE 10 — Motion & Sound Promotion

**Objective.** Move the ~100 FLOW primitives out of `/jarvis/stage` and bind them to kernel
transitions.
**This is the phase that directly answers "there are very few animations."**

**Why it exists.** C-18. The assets exist; they are unwired. v1's rule F1 made the catalog the
destination; this phase makes it the source.

**Source files to read.** All 15 `ui/motion/*Catalog.tsx` · `ui/motion/{choreo,tokens,
flow-index}.ts` · `ui/motion/primitives.tsx` · `ui/fx/*` · `sound.ts` · `lib/haptics.ts` ·
`kernel/choreography.ts`

**Discovery commands.**
```bash
grep -rhoE "FLOW-[0-9]+" src/components/jarvis/ui/motion | sort -u | wc -l
grep -rn 'from "../ui/motion' src/components/jarvis/{panels,bridge} | wc -l
```

**Tasks (ordered).**
1. **Inventory every FLOW primitive** into `docs/flow-inventory.md`: id, name, catalog file,
   family (§10.1), and its §8.2 binding — **or "retire"**. Every primitive must be
   classified. Paste the count.
2. Extract each **bound** primitive from its catalog into `ui/motion/primitives/<Name>.tsx`;
   catalogs then import from there. **One implementation, two consumers** (product + stage).
3. Complete `kernel/choreography.ts`'s `EVENT_TO_PIXEL` for **every** `KernelEventName`.
4. Add the exhaustiveness test (§8.1) — **a missing entry fails the build**.
5. Bind cues at transition sites. **Motion is triggered by kernel events only** — never by
   component-local state.
6. **Enforce the ambient budget:** audit each viewport, assert ≤ 2 running loops. Convert or
   remove the rest — including `CommandBar`'s permanent gradient sweep (superseded by P5's
   presence-reactive rail).
7. Sound: map cues per §10.3; enforce the 400 ms throttle; verify quiet-hours suppression.
8. Haptics: bind `lib/haptics.ts` patterns to intensity 2–3 cues, mobile only.
9. **Retire genuinely unused primitives** — delete them and record the list.

**Files expected to change.** `ui/motion/**` (restructure) · `kernel/choreography.ts` ·
`sound.ts` · `lib/haptics.ts` · `bridge/**` · `panels/**` · `docs/flow-inventory.md`(new)

**Architecture decisions already made.** **Every primitive is bound or retired — nothing stays
orphaned.** One implementation shared by product and stage. Motion triggered only by kernel
events. The ambient budget is 2.
**Must not decide.** Adding motion not in §8.2. Keeping a primitive "just in case."

**Tests.** Unit: `EVENT_TO_PIXEL` exhaustiveness; every entry has non-null `reducedMotion`
**and** `failureFallback`. E2E: a reduced-motion run of the golden journey asserting the
**same information** is present.
**Visual.** Before/after of every product surface; reduced-motion variants.
**Runtime.** Paste the ambient-loop audit per scene.
**A11y.** Reduced-motion golden journey passes with identical assertions.
**Perf.** fps ≥ 55 in the three busiest scenes (execution, approval, thinking) — readings pasted.

**Failure/rollback.** The restructure is mechanical; revert per primitive.
**Exit gate.**
- [ ] `docs/flow-inventory.md` classifies **every** FLOW primitive — count pasted
- [ ] `EVENT_TO_PIXEL` exhaustiveness test green — pasted
- [ ] **≤ 2 ambient loops per viewport** — audit pasted
- [ ] Reduced-motion golden journey passes the same assertions — pasted
- [ ] **≥ 55 fps** in the three busiest scenes — readings pasted
- [ ] Product surfaces now import motion primitives — grep count **> 0**, pasted

**Dependencies.** P5, P7, P8. **Sessions.** 3–4.

---

## PHASE 11 — IA Cutover: the Bridge becomes JARVIS

**Objective.** Make the Bridge the home; retire the legacy Command Center; delete duplicates.

**Why it exists.** C-17, C-19, C-20, C-16 and §9.

**Source files to read.** `PersonalizedHome.tsx` · `JarvisCommandCenter.tsx` · `views.tsx`
(all 47 KB) · `bridge/Bridge.tsx` · every duplicate pair in §2.3

**Discovery commands.**
```bash
grep -rn "JarvisCommandCenter" src/
grep -c "export function" src/components/jarvis/views.tsx
grep -rn "setInterval" src/components/jarvis/views.tsx
```

**Tasks (ordered).**
1. **Achieve feature parity first.** Every one of the 13 legacy views must have a Bridge
   scene home per §9.3. Verify one by one; **check them off individually** in the state file.
2. Split `views.tsx` (47 KB, 9 views) into `scenes/<Name>Scene.tsx`. Delete the file.
3. **Remove `views.tsx`'s own 8 s poll** (C-16) — all data via the kernel.
4. **Flip `PersonalizedHome.tsx:61`:** owner → `<Bridge />`. Honour `ALLOWED_HOME`/`prefs`
   (which already name `bridge` at `:25-26`). **Do this in its own commit.**
5. Signed-out `/jarvis` (`:52`) → a Bridge `preview` shell, honest per §15.
6. Move Command Center to `/jarvis/classic` behind an owner-only escape hatch, with a banner
   naming the sunset date.
7. **Delete duplicates after parity is proven:** `panels/ApprovalDock.tsx` ·
   `panels/ActivityRail.tsx` · `panels/JarvisOrb.tsx` *(if the 2D low-power path is folded
   into `Orb3D`'s fallback)* · `lib/CommandPalette.tsx` · `panels/CommandBar.tsx`.
   **Each deletion requires a passing snapshot of its replacement first.**
8. Left-rail navigation regrouped into the §9.2 scene list — **not 13 flat items**.

**Files expected to change.** `PersonalizedHome.tsx` · `bridge/Bridge.tsx` · `scenes/*`(new ×9)
· `src/app/jarvis/classic/page.tsx`(new) · **deletions** per task 7 · `views.tsx` **deleted**

**Architecture decisions already made.** Bridge is home. **Parity precedes deletion.** Legacy
survives at `/jarvis/classic` for one cycle. Nav is scene-grouped.
**Must not decide.** Deleting before parity. Keeping both permanently. A different home.

**Tests.** Full E2E suite; all certified paths; visual snapshots regenerated with an
**explicit, reviewed diff** — never a blind `--update-snapshots`.
**Visual.** Every scene at 1440 + 375; before/after of `/jarvis`.
**Runtime.** Zero console errors on every scene. **Assert exactly one data provider** — paste
a network log showing no duplicate polling.
**A11y.** Full keyboard walkthrough of all scenes — transcript pasted.
**Perf.** Cold Lighthouse ≥ 85; JS ≤ 250 KB gzipped — pasted.

**Failure/rollback.** The flip is **one line** — revert restores the legacy home instantly.
**Exit gate.**
- [ ] Owner `/jarvis` renders the **Bridge** — screenshot
- [ ] All 13 legacy views have scene homes — checklist complete
- [ ] `views.tsx` deleted; 9 scene files exist
- [ ] Duplicate subsystems deleted — `git rm` list pasted
- [ ] **Exactly one polling provider** — network log pasted
- [ ] Cold Lighthouse ≥ 85, JS ≤ 250 KB — pasted
- [ ] Zero console errors on every scene — pasted

**Dependencies.** P5–P10. **Sessions.** 4.

---

## PHASE 12 — Roles, Mobile & Design-System Sweep

**Objective.** Complete the three role journeys, make mobile first-class, apply §11.

**Source files to read.** `lib/jarvis-auth.tsx` ·
`panels/{DispatcherBoard,TechnicianBoard,MyDay,DispatchMap}.tsx` · `jarvis-theme.css` (all) ·
`finnor-os/apps/api/app/api/{me,technician/my-day,dispatch/map}/route.ts`

**Discovery commands.**
```bash
grep -rhoE "text-\[[0-9.]+px\]" src/components/jarvis | sort -u
grep -rn "role ===" src/
```

**Tasks (ordered).**
1. Role-scoped left rail, scenes and affordances per §16. **Backend stays the authority**;
   the frontend hides only to avoid dead affordances.
2. **Technician mobile journey end-to-end:** my day → work order → arrive → log → flag → done,
   **each step ≤ 2 taps, one-thumb reachable.** A deliverable, not a media query.
3. **Dispatcher journey:** map → assign → escalate, with the approval peek in the rail.
4. Rails collapse to a bottom sheet below 1024 px (the pattern exists from earlier cockpit
   work — reuse it).
5. **Type-scale sweep:** replace every `text-[Npx]` with a §11.1 token. **Nothing below 11 px.**
   Paste before/after of the discovery grep.
6. **Spacing sweep** to the §11.2 scale.
7. **Contrast audit:** measure every text/background pair; fix anything below 4.5:1.
   `--j-text-faint` on `j-panel` is the prime suspect — **measure and report the number**.
8. Touch targets ≥ 44 px throughout.
9. `data-weight` applied per §9.4; assert **one primary element per viewport**.

**Files expected to change.** `jarvis-theme.css` · all `panels/**` · all `bridge/**` ·
`scenes/**` · `ui/primitives/Panel.tsx`

**Architecture decisions already made.** The 6-step type scale; 11 px floor; 7-value spacing
scale; 44 px targets; the §16 role matrix.
**Must not decide.** Keeping sub-11 px text. Treating mobile as a media query.

**Tests.** E2E role journeys (certified path #7); a11y suite on every scene at 375.
**Visual.** All three roles at 1440, 768, 375; before/after of the type sweep.
**Runtime.** Console clean on mobile.
**A11y.** axe output for every scene at both widths; **contrast table with measured ratios**.
**Perf.** Mobile cold Lighthouse ≥ 85 — pasted.

**Exit gate.**
- [ ] `grep -rhoE "text-\[[0-9.]+px\]"` → **0** — pasted
- [ ] Contrast table, all ratios ≥ 4.5:1 — pasted
- [ ] Technician mobile journey ≤ 2 taps per step — E2E + screenshots
- [ ] All 3 role journeys green at 375 px — pasted
- [ ] axe: **zero violations** on every scene — pasted

**Dependencies.** P11. **Sessions.** 3.

---

## PHASE 13 — Demo, Dealer Zero & Onboarding Truth

**Objective.** Make every demo surface unmistakably honest; make first-run states designed.

**Source files to read.** `Showtime.tsx` · `src/app/demo/**` · `lib/demo/**` ·
`panels/CertificationStatus.tsx` ·
`finnor-os/apps/api/app/api/{setup/status,integrations/status,dealer-zero/time-compression}/route.ts`

**Tasks (ordered).**
1. `mode: "production" | "showcase" | "preview"` as a **kernel field** (§15.1).
2. Persistent, non-dismissible mode chip in the Pulse Strip for `showcase` and `preview`.
3. `preview` renders veils, never zeros — **verify P1's work holds after the P11 cutover**.
4. Rename the ticker per §15.2.4.
5. **Onboarding / partial-configuration states:** a tenant with nothing configured must see a
   designed first-run scene driven by `setup/status` + `integrations/status`, naming **the
   exact next action** — not an empty dashboard.
6. Showtime adopts the new scene vocabulary so the replay demonstrates the real product.
7. Assert: **no demo surface can render a number that is not labelled as to its mode.**

**Files expected to change.** `kernel/{types,store}.ts(x)` · `Showtime.tsx` ·
`bridge/PulseBar.tsx` · `bridge/FirstRunScene.tsx`(new) · `src/app/demo/**`

**Architecture decisions already made.** Three modes. Chip in primary chrome, not a corner
badge. **Preview never shows zeros.**

**Tests.** E2E certified path #8; E2E first-run with an unconfigured tenant.
**Visual.** All three modes; first-run scene at 1440 + 375.
**Runtime.** Console clean. **A11y.** Mode chip announced on load.

**Exit gate.**
- [ ] Mode chip visible and non-dismissible in `showcase` + `preview` — screenshots
- [ ] Preview shows **zero fabricated numbers** — screenshot
- [ ] First-run scene names the exact next action — screenshot
- [ ] Showtime uses the new scenes — screenshot

**Dependencies.** P11. **Sessions.** 2. *(May run in parallel with P12.)*

---

## PHASE 14 — Certification

**Objective.** Prove the whole thing, with numbers.

**Tasks (ordered).**
1. Run all 8 certified paths (§18.3); every one green.
2. Golden journey (§18.2) green at 1440 **and** 375.
3. **Measure event→pixel latency** across 20+ events on SSE **and** on the polling fallback.
   Publish median and p95.
4. Cold Lighthouse, 5 runs, desktop + mobile. Publish **median and worst**.
5. Full axe sweep, every scene, both widths.
6. Full keyboard-only walkthrough of all three roles — transcript.
7. Bundle analysis; assert ≤ 250 KB gzipped initial.
8. **Refresh/reconnect truth test:** mid-run refresh restores exact state; mid-run network
   loss and recovery restores exact state.
9. **Contradiction sweep:** for **every** number visible in any scene, assert a `data-source`
   attribute naming its selector. **Automate it.**
10. Console-error sweep: zero errors on all certified paths.
11. Write `docs/jarvis-certification-<date>.md` with every measurement.

**Exit gate — this is the Definition of Done (§22).**
- [ ] All 8 certified paths green — output pasted
- [ ] Golden journey green at both widths — output pasted
- [ ] Event→pixel median ≤ 1200 ms (SSE) / ≤ 5000 ms (poll) — pasted
- [ ] Cold Lighthouse ≥ 85 perf, ≥ 95 a11y, desktop + mobile, 5 runs — pasted
- [ ] axe zero violations, every scene, both widths — pasted
- [ ] Keyboard-only completes all three role journeys — transcript
- [ ] Every visible number carries `data-source` — automated check pasted
- [ ] Zero console errors — pasted
- [ ] Refresh + reconnect restore truthful state — pasted
- [ ] Initial JS ≤ 250 KB gzipped — pasted
- [ ] `docs/jarvis-certification-<date>.md` committed

**Dependencies.** P0–P13. **Sessions.** 2–3.

---

# §20. PHASE DEPENDENCIES

```
P0 → P1 → P2 → P3 → P4 → P5 → P6 → P7 → P8 ─┐
                                │      │     │
                                └ P9 ──┘     │
                                             ↓
                          P10 ←──────────────┘
                           │
                           ↓
                          P11 → P12 ─┐
                           │          ├→ P14
                           └→ P13 ────┘
```

- **P9** may run in parallel with P7/P8 (independent surface).
- **P10** needs P5, P7 and P8 — its binding targets must exist first.
- **P12** and **P13** may run in parallel after P11.
- **Nothing may skip P0 → P1 → P2.** That chain is the spine.

---

# §21. RISKS AND ROLLBACK

| Risk | Likelihood | Impact | Mitigation | Rollback |
|---|---|---|---|---|
| Kernel duplicates `data-core` state and they diverge | med | high | Kernel *wraps*; `useJarvis` banned outside `kernel/` by lint | revert kernel; components still read data-core |
| Backend migration (P3) breaks production | low | critical | Purely additive; `instructionId` optional; response unchanged | additive migration; drop the frontend flag |
| SSE proxy hangs on Vercel edge | med | high | Dedicated route + heartbeat + `NEXT_PUBLIC_JARVIS_SSE=0` kill switch | flip the env var → polling |
| P11 cutover regresses the owner experience | med | critical | Parity checklist per view; the flip is one line in its own commit; `/jarvis/classic` retained | revert one line |
| Motion restructure (P10) breaks the stage catalog | med | med | Shared implementation; both consumers snapshot-tested | revert per primitive |
| Snapshot churn hides real regressions | high | med | Every update reviewed as an explicit diff; **never blind `--update-snapshots`** | regenerate from the prior commit |
| Perf regresses from new scenes | med | high | Budget asserted every phase; heavy scenes stay dynamic | lazy-load or defer the offending scene |
| Sonnet invents architecture when blocked | med | high | §0.1 + the Blockers section + explicit "must not decide" per phase | revert; re-read the phase |
| Deleting a duplicate that was still load-bearing | med | high | Deletion requires a passing snapshot of the replacement first | `git revert` the deletion commit |

**Global rollback:** every phase is one or more commits prefixed `jarvis-fe P<n>.`.
`git revert` by prefix restores the prior phase. No phase may leave `/jarvis` broken
(§0.6.10), so any single revert is safe.

---

# §22. DEFINITION OF DONE

Done when **all 20 gates hold**, each with pasted evidence:

1. No two surfaces show different values for the same fact. *(P1 · verified P14)*
2. Every visible metric carries `data-source` naming its selector. *(P1/P14)*
3. Every backend lifecycle state — 9 action, 8 run, 6 step, 5 job — has a designed frontend
   representation. *(P8)*
4. All **44** action types have a renderer; a contract test enforces it. *(P9)*
5. Every consequential action supports approval and receipt inspection. *(P6/P7)*
6. Event→pixel latency measured and within budget. *(P4/P14)*
7. Refresh and reconnect restore truthful state. *(P4/P14)*
8. Missing integrations produce designed degraded states — never blanks or zeros. *(P8)*
9. Demo mode cannot imply production data. *(P13)*
10. No primary interaction requires a mouse. *(P12/P14)*
11. Reduced motion retains full meaning. *(P10)*
12. Low-power mode remains fully usable. *(P2/P10)*
13. Mobile owner, dispatcher and technician journeys complete. *(P12)*
14. No customer-facing route exposes raw payloads. *(P6/P9)*
15. No fake activity, counters or execution anywhere. *(P1/P13)*
16. Zero console errors on all certified paths. *(P14)*
17. Cold Lighthouse ≥ 85 perf / ≥ 95 a11y, 5 runs, desktop + mobile. *(P14)*
18. Visual regression protection existed before every component rewrite. *(P0)*
19. Critical frontend↔backend contracts have integration tests. *(P9/P14)*
20. **The golden journey is flawless:** voice instruction → thinking → plan → approval →
    execution → every affected surface updates → verification → receipt. *(P14)*

---

# §23. EXACT EXECUTION ORDER

```
P0   Regression net & instrumentation        1–2 sessions
P1   Truth layer                             2–3
P2   The kernel                              3
P3   Instruction trace (+ backend)           3–4
P4   Realtime transport                      2–3
P5   Command Rail & Thinking Theater         3
P6   Clarification & Approval Cockpit        2–3
P7   Execution, Verification & Receipts      3
P8   Failure, Recovery & Degraded            3
P9   Renderer completeness                   2      (may parallel P7/P8)
P10  Motion & sound promotion                3–4
P11  IA cutover — Bridge becomes JARVIS      4
P12  Roles, mobile & design sweep            3      (may parallel P13)
P13  Demo, Dealer Zero & onboarding truth    2
P14  Certification                           2–3
                                         ─────────
                                   TOTAL  38–48 sessions
```

**Start at P0.T1. Do not start anywhere else.**

---

# §24. THE MOAT, AND HOW THE FRONTEND MAKES IT VISIBLE

JARVIS does not win by being a prettier chatbot. Every moat asset below **already exists in
`finnor-os` and is currently invisible**. The phase that surfaces each:

| Moat asset | Backend home | Surfaced by |
|---|---|---|
| Water-treatment workflow ontology | 25 domain plugins | **P9** — all 44 renderers, flagship scenes |
| Real business context | `packages/memory`, `planner-memory.ts` | **P5** — context chips in ThinkingTheater |
| Tenant-specific policies | `domain_policies`, `policy-schema` | **P6** — policy id + version on every approval card |
| Grounded planning | `planner.ts`, `plan-dag.ts` | **P5** — the plan DAG forming live |
| Approval controls | `GatedExecutor`, `canApprove` | **P6** — the Approval Cockpit as the centre scene |
| Operational integrations | `integrations/status` | **P8** — designed degraded state per integration |
| Workflow execution | `workflow-runtime` | **P7** — Execution Theater lanes |
| Durable state | `workflow_runs`, `commands`, checkpointer | **P7** — restore-on-refresh mid-run |
| Business memory | `packages/memory` | **P5** — what JARVIS knew, and why |
| Receipts | `decision_receipts` | **P7** — the receipt scene |
| **Predicted vs actual** | **`prediction-diff.ts`** | **P7 — the Verification scene. The sharpest moat asset, and it currently has no UI at all.** |
| Accumulated outcome data | `learning.ts`, `reflection.ts` | **P7/P13** — reliability + certification surfaces |

**The sentence that should describe the finished product:**

> You tell JARVIS what you want; you watch it understand, ask when it is unsure, plan against
> your real business, wait for your permission, do the work, and then prove exactly what it did.

---

*End of plan. Begin at Phase 0, Task 1. Record everything in
`JARVIS-FRONTEND-MAESTRO-STATE.md`.*
