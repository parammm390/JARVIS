# P3 exit-gate audit — 2026-08-03

Scope is `/jarvis` only. This is an evidence reconciliation, not a score
assignment. The P1/P2 gates remain open, the accepted cumulative score remains
10/100, and no Phase 3 completion is claimed.

## Evidence inventory

- P3.T1/T2 source and focused-test artifacts cover source-labelled context
  facts, real action/dependency endpoints, and the no-placeholder/no-fabricated
  motion rules.
- P3.T3/T4 source artifacts cover clarification continuity, mounted blocks,
  active-block protection, and focus-handoff logic. The follow-up labelled P3
  fixture pass covered clarification focus and continuity at 1440/390/reduced
  motion after fixing a real pre-frame focus race; it remains component-tree
  support rather than live tenant proof.
- P3.T5/T6 labelled fixtures cover the causal-spine/history presentation at
  1440/390 and reduced motion; they do not provide authenticated/live state
  edges.
- P3.T7 source/tests plus the labelled refresh fixture cover settled remount
  presentation, active receipt keyboard behavior, refresh signature equality,
  reduced motion, and the existing transport cursor/reconnect logic. The full
  results are in [`P3.T7 verification`](/Users/paramdave/FINNOR/evidence/jarvis-p3-t7/verification.md).
- The new [`P3 lifecycle fixture`](/Users/paramdave/FINNOR/evidence/jarvis-p3-lifecycle-fixture.md)
  advances one visibly labelled same-document component tree through
  ready→captured→understanding→planning→clarifying→approval→executing→verifying
  →terminal at 1440/390/reduced motion. It records focus/scroll, CLS, and eight
  source-labelled event→pixel rows per run. This is bounded shared-component
  support only: it does not establish authenticated/live tenant edges, retry or
  restore in the same recording, production SSE/poll timing, or an authoritative
  score.
- The current-worktree deployment reconciliation is recorded in
  [`jarvis-p3-current-worktree-deployment.md`](/Users/paramdave/FINNOR/evidence/jarvis-p3-current-worktree-deployment.md).
  Deployment `dpl_7zEG4p8wimDXiyA9KK3VqpuWJpZm` is `READY` and the existing
  Chrome tab now serves the current branch without `PUBLIC PREVIEW` or `Sign in`
  markers at 1440/390. The initial reconciliation observed only the
  ready/degraded shell; the later bounded owner journey is recorded separately
  below. No approval control was clicked and no external side effect was
  inferred from that journey.
- The live owner journey is recorded in
  [`jarvis-p3-live-owner-journey.md`](/Users/paramdave/FINNOR/evidence/jarvis-p3-live-owner-journey.md).
  The canonical owner surface produced a real terminal causal order
  (`Heard → Understood → Plan → Execution → Receipt`) for one submitted
  instruction, and a second real instruction reached an expanded clarification
  state with source-visible fields. The intermediate terminal edges were not
  separately timestamped, no approval was clicked, and the live clarification
  refresh returned to the empty Ready surface rather than restoring a Thread.
- The measurement follow-up is recorded in
  [`jarvis-p3-trace-metrics-follow-up.md`](/Users/paramdave/FINNOR/evidence/jarvis-p3-trace-metrics-follow-up.md).
  The existing event-received→next-paint bus now has a non-visual inspection
  seam on the Thread document. Source/tests and the complete labelled P3
  regression pass, but the bounded live sample supplied submission-edge timing
  only; the final repeat was stopped by the observed route rate limit before a
  trustworthy final live metric record.

## Gate reconciliation

| Plan gate | Result | Evidence-backed reason |
|---|---|---|
| Every state edge is spatially continuous | **OPEN** | The labelled lifecycle fixture covers the complete ready→captured→understanding→planning→clarifying/approval→executing→verifying→terminal sequence in one document at 1440/390/reduced motion, but it is not an authenticated/live recording and does not include retry plus restore in the same run. |
| No active blank gap or layout jump >0.03 CLS | **CLOSED** | The strict authenticated production clarification/restore recording passed at the required widths: 1440 CLS `0.01930893778544231` and 390 restored CLS `0.004535921583271948`, both at or below the Plan §5.4 `0.03` limit. The source evidence also captures the setup-row defect and its geometry fix. |
| Context and plan motion only from real facts/nodes | **CLOSED** | T1/T2 source and focused-test evidence traces context chips to real `context_retrieved` facts and plan edges to real dependency endpoints; no placeholder endpoints are rendered. |
| Active block remains visible and keyboard reachable | **CLOSED** | The labelled P3 fixture set passed 21/21, covering active Plan and Receipt block focus/Enter behavior at 1440/390 plus clarification input focus at 1440/390/reduced motion. This is representative shared-component evidence, not a claim that every authenticated live edge was recorded. |
| Refresh restores without replayed completed event blooms | **CLOSED** | The same-owner 1470px restore fetched 7 rows with all restored entries settled, and the strict authenticated 390px reload restored the same instruction with `settled, settled, settled` Thread entries, active Plan, and focused `householdId`; no replayed entry blooms were observed. |
| Event→pixel meets Plan §5.4 | **OPEN** | The labelled lifecycle fixture captured eight source-labelled event→pixel rows per viewport (the latest complete regression still passes), and the existing production measurement bus now has a non-visual inspection seam. The bounded live sample recorded submission-edge timing only; no trustworthy authenticated/live SSE or poll event-receipt→paint record was obtained before the observed rate limit. |
| P3 cumulative score ≥87/100 | **OPEN** | The ledger retains the accepted evidence-backed score `10/100`; no authoritative reviewer score artifact or Plan-defined reproducible phase-scoring rule was supplied. |

