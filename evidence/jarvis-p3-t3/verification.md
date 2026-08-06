# P3.T3 Verification — LF-07 Question Focus and clarification return

Date: 2026-08-03
Scope: `/jarvis` only; `/demo` untouched.

## Source and behavior evidence

- `kernel/choreography.ts` now owns LF-07's explicit `220 ms`, `0.42`, and `8 px` values. Full motion dims non-spine depth and settles the question upward; reduced motion reaches the same end state with zero duration.
- `ThreadBlocks.tsx` renders the real `thread.clarification` question, labels its input relationship with `aria-describedby`, focuses the first clarification input only when no interactive control is already in use, and scrolls the question into the nearest visible position.
- `Thread.tsx` leaves the Plan block active for `clarifying`, avoids replacing a user-controlled focus with the passive block anchor, and marks the clarification answer as a same-thread return leg.
- `ThreadBridge.tsx` applies one LIVEFRAME-driven depth transition to the non-spine canvas surfaces. The action spine remains the full-emphasis causal surface; dimmed controls remain mounted and reachable.
- `kernel/store.tsx` carries already observed real plan nodes and source-labelled context into the same-thread continuation while resetting the new turn's trace-gating counters. `applyTraceEvents()` remains the source of the real `clarification_required` state.
- `trace-metrics.ts` continues to map `clarification_required` to the existing Plan pixel stage; the added test records that this is the causal event-to-pixel mapping, not a synthetic question stage.

Discovery artifact: [`discovery.md`](/Users/paramdave/FINNOR/evidence/jarvis-p3-t3/discovery.md)

## Deterministic verification

1. Focused LF-07/source tests:

```text
npx vitest run src/components/jarvis/kernel/apply-trace-events.test.ts src/components/jarvis/kernel/choreography.test.ts src/components/jarvis/kernel/trace-metrics.test.ts --reporter=dot
```

Result: **3 files passed, 51 tests passed**.

2. Kernel suite:

```text
npx vitest run src/components/jarvis/kernel --reporter=dot
```

Result: **17 files passed, 289 tests passed**.

3. TypeScript, focused ESLint, and whitespace checks all exited 0:

```text
npx tsc --noEmit --pretty false
npx eslint src/components/jarvis/bridge/Thread.tsx src/components/jarvis/bridge/ThreadBlocks.tsx src/components/jarvis/bridge/ThreadBridge.tsx src/components/jarvis/kernel/choreography.ts src/components/jarvis/kernel/choreography.test.ts src/components/jarvis/kernel/apply-trace-events.test.ts src/components/jarvis/kernel/trace-metrics.test.ts src/components/jarvis/kernel/store.tsx e2e/jarvis-p3-clarification-fixtures.spec.ts
git diff --check
```

4. The labelled Playwright file parses and discovers all **3** intended tests with `--list`.

5. Additional bounded runner attempts were recorded but did not yield a test verdict:

```text
npm run test:unit -- --reporter=dot
```

The runner remained at its initial `RUN` output after approximately three minutes and was stopped; no pass/fail count was produced.

```text
npx vitest run src/components/jarvis/bridge src/components/jarvis/lib --reporter=dot
```

The runner emitted progress dots but stalled after approximately 1 minute 13 seconds and was stopped; no pass/fail count was produced. These attempts do not replace the passing kernel-suite and focused results above.

## Browser/evidence boundary

- Required in-app browser bootstrap was attempted after reading the browser skill. It failed with the exact runtime error: `Cannot redefine property: process`.
- The labelled Playwright execution was attempted at the required 1440 and 390 CSS viewports. The repository webServer did not become usable; the run ended with `Error: Timed out waiting 120000ms from config.webServer.` Direct requests observed port 3000 eventually listening but returned no route response before the bounded request timeout, so no screenshot, DOM, keyboard transcript, console log, layout-shift trace, or reduced-motion browser recording was produced by this task.
- A generated `.next/cache/webpack` directory was temporarily moved to `/tmp/finnor-next-cache-iOXx0f/webpack` while diagnosing the server startup loop and restored to its original path. No source, user data, or tracked worktree changes were removed.
- The source-labelled fixture test is [`jarvis-p3-clarification-fixtures.spec.ts`](/Users/paramdave/FINNOR/e2e/jarvis-p3-clarification-fixtures.spec.ts:1). Its assertions are bounded to the explicitly labelled `fixture=clarify` component tree and do not claim live tenant/authentication/event data.

## Open evidence

Authenticated/live runtime proof remains open: canonical live state edges,
transition layout-shift measurement, event-to-pixel timings, and performance
budgets were not claimed. The labelled focus fixture is covered by the
follow-up below. P1/P2 gates remain open; the P3 audit remains below its score
threshold and the score remains 10/100.

## Follow-up fixture regression after P3.T7

During the P3 fixture coverage pass on 2026-08-03, the existing clarification
fixture initially failed its 390px and 390px reduced-motion `toBeFocused()`
assertions (19/21 labelled P3 fixtures passed). Source inspection found a real
focus race in `Thread.tsx`: the parent Thread handoff captured
`document.activeElement` before its deferred animation-frame callback, so it
could reclaim focus after `ThreadClarify` had focused the first input.

The narrow fix re-reads the live focus owner inside the animation-frame callback
before handing focus to the block anchor. It preserves the existing
clarification and Command Dock focus guards and does not change Thread state,
data, or backend behavior.

The focused bridge/kernel regression passed **2 files / 32 tests**; TypeScript
and `npx eslint src/components/jarvis/bridge/Thread.tsx` exited 0. The focused
clarification fixture then passed **3/3** at 1440px, 390px, and 390px reduced
motion. The complete labelled P3 fixture set passed **21/21** using the verified
local server:

```text
PLAYWRIGHT_BASE_URL=http://127.0.0.1:3000 npx playwright test e2e/jarvis-p3-clarification-fixtures.spec.ts e2e/jarvis-p3-continuity-fixtures.spec.ts e2e/jarvis-p3-history-fixtures.spec.ts e2e/jarvis-p3-plan-fixtures.spec.ts e2e/jarvis-p3-refresh-fixtures.spec.ts e2e/jarvis-p3-spine-fixtures.spec.ts e2e/jarvis-p3-understood-fixtures.spec.ts --project=desktop-chromium --workers=1
```

Result: **21 passed (22.4s)**. This is labelled shared-component runtime
evidence; it does not claim authenticated/live tenant state edges or backend
transition timing.
