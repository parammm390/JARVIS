# P0 Baseline Report

## Certified baseline facts

- Baseline source checkpoint: `4888c6d22ed211cb918f30edc2b508fe1a04bcde`.
- Preserved baseline commit: `be27bfa9236b0adb0a7510aeed833076cf91b1c4`.
- Static registry/spec result: **44/44 PASS**.
- Migration head: `0064_evidence_corpus_search.sql`.
- Deployable services: API, console frontend, worker, and orchestrator; exact committed target inventory is in `generated/deployment-inventory.md`.

## Provider and binding baseline

The environment contract names configuration variables only and never reads their values. Current source families are Postgres, Redis, Sentry, Supabase, Vapi, Mistral, DeepSeek/Bedrock, Exa, Firecrawl, embeddings, Zep, Stripe, QuickBooks, DocuSign, Resend/communications, GoHighLevel, Meta Ads, Google Ads, OSRM/routing, and the secrets provider. Refer to `generated/environment-contract.md` for the exact variable-name and local-presence inventory.

Binding defaults are native for Finnor-owned scheduling/documents/inventory/CRM and emulator for communications, e-sign, accounting, payments, and marketing. Tenant integration rows may override those defaults. No live provider was certified or invoked in P0.

## Tests and repairs

| Command/evidence | Result |
| --- | --- |
| `npm run release:manifest` | PASS, 44/44 |
| backend authz/typecheck/planner eval/policy coverage | PASS; policy coverage 44/44 |
| clean local migration, seed, LangGraph setup | PASS against disposable databases; migration 0000–0064 |
| backend `npm test` | PASS on a fresh post-update database: 180 files, 851 tests; 3 existing conditional skips |
| frontend lint/typecheck/contrast/unit/build | PASS: 39 files, 434 unit tests; contrast failedCount=0 |
| fixture provenance browser sweep | PASS: 14 tests |
| signed-out Next fixture/keyboard browser suite | PASS: 17 tests |
| complete Playwright browser suite | PASS: 280 total; 113 passed, 167 pre-existing skips, 0 failures — `p0-t6-frontend-e2e-280-final.txt` |
| backup/restore CLI drill | PASS: four sentinel row counts matched; throwaway database cleaned — `p0-t6-backup-restore-drill-final.txt` |
| security scans | PASS current diff gitleaks, OSV lockfile scan, npm audit; historical gitleaks findings retained as pre-existing follow-up — `p0-t6-security-final.txt` |

Repairs made: bounded local DB connection timeout; regenerated authz matrix; seeded immutable policy revisions; corrected evidence fallback SQL; excluded generated columns on backup restore; restored workflow claim/receipt test setup; added the test-only JARVIS route flag to the Playwright server; corrected fixture provenance labels and stale public-preview snapshots; classified expected signed-out 401 responses in the relevant browser test; made the backup drill probe optional local vector availability while always closing its probe connection; and added lockfile-only security overrides for the four OSV findings.

## Remaining defects/blockers

- **P0/P3 environment blocker:** `npm run test:staging`, tenant-isolation probing, Dealer Zero replay, live planner evaluation, and k6 load remain environment-gated. A current Vercel Preview target is discoverable, but its database endpoint resets before PostgreSQL authentication and its Supabase auth origin matches Production, so it is not a verified isolated staging target. Railway read-only discovery still exposes only `confident-wisdom/production`; no usable staging JWTs, replay artifacts, live provider credential, or k6 binary is available. These are recorded as fail-closed prerequisites and were not replaced with Production or fabricated fixtures — `docs/release/evidence/P0/p0-t7-vercel-preview-audit.txt`.
- **Historical scanner follow-up:** all-history gitleaks reports three pre-existing matches in older commits; the current P0 diff is clean. Rewriting history or rotating owner credentials is outside this phase and was not performed.
- Full Playwright certification completed after the targeted repairs: 113 passed, 167 pre-existing skips, and 0 failures. The final lint and TypeScript check also pass (`p0-t6-frontend-e2e-280-final.txt`).

## Starting readiness score

**0.0 / 10.0.** Under plan §2.3, P0 proves no full-credit category: 44-action contract, chaos/security, staging/live bindings, load, observability, and release rehearsal remain future-phase work. This is a strict baseline score, not a claim of product readiness.
