# Finnor OS / JARVIS — post-completion system brief

## Purpose and truth status

This is the **target-state context document** for Finnor OS after every phase in `JARVIS-MAESTRO-PLAN.md` and `JARVIS-FRONTEND-MAESTRO-PLAN.md` has been completed and its stated exit gate has passed. It deliberately excludes any future marketing-only plan.

It is not a claim that every capability below is live today. It is the exact intended system shape after completion, including the plan's honesty rules: real integrations remain visibly unconfigured until their credentials and tenant setup exist; simulations are always labelled; model predictions are not facts; and no visual surface may fabricate data.

## What Finnor OS is

Finnor OS is a multi-tenant, approval-governed AI operations platform for water-treatment dealers. It turns voice or typed operational instructions into typed, policy-controlled business actions and durable workflows. JARVIS is the live operations console for that system: it lets owners, dispatchers, and technicians see, approve, execute, inspect, recover, and learn from the work.

It is not a generic chatbot, a generic CRM, or an unattended autonomous agent. It is a domain-specific operating layer that can recommend and prepare work, execute only within policy and approval constraints, expose evidence for every material decision, and recover safely when external systems fail.

## Product architecture and deployments

- `finnor-os/` is an npm-workspaces monorepo containing the API, worker, orchestration, workflow runtime, database, domain plugins, policy schemas, read models, security, tools, and a legacy internal console.
- The root Next.js application (`finnorai.com`) hosts the production JARVIS experience. It is the product frontend that evolves; `apps/console` is a separate minimal internal tool and is not the target of JARVIS work.
- `apps/api` is the authenticated API. `apps/worker` is the long-running job, scheduler, realtime SSE, and workflow host. Vercel hosts the web/API surfaces and Railway-class long-running infrastructure hosts the worker/SSE process.
- JARVIS uses a server-side proxy and a typed API client. All browser data access goes through authenticated, tenant-scoped routes; it does not receive broad database credentials.
- The system has separate production and staging posture, deployment checks, environment consistency checks, and explicit setup/integration status endpoints. A production claim is only valid after it is probed again.

## The core execution loop

1. A user gives a typed or voice instruction, or a permitted scheduled/system signal creates a draft.
2. The orchestrator builds one or more typed `DomainAction` records using the plugin registry, policy, grounded tenant data, memory, and integration health.
3. Ambiguity produces a first-class clarification request instead of a guessed action.
4. Every action that can have a side effect goes through a database-enforced approval gate. An approval card is only a presentation of that gate; the UI cannot bypass it.
5. Approved work runs through the appropriate executor and plugin. Multi-step plans run as dependency-ordered durable workflows; single actions retain their simple path.
6. Every meaningful step creates a receipt: inputs, relevant policy version, binding/mode, trace/correlation id, prediction where available, actual result, error classification, cost where applicable, and provenance/evidence.
7. Reflection compares predicted or expected outcomes with actual outcomes. Retryable failures retry under strict rules; terminal or repeated failures stop and surface for a human. The planner can propose a repaired remaining plan, which again goes through normal gates.

No side effect is authorised merely because an LLM asked for it. The system is designed to be inspectable, pausable, cancelable, retryable, escalatable, and auditable.

## Domain model, plugins, policy, and planning

- The platform supports 21 domain-plugin modules and 41 action types across CRM, scheduling, water testing, quotations, proposals, installation, invoice-to-cash, inventory, service reminders, compliance, maintenance agreements, technician reports, communications, marketing, research, and operations.
- Each plugin provides typed Zod input schemas and the same validate/draft/execute contract. The planner receives compact registry-derived field specifications rather than unbounded free-form tool descriptions.
- Tenant-scoped policy—not hard-coded prompts—governs price rules, approval/confirmation requirements, thresholds, volume and safety limits, and permitted behavior. Policies are versioned and effective-dated; receipts record the policy version applied.
- Before planning an id-shaped payload is grounded against tenant data. Fields are visibly classified as verified, not found, or unverifiable.
- The planner supports DAG plans. Dependent actions execute topologically and each step has its own receipt.
- It creates predicted receipts before approval. Quotation, scheduling, inventory, invoice-to-cash, and bulk-notify support real dry-run/simulation behavior where defined; other plugins have schema-level predictions. After execution, field-level predicted-vs-actual diffs feed per-action-type accuracy metrics.
- Integration health is part of planning. The planner does not knowingly plan through an open provider circuit; it proposes an honest manual alternative when appropriate.
- The planner has a bounded memory context: canonical summary plus selected semantic records, under a defined token cap. Semantic retrieval uses the configured embeddings provider in production rather than pretending hash embeddings are meaningful.
- It has a replayable evaluation suite covering expected action types and fields, ambiguity, health degradation, repair, policy/safety cases, and critic behavior. The target is at least 95% planner-eval performance and at least 90% critic catch performance on the defined test sets.

## Execution, durability, recovery, and realtime

