# JARVIS 4-DAY PRODUCTION MAESTRO PLAN — v1
## Hardening all 44 actions into a measurable, launch-certified operating system

**Authored:** 2026-08-06 by GPT-5.6 Thinking (architecture/planning session; no product code modified)
**Execution window:** Thursday 2026-08-06 → Sunday 2026-08-09
**Launch target:** Monday 2026-08-10
**Executed by:** LunaMax / Terra / other low-cost execution models, one phase per `/goal`
**Repository root:** `/Users/paramdave/FINNOR`
**Backend root:** `finnor-os/`
**State file:** `/Users/paramdave/FINNOR/JARVIS-4-DAY-PRODUCTION-MAESTRO-STATE.md`
**Baseline commit:** captured and written into the state file by P0.T1 before any hardening change

> This is not a feature plan. The 44 actions already exist. This plan builds one machine-enforced
> hardening system around the existing architecture, fixes every failure it exposes, proves the
> complete backend→frontend→voice path, and leaves a release candidate with evidence, rollback,
> observability, pilot documents, and no hidden production claims.
>
> In this plan, **“bulletproof” is a certification, not a feeling**. An action is certified only
> when its schema, tenant isolation, grounding, approval, idempotency, execution, failure,
> recovery, receipt, observability, frontend state, and configured binding tests have passed.

---

# §0. EXECUTION PROTOCOL

## 0.1 The contract with the executor

You are an execution engine. **The architecture and product decisions are already made.**
Do not create a new plan. Do not simplify scope. Do not propose alternatives. Do not redesign.
Read the plan and state file completely, then execute the active phase exactly in task order.

**You MUST NOT decide:**
- whether all 44 actions should be tested — they all are;
- which action is “important enough” — the fixed table in §3 covers every action;
- action profiles, approval floors, or expected side-effect posture — §3 fixes them;
- whether to replace LangGraph, Redis, Postgres, Railway, Sentry, Vapi, OpenAI Realtime,
  Exa, Firecrawl, or the existing LLM router — do not migrate providers or frameworks;
- whether to add a runtime dependency — default **no**; a phase must explicitly authorise it;
- whether a failing test can be skipped, quarantined, marked flaky, or converted to a snapshot;
- whether missing credentials may silently fall back to live behaviour — they may not;
- whether staging may perform unrestricted outbound calls, SMS, email, payments, ad spend,
  signatures, or customer changes — it may not;
- whether a P0/P1 defect can be deferred to after launch — it cannot;
- whether to deploy production — this plan stops at a signed release candidate; production
  deployment requires a separate explicit owner instruction after P4 is green.

**You MAY decide only local, reversible details:**
- internal helper names inside a file whose path and responsibility are fixed by this plan;
- test names and assertion order;
- exact fixture values that preserve the fixed tenant/data relationships in §4;
- formatting of generated Markdown tables;
- whether a tiny pure helper lives inline or in a sibling `*.util.ts`.

**If reality differs from this plan:**
1. The repository wins.
2. Paste the command and source evidence into the task's `Deviation:` slot.
3. Make the smallest change that preserves the decision and invariant written here.
4. If doing so requires a new architecture/product decision, write a blocker and continue all
   independent tasks. Never invent a decision silently.

## 0.2 Low-cost executor rules

1. Do not spend tokens explaining the repository back to the user.
2. Do not write a replacement plan or long preamble. Start with commands.
3. Read only the phase's named source files plus files directly imported by them.
4. Save full command output under `docs/release/evidence/P<n>/`; paste only the command,
   exit code, summary, and relevant failing/passing lines into the state file.
5. Run targeted tests while fixing. Run the phase suite once after tasks are complete. Run the
   complete certification suite only in P4.
6. Use generated manifests and parameterised tests. Do not hand-write 44 copies of the same test.
7. Patch shared infrastructure before patching individual plugins when one defect affects multiple
   actions. An individual plugin patch is allowed only when the failure is genuinely action-specific.
8. Do not ask the user questions unless a real blocker requires credentials, an external account,
   or an irreversible production decision.
9. Continue until the whole phase exit gate is green or every remaining item has a concrete blocker.

## 0.3 Anti-hallucination rules

1. Never claim a count without the command that derived it.
2. Never claim a test passed without the command, exit code, and output saved as evidence.
3. Never claim an integration is live because an adapter file exists.
4. Never claim a migration is applied because the SQL file exists.
5. Never claim a side effect is idempotent because an idempotency table exists; prove duplicate and
   concurrent replay behaviour.
6. Never claim tenant isolation from code inspection alone; run cross-tenant tests.
7. Never claim approval safety from UI state; prove the backend rejects execution without immutable
   approval evidence.
8. Never display, print, snapshot, commit, or paste secrets, tokens, customer PII, full phone numbers,
   raw webhook signatures, or provider payloads.
9. Never change a failing assertion to match broken behaviour unless the plan explicitly changes the
   contract.
10. Never mark a task complete with “looks good,” “should work,” or an empty evidence slot.

## 0.4 One-phase session loop

Every `/goal` executes exactly one complete phase:

1. Read this plan top to bottom.
2. Read `JARVIS-4-DAY-PRODUCTION-MAESTRO-STATE.md` top to bottom.
3. Find `## NEXT EXACT PHASE`; execute that phase only.
4. Verify `git rev-parse HEAD` matches `Latest verified commit` in state. If it differs, inspect
   `git log` and `git diff`, record the movement, then continue without deleting work.
5. Read the phase's `Source files to read` in full.
6. Run the phase's discovery commands; save output and paste the summary into state.
7. Execute every task in order. Do not skip ahead.
8. Fix failures until the phase suite is green or a real blocker is recorded.
9. Update every checkbox, evidence slot, action ledger cell, defect ledger row, score, session log,
   latest verified commit, and `NEXT EXACT PHASE`.
10. Commit with `jarvis-release P<n>: <phase result>`.

## 0.5 Evidence requirements

| Evidence kind | What counts | What does not |
|---|---|---|
| Source | `path:line`, generated manifest, or command + output | “I inspected it” |
| Unit/contract | command, exit 0, pass/fail counts, no skipped tests | “tests look fine” |
| Integration | request id, tenant id alias, expected/actual status, receipt id | adapter existence |
| Security | cross-tenant denial, approval-bypass denial, secret/PII scan | code comments |
| Idempotency | two identical + two concurrent requests, one side effect | an idempotency key field |
| Recovery | injected failure, restart/retry evidence, final state/receipt | a retry function |
| Runtime | structured log/trace ids, Sentry event test, queue state | no console errors noticed |
| Load | exact concurrency, duration, request count, p50/p95/p99, failures | one manual click |
| Frontend | screenshots/video path plus network/receipt evidence | a pretty fixture only |
| Release | clean checkout, migration/rollback, backup restore, tag SHA | “ready to ship” |

## 0.6 Severity and stop rules

**P0 — release-stopping:** tenant leak; production auth bypass; approval bypass; duplicate payment,
message, call, signature, campaign, appointment, or inventory mutation; secret leak; irreversible data
loss; wrong-tenant recipient resolution; staging egress to real customers; migration corrupts data.

**P1 — must fix before certification:** hanging CI/test process; unbounded retry; lost job; incorrect
receipt; incorrect provider provenance; stale transcript replay; missing action renderer; silent provider
fallback; policy drift ignored; dead-letter without truthful state; Sentry blind spot; backup/rollback fail.

**P2 — fix if time remains after P0/P1, otherwise document:** copy polish, non-blocking visual issues,
minor performance variance inside the fixed budget, low-value test duplication.

No P0 or P1 item may remain open at P4 exit.

## 0.7 Hard rules — every phase

1. Feature freeze begins at P0 exit. Only hardening, correctness, observability, release, and launch-pack
   work is allowed afterward.
