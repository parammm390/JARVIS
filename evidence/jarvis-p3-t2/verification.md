# P3.T2 Verification — LF-06 Plan Draw

Date: 2026-08-03

## Source implementation

- [`instruction.ts`](/Users/paramdave/FINNOR/src/components/jarvis/kernel/instruction.ts) exposes the existing `dependsOn` field returned with planned action rows.
- [`store.tsx`](/Users/paramdave/FINNOR/src/components/jarvis/kernel/store.tsx) retains real dependency IDs on `ThreadNode`, preserves them through trace-node enrichment, and ignores malformed/non-string IDs.
- [`ThreadBlocks.tsx`](/Users/paramdave/FINNOR/src/components/jarvis/bridge/ThreadBlocks.tsx) renders only `thread.nodes`, derives edges only from a real `dependsOn` ID whose source and target nodes both exist, and emits no placeholder edge/node for an unknown dependency. Initial/restore node and edge IDs are settled; newly observed IDs use the LF-06 one-shot variants.
- [`choreography.ts`](/Users/paramdave/FINNOR/src/components/jarvis/kernel/choreography.ts) defines the exact LF-06 node resolution at 160 ms and edge draw at 240 ms. Neither variant has a batch/index delay; reduced motion is an instantaneous settled node/edge with the changed border.

## Automated verification

```text
npx vitest run src/components/jarvis/kernel/apply-trace-events.test.ts src/components/jarvis/kernel/choreography.test.ts src/components/jarvis/kernel/trace-metrics.test.ts --reporter=dot
3 files passed, 48 tests passed

npm run test:unit -- --reporter=dot
34 files passed, 386 tests passed

npx tsc --noEmit --pretty false
exit 0

npx eslint [named P3 sources/tests plus store.tsx]
exit 0, no warnings

git diff --check
exit 0
```

Focused tests cover dependency retention from an action-created payload, exact 160/240 ms LF-06 variants, no artificial delay, initial/restore settlement, and reduced-motion settlement.

## Visual fallback evidence

The required in-app browser bootstrap was attempted first and failed with the exact runtime error `Cannot redefine property: process`. The permitted Playwright fallback then ran the labelled `/jarvis/next?fixture=plan` harness:

```text
CI=1 npx playwright test e2e/jarvis-p3-plan-fixtures.spec.ts --project=desktop-chromium --reporter=line
2 passed (11.7s)
```

The fixture assertions observed one Plan graph, six real fixture action nodes, zero entering nodes after initial mount, zero dependency edges because the fixture supplies no dependency fact, and zero page/console errors at both viewports. Captures:

- [Plan fixture — 1440 px](/Users/paramdave/FINNOR/qa-screenshots/v3-P3/plan-1440.png)
- [Plan fixture — 390 px](/Users/paramdave/FINNOR/qa-screenshots/v3-P3/plan-390.png)

The visual run is labelled fixture support only. It does not prove authenticated/live `action_created` arrival, live `domain_actions.dependsOn` delivery, event→pixel timing, CLS, focus/scroll, reduced-motion browser behavior, or device/runtime behavior. No score or P3 exit-gate item moved.

The LF-05 regression fixtures were rerun alongside the new Plan fixture:

```text
CI=1 npx playwright test e2e/jarvis-p3-understood-fixtures.spec.ts e2e/jarvis-p3-plan-fixtures.spec.ts --project=desktop-chromium --reporter=line
6 passed (19.3s)
```
