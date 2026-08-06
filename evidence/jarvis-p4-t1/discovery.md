# P4.T1 discovery — active workflow scope

Date: 2026-08-03 (Asia/Kolkata)
Route scope: `/jarvis` only.

## Observed source contract

- `src/components/jarvis/bridge/ThreadBlocks.tsx:38` loads `WorkflowTheater` only for the execution/receipt part of the Thread.
- `src/components/jarvis/bridge/ThreadBlocks.tsx:620-630` derives `actionIds` from the current `thread.nodes` and filters workflow runs with `runsForActionIds`.
- `src/components/jarvis/kernel/execution-presentation.ts` excludes any run whose `workflow_steps.domainActionId` is not one of those action IDs and keeps the freshest snapshot for duplicate run IDs.
- Before this task, `src/components/jarvis/panels/WorkflowTheater.tsx` had an optional `actionIds` prop and an unscoped fallback that rendered `BLUEPRINTS` or timer-driven `ReplayTheater` content.
- Legacy non-canonical callers were `src/components/jarvis/bridge/Bridge.tsx` and `src/components/jarvis/JarvisCommandCenter.tsx`; they now pass an explicit empty scope and receive the truthful empty state.

## Source-to-runtime mapping currently available

`instructionId → Thread.nodes[].id/domain action ID → workflow_steps.domainActionId → workflow run/step` is available in source. The frontend run response still does not expose `commandId`, so no command-to-run identifier claim is made here. Receipt lookup remains on demand by `workflowStepId`.

## Boundary result

The active renderer must receive `actionIds`. An empty array is treated as an explicit no-linked-workflow state; it is not treated as permission to inspect tenant-wide runs, blueprint circuits, or replay history.

## Evidence limitation

No authenticated production workflow was clicked or submitted in this task. A browser DOM assertion at 1440/768/390 is still required for the Phase 4 evidence bundle; this discovery artifact does not claim that runtime proof.