- Actions can use the legacy gated executor or a LangGraph-based executor; routing is explicit per action type. Graph workflows pause durably at approval and survive process restart.
- The durable workflow runtime provides commands, leased steps, outbox/inbox processing, reconciliation cases, compensation, dead-letter queues, and owner-gated replay/discard. It supports pause, resume, cancel, retry, and escalate run controls with optimistic versioning.
- The job queue uses safe concurrent claiming, leases, backoff, dead-lettering, and expired-lease recovery. It has priority lanes, per-queue caps, graceful shutdown/draining, and backpressure for non-urgent intake.
- Intake, webhooks, workflow steps, and external provider calls have distinct idempotency protections. A duplicate cannot quietly create a second side effect.
- Error handling is classified as retryable, terminal, needs-human, or configuration-related. Receipts retain the class. A watchdog detects stuck runs, orphaned steps, unfinalized receipts, and aging approvals; DLQ rows receive rule-based triage suggestions while human authority stays intact.
- Provider bindings resolve tenant override → environment setting → safe default. Finnor-owned capabilities default to native bindings; emulator use is explicit where required. Each integration exposes its actual configured and health state.
- Outbound provider calls have timeouts, classified retries, jitter, circuit breakers with half-open recovery, metrics, and fault injection for emulator/testing paths. Vendor failure degrades to a documented safe mode; it is not silently represented as success.
- Postgres notifications, an authenticated tenant-scoped SSE gateway, and CQRS projections give JARVIS near-real-time updates. Event-to-pixel is targeted at under two seconds. The client is SSE-first with reconnect/Last-Event-ID support and adaptive polling fallback.

## Intelligence, simulation, and economics

- The intelligence layer provides an explainable route optimizer, appointment-slot recommender, transparent forecasting bands, anomaly detection, churn/risk heuristics, reorder suggestions, and cited water-domain retrieval. Heuristic outputs are explicitly labelled as such.
- Dispatch recommendations compare against a naive route and show projected kilometres saved. Forecasts and anomalies are linked to real series and evidence rather than decorative charts.
- Dealer Zero is a deterministic sandbox for safe scenario playback: normal day, summer pressure, payment crunch, equipment recall, and fault/chaos scenarios. Same seed means same event stream.
- Time-compression powers a sandbox-only, explicitly DEMO-labelled day replay. Counterfactual replay produces normalized receipt diffs across code changes; shadow mode compares a candidate build against a read-only mirrored sandbox intake before promotion.
- A training tenant can be bootstrapped for onboarding without touching a real dealer's data.
- Every LLM call is recorded with purpose, model, token usage, cost, action/trace relationship, and tenant. Model routing uses an explicit purpose-to-model policy; tenant budgets warn at soft caps and defer non-urgent work at hard caps with an honest receipt.

## Integrations and notifications

- Capability bindings cover CRM, scheduling, inventory, documents, communications, payments/accounting, e-signature, and marketing. Real providers are used only when configured; otherwise the UI says native, sandbox, emulator, unconfigured, degraded, or down truthfully.
- Webhooks are signature-verified and fail closed in production. Webhook fuzzing and malformed-input tests are part of the security proof.
- External messaging is guarded by recipient allowlists, volume limits, policies, receipts, retries, and circuit breakers. It never claims a sent message without a provider result.
- Users can opt into web push for approvals, SLO burn, and critical watchdog events. Owner digests include operational briefing, anomalies, cost, and SLO deltas. A weekly certification report contains readiness, drills, and replay-diff evidence.
- User preferences include notifications, quiet hours, sound, density, home surface, pinned panels, and accent choices. Sound and haptics remain opt-in/off by default.

## Security, tenancy, and operational proof

- All tenant data paths use tenant context, row-level isolation, explicit tenant filters, and route/authz tests. The target is zero cross-tenant leaks in nightly verification.
- Approval authority is RBAC/policy controlled; an authz matrix is generated from code and checked in CI. No default “agent authority” exists.
- PII is redacted before planner/critic/retrieval calls and from structured logs. Retention/purge behavior is policy controlled.
- Production boot checks fail closed for unsafe auth bypass, secret-provider configuration, unsafe native/emulator resolution, and post-cutover role mistakes. Plaintext secret fallback is only a loud emergency override once the configured secrets provider is active.
- Audit records are immutable at the database level and regression-tested. CI includes secret scanning, dependency vulnerability scanning, approval-gate property tests, tenant-isolation fuzzing, and webhook fuzzing.
- The platform has documented degradation ladders for Redis, logs, error reporting, embeddings, voice, and email; a dependency outage does not silently become a business-data lie.
- Backups have defined retention, restoration drills, an RPO target of six hours and RTO target of thirty minutes. Pooling/load changes are measured in staging and production with an explicit rollback and soak period.
- Readiness computes SLOs and error-budget burn: post-approval success, workflow latency, queue age, worker heartbeat, DLQ rate/triage time, API error rate, planner/critic evaluation scores, tenant-isolation failures, restore performance, event-to-pixel latency, and prediction accuracy. Failure-injection drills are scheduled and recorded.

