# P0/P1 release checkpoint — 2026-08-21

## Source and verification

- Canonical Company World and Identity & Access Fabric changes were merged to `main` at `2bbb16b2620b00996bfebd73eac738a2272596e7` through PR #13.
- The release candidate passed a clean 86-migration database build, seed and LangGraph setup, FINNOR typecheck, release-policy checks, 1,144 FINNOR tests, frontend lint/typecheck, 533 frontend unit tests, and focused identity/tenant/heartbeat suites.
- Migration bundle parity and generated OpenAPI contract checks passed.

## Production release status

- Canonical production workflow: `production-release.yml`, run 32488876338.
- Both the initial attempt and one bounded failed-job rerun stopped at **Pull protected production database configuration**.
- Vercel CLI 50.15.1 returned `scope-not-accessible`: the production `VERCEL_TOKEN` does not currently have access to the organization configured in `infra/deployment/production.contract.json`.
- Azure OIDC authentication succeeded. Every preflight, build, migration, deployment, parity, and smoke step after the Vercel check was skipped. No production database or runtime was mutated by either attempt.

## Required release continuation

Refresh the GitHub `production` environment's `VERCEL_TOKEN` with access to the configured Vercel team, then rerun the canonical workflow for exact SHA `2bbb16b2620b00996bfebd73eac738a2272596e7`. Do not bypass the protected workflow or weaken its account-scope check.
