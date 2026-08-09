# P3.T4 — Role-adaptive landing / density verification

Date: 2026-08-08

## Source freeze and re-probe

- HEAD before the task: `1ea6d4de7d5bc877b54c3bf85eb432d81dc55f98`.
- The only roles exposed by the shared backend/frontend contract are `owner`,
  `dispatcher`, and `technician` (`finnor-os/packages/shared-types/src/index.ts`,
  `src/components/jarvis/lib/jarvis-auth.tsx`). No accountant role was added.
- `GET /api/me` returns the verified `requireContext()` role. It is a display
  projection only; backend routes remain the authorization authority.
- `GET /api/user-prefs` is user-bound and currently accepts only the existing
  homepage values `bridge | map | my-day` plus `density: comfortable | compact`.
  `schedule` was not added as a persisted preference.
- Existing canonical scene gates were preserved: `DispatchFieldSurface` fetches
  dispatch/Work data only for owner/dispatcher, and `MyDay` fetches
  `technician/my-day` only for technician.

## Implemented contract

`src/components/jarvis/lib/role-landing.ts` is the pure source contract:

| Verified role | Default | Explicit saved override |
|---|---|---|
| owner | Home / Instruction Thread | none; Home remains canonical |
| dispatcher | Schedule / Dispatch Field | existing `homepage: "map"` preserves the legacy map scene |
| technician | My Day | no cross-role map/bridge value accepted |

The legacy dispatcher override and technician landing now retain the six-surface
navigation, including Work. Existing authenticated density preference is applied
to the legacy role landing spacing rhythm; the canonical Schedule and owner Home
keep their source-owned geometry.

The preference effect now waits for an authenticated `/api/me` role projection
before requesting private `/user-prefs`. `useQuietHours` received the same gate,
closing the public-preview preference request that was observed during the first
audit. No role or business data is prefetched before the authoritative boundary.

## Evidence

- `role-landing.test.ts`: **6/6** targeted role/default, override, and stale-
  preference boundary assertions.
- `e2e/jarvis-p3-t4-role-adaptive.spec.ts`: **1/1** Playwright audit at
  **1440×1000, 768×1024, and 390×844**.
- `after-metrics.json`: all snapshots have `scrollWidth === viewport`, schedule
  has no dispatch/map/technician/Work private-data requests without a session,
  `privateRequests: []`, and `unexpectedErrors: []`.
- Captures: `home-1440x1000.png`, `home-768x1024.png`,
  `home-390x844.png`, `schedule-boundary-1440x1000.png`,
  `schedule-boundary-768x1024.png`, `schedule-boundary-390x844.png`.
- Frontend Vitest: **50 files / 487 tests**.
- Root TypeScript: pass (`npx tsc --noEmit --pretty false`).
- Finnor TypeScript: pass with the repository's explicit Node type selection
  (`npx tsc -p tsconfig.json --noEmit --types node --pretty false`).
- Root lint: pass.
- `git diff --check`: pass.

## Truth boundary

No authenticated tenant role was available for populated owner/dispatcher/
technician visual captures, so no map stops, work orders, assignments, customer
records, preference rows, or role-specific business facts were fabricated. The
public browser audit intentionally shows the real unavailable/sign-in boundary.
The in-app Browser bootstrap remains `BLOCKED-ENV` (`Cannot redefine property:
process`); Playwright supplied the local responsive proof.

