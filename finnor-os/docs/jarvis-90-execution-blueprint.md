# Finnor 10 → 90 Execution Blueprint

## Definition

The target is not a chatbot that can call APIs. It is a voice-native business operator:

owner speaks -> understands business state -> proposes/clarifies -> approves
-> coordinates people, inventory, money and customers -> verifies outcome
-> recovers/escalates -> reports the truth by voice and dashboard

“90” means the whole loop is demonstrably functional against high-fidelity local provider simulators before any real dealer credential is enabled. It does not mean that every SaaS is integrated or that an LLM makes unbounded business decisions.

## Evidence-based starting point

The repository contains a useful core: 17 plugins / roughly 38 action types, tenant isolation, confirmation gate, audit log, queue, LangGraph for one gated action, one Temporal AMC sequence, native household/service/invoice/inventory records, and basic Vapi/GHL/QuickBooks/ads/email/maps/search adapters.

That is not the target platform:

| Area | Exists | Gap to 90 |
| --- | --- | --- |
| Workflows | Two state machines and one durable Temporal workflow. | Reusable workflow runtime and complete operating loops. |
| Execution | Inline plugin DB/tool calls, completed-call idempotency. | Command lifecycle, outbox/inbox, compensation, reconciliation, leases and recovery. |
| Tools | Small registry, native sandbox comms, selected adapters. | Versioned capability contracts and high-fidelity local emulators. |
| Data | Household, visit, equipment, invoice, proposal, inventory. | Canonical customer/deal/work-order/task/payment/purchase/message/document/event models. |
| Voice | Vapi ingress and basic confirmation. | Authenticated identity, durable session, turn control, clarification and handoff. |
| Planning | LLM action drafts against schemas. | Grounded workflow planning, deterministic preflight and executable plans. |
| Testing | Unit/integration tests plus some business flows. | Deterministic provider/voice scenario laboratory. |

## Architecture

Voice / Console / Webhook / Scheduler
             |
      Identity + session control
             |
      Business command gateway
             |
  Policy / permissions / preflight / plan compiler
             |
 Durable workflow runtime + command ledger + outbox
             |
      Capability adapters (real or simulated)
             |
Canonical business data <- inbox/webhooks/reconciliation
             |
Audit, timeline, metrics, spoken/dashboard outcome

The planner may suggest a plan. It must never directly own state transitions or provider calls. The command/workflow runtime owns those deterministically.

## Complete build sequence

### 1. Canonical business data platform

Create repository/service-owned records for customer, household, contact methods/consent, lead, opportunity, pipeline, task, work order, appointment, technician capacity, quote, proposal, price book, invoice, payment, equipment, warehouse stock, procurement, conversation, call, message, document, and a business event timeline.

Add money/quantity/timezone types, constraints, import keys, archive rules, provenance, tenant RLS, and data-quality findings for duplicate detection, entity resolution, missing critical data and stale data. Plugins must stop writing arbitrary tables directly.

Proof: import synthetic dealer data, replay the import twice with no duplicates, and produce quality findings for malformed or ambiguous data.

### 2. Capability and provider control plane

Replace the loose tool list with versioned capability contracts. Each contract declares input/output schemas, idempotency, timeout, retry, reconciliation, compensation, permission, PII minimisation and simulator.

Build local stateful emulators for CRM, calendar/dispatch, communications, accounting/payments, inventory/procurement, documents/e-signature, and marketing/reviews. Emulators must model latency, duplicate delivery, partial failure, rate limits, timeouts, auth failures and eventual consistency. The same contract then backs GHL, QuickBooks, Vapi, Stripe/payment providers, calendars and other real adapters.

Proof: one workflow passes unchanged against the emulator and provider adapter contract tests; only the binding changes on activation.

### 3. Durable execution runtime

Introduce explicit command, workflow_run, workflow_step, outbox_event, inbox_event, integration_operation, reconciliation_case and compensation records. Every step has a lease, idempotency key, attempts, evidence and terminal reason.

