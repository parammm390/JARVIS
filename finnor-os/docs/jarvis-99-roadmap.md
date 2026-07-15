# Finnor OS → 99% Roadmap (Phases 1-16)

**Read this before anything else, so it's impossible to misread what follows:**
"Phases 1-6 done" means exactly one thing — the specific, bounded task list for
those 6 phases was built and verified (real Postgres, chaos-tested, no mocks, full
suite green twice consecutively at the end). It does NOT mean the product is
finished, feature-complete, or ready to show anyone. Honest overall assessment as of
this file: roughly 55-65% engineering-complete toward the full "autonomous ops
assistant" vision, up from ~18% before this work. Phases 7-16 below are what closes
most of the remaining ~35-45%, and even after all 16, the last stretch to 100% is
real API credentials for a real operating dealer — not more code. Do not quote
"Phases 1-6 complete" out of this context.

## PHASES 1-6 (their specific scope built + verified) — summary of what already exists

**Phase 1 — Canonical Data Platform.** 21 new tables in a dedicated `finnor_os`
Postgres schema (its own schema so it can share a database with something else with
zero collision risk). A `@finnor/data-platform` repository package wraps every write
in a `business_events` row — a real queryable cross-entity timeline, not a log file.
3 of 17 plugins (crm, quotation, accounting) migrated to it directly; the rest touch
it additively (see Phase 3). Synthetic dealer import script + proof test built to
validate the schema against realistic data before any real dealer existed.

**Phase 2 — Durable Execution Runtime + Capability Control Plane.** Built
`@finnor/workflow-runtime` from scratch: `commands` -> `workflow_runs` ->
`workflow_steps`, driven through the EXISTING Postgres job queue (not a second queue
system) via `FOR UPDATE SKIP LOCKED` + lease recovery. Added `integration_operations`
(idempotent external calls), `outbox_events`/`inbox_events` (at-least-once delivery
with dedup), `reconciliation_cases` (never blindly retries an unknown-outcome
delivery), `compensation_cases` (undo-on-failure). Capability contracts (typed
input/output + swappable emulator/native/real bindings) proven on 2 domains
(scheduling, communications) first. Chaos-tested for REAL: an actual OS process
`SIGKILL` at 3 defined boundaries (pre-commit, post-commit-pre-ack, mid-multi-step),
proving recovery instead of assuming it. Two real bugs were found and fixed this way
(duplicate reconciliation_cases on repeated polling; a chaos-test driver that ignored
step sequencing).

**Phase 3 — Remaining Plugin Migrations + 5 More Capability Domains.** Audited all 14
remaining plugins individually — 8 had zero direct database writes (nothing to
migrate). Fixed the shared sandbox comms layer (`packages/tools/src/sandbox.ts`) once,
which upgraded 6+ plugins' persisted output simultaneously (household/communications
writes -> canonical `conversations`/`messages`/`contacts`). Built 5 more capability
domains with contracts + emulators + conformance tests: CRM/GHL, accounting (QuickBooks
real adapter formalized + payment-link emulator), marketing (ad campaigns + review
requests), inventory/procurement (fully greenfield — no prior code existed to
rebind), documents/e-signature (document generation real, signature request
emulator-only — no real e-sign provider existed to bind to).

**Phase 4 — Vertical Workflows 1-4.** Wired real fragments together via
`@finnor/workflow-runtime` commands/steps: lead -> booked water test (fixed
Phase 2's orphaned `hold_appointment` capability by giving it a real caller, added a
no-show scan to close the loop), water test -> signed proposal (built real
signature/decline/expiry handling that didn't exist before, depends on Phase 3's
documents capability), signed proposal -> installation (gave `work_orders`/
`procurement_orders`/`warehouse_stock` — built in Phase 1, unused until now — their
first real callers, including a genuine procurement-exception step when stock is
short), invoice -> cash (built the entire payment-collection loop: link, webhook,
reconciliation — the first real caller of Phase 2's inbox_events/reconciliation_cases
machinery). Two real test bugs found by actually running the suite (not by review):
an FK-cleanup-order bug and a UNIQUE-constraint collision on repeat test runs.

**Phase 5 — Vertical Workflows 5-7 + Voice OS.** Closed the single biggest gap found
in the whole system: every voice caller was silently treated as the tenant owner
(hardcoded identity), and a spoken "yes" applied to whichever domain action was
newest for the tenant — a real cross-caller confirmation bug. Built real caller
identity resolution (owner phone match, household match, or handoff for anyone else
— never silent owner-trust) and confirmations bound to the specific session that
drafted them. Vertical workflow 5 (recurring revenue): found the existing Temporal
AMC-renewal sequence's "renewed" outcome did nothing durable, fixed it to actually
advance the renewal date and bill the customer when a real price is configured (never
fabricated). Workflow 6 (daily owner digest): extended with real cash/follow-up/
stuck-workflow signals. Workflow 7 (marketing -> revenue): new webhook turning ad
conversion events into real CRM leads.

