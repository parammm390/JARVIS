# P3.T4 Verification — LF-18 Thread transition continuity

Date: 2026-08-03
Scope: `/jarvis` only; `/demo` untouched.

## Implemented source contract

- `choreography.ts` now owns LF-18's explicit **320 ms** FLIP/layout cadence,
  which is inside Plan v4's 260–380 ms range; reduced motion uses duration 0.
- `Thread.tsx` keeps reached block sections and bodies mounted, marks the body
  collapse state, and guards the active block's toggle so the active causal
  block cannot collapse. The transition effect retries after a newly reached
  block is mounted, scrolls that real block into view, and hands focus over only
  when a collapsing body would hide the current focus. Command Dock focus and
  clarification-control focus remain owned by the person.
- `ThreadBlocks.tsx` applies the same collapsing-body focus check to the real
  clarification question/input path. No kernel state, backend route, approval
  authority, workflow data, or `/demo` surface changed for T4.

## Deterministic verification

1. Baseline before editing:

```text
npx vitest run src/components/jarvis/kernel/choreography.test.ts src/components/jarvis/kernel/apply-trace-events.test.ts src/components/jarvis/bridge/ThreadStack.test.ts src/components/jarvis/kernel/active-thread-pointer.test.ts --reporter=dot
```

Result: **4 files passed, 56 tests passed** in 43.46 seconds.

2. Focused T4/source verification:

```text
npx vitest run src/components/jarvis/kernel/choreography.test.ts src/components/jarvis/kernel/apply-trace-events.test.ts src/components/jarvis/bridge/ThreadStack.test.ts src/components/jarvis/kernel/active-thread-pointer.test.ts --reporter=dot
```

Result: **4 files passed, 61 tests passed**.

3. Kernel regression suite:

```text
npx vitest run src/components/jarvis/kernel --reporter=dot
```

Result: **17 files passed, 291 tests passed**.

4. `npx tsc --noEmit --pretty false`, the named-source ESLint command, and
`git diff --check` all exited **0** with no output/errors. The React review
checked hook dependency boundaries, mounted-body accessibility markers,
command/clarification focus preservation, and component extraction; no new
dependency or nested component was introduced.

5. The labelled Playwright file parsed and discovered all **3** intended tests:

```text
CI=1 npx playwright test e2e/jarvis-p3-continuity-fixtures.spec.ts --project=desktop-chromium --list
```

## Browser/runtime boundary

- The mandated in-app browser bootstrap was attempted after reading the browser
  skill and failed with the exact runtime error: `Cannot redefine property: process`.
- The bounded `npm run dev` attempt printed Next.js 14.2.5 and
  `http://localhost:3000`, but never became responsive. A direct request to
  `/jarvis/next?fixture=plan` was first issued unquoted and zsh rejected that
  command with `zsh:1: no matches found`; the same URL was then quoted and the
  request timed out after 5 seconds with zero bytes. That explicit process was
  stopped.
- The required labelled Playwright execution then ended with the exact harness
  result: `Error: Timed out waiting 120000ms from config.webServer.` The only
  webServer output was the existing `NO_COLOR`/`FORCE_COLOR` warning. No T4
  screenshot, DOM assertion, keyboard/focus transcript, layout-shift trace, or
  reduced-motion browser artifact was produced.
- A bounded `npm run build` attempt reached `Creating an optimized production
  build ...` and produced no further output for more than three minutes; it was
  stopped without a build completion verdict. No source or user worktree data
  was removed, and no stale next/playwright/vitest process remained afterward.

## Evidence status

The T4 source and deterministic contracts are verified; the labelled fixture is
available at [`jarvis-p3-continuity-fixtures.spec.ts`](/Users/paramdave/FINNOR/e2e/jarvis-p3-continuity-fixtures.spec.ts:1), but its browser assertions could not execute in this runtime. Authenticated/live state-edge recordings, 1440/390 DOM/focus/scroll evidence, CLS/layout-shift measurement, reduced-motion browser comparison, and event→pixel performance evidence remain open. P1/P2 gates remain open; P3 exit gate remains 0/7 and the score remains 10/100.