2. No production deployment and no unrestricted real side effects.
3. No provider/framework migration. Preserve Vapi + OpenAI Realtime and the current GLM/Mistral/
   DeepSeek purpose-and-channel router unless the repository proves a different active configuration;
   record that difference, do not redesign it.
4. Every write is tenant-scoped, grounded, policy-resolved, receipt-producing, and idempotent.
5. Every consequential external effect is approval-gated. Batch, spend, payment, outbound-call, and
   mass-communication actions require typed approval during the pilot.
6. Read-only actions must never create `domain_actions` that can produce an external side effect.
7. Missing credentials fail closed into an explicit blocked/degraded state; never silently “succeed.”
8. Emulator and live states are always labelled and separately certified.
9. Retries are bounded and only for retryable failures. No infinite loops or silent drops.
10. All provider calls have deadline, abort propagation, purpose/channel, fallback, and actual provider
    + model provenance in the ledger.
11. All web facts spoken to users are evidence-backed; Exa discovery must be Firecrawl-verified before
    a factual answer is marked verified.
12. Voice session identity is immutable for the call; stale/duplicate transcripts cannot create a new
    request; read-only questions do not narrate fake execution.
13. The frontend must render every action and every terminal/intermediate state honestly.
14. Every phase leaves the repository testable and deployable.
15. Never delete logs/evidence to make a gate green.

## 0.8 Commit and rollback protocol

- Commit one phase at a time: `jarvis-release P<n>: <what became true>`.
- P0 may create one baseline checkpoint commit if the tree is dirty, after excluding `.env*`, credentials,
  caches, build output, provider payloads, and customer data.
- Every phase records its starting and ending SHA in the state file.
- A phase cannot be marked complete until its exit gate is green.
- Rollback is `git revert` of the phase commit(s), never a destructive reset.

---

# §1. SOURCE-VERIFIED STARTING POINT

## 1.1 What is already built and must be preserved

The July code-verified system brief and the August hardening updates describe an unusually deep
existing product, not a blank project:

- multi-tenant Finnor OS monorepo with API, worker, orchestrator, and console applications;
- 44 registered domain action types across 24+ plugin modules;
- grounded planning, DAG execution, clarification, repair, prediction-versus-actual comparison,
  reflection, cost ledger, and policy versioning;
- GatedExecutor plus LangGraph durable workflows checkpointed to Postgres;
- Postgres queue with leases, retries, dead-letter state, outbox/inbox, reconciliation, and compensation;
- Postgres RLS plus app-side tenant transaction scoping;
- Redis short-term memory and rate limiting, Postgres canonical/episodic/evidence memory, optional Zep;
- native/emulated binding resolution, Vapi voice, OpenAI Realtime, accounting, e-sign, CRM, marketing,
  communications, documents, scheduling, payments, and routing adapters;
- Sentry, Railway services, secret-provider controls, signed webhooks, Supabase JWT/RBAC;
- frontend approval, workflow, receipt, degraded-state, and action-renderer infrastructure.

**Do not rewrite these systems. Harden their contracts and close discovered defects.**

## 1.2 August upgrades that are binding inputs to this plan

The executor must verify, preserve, and test these current behaviours:

1. Voice transcript deduplication prevents stale or duplicated transcript replay.
2. One immutable voice-session identity is used for the whole call.
3. Read-only voice answers do not narrate fake “executing/tasks done” states.
4. Backend-authored answers are delivered consistently to speech and display.
5. SMS, call, and appointment actions remain explicitly approval-gated.
6. Sandbox/staging cannot silently register a real outbound Vapi tool.
7. CRM SMS recipients resolve to tenant-scoped phone numbers, never treat contact ids as numbers.
8. Purpose-and-channel LLM routing uses current configured GLM/Mistral/DeepSeek-class models with
   shared deadlines, aborts, latency-aware fallback, and actual-provider provenance.
9. The fast read-only cash-collections lane bypasses secrets, memory, and planning.
10. The evidence corpus is tenant-safe, versioned, searchable through FTS/vector fusion, and cited.
11. Exa discovery is verified through Firecrawl before facts are spoken.
12. Competitor watchers alert only when the verified content hash changes.

## 1.3 Known launch risks that P0 must re-derive

The following are not assumed fixed until fresh evidence proves them:

- a complete clean CI run and monorepo typecheck/test run that terminates normally;
- the previously reported package-test harness stall before collection;
- the previously reported authorization-matrix failure;
- exact current migration head and whether the evidence-corpus migration is applied in staging;
- exact current frontend renderer count versus all 44 backend actions;
- configured tenant credentials for calendar, SMS, calling, e-sign, accounting, payments, and marketing;
- watch targets, cadence, alert destination, and Firecrawl/Exa staging configuration;
- voice cancellation and voice approval behaviour if still deferred;
- Sentry project/environment/release wiring and alert routing;
- backup restore, migration rollback, Railway restart recovery, and 15-user concurrency evidence.

## 1.4 Fixed product outcome

At P4 exit, the system must support a 30-day paid pilot for one dealer location and **up to 15 users**
with every one of the 44 actions core-certified. Every configured external binding must be live-certified;
every unconfigured binding must fail closed with a truthful setup state. No action may be hidden,
silently emulated, or represented as live without evidence.

---

# §2. WHAT “BULLETPROOF” MEANS

## 2.1 Per-action certification states

- **UNCERTIFIED:** any required core gate is missing or failing.
- **CORE-CERTIFIED:** all repository/emulator contract, security, approval, idempotency, recovery,
  receipt, frontend, and observability gates pass.
- **LIVE-CERTIFIED:** CORE-CERTIFIED plus an allowlisted staging smoke test against every configured
  live provider used by that action.
- **BLOCKED-CONFIG:** CORE-CERTIFIED, but a required live provider credential/account is absent. The
  product must show the exact missing integration and must not imply successful live execution.

P4 cannot pass with any action `UNCERTIFIED`. `BLOCKED-CONFIG` is allowed only when the pilot scope does
not advertise that integration as live and the UI/setup flow is truthful.

## 2.2 The 14 per-action gates

An action is CORE-CERTIFIED only when all applicable gates pass:

1. Registry/spec identity.
2. Valid-input schema and deterministic draft.
3. Invalid/missing input fails without guessing.
4. Tenant isolation and id grounding.
5. Policy revision and risk classification.
6. Correct approval floor and immutable approval evidence.
7. Idempotency under sequential duplicate and concurrent duplicate requests.
8. Correct executor path, bounded retry, timeout, abort, and provider fallback.
9. Safe behaviour under missing credentials and emulator/live binding selection.
10. Crash/restart/lease-expiry recovery without lost work or duplicate effects.
11. Accurate simulation/prediction, actual outcome, receipt, audit, and provider provenance.
12. PII/secret-safe logs, traces, errors, and evidence.
13. Frontend renderer and all intermediate/terminal/degraded states.
14. Sentry/structured observability with tenant-safe correlation ids.

## 2.3 Global 9.5/10 readiness score

| Category | Weight | Full-credit condition |
|---|---:|---|
| 44-action contract coverage | 2.0 | 44/44 core-certified, zero skipped |
| Security + approval + idempotency | 2.0 | zero bypass/leak/duplicate-effect failures |
| Failure/recovery/durability | 1.5 | chaos matrix green; restart/lease/DLQ verified |
| Integration + full-stack staging | 1.5 | all configured bindings live-certified; truthful blocked states |
| 15-user + 25-user safety load | 1.0 | budgets met, zero data corruption/duplicate effects |
| Observability + cost controls | 1.0 | Sentry, traces, ledger, budgets, alerts proven |
| Release/backup/migration/rollback | 1.0 | clean checkout, restore, forward/rollback, runbooks green |

**Launch gate:** score ≥ **9.5**, and zero open P0/P1 defects. A score cannot compensate for a safety
failure.

---

