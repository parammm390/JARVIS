# P3.T6 discovery — thread history as a collapsed audit trail

Date: 2026-08-03 (Asia/Kolkata)

Scope is `/jarvis` only. `/demo` was not edited or exercised. The existing dirty
worktree was preserved; no reset, checkout, clean, or unrelated snapshot update
was used.

## Contract read

The full `JARVIS-FRONTEND-MAESTRO-STATE-v4.md` ledger and the full
`JARVIS-FRONTEND-MAESTRO-PLAN-v4.md` were read before this task, including Plan
§2, §3, §4.2, §4.3, §5.1, and the complete P3 section. The named P3 sources were
read in full:

- `src/components/jarvis/bridge/Thread.tsx`
- `src/components/jarvis/bridge/ThreadBlocks.tsx`
- `src/components/jarvis/bridge/ThreadStack.tsx`
- `src/components/jarvis/bridge/ThreadField.tsx`
- `src/components/jarvis/kernel/instruction.ts`
- `src/components/jarvis/kernel/apply-trace-events.test.ts`
- `src/components/jarvis/kernel/choreography.ts`
- `src/components/jarvis/kernel/trace-metrics.ts`

The supporting history owner, panel, fixture, and test sources were also read:

- `src/components/jarvis/kernel/store.tsx`
- `src/components/jarvis/bridge/RecentThreadsPanel.tsx`
- `src/components/jarvis/bridge/thread-fixtures.ts`
- `src/components/jarvis/bridge/ThreadStack.test.ts`
- `e2e/jarvis-p5-thread-stacking-fixtures.spec.ts`
- `src/components/jarvis/ui/motion/choreo.ts`
- `src/components/jarvis/jarvis-theme.css`

## Source-labelled facts

- `KernelState.threadHistory` is a real snapshot list owned by `kernel/store.tsx`.
  It is newest-superseded-first; each entry was the active thread when a new
  top-level instruction superseded it, and it is not a live reference.
- The store caps history at the source-defined `THREAD_HISTORY_CAP` of 50;
  the active thread is not capped.
- `RecentThreadsPanel.tsx` uses the stable `threadRowElementId()` contract to
  scroll to and focus the real row; T6 therefore preserved `thread-row-${id}`.
- Before T6, `ThreadStack.tsx` rendered each history snapshot as a full
  `j-panel` button with a rounded border, fixed `h-10` height, and a
  `max-w-[720px]`/`space-y-2` wrapper. That made history visually compete with
  the active Thread surface.
- Historical expansion already reused the real `Thread` component and supplied
  no-op callbacks because a superseded snapshot is read-only. T6 preserved that
  data and callback contract.
- The labelled `receipt` fixture supplies three real history snapshots with
  honest outcomes: `completed` → `Done`, `failed` → `Failed`, and `cancelled` →
  `Cancelled`. No timestamps, persistence, or backend completion facts were
  added.

## T6 change boundary

Only the history presentation and its labelled evidence were changed:

- `ThreadStack.tsx` now exposes a `Thread history` section with the real count,
  transparent rail-aligned rows, stable row IDs, `aria-expanded` keyboard
  access, and an explicit read-only expanded-detail label.
- History rows no longer use `.j-panel`, border-card styling, or a competing
  elevated surface. The active Thread, kernel history ownership, order,
  instruction text, outcome mapping, and historical no-op callbacks are
  unchanged.
- `jarvis-theme.css` adds only the T6 history rail/row/detail treatment and a
  mobile rule that removes the nonessential visible `View details` affordance;
  the row remains a keyboard-accessible button and retains its outcome text.
- `e2e/jarvis-p3-history-fixtures.spec.ts` is explicitly labelled fixture
  evidence. It does not claim live tenant/authentication/backend data.

## Browser boundary discovered during T6

- The required Codex in-app Browser bootstrap was attempted after reading the
  browser skill and returned the exact runtime error: `Cannot redefine property:
  process`.
- The configured Playwright run against `localhost:3000` reached the dev server
  but the fixture navigation ended with the exact `page.goto: net::ERR_ABORTED;
  maybe frame was detached?` result after the test timeout.
- A manually started `127.0.0.1:3000` dev server returned HTTP 200 and HTML for
  both `/jarvis/next?fixture=receipt` and `/jarvis/next`. The final browser run
  used that verified base URL and did not change application source.
- The unauthenticated `receipt` fixture makes real receipt presentation requests
  to `/api/jarvis/receipts?domainActionId=fixture-node-*`, which return 401 in
  this auth-less environment. The final evidence test records and constrains
  those known fixture-boundary responses; unexpected browser/page errors still
  fail the test.
