# Upgrade 9 — JARVIS Agentic Objective Loop

## Outcome

JARVIS owns an objective as persistent Durable Work and advances it through one
bounded, governed iteration at a time:

`objective → inspect → decide one step → query/action → observe → persist → terminate or schedule`

This is a controller over the existing Work Kernel, Query Plane, Company Graph,
Employee Authority, typed actions, workflows, durable operations, jobs, approvals,
receipts, events, and projections. It is not a second agent framework.

## Audit findings and reuse

| Existing primitive | Reused responsibility | Upgrade 9 addition |
| --- | --- | --- |
| `works`, inputs, planner attempts, events | Durable ownership and causal history | One objective loop belongs to exactly one Work |
| Operational Query Plane | Deterministic canonical reads and query receipts | Mandatory `business_state`, optional `company_context`, and model-selected typed reads per iteration |
| Canonical Company Graph | Exact customer/entity context | Fresh graph context before every decision; bounded message labels make already-completed communication observable |
| Employee Authority | Identity, grants, scope, risk, approval routing | Canonical inspection is authorized; typed action gates and execution are re-authorized |
| Planner/provider routing | Model selection and deadlines | Strict one-step decision schema and persisted per-step provider attempts |
| Gated executor and typed plugins | Consequential actions | Objective step idempotency binding; no direct free-form mutation |
| Workflows and durable operations | Long-running/fan-out execution | Objective waits for their real terminal state instead of assuming success |
| Jobs and scheduler | Restart-safe execution | Immediate/future iteration jobs plus ten-minute recovery scan |
| Approvals | Human authorization | Objective pauses as `awaiting_approval` and resumes the same Work after the action changes |
| Decision receipts and business events | Actual outcome evidence | Next iteration observes receipts, action/operation state, Query Plane state, and graph changes |
| Work Cases / Adaptive Workspace | Live operational projection | Objective, reason, budget, iterations, observations, next step, schedule, owner, and text controls |

## Persistent controller records

- `work_objective_loops`: objective text, exact state, revision, budgets, deadline,
  counters, no-progress count, next run, reason, next step, observation, and lease.
- `work_objective_steps`: one canonical inspection, one bounded decision, authority
  or query/action link, real observation, progress verdict, failure, and exact outcome.
- `work_objective_planner_attempts`: provider, inspection hash, attempt number,
  decision/failure, and timestamps. A provider timeout retries the same unfinished step.
- `domain_actions.objective_step_id`: unique link from one step to one typed action.

Tenant/Work consistency is enforced by RLS and database triggers, including for
connections that can bypass RLS. Controller rows are update/append only for the app
role; deletion is not granted.

## Runtime invariants

1. Work is persisted before an iteration is queued.
2. A 30-second controller lease permits only one decision maker per loop.
3. Scheduled payloads carry objective revision and expected step number. Stale jobs
   return without creating or advancing an iteration.
4. Every model call sees a fresh authority-checked Query Plane/Company Graph
   inspection, not merely prior LLM context.
5. The decision schema permits exactly one of `query`, `action`, `wait`, `complete`,
   `block`, or `fail`.
6. Reads use validated Query Plane intents. Mutations resolve an existing plugin and
   pass through the existing gated executor.
7. The immutable step decision is the action idempotency source. PostgreSQL `jsonb`
   key ordering or plugin payload normalization cannot create a second action.
8. The next decision happens only after canonical action, operation, receipt, and
   business state have been observed.
9. Step/action/query/planner-failure/deadline/no-progress limits terminate boundedly.
   Explicit `continue` creates a new scheduling revision but cannot bypass budgets.
10. Interrupt/redirect rejects objective actions that have not begun execution,
    preventing abandoned approvals from firing later. Completed progress remains.
11. Every finished step has one truthful outcome:
    `continue | awaiting_approval | waiting | blocked | completed | failed`.

## Recovery behavior

- Planner/provider timeout: failure and attempt persist; the same step/inspection is
  reclaimed by the durable job retry until its configured budget is exhausted.
- Worker crash: queue lease recovery retries the job; controller lease expires; the
  expected step prevents accidental advancement.
- Approval: the action remains pending; approval/rejection wakes the same objective;
  the next iteration re-inspects the actual action and receipt.
- Action provider outage: the existing executor performs one bounded retry and
  escalates. Authorization after provider recovery reuses the same action/external
  operation idempotency ledger, so the eventual effect occurs once.
- Future dependency: `waiting` persists `next_run_at`; a scheduled job re-inspects at
  that time. The recovery scan repairs missed enqueues.
- Obsolete next step: a fresh Company Graph/Query Plane observation can cause direct
  completion without creating the previously expected action.

## Operability

- `POST /api/objectives` accepts voice/text/console objectives and optional budgets.
- `GET /api/works/:id/objective` returns the full controller audit.
- `POST /api/works/:id/objective` continues, interrupts, or redirects the same Work.
- The Work surface accepts a text objective and renders intent, ownership, progress,
  observations, why/next/waiting state, controls, actions, approvals, and evidence.
- The existing Vapi `finnor_instruct` path recognizes only explicit objective phrases
  for start/inspect/interrupt/continue/redirect. Ambiguous speech remains an ordinary
  instruction, and unresolved callers cannot control Work.

## Executable proof

`tests/integration/agentic-objective-loop.test.ts` proves:

1. customer lookup → gated follow-up → approval → one real sandbox send → receipt observation → completion;
2. planner timeout and same-step recovery;
3. a model-selected invalid typed query is rejected before execution and recovered as
   a persisted planner failure on the same unfinished step;
4. concurrent worker lease exclusion;
5. a late model result is discarded after a person interrupts the in-flight iteration;
6. action/provider outage, escalation, authorized recovery, and one eventual side effect;
7. suspended-employee authority denial before the planner;
8. cross-tenant reference rejection even with an RLS-bypassing test connection;
9. no-progress and hard step-budget termination;
10. interruption cancels an unexecuted objective action;
11. durable future wait and resume;
12. fresh business state makes an expected follow-up unnecessary;
13. stale revision suppression plus redirect of the same Work;
14. idempotent HTTP intake and inspect/control routes.

`tests/unit/objective-model-json.test.ts` additionally proves that one provider JSON
decision can be recovered from a markdown fence or surrounding prose, while malformed
or multiple decisions remain rejected. The parser does not relax the bounded decision
schema or typed-query/action validation.

Voice grammar, proxy allowlisting, OpenAPI generation, Work projection, authority,
and existing Work APIs have separate unit/integration coverage.

The authenticated browser proof uses the real Work surface and API: create one
persistent objective, inspect its audit, interrupt it, then redirect the same Work.
The objective card renders the objective, owner, budget, iteration, observation,
reason, and next state after every control operation. Evidence is retained at
`evidence/upgrade9-local-work-objective.png`,
`evidence/upgrade9-local-work-interrupted.png`, and
`evidence/upgrade9-local-work-redirected.png` in the repository root.