**Phase 6 — Orchestration Compiler + Read-Models + Eval Harness.** Built a typed plan
compiler that sits between the Planner's raw LLM output and the stored action:
grounds every id-shaped payload field against the real table it claims to reference
(verified/not_found/unverifiable, never assumed), and tags each action
workflow-vs-single-call — a structural tag, not a fabricated step list, since actual
steps depend on runtime state the compiler can't predict. Built 8 cross-entity
read-models (pipeline health, technician load, stock risk, cash collections, service
due, SLA breaches, follow-up debt, data quality) as real typed queries, exposed via
an API route. Built a planner eval harness (`scripts/eval-planner.ts`) that drives the
REAL LLM against ~40 scripted scenarios covering every registered action type — first
honest baseline: 31/41 passed, 5 real planner ambiguities identified and left
UNFIXED on purpose (that's Phase 7's job, not something to have silently patched
without a real before/after measurement).

**End-of-Phase-6 verification:** typecheck clean, 43 test files / 246 tests green
across two consecutive full-suite runs, real Postgres throughout, zero mocks.

---

# PHASES 7-16 (NEXT) — the continuation plan

This is the continuation plan after Phases 1-6 above.

**How to use this file:** each phase below is a self-contained block. Copy the
`SHARED CONTEXT` section once, then copy ONE phase's `PASTE THIS PROMPT` block after it,
into a fresh Claude Code chat. That chat has zero memory of any prior session — the
context block is what makes it productive from message one instead of re-deriving
everything. Do phases in order; several build directly on the previous one's output.

**On scope honesty:** this list is a filtered, resequenced merge of three inputs — the
actual codebase state, a "10 massive upgrades" list from ChatGPT, and a more grounded
4-item list from a separate Claude session. Several items from the ChatGPT list were
cut or shrunk on purpose: 10 named specialist agents, a 100+ tool ecosystem, a
Palantir-scale world model, SIEM/zero-trust/canary-deploy hardening, and voice
prosody/emotion detection are real engineering categories but are sized for a company
with live customers and a multi-year runway, not a pre-revenue single-dealer product.
Building them now would add surface area and bugs, not intelligence. Nothing below
claims to reach 99% on its own — the last stretch to 100% is real API credentials for a
real operating dealer, which no phase of engineering closes.

**Model setting per phase:** switch to your highest reasoning effort (Opus or Sonnet
5 "max") for that phase's own planning pass (the first 10-15 minutes of the new chat,
before any code is written) — this is where scope mistakes get made. Drop to a lower
effort tier once the plan is approved and the chat is grinding through mechanical
implementation + the verification loop (typecheck, run tests, fix, repeat).

