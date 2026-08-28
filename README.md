# FINNOR OS

**FINNOR is a governed AI operating system for service businesses.**

JARVIS is the human operating surface. FINNOR is the execution system underneath it.

The system accepts a business objective or instruction, grounds it in canonical company state, evaluates authority and policy, converts intent into bounded typed actions, executes through durable workflows and governed integrations, observes the real outcome, reconciles uncertainty, and preserves evidence of what happened.

```text
Human / Event / Voice / API
           │
           ▼
   Context + Company State
           │
           ▼
      Planner / Objective
           │
           ▼
 Authority + Policy + Approval
           │
           ▼
 Typed Actions / Work / Effects
           │
           ▼
 Durable Execution Runtime
   ├─ Native FINNOR operations
   ├─ Provider APIs / MCP
   ├─ Messaging / Voice
   ├─ Workflow runtime
   └─ Governed Computer Use
           │
           ▼
 Observe → Verify → Reconcile
           │
           ▼
 Canonical State + Receipts + Evidence
```

This repository contains the public FINNOR product experience, JARVIS, and the complete `finnor-os` backend/runtime.

---

## What FINNOR is

FINNOR is **not a chatbot, not a CRM wrapper, and not a collection of disconnected AI agents**.

It is an operating layer for company work:

- understands company context and current business state;
- knows employees, roles, scopes, identities, accounts and authority;
- plans and executes bounded business actions;
- pauses consequential work for approval when policy requires it;
- persists long-running Work across requests, workers and restarts;
- performs external operations through native integrations, APIs, MCP and governed computer use;
- reacts to external events and resumes waiting objectives;
- verifies outcomes instead of treating provider dispatch as business success;
- records durable evidence, receipts, failures and recovery paths;
- exposes the operating state through JARVIS.

The product is currently optimized for service-business operations, initially including water-treatment operators, but the runtime itself is built around tenant-scoped business primitives rather than one hard-coded workflow.

---

## JARVIS

JARVIS is the operator-facing command and control surface for FINNOR.

Its major product surfaces include:

- **Command / Voice** — instruct FINNOR through text or supported voice channels;
- **Work** — inspect the durable causal record for objectives, actions, approvals, workflows, evidence and outcomes;
- **Customers** — operate against canonical customer and household context;
- **Schedule** — appointments, service and operational timing;
- **Money** — invoices, collections and financial operating views;
- **Agents** — agent and automation activity;
- **Activity Theater** — live operational activity across actions, workflow steps, computer steps and calls;
- **Execution / Workflow Theater** — visual execution state tied to persisted workflow/action state;
- **Operational Time Machine** — read-only causal replay of decisions, evidence, governance and execution history.

JARVIS is deliberately a projection of persisted system truth. Presentation is not allowed to invent execution progress that the backend has not recorded.

---

## Core architecture

### 1. Company world

FINNOR maintains tenant-scoped canonical business state and organization context across people, roles, teams, locations, customers, work orders, appointments, conversations, calls, messages, documents, invoices, payments, inventory and other operational records.

The database layer uses PostgreSQL with tenant isolation and RLS-aware application access.

### 2. Identity, access and authority

Execution identity is explicit.

FINNOR models:

- employees and service principals;
- role assignments and authority grants;
- tenant/resource/self/assignment scopes;
- application identities and auth profiles;
- risk and amount caps;
- approval requirements and approval chains;
- governed delegation and handoff.

Authority is re-evaluated at execution time and fails closed when identity or scope is ambiguous.

### 3. Typed action fabric

FINNOR executes through a registered action vocabulary rather than free-form tool invention.

The current generated action manifest contains **59 registered actions** spanning business operations, universal company actions and governed computer execution.

Examples include:

- customer messaging and follow-up;
- payment collection and invoice operations;
- scheduling and rescheduling;
- lead and CRM operations;
- inventory and service workflows;
- proposals, quotes and signatures;
- marketing operations;
- business queries and research;
- task creation, assignment and updates;
- delegation, escalation and handoff;
- internal event scheduling;
- document sharing;
- `computer_task` for governed browser/computer execution when a safer native/API route is unavailable.

Each action carries typed payload expectations, risk/approval semantics and execution behavior.

### 4. Durable Work

`Work` is the durable causal envelope for operational responsibility.

A Work record can survive:

- approval delays;
- provider latency;
- worker restarts;
- retries;
- external waits;
- handoffs;
- partial failures;
- recovery and reconciliation.

JARVIS reads Work as the canonical operating story rather than maintaining a second UI-only state machine.

### 5. Objective runtime

FINNOR supports persistent governed objectives in addition to bounded instruction planning.

The objective runtime follows a controlled loop:

