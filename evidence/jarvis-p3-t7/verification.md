# P3.T7 verification — refresh/reconnect restore without replayed one-shots

Date: 2026-08-03 (Asia/Kolkata)

## Focused regression

Command:

```text
npx vitest run src/components/jarvis/kernel/choreography.test.ts src/components/jarvis/bridge/ThreadStack.test.ts src/components/jarvis/kernel/apply-trace-events.test.ts src/components/jarvis/kernel/active-thread-pointer.test.ts src/components/jarvis/kernel/instruction-transport.test.ts src/components/jarvis/kernel/instruction-trace-poll.test.ts --reporter=dot
```

Result: **6 test files passed; 88 tests passed.** The added choreography tests
assert that restored ThreadBirth, CockpitRise, receipt-seal, and blast-radius
dot variants begin at their settled visual state with zero-duration transition,
while fresh variants retain a distinct entering state. The restore/transport
tests continue to cover pointer folding, reconnect status, polling fallback,
and cursor resume behavior.

## Full and static checks

- `npm run test:unit` — **34 test files passed; 396 tests passed**.
- `npx tsc --noEmit --pretty false` — **exit 0**.
- Scoped `npx eslint` over the T7 bridge/kernel/test files — **exit 0**.
- `git diff --check` — **exit 0**.
- The React review covered stable hook dependencies, derived presentation
  state, remount behavior, accessibility/focus preservation, and no new
  render-time network or global-listener work; the scoped ESLint and TypeScript
  checks were clean.

## Labelled refresh fixture evidence

The fixture test is explicitly labelled support for the shared `/jarvis`
component tree. It uses `?fixture=receipt&restore=1`; it does not claim an
authenticated session, a live instruction, or a backend reconnect.

Command, using a manually verified local dev server:

```text
PLAYWRIGHT_BASE_URL=http://127.0.0.1:3000 npx playwright test e2e/jarvis-p3-refresh-fixtures.spec.ts --project=desktop-chromium --workers=1
```

Result: **3 passed (8.8s)**.

The before/reload/after semantic spatial signatures matched exactly in each
viewport. The captured values were:

| Fixture | Scroll height / width | Active block | Block entry state | Receipt motion | Scoped running animations | Layout shift | History rows |
|---|---:|---|---|---:|---:|---:|---:|
| 1440 | 1171 / 1440 | receipt | all reached blocks `settled` | settled | 0 | 0 | 3 |
| 390 | 1401 / 390 | receipt | all reached blocks `settled` | settled | 0 | 0 | 3 |
| 390 reduced motion | 1401 / 390 | receipt | all reached blocks `settled` | settled | 0 | 0 | 3 |

In each capture, the earlier Heard/Understood/Plan/Execution blocks remained
collapsed, the active Receipt remained expanded, and the receipt text plus six
honest fixture outcome rows remained present. After reload, the
`data-thread-restored` and `data-thread-stack-restored` markers were true and
the spatial signature was unchanged. The scoped receipt-motion animation list
was empty after settling. There was no horizontal overflow. Focusing the
Receipt heading and pressing Enter kept the active Receipt expanded and kept
focus on the same receipt control.

The test records the expected unauthenticated fixture receipt requests. The
only observed 401 URLs matched
`/api/jarvis/receipts?domainActionId=fixture-node-\d+`; no unexpected page or
console errors were accepted.

Screenshots, visually inspected after the run:

- [`refresh-1440-before.png`](/Users/paramdave/FINNOR/qa-screenshots/v3-P3/refresh-1440-before.png)
- [`refresh-1440-after.png`](/Users/paramdave/FINNOR/qa-screenshots/v3-P3/refresh-1440-after.png)
- [`refresh-390-before.png`](/Users/paramdave/FINNOR/qa-screenshots/v3-P3/refresh-390-before.png)
- [`refresh-390-after.png`](/Users/paramdave/FINNOR/qa-screenshots/v3-P3/refresh-390-after.png)
- [`refresh-390-reduced-after.png`](/Users/paramdave/FINNOR/qa-screenshots/v3-P3/refresh-390-reduced-after.png)

Visual inspection was scoped to the Thread document and history rail. A late
loaded ambient orb differed between one desktop before/after capture, and the
existing fixture label overlaps the setup rail at 390 px; neither is a Thread
restore/spatial-state assertion and neither was used to claim whole-canvas
pixel identity.

## Reconnect evidence and limits

The focused `instruction-transport.test.ts` path proves the existing behavior
where a first stream failure reports reconnecting and a later failure starts
polling from the retained sequence (the test fixture uses sequence 5). The
focused `instruction-trace-poll.test.ts` path proves transient failure recovery
and the bounded unavailable result. This is deterministic transport evidence,
not a live authenticated reconnect recording.

The mandated in-app Browser bootstrap failed with `Cannot redefine property:
process`. No authenticated/live tenant refresh, live event-to-pixel recording,
or real backend reconnect was available in this environment. The fixture does
provide a runtime layout-shift measurement, which was 0 in all three captures;
it does not close the P3 lifecycle-edge or event-to-pixel exit gates. The P3
score remains the ledger's evidence-backed 10/100, and no phase completion is
claimed by this task.

## Follow-up P3 fixture coverage

The first complete labelled P3 fixture pass exposed a separate mobile
clarification focus race: 19/21 passed and both 390px clarification checks
failed because the Thread parent used a pre-frame focus snapshot. A narrow
`Thread.tsx` fix re-reads the active element inside the deferred handoff frame;
the clarification fixture then passed **3/3** at 1440px, 390px, and reduced
motion.

The complete labelled P3 fixture set subsequently passed **21/21 (22.4s)**,
including continuity, plan, history, refresh, causal-spine, understood, and
clarification fixtures. This additional run supports the active-block keyboard
gate at representative labelled states, but it remains shared-component
fixture evidence rather than authenticated/live tenant lifecycle proof.
