# P3.T6 verification — thread history as a collapsed audit trail

Date: 2026-08-03 (Asia/Kolkata)

## Focused regression

Baseline before the T6 edit:

```text
npx vitest run src/components/jarvis/bridge/ThreadStack.test.ts src/components/jarvis/kernel/choreography.test.ts src/components/jarvis/kernel/apply-trace-events.test.ts src/components/jarvis/kernel/active-thread-pointer.test.ts --reporter=dot
```

Result: 4 test files passed; 61 tests passed.

After the T6 implementation, the same focused command passed again:

```text
Test Files  4 passed (4)
Tests       61 passed (61)
```

## Static checks

- `npx tsc --noEmit` — exit 0.
- `npx eslint src/components/jarvis/bridge/ThreadStack.tsx e2e/jarvis-p3-history-fixtures.spec.ts` — exit 0.
- `git diff --check` — exit 0.

## Labelled browser evidence

Final command, using the manually verified local server binding:

```text
PLAYWRIGHT_BASE_URL=http://127.0.0.1:3000 npx playwright test e2e/jarvis-p3-history-fixtures.spec.ts --project=desktop-chromium --workers=1
```

Result:

```text
Running 3 tests using 1 worker
3 passed (3.5s)
```

The three passing checks cover:

- 1440px: three real history snapshots are collapsed, transparent, and free of
  `.j-panel`; the real `Done` row retains its instruction and outcome, receives
  focus, opens with Enter, and collapses again.
- 390px: the same real rows and keyboard detail behavior remain present without
  horizontal overflow assertions being invented.
- 390px with reduced motion: the same three collapsed rows remain present and
  free of `.j-panel`.

The test also inspects the browser response stream. The only 401 responses are
the source-labelled unauthenticated receipt requests matching
`/api/jarvis/receipts?domainActionId=fixture-node-*`; no unexpected console or
page errors were observed. This is fixture evidence, not a live tenant or
backend transition claim.

Generated and visually inspected artifacts:

- [`history-audit-trail-receipt-1440.png`](/Users/paramdave/FINNOR/qa-screenshots/v3-P3/history-audit-trail-receipt-1440.png)
- [`history-audit-trail-receipt-390.png`](/Users/paramdave/FINNOR/qa-screenshots/v3-P3/history-audit-trail-receipt-390.png)
- [`history-audit-trail-receipt-390-reduced.png`](/Users/paramdave/FINNOR/qa-screenshots/v3-P3/history-audit-trail-receipt-390-reduced.png)

The inspected screenshots show the active receipt document above a compact
rail-aligned history section with three borderless rows. The rows retain the
honest labels `Done`, `Failed`, and `Cancelled`; no competing history tile
surface is visible.

## Evidence limits

No claim is made here about live authenticated tenant data, backend state
transitions, refresh persistence, layout-shift metrics, event-to-pixel timing,
or the P3 phase exit gate. Those remain tracked by the state ledger's P3 exit
gate and later tasks.