**Initial audited result: 2/7 gates supported.** The live owner journey materially
strengthens authenticated causal-order and clarification evidence, but it does
not close the complete lifecycle, live transition CLS, live event→pixel, or
mid-flight refresh/restore boundaries. The score gate is also still
unsupported, so P3 is not 100% complete and the ledger must not mark the phase
complete.

## External/runtime boundary

The mandated in-app Browser bootstrap returned `Cannot redefine property:
process`. An authorized current-worktree deployment and a no-public-preview
Chrome surface are now available, but the tab did not provide a complete live
instruction lifecycle or trustworthy device/event timing in this audit. The
production migration status remains unverified. The bounded live owner journey
did submit two instructions; it did not click an approval or trigger a known
external workflow control. The live clarification refresh returned no restored
Thread, and no migration was performed.

The latest measurement-only deployment is `dpl_9W82UCm8TkDBZow5e2jJynBjDv6e`
(`READY`). Its post-deploy owner probe briefly hit the observed rate-limit
response and, after a 60-second cool-down, returned to the degraded shell with
no Thread blocks. This is recorded as an external/runtime boundary, not as a
passing lifecycle or timing result.

## Addendum — restore key correction and same-owner recheck

The earlier live `0` metric result had a concrete source cause: restore and
stream/poll receipt rows were keyed by the local Thread id, while the rendered
Thread queried the measurement bus by `instructionId`. The correction is
recorded in [`jarvis-p3-restore-metrics-follow-up-2026-08-03.md`](/Users/paramdave/FINNOR/evidence/jarvis-p3-restore-metrics-follow-up-2026-08-03.md)
and passed the focused 3-file/34-test run, scoped ESLint, and `git diff --check`.

Deployment `dpl_4PJBSD9gE37dPnPcF4r5HWnsNTDW` reached `READY`. The existing
authenticated owner tab then restored the exact clarification at 1470×779 with
7 fetched rows and 7 settled browser measurements: median 56.300000 ms and
nearest-rank p95 56.400000 ms from local fetch/application to next paint. The
clarification input retained focus, Heard/Understood were collapsed, Plan was
active, and document width 1462 remained below viewport width 1470.

This closes the live same-owner refresh/no-replayed-bloom item at the observed
owner surface. The responsive test account received a 404 for that owner-tab
instruction id before rendering, so no 1440/390 live result exists. The live
CLS trace, SSE/poll transport-class timing, complete lifecycle/retry, and
authoritative score remain open. The current conservative reconciliation is
therefore **3/7 gates supported**, not a phase-completion claim.

## Addendum — live CLS and responsive restore follow-up

The authenticated production test in
[`jarvis-p3-live-clarification-cls-follow-up-2026-08-03.md`](/Users/paramdave/FINNOR/evidence/jarvis-p3-live-clarification-cls-follow-up-2026-08-03.md)
now supplies the previously missing live layout-shift recording. After the
setup-rail closed-row geometry fix, deployment
`dpl_DcbEUsJTuiYqzYbZbFhDcWk8W1ju` reached `READY` and the strict repeat passed
**1/1 (16.7s)** with the same instruction restored from 1440 to 390, active
Plan, focused `householdId`, no horizontal overflow, and restored entries
settled. The live CLS values were `0.01930893778544231` at 1440 and
`0.004535921583271948` after the 390 reload.

This closes the CLS gate. The complete live lifecycle/retry, separate SSE/poll
transport-class timing, and authoritative score remain open; the current
reconciliation is **4/7 gates supported**, and no Phase 3 completion or score
movement is claimed.