# §3. FIXED 44-ACTION HARDENING SPEC

## 3.1 Profiles

- `READ_ONLY`: no business mutation or external effect; no approval; evidence/receipt still required.
- `INTERNAL_DRAFT`: creates a draft/document only; policy-controlled; no external delivery.
- `INTERNAL_WRITE`: tenant-local record mutation; policy-controlled; idempotent receipt required.
- `OPERATIONAL_CHANGE`: assignment, schedule, inventory, or business-state change; approval required
  unless an explicit versioned tenant policy permits it.
- `FINANCIAL_WRITE`: payment/accounting state change; typed approval required in the pilot.
- `EXTERNAL_SIDE_EFFECT`: sends, calls, schedules, signs, or contacts externally; approval required.
- `EXTERNAL_SPEND`: creates ad spend or financially consequential provider state; typed approval.
- `BATCH_EXTERNAL`: multi-recipient external effect; typed approval plus recipient count/preview.
- `DURABLE_WORKFLOW`: multi-step long-running operation; approval plus checkpoint/recovery/compensation.
- `META_NO_SIDE_EFFECT`: clarification/manual suggestion only; never counted as approval or execution.

## 3.2 Approval floors

- `NONE`: action may run without approval because it has no consequential side effect.
- `POLICY`: current versioned tenant policy decides; default remains safe.
- `REQUIRED`: immutable approval evidence required before execution.
- `TYPED_REQUIRED`: explicit typed confirmation plus immutable approval evidence required.

## 3.3 Binding table — executor must encode this exact table

Create `finnor-os/scripts/release/action-hardening-spec.ts` exporting this fixed set. The discovered
plugin registry must exactly equal it. A missing or extra action is a P0 blocker until reconciled.

| # | Plugin | Action type | Profile | Approval floor | Capability family | External | Receipt |
|---:|---|---|---|---|---|---|---|
| 1 | `accounting` | `create_invoice` | `OPERATIONAL_CHANGE` | `REQUIRED` | `accounting` | yes | yes |
| 2 | `accounting` | `send_payment_reminder` | `EXTERNAL_SIDE_EFFECT` | `REQUIRED` | `communications/accounting` | yes | yes |
| 3 | `accounting` | `record_payment` | `FINANCIAL_WRITE` | `TYPED_REQUIRED` | `accounting/payments` | yes | yes |
| 4 | `accounting` | `call_overdue_invoices` | `BATCH_EXTERNAL` | `TYPED_REQUIRED` | `voice/communications` | yes | yes |
| 5 | `bulk-notify` | `bulk_notify_existing_customers` | `BATCH_EXTERNAL` | `TYPED_REQUIRED` | `communications` | yes | yes |
| 6 | `clarification` | `clarification_request` | `META_NO_SIDE_EFFECT` | `NONE` | `none` | no | yes |
| 7 | `compliance-documentation` | `generate_compliance_summary` | `INTERNAL_DRAFT` | `POLICY` | `documents` | no | yes |
| 8 | `crm` | `create_lead` | `INTERNAL_WRITE` | `POLICY` | `crm` | no | yes |
| 9 | `crm` | `update_lead_status` | `INTERNAL_WRITE` | `POLICY` | `crm` | no | yes |
| 10 | `crm` | `log_interaction` | `INTERNAL_WRITE` | `NONE` | `crm` | no | yes |
| 11 | `crm` | `assign_lead_to_technician` | `OPERATIONAL_CHANGE` | `REQUIRED` | `crm/scheduling` | no | yes |
| 12 | `customer-comm` | `answer_customer_question` | `READ_ONLY` | `NONE` | `llm/evidence` | no | yes |
| 13 | `customer-comm` | `send_customer_message` | `EXTERNAL_SIDE_EFFECT` | `REQUIRED` | `communications` | yes | yes |
| 14 | `customer-comm` | `send_follow_up` | `EXTERNAL_SIDE_EFFECT` | `REQUIRED` | `communications` | yes | yes |
| 15 | `inventory` | `check_stock_level` | `READ_ONLY` | `NONE` | `inventory` | no | yes |
| 16 | `inventory` | `flag_reorder_needed` | `INTERNAL_WRITE` | `POLICY` | `inventory` | no | yes |
| 17 | `inventory` | `log_stock_used_on_visit` | `OPERATIONAL_CHANGE` | `POLICY` | `inventory` | no | yes |
| 18 | `invoice-to-cash` | `start_invoice_to_cash_workflow` | `DURABLE_WORKFLOW` | `TYPED_REQUIRED` | `accounting/communications` | yes | yes |
| 19 | `lead-to-water-test` | `start_water_test_workflow` | `DURABLE_WORKFLOW` | `REQUIRED` | `crm/scheduling/communications` | yes | yes |
| 20 | `maintenance-agreement` | `renew_maintenance_agreement` | `DURABLE_WORKFLOW` | `REQUIRED` | `documents/esign/communications` | yes | yes |
| 21 | `manual-step` | `manual_step_suggestion` | `META_NO_SIDE_EFFECT` | `NONE` | `none` | no | yes |
| 22 | `marketing` | `summarize_ad_performance` | `READ_ONLY` | `NONE` | `marketing` | no | yes |
| 23 | `marketing` | `launch_ad_campaign` | `EXTERNAL_SPEND` | `TYPED_REQUIRED` | `marketing` | yes | yes |
| 24 | `marketing` | `create_review_request` | `EXTERNAL_SIDE_EFFECT` | `REQUIRED` | `communications` | yes | yes |
| 25 | `ops-overview` | `get_business_overview` | `READ_ONLY` | `NONE` | `read-models` | no | yes |
| 26 | `ops-overview` | `answer_business_question` | `READ_ONLY` | `NONE` | `read-models/llm` | no | yes |
| 27 | `proposal-batch` | `send_proposal_to_recent_installs` | `BATCH_EXTERNAL` | `TYPED_REQUIRED` | `documents/communications` | yes | yes |
| 28 | `proposal-signature` | `request_proposal_signature` | `EXTERNAL_SIDE_EFFECT` | `REQUIRED` | `esign/communications` | yes | yes |
| 29 | `proposal-to-installation` | `start_installation_workflow` | `DURABLE_WORKFLOW` | `REQUIRED` | `scheduling/documents/communications` | yes | yes |
| 30 | `quotation` | `generate_quote` | `INTERNAL_DRAFT` | `POLICY` | `documents/price-book` | no | yes |
| 31 | `quotation` | `size_equipment_for_household` | `READ_ONLY` | `NONE` | `water-domain/price-book` | no | yes |
| 32 | `quotation` | `send_proposal` | `EXTERNAL_SIDE_EFFECT` | `REQUIRED` | `documents/communications` | yes | yes |
| 33 | `route-optimization` | `route_suggestion` | `READ_ONLY` | `NONE` | `routing` | no | yes |
| 34 | `scheduling` | `assign_technician_to_visit` | `OPERATIONAL_CHANGE` | `REQUIRED` | `scheduling` | no | yes |
| 35 | `scheduling` | `check_technician_availability` | `READ_ONLY` | `NONE` | `scheduling` | no | yes |
| 36 | `scheduling` | `reschedule_visit` | `OPERATIONAL_CHANGE` | `REQUIRED` | `scheduling/communications` | yes | yes |
| 37 | `service-reminders` | `check_reminder_due` | `READ_ONLY` | `NONE` | `scheduling` | no | yes |
| 38 | `technician-reports` | `log_visit_report` | `INTERNAL_WRITE` | `POLICY` | `crm/documents` | no | yes |
| 39 | `technician-reports` | `flag_visit_issue` | `INTERNAL_WRITE` | `POLICY` | `crm/operations` | no | yes |
| 40 | `water-domain-knowledge` | `answer_water_question` | `READ_ONLY` | `NONE` | `llm/evidence` | no | yes |
| 41 | `water-test` | `schedule_water_test` | `OPERATIONAL_CHANGE` | `REQUIRED` | `scheduling/communications` | yes | yes |
| 42 | `web-research` | `search_web` | `READ_ONLY` | `NONE` | `exa/firecrawl/evidence` | no | yes |
| 43 | `web-research` | `scan_competitors` | `READ_ONLY` | `NONE` | `exa/firecrawl/evidence` | no | yes |
| 44 | `web-research` | `check_business_reviews` | `READ_ONLY` | `NONE` | `exa/firecrawl/evidence` | no | yes |

