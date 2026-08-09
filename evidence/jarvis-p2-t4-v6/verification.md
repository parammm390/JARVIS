# P2.T4 — Dispatch Field

## Source contract

- `src/app/jarvis/schedule/page.tsx` mounts the dedicated Schedule route with the existing auth/data providers.
- `src/components/jarvis/panels/DispatchFieldSurface.tsx` keeps the existing `DispatchMapCore` as the map theater, adds an exceptions-first day rail, owner summary, stored-source status, and exact stop continuity links.
- Dispatcher data remains `/dispatch/map`: stored stop coordinates, stored technician assignments, unplaced-stop truth, and completed B3 route receipt metrics. No route, ETA, zone, or calendar source was invented.
- Technician data remains `/technician/my-day`; `MyDay` keeps the backend-gated arrive/report/flag/done path and now exposes exact household/work-order/visit handoffs plus a next-stop block.
- `DispatchMapCore` stop-to-Work matching is exact `visit`/`service_visit` ID only. A shared household ID does not merge unrelated Work cases.

## Verification

```text
npx vitest run src/components/jarvis/panels/DispatchFieldSurface.test.ts src/components/jarvis/panels/Household360Surface.test.ts src/components/jarvis/panels/WorkSurface.test.ts --reporter=verbose  8/8 PASS
npx vitest run 'src/app/api/jarvis/[...path]/route.test.ts' src/components/jarvis/lib/api.integration.test.ts --reporter=verbose  17/17 PASS
npx vitest run tests/integration/technician-my-day-route.test.ts --reporter=verbose  2/2 PASS
npx tsc -p tsconfig.json --noEmit --pretty false --incremental false  PASS
npm run lint  PASS (no warnings or errors)
git diff --check  PASS
```

## Browser proof

The real `/jarvis/schedule` route was inspected at 1440×900, 768×1024, and 390×844. With no authenticated session, it showed `Dispatch Field is unavailable` and a sign-in handoff; it did not render fake pins, route lines, appointments, technician names, or owner summaries. All three captures had zero horizontal document overflow. Populated dispatcher and technician rendering remains source-backed and role-gated in the component tree.

## Evidence boundary

No authenticated owner/dispatcher/technician session was available for a populated map or My-Day screenshot. The backend technician route and proxy contracts are integration-verified; live map data remains withheld by the real private boundary.
