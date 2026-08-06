# P3.T2 Discovery — LF-06 Plan Draw

Date: 2026-08-03

## Governing contract

- Plan v4 §4.2 LF-06 is triggered by a real plan/action node. The edge draws for 240 ms, the node resolves for 160 ms, no placeholder node is allowed, and reduced motion shows the complete node with its changed border.
- Plan v4 §5.1 requires the Plan to remain causally attached to the current instruction. Action IDs are the correlation boundary; tenant-wide blueprint/replay content must not appear on the active path.
- Plan v4 §0.6 forbids timer theatre and requires real facts to move pixels. A batch of real nodes must not be visually staged as if separate events arrived.

## Current source facts

- `finnor-os/packages/orchestration/src/planner.ts` validates dependency indexes against earlier planner actions and persists the resulting sibling action IDs as `dependsOn` in `domain_actions`.
- `finnor-os/packages/db/schema.ts` defines `domain_actions.dependsOn` as a tenant-scoped UUID array with a real empty-array default. The API action route returns the orchestrator's planned rows directly.
- `finnor-os/packages/orchestration/src/index.ts` emits each real `action_created` trace row with `actionId` and `actionType`, but does not currently include `dependsOn` in that trace payload. The full POST response is therefore the existing source for the dependency array.
- `src/components/jarvis/kernel/instruction.ts`'s `PlannedActionResponse` did not expose `dependsOn`, and `src/components/jarvis/kernel/store.tsx`'s `ThreadNode` did not retain it. `ThreadPlan` rendered one generic bordered row per `thread.nodes` item using the older 340 ms M5 helper and an 80 ms index stagger; it had no dependency-edge surface and no initial/restore one-shot guard.
- `src/components/jarvis/kernel/store.tsx` already appends only real `action_created` nodes and enriches them from the same POST response. The P3.T2 patch will retain that flow, add the real optional dependency fact, and render only endpoints present in `thread.nodes`.

## Truth boundary

- A dependency is displayed only when the real planned response supplies a string ID and both the source and target action nodes are present. Missing/unknown dependency facts produce no edge and no placeholder.
- Initial/refresh-restored nodes and edges are treated as settled. Only IDs newly observed by the mounted plan component receive the LF-06 one-shot variants. Nodes arriving in one React trace batch share the same start time; there is no per-index delay that pretends the batch streamed separately.

## Baseline

Focused baseline command:

```text
npx vitest run src/components/jarvis/kernel/apply-trace-events.test.ts src/components/jarvis/kernel/choreography.test.ts src/components/jarvis/kernel/trace-metrics.test.ts --reporter=dot
```

Result: **3 files passed, 45 tests passed**.
