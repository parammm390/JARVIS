# P3.T5 Discovery — one causal spine visual treatment

Date: 2026-08-03 (Asia/Kolkata)
Scope: `/jarvis` only. `/demo` was not inspected or changed.

## Contract read before implementation

- `JARVIS-FRONTEND-MAESTRO-PLAN-v4.md`: §2.2, §2.4, §2.5, §4.1, §4.2, §4.3, §5.1, and the complete P3 section.
- `JARVIS-FRONTEND-MAESTRO-STATE-v4.md`: complete current ledger before this task.
- Named P3 source files read in full: `src/components/jarvis/bridge/Thread.tsx`, `ThreadBlocks.tsx`, `ThreadStack.tsx`, `ThreadField.tsx`, `src/components/jarvis/kernel/instruction.ts`, `apply-trace-events.test.ts`, `choreography.ts`, and `trace-metrics.ts`.
- Supporting composition seam inspected: `src/components/jarvis/bridge/ThreadBridge.tsx` and `src/components/jarvis/jarvis-theme.css`.

## Current source-backed findings

1. `ThreadBridge.tsx` already owns one `jarvis-action-spine` section and renders the real `ThreadStack` inside it. No second action-spine surface is required for T5.
2. `Thread.tsx` currently renders every reached `BlockShell` as a separate outer `motion.section` with `rounded-xl`, `border`, and either `j-panel` or `j-panel-hot`. This is the repetitive bordered card assembly targeted by P3.T5.
3. `Thread.tsx` already preserves the causal blocks in `BLOCK_ORDER` (`heard`, `understood`, `plan`, `execution`, `receipt`), keeps reached bodies mounted, exposes `data-thread-block`, `data-thread-block-active`, and `data-thread-block-collapsed`, and guards the active block from collapsing. T5 must retain these state, focus, and data contracts.
4. `ThreadStack.tsx` renders older threads as 40px collapsed `j-panel` rows. P3.T6 explicitly owns changing those rows into a deliberate collapsed audit trail, so T5 leaves the history treatment unchanged.
5. `ThreadBlocks.tsx` contains source-backed inner surfaces: context chips/signals, plan dependency edges and action nodes, clarification controls, approval cockpit content, execution content, and receipt content. T5 changes only the outer Thread block treatment; these inner workflow and evidence surfaces remain.
6. `ThreadField.tsx`, `instruction.ts`, `apply-trace-events.test.ts`, `choreography.ts`, and `trace-metrics.ts` contain the real field, lifecycle, motion, and event-to-pixel contracts. No T5 change is justified in those files.

## Baseline verification

Focused baseline command:

```text
npx vitest run src/components/jarvis/kernel/choreography.test.ts src/components/jarvis/kernel/apply-trace-events.test.ts src/components/jarvis/bridge/ThreadStack.test.ts src/components/jarvis/kernel/active-thread-pointer.test.ts --reporter=dot
```

Result: 4 test files passed; 61 tests passed; Vitest v4.1.10; duration 698ms.

## Runtime discovery boundary

No browser/runtime claim is made by this source discovery. Runtime evidence, reduced-motion comparison, focus/keyboard transcript, and layout measurements are recorded only if the bounded browser verification produces observable output. An unavailable dev server or browser bootstrap is recorded as an exact limitation rather than inferred away.