## 3.4 Exact universal test matrix

Create one parameterised harness. Do not create 44 independent ad-hoc suites.

**Every action:**
1. present in plugin registry and fixed spec;
2. accepts one valid seeded payload;
3. rejects schema-invalid payload;
4. refuses a missing referenced entity instead of guessing;
5. refuses Tenant Bravo ids under Tenant Alpha;
6. records actual tenant id, action type, trace/correlation id, policy revision, and risk tier;
7. emits an honest simulation/prediction or an explicit `not_available` reason;
8. emits an accurate receipt/audit trail on every terminal outcome;
9. logs no raw secrets or seeded PII marker;
10. has a frontend renderer and designed pending/approved/executing/completed/failed/blocked state.

**`READ_ONLY`:**
- creates no external tool call and no mutable business row except permitted trace/ledger/receipt rows;
- no approval queue entry;
- repeated calls are safe and answer provenance is present;
- missing evidence returns an honest insufficient-evidence state.

**`META_NO_SIDE_EFFECT`:**
- creates no external tool call;
- clarification is Answer/Skip/Cancel, never Approve/Reject;
- manual suggestion is never shown as executed work.

**`POLICY`/`REQUIRED`/`TYPED_REQUIRED`:**
- pre-approval execution is denied;
- rejected/expired approval cannot execute;
- policy version drift is detected and surfaced;
- valid approval is immutable, tenant-scoped, action-scoped, and consumed exactly once;
- typed-required actions reject a normal approval lacking typed evidence.

**Every mutating/external action:**
- same idempotency key twice → one business effect;
- two concurrent requests → one business effect;
- provider timeout/429/500/malformed response → bounded retry or truthful terminal failure;
- missing credentials → `blocked_integration_unavailable` or equivalent truthful state;
- worker/orchestrator restart after claim → resume/recover without duplicate effect;
- receipt actual outcome matches the final business/provider state.

**`DURABLE_WORKFLOW`:**
- checkpoint survives restart;
- dependency order is preserved;
- terminal step failure repairs only unfinished work;
- compensation is invoked when defined and produces a compensation receipt;
- pause/cancel/escalate states are truthful and recoverable.

**`BATCH_EXTERNAL`/`EXTERNAL_SPEND`/`FINANCIAL_WRITE`:**
- typed confirmation required;
- preview includes target count/amount and provider;
- recipient allowlist and spend/usage caps enforced in staging;
- partial provider success produces per-target truth, never one blanket success.

---

# §4. CERTIFICATION DATA AND ENVIRONMENTS

## 4.1 Three fixed staging tenants

Create `finnor-os/scripts/release/seed-certification-tenants.ts`. It is idempotent and may only run
when `NODE_ENV !== "production"` and `CERTIFICATION_SEED_ALLOWED=1`.

**Tenant Alpha — full pilot:**
- 15 users: 1 owner, 3 dispatchers/office users, 10 technicians, 1 finance/admin user;
- 40 contacts/households, 20 leads, 12 opportunities, 10 quotes, 8 invoices, 4 overdue invoices,
  10 work orders, 12 appointments, 8 proposals, 3 maintenance agreements, inventory with normal and
  low-stock items, conversations/calls/messages/documents, policy revisions, and action history;
- all external recipients use explicit allowlisted test email/phone values from environment variables.

**Tenant Bravo — isolation sentinel:**
- unique marker `BRAVO-ISOLATION-SENTINEL` in every canonical entity family;
- no Alpha user may read, ground, mutate, approve, or receive any Bravo object.

**Tenant Charlie — degraded/configuration tenant:**
- valid data but communications, e-sign, accounting, payments, and marketing credentials absent;
- every affected action must produce the exact blocked/setup behaviour, no silent emulator claim.

## 4.2 Safe external testing

- Live smoke tests run only in staging and only when `LIVE_SMOKE_ALLOWED=1`.
- Every external adapter must additionally require its existing write-enable flag and an allowlisted
  recipient/account.
- No real customer address, phone, email, ad account, signature envelope, bank/payment instrument, or
  production calendar may be used.
- If an allowlist value is absent, the live smoke is `BLOCKED-CONFIG`, not skipped-passing.

## 4.3 Required environment inventory

P0 generates `docs/release/generated/environment-contract.md` from code references and deployment
configuration. It must cover at least:

Postgres · Redis · Railway API · Railway worker · Railway orchestrator · Sentry · Supabase auth ·
Vapi · OpenAI Realtime · GLM · Mistral · DeepSeek · Exa · Firecrawl · embeddings · Zep · Stripe ·
QuickBooks · DocuSign · communications/SMS · Resend/email · GoHighLevel · Meta Ads · Google Ads ·
OSRM/routing · AWS Secrets Manager or the active secrets provider.

The generated file records only variable names, required/optional status, environment presence as
`configured|missing`, binding mode, and write-enable state. Never print values.

---

# §5. SHARED HARDENING ARTIFACTS

The following paths and responsibilities are fixed. If a file already exists, extend it rather than
creating a duplicate.

| Path | Responsibility |
|---|---|
| `finnor-os/scripts/release/action-hardening-spec.ts` | fixed 44-row table from §3 |
| `finnor-os/scripts/release/discover-action-registry.ts` | derive current registry, schemas, plugin ownership |
| `finnor-os/scripts/release/verify-action-manifest.ts` | compare discovery to fixed spec; emit Markdown/JSON |
| `finnor-os/scripts/release/seed-certification-tenants.ts` | idempotent Alpha/Bravo/Charlie seed |
| `finnor-os/scripts/release/run-action-contract-matrix.ts` | 44-action core contract runner |
| `finnor-os/scripts/release/run-chaos-matrix.ts` | deterministic fault/restart/duplicate matrix |
| `finnor-os/scripts/release/run-api-e2e-matrix.ts` | staging API end-to-end runner |
| `finnor-os/scripts/release/run-load-certification.ts` | 15-user and 25-user Node-based load runner |
| `finnor-os/scripts/release/run-release-certification.ts` | orchestrates all final gates, fails non-zero |
| `docs/release/generated/action-manifest.json` | machine-readable discovered manifest |
| `docs/release/generated/action-manifest.md` | human-readable 44-action manifest |
| `docs/release/evidence/P<n>/` | immutable command outputs for each phase |
| `docs/release/production-readiness-report.md` | final evidence-backed readiness report |
| `docs/release/deployment-runbook.md` | exact staging/production commands and checks |
| `docs/release/rollback-runbook.md` | app, worker, migration, feature-flag rollback |
| `docs/release/incident-runbook.md` | P0/P1 detection, kill switch, triage, communication |
| `docs/release/integration-readiness.md` | configured/live/emulated/blocked matrix |
| `docs/release/load-test-results.md` | concurrency, latency, error, queue, cost measurements |
| `docs/release/paid-pilot-offer.md` | fixed pilot scope and pricing |
| `docs/release/demo-and-launch-runbook.md` | safe demo tenant, launch video shots, demo script |

Add root scripts without new runtime dependencies:

```json
{
  "release:manifest": "tsx scripts/release/verify-action-manifest.ts",
  "release:contract": "tsx scripts/release/run-action-contract-matrix.ts",
  "release:chaos": "tsx scripts/release/run-chaos-matrix.ts",
  "release:e2e": "tsx scripts/release/run-api-e2e-matrix.ts",
  "release:load": "tsx scripts/release/run-load-certification.ts",
  "release:certify": "tsx scripts/release/run-release-certification.ts"
}
```

