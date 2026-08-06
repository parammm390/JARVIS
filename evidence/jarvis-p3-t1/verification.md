# P3.T1 verification — LF-05 Context Constellation

Date: 2026-08-03

## Source and behavior

- The real trace contract remains source-labelled `{label, source}` facts in
  [`store.tsx`](/Users/paramdave/FINNOR/src/components/jarvis/kernel/store.tsx:72)
  and `applyTraceEvents` continues to validate and append only those facts at
  [`store.tsx`](/Users/paramdave/FINNOR/src/components/jarvis/kernel/store.tsx:442).
- [`ThreadBlocks.tsx`](/Users/paramdave/FINNOR/src/components/jarvis/bridge/ThreadBlocks.tsx:140)
  now keeps trace facts separate from planned-action grounding, renders the
  source label, registers each real chip's DOM anchor, and does not replay
  facts that were present on initial mount/restore.
- [`ThreadField.tsx`](/Users/paramdave/FINNOR/src/components/jarvis/bridge/ThreadField.tsx:57)
  receives the current thread's real `contextChips`, detects only newly
  appended facts, and moves a deterministic Field point to the registered chip
  anchor. Missing anchors produce no flight; the source fact still renders.
- [`choreography.ts`](/Users/paramdave/FINNOR/src/components/jarvis/kernel/choreography.ts:193)
  defines LF-05 at 220 ms with a 45 ms maximum batch stagger. Reduced-motion
  variants settle immediately without travel or delay.

## Verification commands

Focused baseline before editing: **3 files / 43 tests passed**.

Focused after editing:

```text
npx vitest run src/components/jarvis/kernel/apply-trace-events.test.ts src/components/jarvis/kernel/choreography.test.ts src/components/jarvis/kernel/trace-metrics.test.ts --reporter=dot
3 files / 45 tests passed
```

Broad after editing:

```text
npm run test:unit -- --reporter=dot
34 files / 383 tests passed
npx tsc --noEmit --pretty false
exit 0
npx eslint <named P3 source/test files plus ThreadBridge.tsx>
exit 0, no warnings
git diff --check
exit 0
```

The new pure choreography tests cover the exact 220 ms duration, 45 ms batch
stagger, and reduced-motion settled state. Existing trace tests continue to
cover malformed-fact filtering, source labels, deduplication against existing
facts, and ordered trace batches.

## Supporting visual evidence

The in-app browser was attempted first and failed during bootstrap with
`Cannot redefine property: process`. A local Playwright fallback was used only
for the labelled development fixture, not as authenticated live proof:

```text
CI=1 npx playwright test e2e/jarvis-p3-understood-fixtures.spec.ts --project=desktop-chromium --reporter=line
4 passed (13.8s)
```

The test observed zero page errors/console errors and produced the existing
production-shaped fixture captures at 1440 px and 390 px:

- [`understood-complete-1440.png`](/Users/paramdave/FINNOR/qa-screenshots/v3-P3/understood-complete-1440.png)
- [`understood-complete-390.png`](/Users/paramdave/FINNOR/qa-screenshots/v3-P3/understood-complete-390.png)
- [`understood-midfill-1440.png`](/Users/paramdave/FINNOR/qa-screenshots/v3-P3/understood-midfill-1440.png)
- [`understood-midfill-390.png`](/Users/paramdave/FINNOR/qa-screenshots/v3-P3/understood-midfill-390.png)

The rendered fixture visibly shows the source labels beside real labelled
context facts. It is explicitly fixture evidence and does not prove a live
authenticated trace arrival, event-to-pixel latency, CLS, focus/scroll
movement, microphone/device behavior, or the P3 exit gate.