```text
Inspect canonical state
        ↓
Choose exactly one bounded next step
        ↓
Query / Act / Wait / Block / Complete
        ↓
Observe durable result
        ↓
Re-inspect company state
        ↓
Continue only when justified
```

Objectives have budgets, durable iterations, explicit waits, event wake-ups and terminal states. The runtime never assumes an action succeeded merely because a provider accepted a request.

### 6. Approval and policy

Consequential execution is governed by explicit policy and authority checks.

The system supports:

- no-approval actions;
- policy-gated actions;
- required approval;
- typed confirmation for higher-risk effects;
- immutable confirmation evidence;
- approval drift detection;
- execution-time authority revalidation.

### 7. Durable workflow runtime

Longer operations are represented as durable workflow steps rather than one HTTP request pretending to be a workflow engine.

The runtime includes:

- persisted workflow state;
- leased work;
- retries and backoff;
- outbox delivery;
- idempotent external operations;
- compensation;
- reconciliation;
- dead-letter handling;
- explicit failure classes;
- recovery paths.

### 8. Governed computer use

FINNOR includes a bounded computer-execution subsystem for work that cannot be completed through a reliable native integration or API.

The computer runtime provides:

- tenant- and Work-scoped runs;
- explicit application and auth-profile selection;
- origin restrictions;
- read-only vs mutation modes;
- authority revalidation before execution;
- step/time/cost/artifact/screenshot limits;
- isolated provider sessions;
- durable step history;
- post-action observation;
- cancellation;
- crash/uncertain-write reconciliation;
- evidence capture;
- deterministic terminal states.

Computer use is a **fallback execution route**, not permission for an LLM to browse arbitrary systems or invent credentials.

### 9. Event-driven runtime

External reality can wake FINNOR.

The runtime supports durable event waits and wake claims so objectives can pause for real business events and resume later without keeping an HTTP request or model session alive.

Examples include waiting for acknowledgements, provider events, workflow progress or a deadline.

### 10. Memory, research and evidence

FINNOR separates canonical business truth from softer context.

Planning truth precedence is intentionally biased toward live operational state and durable execution evidence before semantic memory or external research.

The stack includes:

- PostgreSQL canonical state;
- Redis short-term runtime state where configured;
- semantic retrieval / embeddings where configured;
- evidence corpus and immutable versions;
- external research with bounded discovery/verification paths;
- episodic and execution history;
- decision receipts.

### 11. Read models and projections

Operational UI is driven by read models/projections rather than raw table access.

The system contains projections for business state, Work, activity, readiness, customer context, money, operational deltas, reliability and other operating views.

---

## Execution guarantees

FINNOR is designed around several non-negotiable rules:

1. **No invented capability** — the planner may only select registered actions/tools.
2. **No invented identity** — execution must resolve an allowed actor/account/profile.
3. **No silent consequential action** — policy and authority gates run before effects.
4. **No success-by-dispatch** — provider acceptance is not automatically business success.
5. **No duplicate external effect on retry** — external operations use idempotency/reconciliation where required.
6. **No fake progress** — JARVIS renders persisted state, not staged animation timelines.
7. **No cross-tenant leakage** — tenant isolation is enforced in the data and service layers.
8. **No unsafe browser free-for-all** — computer use is bounded by application, identity, origins, mode and budgets.
9. **No long autonomous loop inside serverless requests** — durable jobs/workflows carry continued execution.
10. **No unverified production claim** — live integration certification is configuration- and environment-dependent.

---

## Repository map

```text
.
├── src/                         # Public website + JARVIS frontend
│   ├── app/                     # Next.js routes
│   ├── components/jarvis/       # JARVIS operating experience
│   └── lib/                     # Frontend clients/projections/helpers
│
├── finnor-os/
│   ├── apps/
│   │   ├── api/                 # FINNOR API
│   │   ├── worker/              # Durable/background execution workers
│   │   ├── orchestrator/        # Orchestration runtime process
│   │   ├── console/             # Internal console
│   │   └── supplier-canary/     # Integration/canary surface
│   │
│   ├── packages/
│   │   ├── authority/           # Authority evaluation and grants
│   │   ├── computer/            # Governed computer-use runtime
│   │   ├── data-platform/       # Canonical import/data lifecycle
│   │   ├── db/                  # Schema, migrations, repositories, queue
│   │   ├── domain-plugins/      # Registered business actions
│   │   ├── memory/              # Runtime/semantic memory
│   │   ├── orchestration/       # Planner, executor, objective runtime
│   │   ├── policy-schema/       # Shared request/policy schemas
│   │   ├── projections/         # Operational delta projections
│   │   ├── read-models/         # Tenant-safe operational query/read models
│   │   ├── security/            # Identity/access/security services
│   │   ├── shared-types/        # Shared contracts
│   │   ├── tools/               # Integrations, LLMs and provider wrappers
│   │   ├── voice-os/            # Voice runtime
│   │   └── workflow-runtime/    # Durable workflow + reconciliation layer
│   │
│   ├── tests/                   # Unit/integration/live certification suites
│   └── scripts/                 # Release, certification and generated contracts
│
├── docs/                        # Architecture, evidence and release documentation
├── e2e/                         # Browser/product tests
├── infra/                       # Deployment contracts
└── .github/workflows/           # CI, security and production release gates
```

