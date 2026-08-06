# P3.T3 Discovery — LF-07 Question Focus and clarification return

Date: 2026-08-03
Route scope: `/jarvis` only. `/demo` was not opened or edited.

## Required source read

Read in full before editing:

- `src/components/jarvis/bridge/Thread.tsx`
- `src/components/jarvis/bridge/ThreadBlocks.tsx`
- `src/components/jarvis/bridge/ThreadStack.tsx`
- `src/components/jarvis/bridge/ThreadField.tsx`
- `src/components/jarvis/kernel/instruction.ts`
- `src/components/jarvis/kernel/apply-trace-events.test.ts`
- `src/components/jarvis/kernel/choreography.ts`
- `src/components/jarvis/kernel/trace-metrics.ts`

Source-proven dependencies inspected for this task:

- `src/components/jarvis/bridge/ThreadBridge.tsx` — canonical LIVEFRAME caller and shared canvas surfaces.
- `src/components/jarvis/bridge/CommandRail.tsx` — fixed command dock that must remain reachable while depth is dimmed.
- `src/components/jarvis/kernel/store.tsx` — real clarification state fold and same-thread answer submission.
- `src/components/jarvis/bridge/thread-fixtures.ts` — explicitly labelled `clarify` and `unresolved-reference` fixture data.

## Current facts before the patch

- `deriveLiveFrame()` already projects `clarification_required` / `clarifying` to `mode: "decision", focus: "clarification"`; no new presentation mode is needed.
- `applyTraceEvents()` already folds a real `clarification_required` event into `machine.instructionState: "clarifying"` and stores the payload-derived question, missing fields, and optional context. It does not fabricate a question when the real payload omits it; it uses the existing explicit fallback copy.
- `Thread.tsx` already keeps the plan block as the active block for `clarifying`, but its passive active-block effect can focus the plan section after the clarification component mounts. `ThreadClarify` currently relies on `autoFocus` on the first input and has no explicit question-focus choreography or source/focus data contract.
- `ThreadBridge.tsx` exposes `data-liveframe-focus` on the root and individual surfaces, but the field, presence, setup, workflow, and command-dock surfaces have no shared LF-07 dimming transition. The action spine is the causal focus surface.
- `kernel/choreography.ts` has LF-05/LF-06 helpers but no LF-07 constants or variants.
- `trace-metrics.ts` maps the real `clarification_required` phase to the existing `plan` pixel stage. That is the correct causal stage because the question is rendered inside the active Plan block; no independent synthetic stage exists.
- `store.tsx` answers a clarification with the same thread id and session id, but `runSubmission(existing)` initializes `nodes` and `contextChips` to empty arrays. That clears already observed real plan/context facts during the same-thread return. The new turn must reset trace-gating bookkeeping while carrying the prior real nodes/context into the same document.

## Baseline verification

Command:

```text
npx vitest run src/components/jarvis/kernel/apply-trace-events.test.ts src/components/jarvis/kernel/choreography.test.ts src/components/jarvis/kernel/trace-metrics.test.ts --reporter=dot
```

Result: **3 test files passed, 48 tests passed**.

The worktree was already dirty and user-owned; no reset, checkout, cleanup, commit, or deployment was performed.