## JARVIS: the live operating console

JARVIS is not a wall of generic panels. It is a single live command surface that exposes the system's operational reality with a strict “honest spectacle” rule: synthetic data is labelled, emulator/sandbox state is labelled, and visual effects are driven by actual events or explicit fixtures.

### Foundation and interaction language

- A typed client, live-query layer, visual snapshot suite, Lighthouse checks, Stage QA surface, design codex, elevation/spacing/type/icon rules, and a 100-item FLOW index govern the UI.
- Motion primitives handle reduced motion internally. Effects pause offscreen/when blurred, GPU-only animation is preferred, and no viewport carries more than two ambient loops.
- The catalog covers interaction, workflow, ambient, command-surface, decision, voice, geo, data-viz, state, continuity, and preference behaviors. Every entry is tracked as shipped, planned, or cut with an honest data source.
- The Stage can mount behaviours in isolation, switch fixture states, display completeness, and provide performance/reduced-motion verification. It is the system's visual regression and QA lab, not a marketing fake.

### Bridge, approvals, actions, and workflows

- The Bridge is the primary role-aware live surface: navigation/pulse on the left, contextual scene and active work in the center, activity/approvals on the right. It progressively replaces legacy panel usage without a destructive shell rewrite.
- Its Orb is a reduced-motion-safe, low-power-safe Three.js visual driven by true states—idle, planning, executing, blocked, and error/recovery—and real realtime events. Pulse signals show heartbeat age, queue, DLQ, integration/binding health, scans, and live activity.
- The Approval Cockpit gives mouse-free and keyboard-complete control. It shows risk materials, before/after and provenance where available, critic findings, policy drift, predicted receipt, batch risk safeguards, explicit blocked states, and an honest undo window only before a run has been claimed.
- All 41 action types render as designed UI in approvals, activity feed, receipts, and workflow views. Eight high-value action families have flagship scenes; no normal surface defaults to raw JSON.
- Pipeline Theater renders live durable runs, step receipts, compensation, failures, watchdog flags, run controls, and DLQ triage/replay as real workflow state.

### Dispatch, personalization, and operator experience

- Map Theater shows technician dispatch on a dark map with route replay, household-360 detail, load context, and an optimized-route/km-saved explanation. Technicians get a mobile-first My Day with only their visits, navigation deep-links, checklists, and gated completion.
- Owners, dispatchers, and technicians land in different role-appropriate scenes. Preferences can override defaults, and frecency prefetches/reorders likely-needed surfaces without hiding important work.
- A “since you were away” digest uses actual deltas and deep-links; quiet hours slow/mute ambient behavior only when the user configured them.
- Command-K can navigate, search households/receipts/runs, and turn an instruction into planner-proposed, approval-gated action cards. It does not execute unreviewed commands.
- Voice surfaces use real Vapi levels where available, real transcript/action correlation where available, and visibly labelled limitations/cuts otherwise—never fake waveform activity.

### Visual data, states, continuity, and finish quality

- Charts use an in-product data-viz grammar and gracefully show unavailable future intelligence outputs rather than inventing values.
- Empty, degraded, permission, stale, offline, first-run, and error states are designed operational states, driven by actual conditions where possible.
- JARVIS preserves contextual continuity within Bridge scenes and route/drawer/detail transitions without pretending the legacy shell has been fully rewritten.
- Sound cues and mobile haptics are optional, preference-controlled, short, throttled, and muted in quiet hours.
- Final certification includes FLOW catalog quality cuts where appropriate, five recorded signature moments, FPS matrix, bundle comparison, ambient-loop census, reduced-motion QA, contrast audit, keyboard verification, snapshots, Lighthouse at least 90 performance and 95 accessibility, and zero-CLS proof on primary panels.

## Demonstration and boundary rules

- `/jarvis/showtime` is a guided, time-compressed Dealer Zero demonstration. It is clearly marked DEMO. Calls, plans, approvals, pipelines, dispatch, and Orb activity can be paused and inspected; inspected items resolve to real receipts generated by the sandbox, not decorative mockups.
- Production data, customer messaging, payments, e-signatures, and provider calls remain subject to tenant configuration, policy, approval, and real credentials. A complete code path is not represented as a configured live integration when it is not.
- JARVIS is built for a water-treatment dealer's operations. Its premium visual system serves comprehension, trust, speed, and confidence under operational load; it is not a consumer entertainment product.

## Definition of complete

The system is complete only when every main-plan and F-track task has evidence and every exit gate is green, including live/staged proofs where the plan requires them. Completion means a governed, measurable, recoverable, observable, role-aware operations platform with an unusually polished live console—not an unconstrained general AI, and not a promise that every external provider will be connected for every tenant by default.
