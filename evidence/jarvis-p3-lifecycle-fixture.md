# P3 lifecycle fixture evidence — 2026-08-03

## Scope and provenance

This artifact records a bounded `/jarvis`-only browser fixture run. It is not
an authenticated tenant recording and it does not claim live backend timing.

- Route: `/jarvis/next?fixture=journey` in the local development server.
- The route is visibly labelled `FIXTURE · journey`.
- The harness advances one same-document React tree through the existing
  source-labelled `ThreadBody`, `ThreadStack`, `Thread`, and Thread block
  components. It does not create a kernel event, call a backend, submit an
  instruction, perform an external action, or change a migration.
- Each non-rest edge records the source-defined fixture instruction id
  `fixture-instruction` and its named trace phase through the existing
  `trace-metrics` seam. The fixture uses the repository's existing
  `THREAD_FIXTURES`; it does not invent tenant facts or action IDs.

## Browser and iteration record

The mandated in-app Browser bootstrap was attempted first and returned the
exact error `Cannot redefine property: process`. The local Playwright fallback
was therefore used and is explicitly labelled as fixture evidence.

The first harness attempt used an instruction id that did not match the
existing fixture Thread (`fixture-journey-instruction`); it produced no usable
event-to-pixel rows. The id was corrected to the source-defined
`fixture-instruction`. The next run passed at 1440px and failed only at 390px
because the expected unauthenticated `user-prefs` 401 response was missing from
the allowlist. That allowlist was corrected. The final run below is after the
fixture badge was moved into normal flow for this journey only, removing its
reduced-motion full-page screenshot overlap with the setup rail.

## Verification command and result

```text
PLAYWRIGHT_BASE_URL=http://127.0.0.1:3000 npx playwright test \
  e2e/jarvis-p3-lifecycle-fixture.spec.ts \
  --project=desktop-chromium --workers=1
```

Result: **3 tests passed (8.0s)**.

The test recorded no unexpected page or console errors. The only 401 responses
were the explicitly constrained unauthenticated fixture requests:

- `/api/jarvis/user-prefs`
- `/api/jarvis/receipts?domainActionId=fixture-node-<n>`

The local Next dev server also printed the repository's existing Sentry ESM
external warning while compiling the fixture route. It did not fail the run or
surface as an unexpected page/console error, and no Sentry/dependency source was
changed.

The test also asserted `scrollWidth ≤ viewport width`, one active block for
each non-rest state, the full nine-state sequence, eight finite non-negative
event-to-pixel rows, and `CLS/layout shift ≤ 0.03`.

## Recorded lifecycle

The visible state control advanced through this one document:

```text
ready → captured → understanding → planning → clarifying → approval
      → executing → verifying → terminal
```

The exact active-block/focus/scroll transcript is recorded below. `clarifying`
and `approval` intentionally retain the active Plan block in this fixture;
that is the observed shared-component behavior, not evidence that a live
approval backend event occurred.

| Viewport | Transcript summary | Terminal runtime |
|---|---|---|
| 1440×900 | `rest:null/body/0` → `heard:heard/journey-next/0` → `understood:understood/journey-next/0` → `plan:plan/journey-next/0` → `clarify:plan/journey-next/0` → `approval:plan/journey-next/0` → `execution:execution/journey-next/0` → `verifying:execution/journey-next/0` → `receipt:receipt/div/0` | `scrollWidth=1440`, `scrollHeight=1326`, `CLS=0` |
| 390×844 | `rest:null/body/0` → `heard:heard/journey-next/0` → `understood:understood/journey-next/0` → `plan:plan/journey-next/204` → `clarify:plan/journey-next/53` → `approval:plan/journey-next/19` → `execution:execution/journey-next/30` → `verifying:execution/journey-next/0` → `receipt:receipt/div/13` | `scrollWidth=390`, `scrollHeight=1628`, `CLS=0` |
| 390×844 reduced | `rest:null/body/0` → `heard:heard/journey-next/0` → `understood:understood/journey-next/156` → `plan:plan/journey-next/292` → `clarify:plan/journey-next/0` → `approval:plan/journey-next/0` → `execution:execution/journey-next/0` → `verifying:execution/journey-next/0` → `receipt:receipt/div/134` | `scrollWidth=390`, `scrollHeight=1628`, `CLS=0` |

The active block was visible at every non-rest step and the journey control
retained focus through the transitions. The terminal Receipt was the observed
active block at the end of all three runs.

## Event-to-pixel rows

Rows are ordered by fixture event sequence. Zero values are real measured
values for transitions whose target stage was already painted in the same
measurement turn; they are not substituted defaults.

| Viewport | Ordered event → stage measurements (ms) | Maximum |
|---|---|---:|
| 1440×900 | `received→heard 28.298`; `context_retrieved→understood 9.100`; `plan_ready→plan 8.500`; `clarification_required→plan 0`; `action_gated→plan 0`; `executing→execution 5.600`; `verifying→execution 0`; `completed→receipt 5.000` | 28.298 |
| 390×844 | `received→heard 29.432`; `context_retrieved→understood 6.500`; `plan_ready→plan 11.000`; `clarification_required→plan 0`; `action_gated→plan 0`; `executing→execution 5.000`; `verifying→execution 0`; `completed→receipt 2.800` | 29.432 |
| 390×844 reduced | `received→heard 30.532`; `context_retrieved→understood 15.500`; `plan_ready→plan 15.466`; `clarification_required→plan 0`; `action_gated→plan 0`; `executing→execution 14.700`; `verifying→execution 0`; `completed→receipt 15.066` | 30.532 |

These are source-labelled fixture measurements, not the Plan §5.4 SSE/poll
production classification. They strengthen the component-tree evidence but do
not close the authenticated/live event→pixel gate.

## Screenshots and visual review

- [1440 lifecycle capture](/Users/paramdave/FINNOR/qa-screenshots/v3-P3/lifecycle-1440.png)
- [390 lifecycle capture](/Users/paramdave/FINNOR/qa-screenshots/v3-P3/lifecycle-390.png)
- [390 reduced-motion lifecycle capture](/Users/paramdave/FINNOR/qa-screenshots/v3-P3/lifecycle-390-reduced.png)

The final captures show the visible fixture label, the continuous causal
Thread/Receipt, and the trace metrics panel below the Thread rather than over
the receipt. The reduced-motion capture was visually inspected after the
flow-placement correction; the fixture badge no longer overlaps the setup
rail. The receipt copy and invoice rows remain fixture-labelled content, not
observed tenant outcomes.

## Gate boundary

This fixture supports, but does not close, the three gates that still require
authenticated/live evidence: complete edge continuity, transition CLS across
real state edges, and live event→pixel timing. It does not provide retry or
refresh/restore recording in the same run, nor an authoritative reviewer or
Plan-defined score artifact. The ledger therefore keeps P3 at **3/7 supported**,
the cumulative score at **10/100**, and Phase 3 unclaimed.