If workspace invocation requires `npm -w` or a different root script shape, preserve these script names
and record the exact implementation as a deviation.

---

# §6. ORDERED IMPLEMENTATION PHASES

Five phases. One phase per `/goal`. The executor must finish the whole phase, update the state file,
and commit before the next invocation.

---

## PHASE 0 — Release Lock, Source Audit, and Clean CI

**Window:** Day 1 morning

**Objective.** Freeze the product, capture a safe baseline, re-derive current reality, repair the test
machinery, and produce a trustworthy 44-action manifest before hardening begins.

**Source files to read.** Root `package.json` and lockfile · `.github/workflows/*` ·
`finnor-os/package.json` · every workspace `package.json` · domain plugin registry and all
`packages/domain-plugins/*/index.ts` action declarations · `packages/tools/src/llm.ts` ·
`packages/tools/src/binding-resolution.ts` · `packages/orchestration/src/index.ts` ·
`packages/orchestration/src/fast-read-lane.ts` · `packages/memory/src/evidence.ts` ·
`apps/worker/src/queue.ts` · auth/RBAC and action confirmation routes · frontend renderer registry ·
Railway/Vercel/deployment configuration · latest five migrations.

**Discovery commands.** Save exact output under `docs/release/evidence/P0/`.

```bash
pwd
git status --short
git rev-parse HEAD
git log --oneline -12
node --version && npm --version
find . -maxdepth 3 -name package.json -not -path '*/node_modules/*' -print
find finnor-os/packages/domain-plugins -mindepth 2 -maxdepth 2 -name index.ts -print | sort
find finnor-os/packages/db/migrations -maxdepth 1 -type f | sort | tail -10
grep -R "actionTypes\|const ACTION\|SCHEMAS" finnor-os/packages/domain-plugins --include='*.ts'
grep -R "GLM\|Mistral\|DeepSeek\|Firecrawl\|Exa\|Realtime\|Vapi" finnor-os/packages finnor-os/apps --include='*.ts' | head -300
```

**Tasks (ordered).**

1. **P0.T1 — Safe baseline.** Run secret scan before staging files. If the tree is dirty, create one
   checkpoint commit named `jarvis-release BASELINE: preserve pre-hardening product state`, excluding
   `.env*`, credentials, provider payloads, customer exports, logs, caches, `.next`, coverage, and
   `node_modules`. Record the resulting SHA as both Baseline and Latest verified commit in state.
2. **P0.T2 — Feature freeze.** Create `docs/release/FEATURE-FREEZE.md` stating that only correctness,
   safety, testing, observability, deployment, documentation, and launch-pack changes are allowed until
   P4. No new product feature, provider migration, UI concept, or architecture rewrite.
3. **P0.T3 — Current action discovery.** Implement `discover-action-registry.ts`, the fixed §3 spec,
   and `verify-action-manifest.ts`. Emit JSON + Markdown. It must discover exactly 44 and exactly match
   names/plugin ownership. If not, stop and resolve the discrepancy; never change the expected count to
   make the test pass.
4. **P0.T4 — Environment and binding contract.** Generate `environment-contract.md` from actual env
   references and binding resolution. Record configured/missing/binding/write-enable without values.
5. **P0.T5 — Existing command inventory.** Read CI workflows and package scripts; create
   `docs/release/generated/ci-command-map.md` containing every lint, typecheck, unit, integration,
   security, migration, frontend, and package test command, with workspace and timeout.
6. **P0.T6 — Repair test machinery.** Run every existing CI-equivalent command. Fix the hanging
   package-test harness, collection stall, authorization-matrix failure, TypeScript failures, and
   non-terminating handles. Do not skip or increase timeouts to conceal a hang. Add explicit teardown for
   DB/Redis/server handles where required.
7. **P0.T7 — Fresh migration and deployment inventory.** Record current migration head, unapplied
   staging migrations, four deployable services, health endpoints, and exact Railway/Vercel targets.
   Do not apply production migrations.
8. **P0.T8 — Baseline report.** Write `docs/release/P0-baseline.md`: exact counts, current provider
   families/models/env names, current live/emulated bindings, tests run, failures fixed, remaining
   P0/P1 defects, and the starting readiness score.

**Files expected to change.** Only release scripts/docs, test configuration/teardown, broken CI/auth
matrix code, and minimal files required to make existing gates terminate and pass. No feature work.

**Architecture decisions already made.** Fixed count 44. No new runtime dependencies. No provider
migration. CI must terminate. Feature freeze begins here.

**Must not decide.** Skipping a workspace. Treating a hang as harmless. Changing the action count.
Deploying production. Printing environment values.

**Phase suite.** `npm run release:manifest` plus every command in `ci-command-map.md`.

**Exit gate.**
- [ ] baseline SHA captured; no secret/customer data committed;
- [ ] feature freeze committed;
- [ ] discovered registry exactly equals the fixed 44-action spec;
- [ ] environment/binding contract generated without values;
- [ ] all existing CI-equivalent commands terminate and pass;
- [ ] zero skipped/quarantined tests added;
- [ ] current migration/deployment targets recorded;
- [ ] P0 baseline report committed;
- [ ] zero open P0 defects from this phase.

**Rollback.** Revert the P0 phase commit; keep the baseline checkpoint.

---

## PHASE 1 — Universal Contract Hardening for All 44 Actions

**Window:** Day 1 afternoon → Day 2 morning

**Objective.** Build one deterministic contract harness, execute it over all 44 actions, and fix every
schema, grounding, tenant, approval, idempotency, receipt, and frontend coverage failure it exposes.

**Source files to read.** All plugin `index.ts` files · plugin registry/collision guard · planner and
schema repair · tiering/grounding · GatedExecutor · LangGraph executor and allowlist · policy resolution
and approval confirmation route · idempotency ledger · receipt/audit/prediction-diff code · action API
routes · frontend renderer registry, fallback renderer, action-state components · P0 manifest/spec.

**Discovery commands.**

```bash
npm run release:manifest
grep -R "idempot" finnor-os/packages finnor-os/apps --include='*.ts'
grep -R "canApprove\|confirmed\|typed" finnor-os/packages finnor-os/apps --include='*.ts'
grep -R "prediction\|receipt\|actual" finnor-os/packages/orchestration finnor-os/apps/api --include='*.ts'
grep -R "FallbackRenderer\|REGISTERED_ACTION_TYPES" src --include='*.ts' --include='*.tsx'
```

**Tasks (ordered).**

1. **P1.T1 — Certification seed.** Implement the exact Alpha/Bravo/Charlie seed from §4. It must be
   idempotent, non-production-only, and emit only ids/aliases—not seeded PII—to logs.
2. **P1.T2 — Contract runner.** Implement `run-action-contract-matrix.ts` using the §3 spec and a
   shared fixture builder. Every row produces machine JSON plus a Markdown table with PASS/FAIL/N/A and
   evidence ids. A row with an unexpected skip is a failure.
3. **P1.T3 — Registry/schema/grounding.** Run the matrix. Fix discovered registry, schema, invalid-input,
   missing-entity, and tenant-grounding failures. Shared compiler/grounding fixes precede plugin patches.
4. **P1.T4 — Approval floors.** Enforce §3 approval floors. Typed-required actions reject ordinary
   approval. Clarifications/manual suggestions never enter approval counts. Immutable approval evidence
   is action/tenant/policy-version scoped.
5. **P1.T5 — Idempotency.** Add sequential duplicate and concurrent duplicate tests to every mutating or
   external action. Fix shared idempotency keys/claims first. Assert one business effect and one provider
   effect, with repeat requests linked to the original receipt.
