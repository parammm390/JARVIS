# P2.T1 — exact Work correlation inventory

Date: 2026-08-08  
Source of truth: `JARVIS-FRONTEND-MAESTRO-PLAN-v6.md` §11, §20 and the current Finnor OS schema/read models.

## Projection decision

The existing read models did not expose a Work-shaped causal projection, so P2.T1 adds one read-only derived projection at `finnor-os/packages/read-models/src/work-cases.ts` and exposes it through `/api/read-models/work-cases`. It reads existing tenant-scoped rows; it adds no source-of-truth table and no migration.

The derived case key is `root.kind:root.id`. Instruction roots are preferred when an exact `domain_actions.instruction_id` or `instruction_events.payload.actionId` edge exists. A workflow with one exact action root stays on that root; a workflow spanning multiple roots remains a `workflow_run` root. A command `correlation_id` is used only for an otherwise unrooted trace. Household, invoice, appointment, job, visit, call, and other links are collected only from named ID fields in authoritative payloads/evidence. No customer, invoice, time, text, or similarity grouping is used.

## Exact edges

| Link | Exact source path / rule | Runtime status |
|---|---|---|
| instruction → action | `domain_actions.instruction_id`; fallback `instruction_events.instruction_id` + payload `actionId` | proven; integration |
| action → approval | `pending_confirmations.domain_action_id` and confirmation status | proven; integration |
| action → workflow | `workflow_steps.domain_action_id` → `workflow_steps.workflow_run_id` | proven; integration |
| workflow → steps | `workflow_steps.workflow_run_id` ordered by `sequence` | proven; integration |
| action/run → receipt | `decision_receipts.domain_action_id`, `.workflow_run_id`, or `.workflow_step_id` | proven; integration |
| case → business event | case-linked exact entity ID → `business_events.entity_type` + `entity_id` | proven; integration |
| case → customer | allowlisted payload key `householdId` → `household` link | proven; integration |
| case → appointment/job | allowlisted keys `appointmentId`, `visitId`, `serviceVisitId`, `workOrderId` | source contract; no fixture row invented |
| case → invoice | allowlisted keys `invoiceId` / `invoiceIds` → `invoice` link | proven; integration |
| case → call | `voice_turns.resolved_action_ids` or pending confirmation action → `voice_sessions.call_external_id` → `calls.id` / `calls.external_id` | proven; integration |
| call → agent | no exact agent identifier exists on the discovered canonical `calls`/voice records | not proven; deferred to P3 agent truth binding |

## Truth boundaries

- `Needs you`, `Working`, `Waiting`, `Completed`, `Failed`, and `Blocked` are the only emitted Work statuses.
- Terminal failure outranks approval, execution, and pending states; a missing receipt never becomes an outcome.
- A missing assignee is not rendered as an owner.
- The projection exposes provenance paths so later surfaces can explain an exact link without dumping raw JSON.
- Tenant scoping is applied through `withTenant(tenantId)` and every queried table carries the requested tenant boundary.