**Verification bar every phase must hit before being called done** (matches Phases
1-6's established discipline — do not relax this):
1. `npx tsc --build --force` clean.
2. Full suite (`node --env-file=.env node_modules/.bin/vitest run` from `finnor-os/`)
   green, run twice consecutively, real Postgres, no mocks.
3. Any new capability/integration gets a real conformance or integration test, not a
   unit test against a mock.
4. An honest written note on what's real vs. simplified in that phase — same standard
   Phases 1-6 were held to. No completeness claims beyond what actually ran and passed.

---

## SHARED CONTEXT (paste this before every phase prompt below)

```
Finnor OS is a multi-tenant AI operating system for water-treatment dealers: voice +
text instructions become gated, auditable business actions. Stack: Next.js API
(apps/api) + console frontend (apps/console) + worker (apps/worker) + orchestrator
package (packages/orchestration) + Temporal worker (apps/temporal-worker), one npm
workspaces monorepo, Drizzle ORM + Postgres, tenant isolation via RLS + withTenant().

Core loop: instruction -> LLMPlanner (Groq default, Bedrock Claude fallback) drafts a
DomainAction against a plugin's payload schema -> mandatory human-approval gate
(atomic conditional UPDATE, exactly one winner under concurrency) -> Executor runs one
of 21 domain plugins (~40 action types: CRM, scheduling, inventory, accounting,
quotation, marketing, customer-comm, technician-reports, compliance-documentation,
service-reminders, bulk-notify, proposal-batch, water-test, water-domain-knowledge,
web-research, ops-overview, maintenance-agreement, plus 4 vertical-workflow plugins) ->
Reflection compares expected vs actual, retries once, escalates on repeat failure. An
async critic pass (Bedrock DeepSeek) reviews GATED actions after they're already
waiting for a human — zero added voice latency, can only flag needs_human_review,
never override. All business rules live as tenant-scoped JSON in domain_policies,
never code; a PLACEHOLDER_NEEDS_REAL_VALUE sentinel keeps anything unconfigured safely
gated. GET /api/setup/status reports real config state per action type.

Durable execution: a Postgres job queue (FOR UPDATE SKIP LOCKED, lease recovery) plus
a purpose-built runtime (@finnor/workflow-runtime: commands -> workflow_runs ->
workflow_steps, with integration_operations for idempotent external calls,
outbox_events/inbox_events for at-least-once delivery + dedup, reconciliation_cases
for unknown-outcome handling, compensation_cases for undo-on-failure). Chaos-tested
for real (actual OS process kills at 3 boundaries). Capability contracts (typed
input/output + swappable emulator/native/real bindings) cover 7 domains: scheduling,
communications, CRM, accounting, marketing, inventory, documents. 7 vertical workflows
run end-to-end: lead->booked water test, water test->signed proposal, signed
proposal->installation (with real procurement-exception handling), invoice->cash,
recurring revenue (Temporal-based maintenance-agreement renewal that now actually
bills on renewal when a real price is configured), daily owner operating loop (real
cash/follow-up/stuck-workflow signals), marketing conversion->real lead.

Voice OS: real caller identity resolution (tenant's registered owner phone or a
matched household; unresolved callers get handed off, never silently trusted as
owner), confirmations bound to the specific session that drafted them (fixed a real
cross-caller confirmation bug this phase).

Plan compiler + read-models (new, Phase 6): every id-shaped payload field is checked
against the real table it claims to reference (verified/not_found/unverifiable, never
assumed); each action is tagged workflow vs single_action. 8 read-models (pipeline
health, technician load, stock risk, cash collections, service due, SLA breaches,
follow-up debt, data quality) exist as real typed queries, exposed via an API route.
A planner eval harness (scripts/eval-planner.ts) drives the real LLM against ~40
scripted scenarios; first honest baseline was 31/41 passed, 5 real planner
ambiguities identified and NOT yet fixed (see Phase 7 below — that's its first job).

Memory: 4 tiers — Redis (short-term/session), Postgres (long-term/household), pgvector
(semantic, in-process cosine fallback locally), append-only audit log (episodic,
DB-trigger-enforced immutable).

Frontend (apps/console): 6 pages, ~560 lines total, inline styles, no design system,
functionally wired to real APIs but zero visual polish — this is the weakest layer
relative to backend depth and the first thing anyone sees.

Known real gaps (not fixed by more code — credentials/business-account gaps):
no real payment provider or e-signature provider connected (both emulator-only by
design), AWS Secrets Manager code ready but no real credentials loaded, no staging
environment, Gmail app password empty (email doesn't send), Vapi webhook secret empty
(dev-safe only), GHL/QuickBooks sandbox creds unavailable, ~2/3 of action types show
"unconfigured" because no real dealer's pricing/rules exist yet.

Conventions this whole codebase follows, keep following them:
- Real Postgres in every test, never mocked. describe.skipIf(!available) DB-reachability
  guard. Dedicated tenant UUID per test file. FK-ordered cleanup in beforeAll/afterEach.
- Hand-written SQL migrations in packages/db/migrations/, bundled via
  scripts/bundle-migrations.ts into packages/db/migrations-bundle.ts after every new one.
- Never invent completeness. If something is emulator-only or unconfigured, say so in
  code comments and in your final report, the same way every prior phase did.
- withTenant() for every tenant-scoped query; RLS is the enforcement boundary.
- New package: package.json (type module, main/types -> src/index.ts) + path alias in
  BOTH tsconfig.base.json and vitest.config.ts.
```

---

## PHASE 7 — Self-Critique & Repair Before the Gate

**Why:** The eval harness (Phase 6) found 5 real planner ambiguities — e.g. "send the
proposal" sometimes routes to `answer_business_question` instead of `send_proposal`;
the vertical-workflow action types occasionally lose to their simpler single-step
namesakes. Today's critic only reviews AFTER an action is already gated. This phase
gives the planner a chance to catch and repair its own mistakes before a human ever
sees the draft — the single highest-leverage "feels smarter" change available, because
it slots directly onto the plan compiler (Phase 6) instead of requiring a new engine.

**Scope:**
1. Turn the eval harness's 5 named failure patterns into an explicit checklist
   (packages/orchestration/src/repair.ts or similar) — not vague "check for mistakes,"
   literal named checks: (a) is a more specific action_type available that the LLM
   passed over for a generic fallback, (b) does a workflow-tagged action's payload
   look like it should have gone through the simpler single-action counterpart or
   vice versa, plus whatever else the harness surfaces on a fresh run.
2. Add a repair pass: after the Planner drafts an action and BEFORE it's inserted as
   pending/gated, run one additional cheap LLM call (or a deterministic check where
   possible — prefer deterministic over a second LLM call wherever the check is
   mechanical) that either confirms the draft or produces a corrected action_type/payload.
   Log both the original and repaired version to action_log for auditability — never
   silently swap without a record.
3. Re-run scripts/eval-planner.ts before and after — the report this phase must include
   is the actual before/after pass-rate delta, not a claim of improvement.
4. This must NOT add meaningful latency to the voice path for actions that don't need
   it — gate the repair pass behind Phase 8's risk tiering if you build that first, or
   keep it cheap enough (a small/fast model, not another full planning call) that it's
   fine unconditionally for now.

**Non-goals:** do not build a general "self-improving" framework. Do not touch the
async critic (post-gate) — that stays as-is, this is a new PRE-gate step.

**Verify:** re-run the eval harness and report the real before/after numbers. Full
suite twice. New integration test proving at least one of the 5 known failure
patterns is now caught and repaired.

**PASTE THIS PROMPT (after the SHARED CONTEXT block):**
```
/goal Implement Phase 7 of the Finnor OS roadmap: self-critique & repair before the
gate. Read scripts/eval-planner.ts and packages/orchestration/src/planner.ts and
compiler.ts first to understand the current state, then build the repair pass
described in the Phase 7 scope above. Run the eval harness before you start to get a
fresh baseline (rate-limit pacing is already built in, it takes a few minutes), then
again after your changes, and report the real delta. Follow this repo's established
verification bar (typecheck clean, full suite green twice consecutively, real
Postgres, no mocks) before considering this done. Do not fabricate an improvement
number — report whatever the harness actually says, including if some scenarios get
worse.
```

---

## PHASE 8 — Risk-Tiered Reasoning Depth

**Why:** Not every action deserves the same reasoning budget. This is the realistic,
cheap version of "simulation and confidence scoring" — calling the planner twice (or
adding the repair pass from Phase 7) only for actions where the stakes justify the
latency, using data you already have (`domain_policies.requiresConfirmation` already
distinguishes gated vs. not — this extends that same concept).

**Scope:**
1. Add a `reasoningTier` concept derived from existing signals: `requiresConfirmation`
   from the policy (already exists), plus a magnitude check where the payload has a
   dollar amount or affects an already-approved dependent workflow (use the plan
   compiler's `groundedPayload`/`compiledGraph` from Phase 6 to detect this — e.g. a
   `workflow`-tagged action, or a payload with `amountUsd` above a tenant-configurable
   threshold in `domain_policies`, is "high" tier).
2. Routine actions (low tier): unchanged, one planner call.
3. Medium tier: run Phase 7's repair pass (if built) or add it now as part of this phase.
4. High tier: generate 2 candidate actions/payloads from the planner (two LLM calls,
   or one call asked to return 2 ranked candidates in the same response — cheaper,
   prefer this), score them with a lightweight deterministic scorer (does the payload
   ground cleanly per Phase 6's compiler, does it match a known-good pattern from
   Phase 9 if that's built yet), pick the better one, THEN repair-pass it.
5. Add a `reasoningTier` + which path was taken to `action_log` so this is auditable,
   not a black box.

**Non-goals:** no new "simulation engine." No more than 2 candidates ever — this is
about cheap, justified extra reasoning for real stakes, not an open-ended search.

**Verify:** integration test proving a low-value action takes the 1-call path and a
high-value/workflow action takes the 2-candidate path, with the choice logged.
Full suite twice.

**PASTE THIS PROMPT (after the SHARED CONTEXT block):**
```
/goal Implement Phase 8 of the Finnor OS roadmap: risk-tiered reasoning depth. Read
packages/orchestration/src/planner.ts, compiler.ts, and packages/db/schema.ts's
domain_policies table first. Build the reasoningTier logic described in the Phase 8
scope above, reusing the Phase 6 plan compiler's groundedPayload/compiledGraph output
to help classify tier rather than inventing a separate classifier. If Phase 7's
repair pass already exists, wire into it for the medium/high tiers instead of
duplicating logic. Keep the 2-candidate path to genuinely high-stakes actions only —
do not let scope creep into every action getting extra LLM calls, that just adds cost
and latency for no benefit. Follow the repo's verification bar (typecheck, full suite
twice, real Postgres) before calling this done.
```

---

## PHASE 9 — Retrieval-Based Pattern Context

**Why:** "Last 73 times, this dealer preferred X" is retrieval over your own audit
log, not learning — call it that, honestly, in code comments and in any dealer-facing
copy. Claiming otherwise is the fastest way to lose credibility the moment someone who
understands the difference asks a direct question. What's real and buildable: querying
`business_events`/`action_log` for similar past cases and feeding the pattern into the
Planner's context, starting with your highest-value workflows (proposals, pricing).

**Scope:**
1. New function in packages/memory or a new packages/pattern-retrieval package:
   given a tenant + an action_type + a rough payload shape, query past
   `business_events`/`action_log` rows of the same action_type, extract simple
   aggregate patterns (e.g. "of the last N proposals sent to this household or similar
   households, how many were accepted at what price point," "how often was this
   technician's ETA late per business_events"). Keep this to a handful of concrete,
   query-able patterns tied to real columns — do not build a generic "pattern mining"
   system.
2. Feed the retrieved pattern into MemorySnapshot (extend the existing shape, don't
   replace it) so LLMPlanner.plan() can use it the same way it already uses
   shortTerm/episodic memory.
3. Ship this for 2-3 of your highest-value action types first (proposals/pricing,
   technician assignment) rather than all ~40 at once — prove it moves the needle
   before expanding.

**Non-goals:** no fine-tuning, no vector-embedding-based "learned" behavior, no
claiming this is a learning system anywhere in code, docs, or product copy.

**Verify:** integration test seeding known historical business_events, proving the
retrieved pattern actually shows up in what gets passed to the planner. Full suite
twice.

**PASTE THIS PROMPT (after the SHARED CONTEXT block):**
```
/goal Implement Phase 9 of the Finnor OS roadmap: retrieval-based pattern context.
Read packages/memory/src/index.ts (buildMemorySnapshot) and packages/db/schema.ts's
business_events/action_log tables first. Build the pattern-retrieval function
described in the Phase 9 scope above, for proposals/pricing and technician assignment
first. Call it "retrieval" or "pattern context" everywhere in code comments, docs, and
any user-facing text — never "learning." Follow the repo's verification bar
(typecheck, full suite twice, real Postgres, no mocks) before calling this done.
```

---

## PHASE 10 — Frontend Mission Control

**Why:** Both prior analyses agree this is the single biggest lever on first
impression, independent of backend depth, and it's real, achievable engineering with
zero new AI research required. Today: 6 pages, ~560 lines, inline styles, no design
system. This is its own track — run it in parallel with the intelligence phases above,
not after them.

**Scope:**
1. Real design system: a token set (color, spacing, type scale, motion durations),
   dark/light aware, applied consistently — replace the inline-style pattern in
   apps/console entirely.
2. A genuine "mission control" information architecture, not a bigger admin dashboard:
   a live view of in-flight workflow_runs/workflow_steps (Phase 2's durable runtime is
   already fully queryable — this is a real data source, not a mockup), the
   confirmation queue redesigned with real motion, an event timeline pulling from
   business_events (Phase 1/6 — also real data, already there), the 8 read-models
   (Phase 6) surfaced as an actual live dashboard instead of just an API route.
3. Command palette (cmd-K) for navigation + common actions, keyboard-first where it
   makes sense.
4. Cinematic motion where it earns its place (workflow step transitions, confirmation
   card interactions) — but performance and clarity first; motion is seasoning, not
   the point.
5. Mobile-responsive layout — this wasn't true at all before this phase.

**Non-goals:** no "AI thoughts" panel that fabricates a chain-of-thought the model
didn't actually produce — if you show reasoning, show real `reasoning` field content
already captured on DomainAction, never invented narration. No animated "knowledge
graph" visualization until Phase 11 actually produces graph-shaped data to visualize —
don't build a UI for data that doesn't exist yet.

**Verify:** this is frontend, so use the `run`/browser-preview flow this repo's
tooling supports — actually load the pages in a browser and confirm real API data
renders, don't just eyeball the component code. No regression to existing
functionality (confirm/reject flow, policy editing, etc. all still work).

**PASTE THIS PROMPT (after the SHARED CONTEXT block):**
```
/goal Implement Phase 10 of the Finnor OS roadmap: Frontend Mission Control. Read
every file in apps/console/app first (it's small, ~560 lines total) to understand
current functionality before changing anything — do not regress the existing
confirm/reject/policy/audit/talk/comms flows. Build the design system + mission
control experience described in the Phase 10 scope above, using REAL data sources
that already exist: workflow_runs/workflow_steps (durable execution runtime),
business_events (event timeline), the 8 read-models exposed at
/api/read-models/:view. Do not fabricate any "AI reasoning" display beyond what's
actually stored in DomainAction.reasoning. Start the dev server and actually drive
the UI in a browser to verify each page before calling this done — don't just review
the component code.
```

---

## PHASE 11 — Memory Depth Extension

**Why:** The honest version of "cognitive memory" — extending what you already store
(episodic log, business_events, households/contacts/opportunities) with real
cross-entity relationship queries, not standing up 7 new memory "types" as a rewrite.

**Scope:**
1. Build on Phase 6's read-models and Phase 9's pattern retrieval: add relationship
   traversal queries — "everyone connected to this household" (contacts, technicians
   who've serviced them, quotes/invoices/communications), "everything that happened
   to this opportunity across its lifecycle" — using the tables you already have
   (households, contacts, opportunities, business_events), not a new graph database.
2. If traversal queries genuinely get too slow/complex for relational SQL at some
   entity depth, that's the signal to consider a graph layer — don't add one
   speculatively before that's proven true with real data volume.
3. Surface the most useful traversal (household → full history) as a read-model,
   consumed by both the planner (for context) and the Phase 10 frontend (for a
   real "customer 360" view).

**Non-goals:** no new database technology unless the relational approach is proven
insufficient with real query performance data, not assumption.

**Verify:** integration test with real multi-entity fixtures proving a traversal query
returns the correct connected graph. Full suite twice.

**PASTE THIS PROMPT (after the SHARED CONTEXT block):**
```
/goal Implement Phase 11 of the Finnor OS roadmap: memory depth extension. Read
packages/read-models/src/index.ts (Phase 6) and packages/memory/src/index.ts first.
Build the relationship-traversal read-model(s) described in the Phase 11 scope above
using plain SQL/Drizzle over existing tables — do not introduce a graph database
unless you've actually measured relational query performance against realistic data
volume and found it insufficient (and if so, say exactly what you measured). Follow
the repo's verification bar (typecheck, full suite twice, real Postgres) before
calling this done.
```

---

## PHASE 12 — Autonomous Loop Closure

**Why:** You already have proactive scans (cold leads, low inventory, service due,
appointment no-shows, data quality) and a daily digest. The real gap isn't "add an
OODA framework from scratch" — it's that scan findings don't currently feed back into
planning confidence or trigger anything beyond a digest line. This phase closes that
loop using what already exists.

**Scope:**
1. Wire scan findings (scan_findings table, already real) into the Phase 9 pattern
   context and Phase 8 risk tiering — e.g. a flagged low-inventory item should raise
   the risk tier of any action that would consume that stock, using data you already
   collect.
2. For findings that have a clear, safe, deterministic remediation (not requiring
   judgment), let the scan itself draft the action directly (already how
   draftKnownAction-based scans work) — the extension here is making MORE scans
   capable of drafting real actions instead of just logging a finding, where that's
   safe to do (still gated, never auto-executed).
3. Tighten the scheduler interval logic if real usage shows findings going stale
   before the daily digest surfaces them — measure this with real data before
   changing the interval, don't guess.

**Non-goals:** no separately-branded "OODA loop" system — this is an extension of the
scheduler + scan handlers you already have, described honestly as that.

**Verify:** integration test proving a scan finding actually influences a subsequent
planning decision (risk tier or pattern context). Full suite twice.

**PASTE THIS PROMPT (after the SHARED CONTEXT block):**
```
/goal Implement Phase 12 of the Finnor OS roadmap: autonomous loop closure. Read
apps/worker/src/scheduler.ts and the scan handlers in apps/worker/src/handlers/ first.
Wire scan findings into the Phase 8 risk-tiering and Phase 9 pattern-context systems
as described in the Phase 12 scope above — this is an extension of the existing
scheduler/scan-handler system, not a new framework. Follow the repo's verification
bar (typecheck, full suite twice, real Postgres) before calling this done.
```

---

## PHASE 13 — Orchestration Expansion

**Why:** The LangGraph-based gate/executor path currently covers exactly one action
type (schedule_water_test), with the rest on the original hand-rolled executor. This
phase grows real coverage and adds the "which tool/provider" reasoning ChatGPT's
Phase 13 described, scoped to what you actually have (Groq/Bedrock providers, not a
fantasy of arbitrary tool selection across 100 integrations).

**Scope:**
1. Expand the LangGraph allowlist to cover the vertical-workflow action types (Phase
   4/5) next — they're the ones that benefit most from graph-based state/interrupt
   handling since they're already multi-step.
2. Add real provider-selection reasoning: given cost/latency/availability signals you
   actually have (Groq vs Bedrock configured-or-not, recent error rates per provider
   from Sentry breadcrumbs already being captured), pick the provider per-call instead
   of the current static default+fallback. This is a real, boundable version of
   "cost/tool reasoning" — not a general reasoning-about-any-tool system.

**Non-goals:** don't attempt "which of 100 tools" reasoning — you have a handful of
LLM providers and ~40 action types with fixed plugin routing; that's the real scope.

**Verify:** integration test proving a vertical-workflow action type now runs through
the LangGraph path with checkpoint/resume behavior proven the same way the original
schedule_water_test proof worked. Full suite twice.

**PASTE THIS PROMPT (after the SHARED CONTEXT block):**
```
/goal Implement Phase 13 of the Finnor OS roadmap: orchestration expansion. Read
packages/orchestration/src/graph/ (build-graph.ts, executor.ts, allowlist-executor.ts,
checkpointer.ts) first to understand the current LangGraph proof-of-concept before
expanding it. Add the vertical-workflow action types to the allowlist and prove
checkpoint/resume survives a process restart the same way it was proven for
schedule_water_test. Then add the real provider-selection logic described in the
Phase 13 scope above, using actual signals (configured-or-not, recent error rates)
rather than a speculative general tool-reasoning system. Follow the repo's
verification bar (typecheck, full suite twice, real Postgres, actual process-restart
proof for the checkpoint claim) before calling this done.
```

---

## PHASE 14 — Voice OS Depth

**Why:** The realistic subset of ChatGPT's Phase 14 — interruption handling, caller
recognition (partially done in Phase 5), multi-number tenant routing, and richer
cross-call memory are real and buildable. Emotion detection, prosody analysis, and
sub-400ms latency engineering are voice-ML research problems, not something this
repo's coding sessions produce — leave them out.

**Scope:**
1. Multi-tenant phone-number routing: today `defaultTenant()` resolves one hardcoded
   tenant per deployment. Real dealers each need their own number resolving to their
   own tenant — build a `tenant_phone_numbers` mapping (or extend voice_identities'
   sibling tables from Phase 5) so the Vapi webhook resolves tenant from the DIALED
   number, not an env var.
2. Cross-call caller memory: voice_identities (Phase 5) already persists across calls
   — extend it to carry forward real preferences observed via Phase 9's pattern
   retrieval (e.g. "this caller usually confirms by saying 'yep' not 'yes'" — feed
   parseSpokenDecision more real recognized phrases from actual call transcripts
   stored in `calls`).
3. Interruption handling: check what Vapi's own API actually supports for barge-in
   today (this may already be a Vapi platform feature you just need to configure/wire,
   not something to build from scratch — check before writing code).

**Non-goals:** no emotion/prosody detection, no custom latency-engineering project
below what Vapi's platform already provides.

**Verify:** integration test proving a second tenant's phone number correctly routes
to that tenant, not the first one. Full suite twice.

**PASTE THIS PROMPT (after the SHARED CONTEXT block):**
```
/goal Implement Phase 14 of the Finnor OS roadmap: voice OS depth. Read
apps/api/app/api/webhooks/vapi/route.ts and packages/voice-os/src/index.ts (Phase 5)
first. Build multi-tenant phone-number routing as described in the Phase 14 scope
above — this is the highest-priority item since defaultTenant() currently hardcodes
one tenant. Before building any interruption-handling code, check Vapi's actual API
documentation for existing barge-in/interruption support — much of this may already
be a platform feature that just needs configuring, not custom code. Do not build
emotion detection or prosody analysis — that's out of scope. Follow the repo's
verification bar (typecheck, full suite twice, real Postgres) before calling this done.
```

---

## PHASE 15 — Capability & Tool Ecosystem Growth

**Why:** Not "100+ tools" speculatively — grow capability coverage exactly as far as
credentials and real dealer needs justify, and make sure every emulator-only binding
is code-complete and ready to flip on the moment a real credential exists, so there's
zero engineering lag between "we got the API key" and "it's live."

**Scope:**
1. Audit every emulator-only binding (create_payment_link, request_signature per
   Phase 3's findings) and build the REAL binding code now, gated behind an env var
   exactly like every other real/emulator pair in this codebase (SCHEDULING_BINDING,
   COMMUNICATIONS_BINDING, etc. pattern) — so turning it on later is a config change,
   not a coding project.
2. Pick real payment (Stripe is the standard choice unless you have a reason
   otherwise) and e-signature (DocuSign or a comparable API) providers, write their
   adapters against their real documented APIs, and prove the adapter's request/
   response shape against their sandbox/test-mode credentials if you can get a free
   sandbox key (Stripe and DocuSign both offer free test-mode access without a live
   business) — that's a real, provable step short of production credentials.
3. Do NOT add unrelated new integrations (Slack, Teams, ERP systems) speculatively —
   only add what a water-treatment dealer's actual workflow needs, which the existing
   plugin set already reflects well.

**Non-goals:** no speculative enterprise integrations (SAP/Oracle/etc.) — that's not
this product's customer profile.

**Verify:** conformance test for the new real bindings against sandbox/test-mode
credentials (free tier, no real business required). Full suite twice.

**PASTE THIS PROMPT (after the SHARED CONTEXT block):**
```
/goal Implement Phase 15 of the Finnor OS roadmap: capability & tool ecosystem
growth. Read packages/tools/src/capabilities/ and packages/tools/src/emulators/
(the existing binding pattern from Phase 3) first. Build real Stripe and DocuSign (or
your best comparable choice) bindings for create_payment_link and request_signature,
following the exact same env-var-gated binding pattern already used for
SCHEDULING_BINDING/COMMUNICATIONS_BINDING/etc. Sign up for free sandbox/test-mode
credentials for both providers (no real business required for either) and prove the
adapter against real sandbox API calls, not just against types. Do not add any
integration beyond payment/e-signature in this phase. Follow the repo's verification
bar (typecheck, full suite twice, real Postgres, real sandbox API calls for the new
bindings) before calling this done.
```

---

## PHASE 16 — Production Hardening, Right-Sized

**Why:** The boring-but-necessary work, sized to an actual pre-revenue single-tenant-
at-a-time product — not SIEM/zero-trust/canary-deployment infrastructure meant for a
company with a security team and live enterprise customers.

**Scope:**
1. Load real credentials into the already-built AWS Secrets Manager integration the
   moment you have an IAM key pair — this is config, not code, per the honest gaps
   list; if you're doing this phase before that's available, instead write the
   runbook for exactly what to do the day the key pair arrives.
2. Actually run the backup/restore drill script end to end (it's correct but unproven
   on this machine per the honest gaps list) — install real Postgres client tools and
   prove it, don't just review the script.
3. Provision one real staging environment (Supabase/Railway/Vercel/Temporal Cloud —
   whichever you choose) and run the full test suite + a smoke test of every vertical
   workflow against it, not just local dev Postgres.
4. RBAC/ABAC: review the existing role model (owner/dispatcher/technician) against
   real dealer org structures you now understand better after Phases 1-15, and extend
   only if a real gap is found, not speculatively.
5. Basic distributed tracing across the API -> job queue -> worker -> Temporal path
   (you already have Sentry breadcrumbs at every LLM/tool call — extend that same
   mechanism across process boundaries rather than adopting a new tracing system).

**Non-goals:** no SIEM, no zero-trust network architecture, no canary deployments —
these are real categories for a later stage of the company, not this one.

**Verify:** the backup/restore drill actually completed with a real timestamp and
output logged. Staging environment actually running the full suite green. Full local
suite twice as always.

**PASTE THIS PROMPT (after the SHARED CONTEXT block):**
```
/goal Implement Phase 16 of the Finnor OS roadmap: production hardening, right-sized
to an actual pre-revenue single-tenant product. Read the backup/restore drill script
and the AWS Secrets Manager integration code first. Actually run the backup/restore
drill end to end on this machine (install whatever Postgres client tools are needed)
and report the real output, not a review of the script. Provision one real staging
environment and run the full test suite against it. Do NOT propose SIEM, zero-trust
architecture, or canary deployments — those are out of scope at this company's actual
stage. Follow the repo's verification bar and report honestly what actually ran vs.
what's still blocked on credentials/accounts only a human can provision.
```

---

## After Phase 16

At this point the honest ceiling is real API credentials for a real operating dealer
(payment/e-sign production keys, AWS keys, GHL/QuickBooks production credentials,
Gmail app password, Vapi webhook secret) — none of which any further phase of
engineering closes. That's the genuine 99% -> 100% gap, and it's a business step, not
a code step.