6. **P1.T6 — Receipts and truth.** Every terminal outcome—completed, rejected, blocked, failed,
   compensated—must produce an accurate receipt/audit row with actual provider/model/binding provenance.
   Read-only actions produce answer evidence/provenance without pretending an external action occurred.
7. **P1.T7 — Prediction/simulation.** Every action returns an honest prediction/simulation or an explicit
   reason it is unavailable. No fabricated prediction. Diff actual against predicted when both exist.
8. **P1.T8 — Frontend 44/44.** Generate frontend action types from the backend manifest. Ensure every
   action has a renderer and all relevant pending/approved/executing/completed/failed/blocked states.
   `FallbackRenderer` may exist only behind an owner debug route; it may never mount in certified paths.
9. **P1.T9 — Per-action fixes.** Patch only action-specific failures remaining after shared fixes. Record
   each plugin/file and why the shared contract could not solve it.
10. **P1.T10 — Contract report.** Write `docs/release/action-contract-results.md` with all 44 rows and
    exact evidence. Update every action ledger row in state.

**Architecture decisions already made.** One parameterised harness. Fixed action profiles and approval
floors. Shared fixes first. 44/44 frontend coverage. No fake prediction or success.

**Must not decide.** Reducing the matrix. Marking a test N/A without spec permission. Auto-approving a
required action. Hand-maintaining a second action list.

**Phase suite.** `npm run release:manifest && npm run release:contract` plus targeted frontend contract
and renderer tests.

**Exit gate.**
- [ ] all 44 actions present and CORE contract rows pass;
- [ ] zero schema/grounding guesses;
- [ ] cross-tenant tests pass for every applicable action;
- [ ] approval floors match §3, including typed confirmation;
- [ ] duplicate and concurrent duplicate tests produce one effect;
- [ ] every terminal outcome has truthful receipt/audit/provenance;
- [ ] prediction/simulation truth is explicit;
- [ ] frontend renderer/state coverage is 44/44;
- [ ] `FallbackRenderer` mounts zero times in certified paths;
- [ ] zero open P0/P1 contract defects.

**Rollback.** Revert P1; P0 manifest/CI remains.

---

## PHASE 2 — Chaos, Voice, Model, Integration, and Security Hardening

**Window:** Day 2

**Objective.** Intentionally break the shared system and prove that all action profiles fail safely,
recover durably, preserve tenant/approval/idempotency invariants, and remain observable.

**Source files to read.** Provider router/health/circuit/budget/ledger · fast read lane · evidence corpus ·
Exa/Firecrawl web research · voice session/transcript/tool registration/recipient resolution · worker
queue and lease recovery · workflow runtime outbox/inbox/reconciliation/compensation · LangGraph
checkpointer · Redis memory/rate limiting · RLS/withTenant · secrets boot guard · webhook verification ·
Sentry initialization and structured logging.

**Discovery commands.**

```bash
grep -R "deadline\|AbortSignal\|circuit\|provider.*health\|llmCalls" finnor-os/packages --include='*.ts'
grep -R "voice_session\|transcript\|Vapi\|recipient" finnor-os/packages finnor-os/apps --include='*.ts'
grep -R "SKIP LOCKED\|lease\|dead_letter\|compensat\|reconciliation" finnor-os/packages finnor-os/apps --include='*.ts'
grep -R "Sentry\|captureException\|trace_id\|correlation" . --include='*.ts' --include='*.tsx' | head -300
```

**Tasks (ordered).**

1. **P2.T1 — Deterministic fault layer.** Implement `run-chaos-matrix.ts` using existing emulator/test
   seams. Faults are selected only by explicit test context: provider timeout, 429, 401, 500, malformed
   response, Redis unavailable, Postgres transient failure, worker crash after claim, orchestrator crash
   after checkpoint, queue lease expiry, duplicate webhook, policy drift, budget exhausted, circuit open.
   No production fault injection.
2. **P2.T2 — Approval/idempotency under failure.** For every mutating/external profile, inject failure
   before effect, during effect, and after provider success before local acknowledgement. Prove no
   approval bypass and no duplicate effect on retry/restart.
3. **P2.T3 — Queue/workflow durability.** Prove lease recovery, bounded backoff, max-attempt dead-letter,
   replayability classification, LangGraph checkpoint resume, plan repair of unfinished nodes only, and
   compensation receipt where supported.
4. **P2.T4 — LLM router.** Test every purpose/channel route against the actual configured GLM/Mistral/
   DeepSeek chain: deadline, abort propagation, latency-aware fallback, 429/5xx fallback, malformed
   structured output repair, actual provider/model provenance, token/cost ledger, tenant budget refusal.
   Do not change model lineup unless code is broken relative to its current contract.
5. **P2.T5 — Fast read lane.** Prove eligible cash-collections read requests bypass planner, secrets, and
   memory, remain tenant-scoped, answer from real read-model data, and fall back safely when ineligible.
6. **P2.T6 — Evidence/web research.** Prove tenant-safe evidence versioning, FTS/vector fusion, citation
   presence, Exa→Firecrawl verification, no unverified factual speech, and watcher alert only on verified
   hash change. Missing Firecrawl fails into explicit unverified/blocked truth.
7. **P2.T7 — Voice.** Prove immutable session identity, stale/duplicate transcript rejection, one final
   request per utterance, identical backend-authored speech/display answer, no fake execution narration
   on read-only questions, tenant-scoped recipient resolution, approval gate for SMS/call/appointment,
   and staging refusal to register a real outbound tool.
8. **P2.T8 — Security.** Run cross-tenant RLS tests, auth-dev-bypass production boot test, RBAC default
   deny, webhook signature positive/negative/replay tests, rate-limit fallback tests, secret scan, PII
   redaction/token restoration tests, and log/evidence scan for the seeded PII sentinel.
9. **P2.T9 — Observability.** Every injected failure must create one correlated structured error and a
   test Sentry event in the staging/test environment with tenant-safe tags: action type, trace id,
   provider, binding, failure kind, retry count. No request body or PII.
10. **P2.T10 — Chaos report.** Write `docs/release/chaos-results.md`; update action and defect ledgers.

**Architecture decisions already made.** Fault injection only through explicit test context. No provider
migration. No production egress. Recovery never bypasses approval/idempotency. Sentry payloads are
sanitised.

**Must not decide.** Making retries infinite. Treating provider success/local failure as safe without a
reconciliation test. Speaking unverified web facts. Allowing a new voice request from duplicate text.

**Phase suite.** `npm run release:contract && npm run release:chaos` plus security/secret scans.

**Exit gate.**
- [ ] zero tenant leaks, approval bypasses, and duplicate effects under every applicable fault;
- [ ] all retries bounded; dead-letter/reconciliation states truthful;
- [ ] LangGraph/queue restart recovery passes;
- [ ] GLM/Mistral/DeepSeek routing, abort, fallback, ledger provenance pass;
- [ ] fast read lane eligibility and fallback pass;
- [ ] Exa/Firecrawl/evidence citation and hash-change tests pass;
- [ ] all voice invariants pass;
- [ ] auth/RBAC/RLS/webhook/rate-limit/PII/secret tests pass;
- [ ] every injected P0/P1 failure is visible in structured logs + Sentry;
- [ ] zero open P0/P1 chaos/security defects.

**Rollback.** Revert P2. Fault hooks must be unreachable outside test/staging guard conditions.

---

## PHASE 3 — Full-Stack Staging, Live-Binding Smoke, and 15-User Load

**Window:** Day 3

**Objective.** Prove the real deployed system—from frontend and voice through API, orchestrator, worker,
Postgres/Redis, configured providers, receipts, and Sentry—under realistic pilot concurrency.

**Source files to read.** Deployment configuration for API/worker/orchestrator/frontend · health and
integration status routes · migration scripts · P0 environment contract · P1/P2 runners · frontend
command/approval/execution/receipt/degraded paths · Sentry release/environment configuration.

