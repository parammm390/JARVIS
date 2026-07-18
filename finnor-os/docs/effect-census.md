# Phase 2 — Effect Census

Every code path that causes an external side effect (a plugin `execute()` call, a
provider API call, an outbound message/write) as of 2026-07-18, before Phase 2 work
begins. This is the Phase 2 migration checklist — every row must end "via runtime" by
the exit gate. "External side effect" = anything with a real-world consequence outside
this database (SMS/email/call, CRM/calendar write, invoice/payment, e-sign, ad spend,
document generation) OR any write with cross-tenant/financial blast radius.

## Dispatch paths today

| # | Path | File | How it executes plugins | Runtime coverage |
|---|------|------|--------------------------|-------------------|
| 1 | Bare executor | `packages/orchestration/src/executor.ts` (`GatedExecutor.execute`) | Calls `plugin.execute(draft, scopedTools)` directly inside the route/job handler. Idempotency is per-external-tool-call only, via `ScopedToolRegistry` → `external_operations` ledger (`packages/tools/src/idempotent-call.ts`). No workflow_run, no outbox, no DecisionReceipt, no DLQ, no chaos coverage. | **NOT on runtime** |
| 2 | LangGraph mirror | `packages/orchestration/src/graph/nodes.ts` (`makeExecuteNode`) | Line-for-line mirror of path 1 for action types listed in `ORCHESTRATION_ENGINE_GRAPH_ACTION_TYPES` (gated in `graph/allowlist-executor.ts`) — same bare `plugin.execute()` call, same idempotency ledger, no runtime. | **NOT on runtime** |
| 3 | Workflow-runtime steps | `apps/worker/src/handlers/run-workflow-step.ts` + `packages/workflow-runtime/src/{steps,commands,outbox,reconciliation,chaos}.ts` | `submitCommand()` creates a `commands`/`workflow_runs`/`workflow_steps` row set; `claimStep`/`completeStep`/`failStep`/`advanceWorkflow` drive execution with atomic lease claims, idempotency keys (`{runId}:{sequence}`), stale-lease recovery, and `reconciliation_cases` on unknown-delivery. Bindings are real env-switched capability adapters (`packages/tools/src/capabilities/*`, GHL/Stripe/DocuSign/QuickBooks/native). | **Already on runtime** — this is the target shape for everything else. |
| 4 | Outbox relay | `packages/workflow-runtime/src/outbox.ts` (`relayOutboxEvents`) | Sequential per-tenant loop, 3-attempt retry, no `FOR UPDATE SKIP LOCKED` (not safe under concurrent relayers), no dead-letter table — terminal failures become `reconciliation_cases` with status `unknown`, not a queryable/replayable DLQ row. | **Partial** — exists, needs Phase 2.3 hardening. |
| 5 | Scan/reminder job handlers | `apps/worker/src/handlers/scan-*.ts`, `scheduled-reminder.ts` | Do NOT call capabilities directly — they read tenant data and call `FinnorOrchestrator`'s `draftKnownAction`, which inserts a `domain_actions` row that then flows through path 1 or 2. No separate effect surface; inherits whichever path the resulting action_type is gated to. | Inherits path 1/2/3 |
| 6 | Provider webhooks | `apps/api/app/api/webhooks/{vapi,stripe,esign}/route.ts` | Inbound only — signature-verified, zod-parsed, inbox-deduped. No outbound side effect originates here directly; they enqueue jobs that go through path 1/3. | Inherits path 1/3 |

## Action-type inventory (`compiler.ts` `WORKFLOW_ACTION_TYPES`)

Only **4 of 42** action types are tagged `kind: "workflow"` and go through path 3 today:
`start_water_test_workflow`, `request_proposal_signature`, `start_installation_workflow`,
`start_invoice_to_cash_workflow`.

The remaining **~38 action types**, across all 21 domain plugins (crm, scheduling,
inventory, accounting, customer-comm, quotation, marketing, bulk-notify,
service-reminders, technician-reports, compliance-documentation, maintenance-agreement,
ops-overview, water-domain-knowledge, web-research, proposal-batch,
proposal-to-installation*, invoice-to-cash*, proposal-signature*), execute via path 1 or
2 — bare `plugin.execute()`, no receipt, no DLQ, no chaos coverage.

(*proposal-to-installation, invoice-to-cash, proposal-signature plugins export several
action types each — some of their own action types are single-step reads/mutations
still on path 1/2 even though the plugin's *workflow-starting* action type is on path 3.
Verify per-action-type, not per-plugin, during 2.5.)

## Definition of done (Phase 2 exit gate, this doc's job)

Every row in "Dispatch paths today" collapses to ONE entry: path 3, generalized so a
single-step action submits a 1-step `workflow_run` (via `submitCommand`) instead of a
dedicated code path — no `plugin.execute()` call survives outside a workflow-runtime
step handler. Paths 1 and 2 are deleted, not "kept for compatibility." Path 4 gets
`FOR UPDATE SKIP LOCKED` + a real `dead_letters` table + replay API (Task 2.3). Every
step handler creates/finalizes a `DecisionReceipt` (Task 2.2/2.4).

## Non-goals for this census

- `apps/temporal-worker` (AMC renewal, `workflows/amc-renewal-sequence.ts`) is a
  separate, already-known migration target (Task 2.6). Verified: Temporal here owns
  ONLY the durable wait/signal-race/escalation timing between renewal attempts — each
  actual reminder still drafts through the unchanged `FinnorOrchestrator.draftKnownAction()`
  pipeline (path 1/2 above), the same primitive `scheduled_reminder` already uses. So
  2.6 is a timer-mechanism port (Temporal's `condition()`/signals → a workflow-runtime
  equivalent, likely reusing the date-bucketed re-enqueue pattern already in
  `apps/worker/src/scheduler.ts`), not a second effect-execution surface to migrate.
