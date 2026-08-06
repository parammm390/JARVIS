# P4.T2 discovery — authoritative decision and linked-run boundaries

## Source facts

- `ApprovalCockpit.tsx` owns the decision POST for `actions/:id/{confirm,reject,escalate}`.
- `data-core.ts` exposes `recordDecision(verb, actionId?)`; the canonical caller now invokes it only after the decision POST resolves.
- `pulse-bus.ts` carries the existing `action-decided` event; it does not create transport or workflow state.
- `WorkflowTheater.tsx` receives the instruction's `actionIds` and derives linked runs only through `workflow_steps.domainActionId`.
- No source path authorizes a run merely because an approval was clicked. LF-10 therefore waits for a newly observed scoped run.

## Release/runtime boundary

No authenticated current-worktree decision response or linked real workflow run was available for this task. No approval was clicked, no production action was submitted, and no deployment was performed.
