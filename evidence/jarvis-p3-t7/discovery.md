# P3.T7 discovery — refresh/reconnect restore without replayed one-shots

Date: 2026-08-03 (Asia/Kolkata)

Scope is `/jarvis` only. `/demo` was not edited or exercised. The existing
dirty worktree was preserved; no reset, checkout, clean, bulk revert, or
unrelated snapshot update was used.

## Contract read

The full `JARVIS-FRONTEND-MAESTRO-STATE-v4.md` ledger and the full
`JARVIS-FRONTEND-MAESTRO-PLAN-v4.md` were read before this task, including
Plan §§2, §3, §4.2, §4.3, §5.1, and the complete P3 section. The named P3
sources were read in full:

- `src/components/jarvis/bridge/Thread.tsx`
- `src/components/jarvis/bridge/ThreadBlocks.tsx`
- `src/components/jarvis/bridge/ThreadStack.tsx`
- `src/components/jarvis/bridge/ThreadField.tsx`
- `src/components/jarvis/kernel/instruction.ts`
- `src/components/jarvis/kernel/apply-trace-events.test.ts`
- `src/components/jarvis/kernel/choreography.ts`
- `src/components/jarvis/kernel/trace-metrics.ts`

The supporting restore/transport and approval sources were also read in full:

- `src/components/jarvis/kernel/store.tsx`
- `src/components/jarvis/kernel/transport.ts`
- `src/components/jarvis/kernel/instruction-transport.test.ts`
- `src/components/jarvis/kernel/instruction-trace-poll.test.ts`
- `src/components/jarvis/bridge/ApprovalCockpit.tsx`
- `src/components/jarvis/bridge/ThreadBridge.tsx`
- `src/components/jarvis/bridge/ThreadStack.test.ts`
- `e2e/jarvis-p3-refresh-fixtures.spec.ts`

## Source-labelled restore facts

- `kernel/store.tsx` persists the active thread pointer in `sessionStorage` at
  thread birth. The pointer contains the real thread/instruction identity and
  source text; it is not a presentation snapshot or fabricated event list.
- On reload, the store fetches the real instruction and its events from the
  existing instruction/event endpoints, folds them through `applyTraceEvents`,
  clears the pointer only for a terminal instruction, and otherwise resumes
  the existing transport from the last folded sequence.
- `kernel/transport.ts` keeps the existing SSE reconnect path and falls back to
  bounded polling after the existing failure threshold. The focused transport
  tests prove reconnect status and polling resume from the supplied sequence;
  this task did not change that cursor or backend contract.
- Before T7, the remaining remount replay owners were presentation-only:
  ThreadBirth, the ThreadStack camera-pan wrapper, CockpitRise/propose sound,
  blast-radius count/dots, completed execution-step cues, receipt seal, and
  approval-card mount entry. Existing context-chip and plan-node/edge logic
  already seeded initial keys as settled.

## T7 change boundary

The fix adds a presentation-only `threadRestored` marker derived from the
real restored thread identity and current instruction state. A restored
snapshot renders already-reached blocks, cockpit/receipt/count/step one-shots,
and the ThreadStack wrapper in settled variants; it does not replay mount-time
motion or propose sound. A fresh submission remains `restored=false` and keeps
the existing entry/cue behavior. When a restored instruction advances to a new
real state, the derived marker stops applying so newly reached state edges can
animate normally.

No Thread state shape, event fold, transport cursor, action ID, receipt lookup,
truth/data-source label, or backend behavior was changed. The fixture harness
passes the same marker through the real `ThreadBody`/`ThreadStack` tree and is
explicitly labelled fixture support, not live tenant proof.

## Baseline and browser boundary

Before editing, the focused baseline passed 4 files / 61 tests and
`git diff --check` passed. The mandated Codex in-app Browser bootstrap was
attempted after reading the browser skill and returned the exact runtime error
`Cannot redefine property: process`. The Playwright fallback therefore remains
the labelled local fixture path documented in the verification artifact; it is
not authenticated/live browser evidence.
