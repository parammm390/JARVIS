# P1.T5 verification — Home craft + responsive pass

Date: 2026-08-08

## Scope

P1.T5 applied only craft, density, truth-preserving state presentation, and responsive hierarchy changes. No new product functionality, backend contract, or fabricated state was added.

## Evidence

- `after-metrics.json`: 21 labelled fixture snapshots across H0–H6 at 1440, 768, and 390 widths, plus a reduced-motion approval snapshot.
- The snapshots report `scrollWidth === viewport` for every capture, one visible primary status per capture, `minCraftFontSize: 11`, zero raw rail copy, zero untrusted currency nodes, zero infinite rest animations, and zero unexpected page errors.
- Ready enforces one compact Now Rail with a maximum of three operational rows; this fixture has zero pending rows because the source is unauthenticated.
- Approval reports one cockpit and keyboard focus inside the approval dialog at 390px with reduced motion.
- Visual captures include `rest`, `listening`, `plan`, `approval`, `execution`, `receipt`, and `recovery` at all three required widths. `rest-mobile-check.png` is an additional manual mobile spot check after the responsive overrides.

## Verification commands

- `npx playwright test e2e/jarvis-p1-exit-gate.spec.ts --project=desktop-chromium --workers=1` — 1 passed.
- `PLAYWRIGHT_BASE_URL=http://localhost:3002 npx playwright test e2e/jarvis-p1-signature-moments.spec.ts --project=desktop-chromium --workers=1` — 3 passed against an isolated `NEXT_PUBLIC_JARVIS_NEXT=1` server; the temporary server was stopped after the run.
- `npx tsc --noEmit --pretty false` — passed.
- `npm run lint` — passed with no ESLint warnings or errors.
- `npx vitest run` — 43 files / 461 tests passed.
- `npm run build` — passed. Next emitted the existing Sentry dependency warning that `@apm-js-collab/tracing-hooks/hook-sync.mjs` needs ESM import treatment; this is an environment/dependency warning, not a P1.T5 product failure.
- `git diff --check` — passed.

## Truth boundary

The local fixture is visibly labelled and remains unauthenticated. No authenticated owner command dock, live leased workflow-step Ignite capture, or transport reconnect Recover capture was available. Those moments remain source-contract verified and production-bound to their existing workflow/transport/legal-recovery edges; no fake run, reconnect, approval result, currency value, or outcome was introduced.