**Discovery commands.**

```bash
git status --short
git rev-parse HEAD
# use repository deployment/health commands discovered in P0; do not invent project names
npm run release:manifest
```

**Tasks (ordered).**

1. **P3.T1 — Staging identity and egress guard.** Verify the exact staging URLs/services/databases and
   prove they are not production. Require emulator/no-egress defaults plus allowlists and explicit
   `LIVE_SMOKE_ALLOWED=1`. A staging environment that cannot prove isolation is a blocker.
2. **P3.T2 — Staging migration.** Back up staging, apply all pending migrations, verify schema/RLS/
   triggers/indexes, run migration validation, and record the migration head. No production migration.
3. **P3.T3 — Deploy release candidate to staging.** Deploy frontend, API, worker, and orchestrator from
   one commit; set Sentry release to that SHA; verify health, worker polling, queue claims, Redis, DB,
   auth, and integration status.
4. **P3.T4 — Seed tenants.** Run the guarded Alpha/Bravo/Charlie seed. Verify 15 Alpha users, sentinel
   isolation, and Charlie blocked states.
5. **P3.T5 — 44-action API E2E.** Implement/run `run-api-e2e-matrix.ts` against staging. Every action
   runs through real auth/API/orchestration/worker/receipt paths using emulator or configured allowlisted
   live bindings. Update each action ledger row.
6. **P3.T6 — Configured live smokes.** For each configured live binding, execute the minimal allowlisted
   action and verify provider + local receipt reconciliation. Missing credentials become
   `BLOCKED-CONFIG`, never skipped-passing. No live payment/ad spend/customer contact.
7. **P3.T7 — Frontend certified journeys.** Run text instruction, voice read-only, clarification,
   approval-required external action, rejection, execution, failure/recovery, receipt, and blocked
   integration journeys. Prove all 44 renderers via generated stage/catalog tests and zero fallback.
8. **P3.T8 — Load runner.** Implement Node-based load with existing `fetch`/runtime—no new dependency.
   Scenario A: 15 simultaneous authenticated users for 20 minutes. Scenario B: 25 users for 10 minutes.
   Include read-only questions, action drafts, approvals, concurrent duplicates, queue work, and safe
   voice-session establishment where testable.
9. **P3.T9 — Load gates.** Zero tenant leak/data corruption/duplicate effect. API error rate < 1% excluding
   intentional faults; p95 read-only < 2.5 s; p95 action draft < 8 s; approval API p95 < 2 s; queue oldest
   ready age < 30 s; no runaway retries; Sentry unhandled errors = 0; cost/usage within configured caps.
   If the current architecture cannot meet a latency target, fix the bottleneck or record a P1 blocker;
   do not change the target silently.
10. **P3.T10 — Observability drill.** Trigger one sanitised test error per service and one integration
    failure. Verify Sentry project/environment/release, alert routing, trace correlation, and on-call
    visibility. Then clear only test data, not evidence.
11. **P3.T11 — Staging/load report.** Write `integration-readiness.md` and `load-test-results.md` with
    every configured/emulated/blocked binding and exact measurements.

**Architecture decisions already made.** One commit across all services. Three fixed tenants. 15-user
pilot test plus 25-user safety test. No new load dependency. No production egress.

**Must not decide.** Pointing tests at production. Treating a missing credential as a pass. Running an
unallowlisted live side effect. Testing only flagship actions.

**Phase suite.** Staging health + `npm run release:e2e && npm run release:load` plus frontend E2E.

**Exit gate.**
- [ ] staging identity/no-egress proven;
- [ ] backup taken and all staging migrations applied/verified;
- [ ] frontend/API/worker/orchestrator run the same SHA;
- [ ] Alpha/Bravo/Charlie seed verified;
- [ ] 44/44 staging API E2E rows pass core path;
- [ ] every configured live binding is live-certified; missing ones truthfully blocked;
- [ ] frontend/voice/approval/recovery/receipt journeys pass;
- [ ] 15-user and 25-user load gates pass;
- [ ] Sentry release/alerts/traces proven with sanitised events;
- [ ] zero open P0/P1 staging/load defects.

**Rollback.** Roll back staging services to P2 SHA and restore staging backup if migration rollback fails.

---

## PHASE 4 — Production Rehearsal, Final Certification, and Launch Freeze

**Window:** Day 4

**Objective.** Prove a clean rebuild, backup/restore, migration/rollback, complete certification, release
runbooks, pilot scope, demo safety, and create the exact release candidate for Monday.

**Source files to read.** All P0–P3 reports/evidence · CI workflows · deployment/migration/backup code ·
health/kill-switch/config routes · existing launch/demo content in repository · current pricing/website
copy relevant to the paid pilot.

**Tasks (ordered).**

1. **P4.T1 — Clean-checkout proof.** From a fresh worktree or clean clone at the P3 SHA, install from the
   lockfile, build every workspace/service/frontend, and run all CI commands. No local untracked file or
   cached output may be required.
2. **P4.T2 — Backup/restore rehearsal.** Create a staging backup, record checksum/row-count sentinels,
   restore into a separate rehearsal database, and run tenant/action/receipt integrity checks. Restore
   must preserve RLS and immutable audit triggers.
3. **P4.T3 — Migration forward/rollback rehearsal.** On the rehearsal database, apply from the prior
   production-equivalent migration head to current, run smoke tests, execute the documented rollback or
   forward-fix strategy, and prove application compatibility. Never run this against production.
4. **P4.T4 — Release certifier.** Implement `run-release-certification.ts` to orchestrate manifest,
   contract, chaos, security, frontend, staging E2E, load-result validation, clean build, and report
   checks. It exits non-zero on skip, timeout, missing evidence, open P0/P1, action uncertified, or score
   below 9.5.
5. **P4.T5 — Final full run.** Execute `npm run release:certify` from the clean worktree. Fix failures and
   rerun until green. Save complete output under `docs/release/evidence/P4/`.
6. **P4.T6 — Production runbooks.** Write exact `deployment-runbook.md`, `rollback-runbook.md`, and
   `incident-runbook.md`: preflight, migrations, service order, health gates, smoke tests, Sentry checks,
   queue drain, kill switches, binding disable, database rollback/restore, and owner communication.
7. **P4.T7 — Production readiness report.** Write the final 44-row certification table, configured/live/
   blocked integrations, known P2-only limitations, test counts, latency/load/cost results, migration
   head, backup proof, rollback proof, Sentry proof, SHA, and readiness score. No unsupported claim.
8. **P4.T8 — Paid pilot pack.** Write `paid-pilot-offer.md` with the fixed commercial terms:
   **$5,000, 30-day paid pilot, 14-day implementation, one location, up to 15 users, fixed included usage
   allowance, overage billed separately, explicit integration scope, twice-weekly iteration/support,
   no unlimited 24/7 custom development, success metrics, conversion path to $10,000 implementation +
   $4,000/month + usage.** Include qualification checklist, discovery-call scorecard, demo agenda,
   onboarding data checklist, and pilot acceptance criteria.
9. **P4.T9 — Demo/launch pack.** Write `demo-and-launch-runbook.md`: safe showcase tenant, exact demo
   sequence, backup video path, no live customer data, no real outbound action, screen/voice/network
   preflight, launch-video shot checklist, copy claims allowed by evidence, and claims prohibited because
   they are not proven.
10. **P4.T10 — Release freeze.** When and only when all gates are green, commit
    `jarvis-release P4: certify Monday release candidate` and create local annotated tag
    `jarvis-2026-08-10-rc1` containing the readiness score and report path. Do not push/deploy production.
11. **P4.T11 — State closure.** Update every state ledger, close all P0/P1 defects, record final SHA/tag,
    set `NEXT EXACT PHASE` to `OWNER GO-LIVE APPROVAL`, and provide the exact separate production `/goal`
    instruction from §10.2.

