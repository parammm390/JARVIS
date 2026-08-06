# P3.T4 Discovery — LF-18 Thread transition continuity

Date: 2026-08-03
Scope: `/jarvis` only; `/demo` untouched.

## Required source read

Read in full before editing: `bridge/Thread.tsx`, `bridge/ThreadBlocks.tsx`,
`bridge/ThreadStack.tsx`, `bridge/ThreadField.tsx`, `kernel/instruction.ts`,
`kernel/apply-trace-events.test.ts`, `kernel/choreography.ts`, and
`kernel/trace-metrics.ts`. The matching Plan v4 sections §2, §3, §4.2, §4.3,
§5.1, and the complete Phase 3 contract were also read.

## Source-backed transition facts

- `Thread.tsx` is the canonical causal document. Its `seenBlocks` set keeps
  reached blocks in the DOM, `BlockShell` keeps each body mounted while the
  body height/opacity changes, and `activeBlock()` makes the current causal
  block expanded. The existing active-block focus effect scrolls to the new
  block, but it skips focus whenever *any* interactive element is focused; that
  can leave focus inside a body that is being collapsed.
- The existing `threadLayoutTransition()` derives its duration from M2
  `ThreadBirth` (420 ms). LF-18 requires a FLIP/layout transition in the
  260–380 ms range, so the current shared transition is outside the LF-18
  contract even though the body is mounted.
- `ThreadBlocks.tsx` owns real controls inside the mounted bodies: clarification
  inputs and Answer/Skip/Cancel, cancel/retry actions, approval/workflow content,
  and receipt links. The clarification focus path is a separate real-decision
  exception: it preserves a user-controlled interactive focus rather than
  moving the passive plan anchor.
- `ThreadStack.tsx` keeps the active thread and history in one keyed layout
  wrapper. Historical threads are collapsed rows and re-expand through the same
  `Thread` implementation; its key-based `AnimatePresence` transition must not
  be used to invent a second block lifecycle.
- `ThreadField.tsx` is a fixed, pointer-inert field and has no Thread block
  lifecycle ownership. `instruction.ts` and `applyTraceEvents.test.ts` prove
  the real event/state facts (including clarification and action nodes); they
  do not authorize synthetic transition events. `trace-metrics.ts` measures the
  next painted real stage and is not a layout-transition timer.

## Baseline

Command:

```text
npx vitest run src/components/jarvis/kernel/choreography.test.ts src/components/jarvis/kernel/apply-trace-events.test.ts src/components/jarvis/bridge/ThreadStack.test.ts src/components/jarvis/kernel/active-thread-pointer.test.ts --reporter=dot
```

Result: **4 test files passed, 56 tests passed** in 43.46 seconds.

## T4 implementation boundary

Only the existing Thread transition seams and their pure choreography tests are
in scope. The patch must keep completed/reached block DOM mounted, make the
active block non-collapsible, move focus only when the current focused element
would otherwise become hidden, preserve command-rail/question control focus,
keep the real active block in view, and settle instantly under reduced motion.
No kernel state, backend route, approval authority, workflow data, or `/demo`
surface is to change.