---

## AI / model architecture

FINNOR is **provider-routed**, not identified with one model vendor.

The backend can select configured model providers by purpose/channel with explicit deadlines, health-aware ordering, fallbacks and usage/provenance recording.

Current code supports provider families/routes including configured Bedrock-hosted models and OpenAI-compatible providers such as Mistral and DeepSeek. Voice can use its own channel-specific runtime. Model availability is always environment-dependent.

**Gemini is not the identity of FINNOR.** Legacy/public demo code may still use Gemini for optional narrative/profile generation, but that is an isolated demo concern and not the core planning/execution architecture.

---

## Integrations

FINNOR contains integration/tooling surfaces for categories including:

- voice/calling;
- email and messaging;
- scheduling;
- CRM;
- accounting;
- payments;
- e-signature/documents;
- marketing/ad platforms;
- web research;
- semantic memory/embeddings;
- routing/geography;
- governed computer execution.

Specific providers are activated only when the tenant/environment has valid configuration and the appropriate binding is enabled. External integrations commonly default to safe/emulated behavior until explicitly activated.

Never infer that every provider is live merely because an adapter exists in source.

---

## Current production boundary

The repository contains more capability than any single deployed environment necessarily has activated.

Production readiness is determined by source parity, migration state, deployment identity, environment configuration, live provider canaries, security gates and recovery certification — not by README claims.

The canonical release path is defined by:

- `infra/deployment/production.contract.json`
- `.github/workflows/production-release.yml`
- generated release/certification artifacts under `docs/release/`

A direct frontend deploy is **not** equivalent to a complete FINNOR production release because the system also depends on API, persistent worker/runtime, database state, credentials and release identity parity.

---

## Development

### Frontend / JARVIS

```bash
npm install
npm run dev
```

The root application is the public site and JARVIS frontend.

### FINNOR OS

```bash
cd finnor-os
npm install
```

Use the scripts defined in `finnor-os/package.json` for API, worker, tests, generation and certification tasks.

The backend targets modern Node.js and uses workspace packages under `finnor-os/packages/*`.

---

## Configuration

Do **not** treat this README as the environment-variable contract.

Use the repository's generated environment/release contracts and `.env.example` files as the current source for configuration requirements. Provider credentials and live bindings vary by environment and tenant.

Important configuration families include:

- database / PostgreSQL;
- Redis where enabled;
- Supabase authentication;
- model providers;
- voice providers;
- embeddings / semantic memory;
- research providers;
- communications;
- payments/accounting/e-signature;
- CRM/marketing;
- secrets management;
- computer-use provider/runtime;
- observability.

Production is intentionally fail-closed for unsafe development bypasses and unsupported secret configuration.

---

## Testing and certification

The repository contains multiple levels of verification:

- unit tests;
- integration tests;
- tenant-isolation and RLS tests;
- action-contract tests;
- authority/policy tests;
- idempotency/outbox/recovery tests;
- objective and event-runtime tests;
- computer-use tests;
- browser/JARVIS E2E tests;
- load/reliability gates;
- optional live-provider canaries;
- release certification and source-parity gates.

Live-provider tests are intentionally opt-in and must never be confused with deterministic CI success.

---

## Product truth vs. demo surfaces

Some public/demo routes intentionally demonstrate only a slice of FINNOR and may use isolated model/provider code for narrative generation.

Those demos do **not** define the system architecture.

For current product truth, start with:

- `finnor-os/packages/orchestration/`
- `finnor-os/packages/authority/`
- `finnor-os/packages/computer/`
- `finnor-os/packages/workflow-runtime/`
- `finnor-os/packages/tools/`
- `finnor-os/packages/read-models/`
- `finnor-os/packages/db/`
- `src/components/jarvis/`
- `docs/release/`

---

## Design principle

> **FINNOR should not merely tell a business what to do. It should safely carry responsibility for the work until the verified business state says the outcome is complete.**

That principle drives the architecture: canonical state, explicit authority, typed actions, durable Work, bounded autonomy, real-world execution, verification, reconciliation and evidence.
