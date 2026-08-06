# P3.T1 discovery — LF-05 Context Constellation

Date: 2026-08-03
Route scope: `/jarvis` only; `/demo` untouched.

## Current source facts

- `Thread.contextChips` is the only instruction-owned context collection. Its
  contract is `{ label: string, source: string }`; the kernel does not expose
  memory contents to the renderer.
- `applyTraceEvents` handles only the real `context_retrieved` trace phase,
  validates both strings, and appends only source-labelled facts. Existing
  facts are deduplicated by `label·source`.
- The orchestration trace emits the real labels `prior turns this session`,
  `household history`, `related past instructions`, and `recent business
  activity`, each with its real source and count. The frontend contract keeps
  only `label` and `source`, so this task does not invent or display counts.
- `ThreadUnderstood` currently combines trace context chips with separate
  `groundedPayload` chips and uses the v3 M4 `contextGatherChipVariants`
  (380 ms, 60 ms stagger). This is not the v4 LF-05 contract.
- `ThreadField` currently renders only the source-backed overdue-invoice
  aggregate as deterministic points. It has no instruction context input or
  context-to-thread target.
- `ThreadBridge` is the sole current caller of `ThreadField`; it already owns
  the current `thread`, so passing `thread?.contextChips ?? []` is the narrow
  source-proven dependency needed to connect the real trace facts to the Field.
- The existing lifecycle edge source covers `captured → understanding →
  planning → clarifying/awaiting_approval → executing → verifying → terminal`
  plus retry and refresh restore through `applyTraceEvents` and the active
  thread pointer. No product code in this task invents a new state or edge.

## Baseline verification

Focused baseline command:

```text
npx vitest run src/components/jarvis/kernel/apply-trace-events.test.ts src/components/jarvis/kernel/choreography.test.ts src/components/jarvis/kernel/trace-metrics.test.ts --reporter=dot
```

Observed result: **3 files / 43 tests passed**.

The mandated in-app browser discovery was attempted after reading the browser
skill. Bootstrap failed with the exact runtime error `Cannot redefine property:
process`. Therefore this discovery contains no rendered screenshot, device,
event-to-pixel, or microphone claim. A labelled Playwright fixture run may be
used only as supporting visual evidence after implementation; it cannot prove
authenticated live context arrival.

## Measurements available before editing

- Event-to-pixel measurement infrastructure already records the next painted
  Thread stage in `trace-metrics.ts`; `context_retrieved` maps to `understood`.
- A real context batch is append-only in the kernel, so a ≤45 ms per-fact
  stagger can be keyed to append order without pretending facts arrived
  separately.
- No browser measurement of CLS, scroll movement, focus movement, or event →
  painted context flight was available in this environment. Those remain open
  evidence items rather than assumptions.