**Architecture decisions already made.** Clean worktree proof. Separate rehearsal DB. Certifier fails on
skips/missing evidence. Exact pilot terms. Production deployment remains a separate explicit decision.

**Must not decide.** Lowering gates to get 9.5. Hiding blocked integrations. Tagging a failing SHA.
Deploying production. Making a launch-video claim not supported by certification evidence.

**Phase suite.** Fresh install/build/CI, backup restore, migration rehearsal, `npm run release:certify`.

**Exit gate.**
- [ ] clean-checkout install/build/all CI green;
- [ ] staging backup restore and integrity proof green;
- [ ] migration forward/rollback rehearsal green;
- [ ] release certifier exits 0 with zero skips/timeouts;
- [ ] 44/44 actions are CORE-CERTIFIED; configured bindings LIVE-CERTIFIED;
- [ ] zero open P0/P1 defects;
- [ ] 15-user/25-user gates and Sentry proof green;
- [ ] deployment, rollback, and incident runbooks committed;
- [ ] production-readiness report score ≥ 9.5;
- [ ] paid-pilot and demo/launch packs committed;
- [ ] final SHA and `jarvis-2026-08-10-rc1` tag recorded;
- [ ] production was not deployed by this plan.

**Rollback.** Revert P4 docs/scripts/tag; P3 staging remains available. Delete the local tag only if its
SHA is invalidated by a new certified release.

---

# §7. PHASE DEPENDENCIES AND FOUR-DAY CLOCK

```text
Thursday AM      P0  Release lock + clean CI + manifest
Thursday PM      P1  Contract harness begins
Friday AM        P1  44/44 contract closes
Friday PM        P2  Chaos/voice/model/security
Saturday         P3  Staging E2E + live smokes + 15/25-user load
Sunday           P4  Clean certification + backup/rollback + launch freeze
Monday           OWNER GO-LIVE APPROVAL + production runbook execution
```

Strict dependency: `P0 → P1 → P2 → P3 → P4`. No parallel phase execution. Within a phase, targeted
independent test runs may execute in parallel, but the phase commit happens only after all tasks finish.

---

# §8. RISKS AND ROLLBACK

| Risk | Impact | Binding mitigation | Rollback |
|---|---|---|---|
| Executor redesigns instead of hardening | high | §0 contract, exact files/spec/matrix | revert phase |
| 44× matrix becomes slow | medium | parameterised fixtures, profile N/A rules, targeted fix loop | retain manifest, optimise runner |
| Provider success occurs before local ack | critical | idempotency + reconciliation test in P2 | disable binding, reconcile, retry safely |
| Staging contacts real customer | critical | no-egress defaults, allowlist, dual opt-in | disable provider/write flag |
| Test runner hangs | high | P0 explicit handle teardown; hang is failure | revert offending test infra |
| LLM fallback changes answer/provenance | high | fixed purpose/channel/deadline/provenance tests | pin existing router config |
| Voice duplicate causes duplicate action | critical | immutable session + transcript dedup + idempotency | disable action tool, voice read-only |
| Migration damages data | critical | backup, staging, rehearsal DB, forward/rollback proof | restore backup / prior app SHA |
| Load overwhelms queue/provider | high | budgets, backpressure, bounded retry, 25-user safety test | scale/disable binding, drain queue |
| Missing provider credentials | medium | BLOCKED-CONFIG truthful state | emulator or integration setup |
| Sentry captures PII | critical | seeded sentinel scan, sanitised tags only | disable event, scrub, rotate if needed |
| Release pressure lowers gates | critical | certifier hard-fails on skips/open P0/P1/score | no tag, no production deploy |

---

# §9. DEFINITION OF DONE

Done only when all gates hold with evidence:

1. Fixed spec and discovered registry match exactly: 44/44.
2. Every action is CORE-CERTIFIED; no action is UNCERTIFIED.
3. Every configured provider path is LIVE-CERTIFIED or deliberately disabled.
4. Every missing provider is shown as BLOCKED-CONFIG with exact setup action.
5. Zero tenant leakage across Alpha/Bravo and direct RLS tests.
6. Zero approval bypass; typed-required actions require typed evidence.
7. Zero duplicate business/provider effects under sequential or concurrent replay.
8. Read-only/meta actions create no consequential side effect.
9. All retries bounded; non-retryable failures do not retry.
10. Worker lease recovery, dead-letter, reconciliation, and replayability are truthful.
11. LangGraph workflows resume after restart and compensate when defined.
12. GLM/Mistral/DeepSeek routing deadlines, aborts, fallback, provenance, and cost ledger pass.
13. Fast read lane passes eligibility, tenant, data, and fallback tests.
14. Evidence corpus and Exa→Firecrawl verification/citations pass.
15. Voice identity, transcript dedup, speech/display parity, recipient resolution, approval, and staging
    outbound guards pass.
16. Auth, RBAC, RLS, webhook, rate-limit, secret, PII, and production boot guards pass.
17. Every action/state has truthful frontend handling; zero fallback in certified paths.
18. Every terminal outcome has a truthful receipt/audit/prediction/provenance story.
19. Sentry/structured traces cover every service and injected P0/P1 failure without PII.
20. 44/44 staging API E2E passes.
21. 15-user and 25-user load gates pass without corruption or duplicate effects.
22. All services in staging run one release SHA.
23. Fresh-checkout install/build/CI passes with no local dependency.
24. Backup restore preserves tenant/action/receipt/audit integrity.
25. Migration forward/rollback rehearsal passes.
26. Zero skipped/quarantined tests and zero hanging processes.
27. Zero open P0/P1 defects.
28. Production/deployment/rollback/incident runbooks are executable and exact.
29. Paid pilot and demo/launch packs match proven product capability.
30. Final score ≥ 9.5 and release candidate tag points to the certified SHA.

---

# §10. EXACT EXECUTION INVOCATIONS

## 10.1 Phase `/goal` template

Use only the phase number change:

```text
/goal Read JARVIS-4-DAY-PRODUCTION-MAESTRO-PLAN.md and
JARVIS-4-DAY-PRODUCTION-MAESTRO-STATE.md completely. Execute PHASE 0 exactly as written.
Do not redesign, simplify, skip, or create a new plan. Continue until every Phase 0 exit gate is
green or a real blocker is written into the state file. Update the state file completely and commit.
```

Then repeat for PHASE 1, PHASE 2, PHASE 3, and PHASE 4.

## 10.2 Separate production go-live `/goal` — run only after P4 is green

```text
/goal Read the certified production readiness report, deployment runbook, rollback runbook,
incident runbook, and both Maestro files completely. Confirm the state file says P4 COMPLETE,
readiness score is at least 9.5, zero P0/P1 defects are open, and the current HEAD matches the
certified RC tag. Execute only the production deployment runbook. Stop and roll back immediately
on any failed gate. Do not improvise.
```

---

# §11. THE COMMERCIAL RELEASE BINDING

The release is built for this initial offer:

> **$5,000 — 30-day paid pilot, 14-day implementation, one location, up to 15 users.**
> A fixed usage allowance is included; additional model, voice, SMS, email, calling, and provider usage
> is billed separately. Scope and integrations are written before kickoff. Support/iteration is
> scheduled twice weekly, with incident response for real outages—not unlimited custom development.
>
> Successful conversion: **$10,000 implementation + $4,000/month + usage.**

Pilot success metrics must be concrete: response speed, recovered leads/revenue, bookings, overdue cash
movement, dispatcher time saved, approval turnaround, action success rate, duplicate-effect rate (zero),
and system availability during agreed pilot hours.

---

*End of plan. Begin with PHASE 0 only. Record all progress in
`JARVIS-4-DAY-PRODUCTION-MAESTRO-STATE.md`.*
