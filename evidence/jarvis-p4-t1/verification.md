# P4.T1 verification — action-ID scope

Date: 2026-08-03

## Changes

- Made `WorkflowTheater` accept mandatory `actionIds`.
- Removed `BLUEPRINTS`, `ReplayRow`, `ReplayTheater`, replay mode, and blueprint edge/node rendering from the active theater source.
- Added explicit `empty`, `waiting`, `trace`, `live`, and `settled` scoped postures through `scopedExecutionMode`.
- Added `data-workflow-scope="action-ids"`, action-ID diagnostics, and `data-testid="workflow-scope-required"` for an empty scope.
- Added unit coverage for empty scope, no-run trace outcomes, waiting outcomes, and six linked lanes.

## Commands and results

```text
npx vitest run src/components/jarvis/kernel/execution-presentation.test.ts src/components/jarvis/kernel/workflow-presentation.test.ts src/components/jarvis/lib/data-core.transition.test.ts --reporter=dot
3 test files passed · 13 tests passed
```

The source search after the change found no `BLUEPRINTS`, `ReplayTheater`, `mode === "replay"`, or `mode === "blueprint"` references in `src/components/jarvis/panels/WorkflowTheater.tsx`.

Bounded labelled local fixture fallback (after the required in-app Browser bootstrap failed): at 1440×1000 no Weave mounted because no linked run existed; at 768×1024 and 390×844 the action-ID-scoped theater rendered its explicit waiting state for six fixture action IDs. All three widths had no blueprint/replay text, no page overflow, and zero `pageerror` events. This is fixture support only, not authenticated/live workflow evidence.

## Deviation / open evidence

The required authenticated visual DOM assertion has not been produced because the available browser/runtime session is not an authenticated current-worktree workflow surface. No blueprint/replay runtime claim is made until that assertion is captured.
