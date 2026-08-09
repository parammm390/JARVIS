# P4.T3 — L1–L6 launch-critical journeys

Date: 2026-08-08  
Status: SAFE PATH GREEN — authenticated/live tenant capture remains `BLOCKED-ENV`

## Result

All six journeys are green on the strongest safe evidence available in this environment. The proof uses the same production Thread/Orb/kernel tree through visibly labelled Dealer Zero fixtures, exact source-contract tests, and an isolated local Finnor database. No external action, payment, message, provider call, or tenant record was fired or fabricated.

The authenticated owner journey and populated private-surface capture were probed honestly but not claimed: `TEST_OWNER_EMAIL` and `TEST_OWNER_PASSWORD` are absent, so the owner-gated live Playwright suites remain skipped. This is an environment evidence limitation, not a newly observed product defect.

## Journey matrix

| Journey | Evidence-backed path | Result |
|---|---|---|
| L1 Command | The canonical `ThreadBody`/`ThreadStack`/Orb state tree renders Ready → listening → understand → plan through the labelled signature journey; P1 signature tests cover wake, gather, draw, clamp, and settle at desktop/mobile reduced motion. | GREEN on safe source-coupled path |
| L2 Authority | `ApprovalCockpit` uses the authoritative `confirm`, `reject`, and `escalate` action routes. Finnor integration coverage proves approval gating, reject halt, role authority, escalation, idempotency, and terminal conflict behavior. | GREEN on isolated tenant-scoped path |
| L3 Execution | Approved actions produce the linked run → step → receipt/outcome trail; single-action runtime, workflow runtime, Work cases, sandbox-complete-flow, payment receipt, and stream contracts pass. The execution/receipt fixtures use visible fixture authority and do not mutate external systems. | GREEN on safe emulator/source path |
| L4 Recovery | Failure maps to legal retry/escalation/compensation states and settles truthfully; workflow recovery, compensation, escalation, action-revert, full-flow, and sandbox contracts pass, including explicit failed compensation for communications. | GREEN on isolated recovery path |
| L5 Operational continuity | Exact-ID Work/Customer/Schedule/Money handoffs and round trips remain covered by the P2.T6 11/11 contract, surface unit tests, role/continuity e2e, and the refreshed Golden Frame route review. No cross-surface fact is inferred from a shared label. | GREEN on exact-ID/source path |
| L6 Agent continuity | The five-channel Fleet keeps provider-level status separate from assistant status, projects only exact `agentKey`/`domainActionId`/household edges, and preserves literal unavailable state when source data is absent. Fleet projection, persona/schema, causal-envelope, and agent-causality browser tests pass. | GREEN on bounded causal path |

## Verification commands

Frontend source contracts:

```text
npx vitest run src/components/jarvis/kernel/signature-moments.test.ts \
  src/components/jarvis/kernel/recovery.test.ts \
  src/components/jarvis/lib/receipt-recovery.test.ts \
  src/components/jarvis/agents/agent-fleet.test.ts \
  src/components/jarvis/panels/WorkSurface.test.ts \
  src/components/jarvis/panels/Household360Surface.test.ts \
  src/components/jarvis/panels/DispatchFieldSurface.test.ts \
  src/components/jarvis/panels/CashPressureSurface.test.ts \
  src/components/jarvis/lib/role-landing.test.ts \
  --reporter=verbose
```

Result: 9 files, 40 tests passed.

Browser journeys:

```text
PLAYWRIGHT_BASE_URL=http://127.0.0.1:3000 npx playwright test \
  e2e/jarvis-p1-signature-moments.spec.ts \
  e2e/jarvis-p7-thread-fixtures.spec.ts \
  --project=desktop-chromium --workers=1
```

Result: 17/17 passed, including 1440px and reduced-motion 390px signature coverage and keyboard clarification controls.

```text
PLAYWRIGHT_BASE_URL=http://127.0.0.1:3000 npx playwright test \
  e2e/jarvis-p3-t3-agent-causality.spec.ts \
  e2e/jarvis-p3-t4-role-adaptive.spec.ts \
  e2e/jarvis-p3-continuity-fixtures.spec.ts \
  --project=desktop-chromium --workers=1
```

Result: 5/5 passed. The public/private boundary, role landing, exact causal edges, same Thread tree, and responsive containment remain green.

Selected Finnor contracts against the embedded local Postgres database:

```text
tests/integration/full-flow.test.ts
tests/integration/decision-receipts.test.ts
tests/integration/single-action-runtime-bridge.test.ts
tests/integration/workflow-runtime.test.ts
tests/integration/work-cases.test.ts
```

Result: 5 files, 25 tests passed.

```text
tests/integration/rbac-approval.test.ts
tests/integration/actions-revert.test.ts
tests/integration/compensation.test.ts
tests/integration/escalate-route.test.ts
tests/integration/vertical-workflows-phase4.test.ts
```

Result: 5 files, 25 tests passed.

```text
tests/integration/payment-webhook-receipt.test.ts
tests/integration/sandbox-complete-flow.test.ts
tests/integration/stream-route.test.ts
```

Result: 3 files, 12 tests passed.

```text
tests/unit/voice-personas.test.ts
tests/unit/vapi-webhook-schema.test.ts
tests/unit/work-cases.test.ts
```

Result: 3 files, 12 tests passed. Total selected Finnor proof: 74/74.

## Limitation and non-claims

- No owner credentials were present in the environment; `e2e/jarvis-p4-verification-fixtures.spec.ts` skipped 4 authenticated tests for that reason, and `e2e/jarvis-next-real-journey.spec.ts` was not represented as live proof.
- Populated private Work, Household 360, Dispatch, Money, technician My Day, and Fleet activity captures remain the real unavailable boundary, not synthetic tenant data.
- This evidence closes P4.T3 safe-path verification only. It does not claim the final 98/100 score; P4.T4 certification and P4.T5 production-shaped deployment/score remain required.