- Temporal owns long waits, human tasks, callbacks and multi-day sequences.
- Postgres queue owns short local work and outbox delivery.
- Transactional outbox/inbox prevents hidden side effects.
- Unknown side effects are reconciled, never blindly retried.
- Compensations cancel appointments, void drafts, release stock, retract unsent messages, or escalate when impossible.

Proof: kill processes at every workflow boundary, duplicate webhooks, restart, and obtain either exactly-once business outcome or an explicit reconciliation case.

### 4. Complete vertical dealer workflows

Build these end-to-end before widening action count:

1. Lead to booked water test: intake, entity resolution, qualification, availability, hold, approval, booking, confirmation, reminder and no-show.
2. Water test to signed proposal: technician report, water profile, sizing, price-book quote, delivery, signature/decline/expiry and follow-up.
3. Signed proposal to installation: deposit/payment, stock reservation, procurement exception, dispatch, checklist, completion and handoff.
4. Invoice to cash: invoice, delivery, payment link, payment webhook, reconciliation, overdue cadence and accounting sync.
5. Installed customer to recurring revenue: service cadence, due checks, appointment, report, parts use, renewal and churn recovery.
6. Daily owner operating loop: priorities, exceptions, approvals, route/stock/payment risk, voice briefing and reconciliation.
7. Marketing-to-revenue loop: campaign/review request, attribution, lead source, conversion and spend outcome.

Every workflow gets a state diagram, invariants, permission rules, compensations, provider contract tests, voice scripts and scenario pack.

### 5. Real voice operating system

Build voice_identity, voice_session, voice_turn, pending_confirmation and handoff records. Require verified provider signature plus resolved assistant and caller identity. Unknown callers may use safe intake but never owner commands.

Persist turns, extracted facts, unresolved slots, action IDs shown and expiry. Bind “yes/no” to one confirmation object—not the newest pending action. Support clarification, correction, interruption, multi-action disambiguation, callback, human transfer and dropped calls. Speak only verified outcomes.

Proof: scripted calls complete every vertical workflow—including ambiguity, transcript noise and call drops—without accidental approval, cross-tenant access or false completion.

### 6. Orchestration and intelligence

Use a typed plan compiler:

intent -> grounded entities -> policy decision -> executable workflow command graph

The LLM can only select allowed capabilities and fill typed slots. Deterministic policy validates money limits, consent, service radius, capacity, pricing, permission, inventory and required evidence before a step starts.

Build event-timeline read models for pipeline health, technician load, stock risk, cash/collections, service due, SLA breaches, follow-up debt and data quality. Proactive recommendations become explainable, gated commands.

### 7. Simulation lab and certification

Create synthetic dealer fixtures: small, high-volume, multi-tech, bad-data and integration-down. Add virtual time for reminders and Temporal waits. Run deterministic scenarios covering happy paths, duplicate/inverted/delayed webhooks, crash/restart, possible-delivery timeouts, concurrent commands, policy violations, duplicate imports, voice ambiguity/call drops, load, audit and recovery.

The release gate is workflow-by-workflow readiness, not one vague global green badge.

### 8. Real-provider activation

Only after simulator certification:

1. Connect a provider sandbox.
2. Run adapter conformance and webhook replay tests.
3. Run the full synthetic dealer workflow in staging.
4. Enable one capability behind a tenant/action kill switch.
5. Reconcile every operation and observe it.
6. Progressively enable the next capability.

No live provider is the test environment for unfinished orchestration.

## Platform upgrades required throughout

- Real auth/session management and voice identity; no default-tenant assumptions.
- Secrets rotation, PII controls, consent ledger, retention/deletion controls.
- Correlation IDs and traces across API, queue, workflow, providers and webhooks; metrics, alerts, runbooks and replay tools.
- CI migration, contract, scenario, chaos, load and schema-compatibility tests.
- Synthetic-data staging, restore drills, disaster recovery and per-capability kill switches.

## What not to do

Do not add random APIs or one-off plugins first. That creates breadth without execution reliability. Build canonical data, contracts, emulators, durable runtime and the first seven vertical workflows; then every provider becomes a controlled adapter rather than fragile custom code.

