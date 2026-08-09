# P2.T3 — Household 360

## Source contract

- `src/app/jarvis/customers/page.tsx` mounts the dedicated Customers route with the existing auth/data providers.
- `src/components/jarvis/panels/Household360Surface.tsx` reads only `/resources/households`, `/read-models/household-360`, and the exact Work projection. It has no sample rows or CRM-side source.
- The index is a dense list/table hybrid. Loaded rows expose exact identity, equipment, service, Work, balance, and alert facts; unloaded cells say `Select for equipment record`, `Not yet observed`, or `—` rather than guessing.
- The detail is one continuous record with the required `IDENTITY`, `SERVICE & EQUIPMENT`, and `CURRENT BUSINESS STATE` bands. Equipment, visits, appointments, business events, invoices/payments, conversations, and documents remain their exact source records.
- `OperationalSurfaceNav` exposes the visible context capsule with the exact household ID and appends `householdId` to Work/Schedule/Money handoff links.

## Verification

```text
npx vitest run src/components/jarvis/panels/Household360Surface.test.ts src/components/jarvis/panels/WorkSurface.test.ts --reporter=verbose  6/6 PASS
npx vitest run tests/integration/household-360.test.ts --reporter=verbose  8/8 PASS
npx tsc -p tsconfig.json --noEmit --pretty false --incremental false  PASS
npm run lint  PASS (no warnings or errors)
git diff --check  PASS
```

## Browser proof

The real `/jarvis/customers` route was inspected through the in-app browser at 1440×900, 768×1024, and 390×844. It rendered the source-unavailable / sign-in state with the explicit no-record message and no fabricated household. The responsive metrics are in `responsive-metrics.json`; all captures had zero horizontal document overflow, the index/detail composition stacked at tablet width, and mobile navigation remained contained in its own horizontal rail.

## Evidence boundary

The existing Household 360 backend traversal is integration-verified across canonical and legacy records, payment aggregation, appointment hops, timeline ordering, cross-household isolation, and route query validation. A populated browser capture is not claimed because this browser has no authenticated tenant session; the private route correctly returns 401.
