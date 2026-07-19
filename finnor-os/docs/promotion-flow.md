# Promotion flow — CI/CD (Phase 6, Task 6.7)

## What's already real

`.github/workflows/ci.yml` (`finnor-os-ci`) already runs on every push to `main` and
every PR touching `finnor-os/**`: `npm ci` → `npm run typecheck` → `npm run db:migrate`
→ `npm run db:seed` → `npm test` (which, via `vitest.config.ts`'s
`include: ["tests/**/*.test.ts"]`, already runs `tests/eval/retrieval-eval.test.ts` and
its real `expect(score).toBeGreaterThanOrEqual(0.85)` assertion) — plus, as of this
session, a real Postgres-client-tools restore drill (see `docs/restore-drill-2026-07-
19.md`). **The retrieval-eval CI gate the pack's Task 6.7 asks for already existed
before this session** — nothing new needed there beyond confirming it.

**No deploy step exists in CI** (by original design — see the comment at the top of
`ci.yml`: "No deploy step yet — manual deploy until there's a reason to automate it").
Every production deploy so far has gone through a manual `vercel deploy --prod` /
`railway up`-style flow, run directly by whoever is executing the current phase, and
verified live afterward. This doc is that flow, written down for the first time.

## The manual promotion flow, as actually practiced (Phases 1-6)

1. **Land the code.** Commit locally with a `P<phase>:` prefix. `git push origin main`
   is currently broken in this environment (no credential helper — see
   `owner-actions.md` §2) so GitHub's copy lags what's live; this does not block
   deploys, which build from the local tree.
2. **Apply pending migrations.** `POST /api/admin/migrate` with header
   `x-admin-secret: <ADMIN_SECRET>` against the deployed API — runs the bundled
   migration set (`packages/db/migrations-bundle.ts`, regenerated via
   `scripts/bundle-migrations.ts` whenever a new migration file is added) against the
   real production Supabase database. Confirm the JSON response lists every expected
   migration as applied.
3. **Deploy the API** (`apps/api`, Vercel project id `prj_BoMZ2AXdLIJQXAAe6RqDGBveyq3n`,
   prod URL `api-psi-brown-95.vercel.app`):
   ```
   cd finnor-os
   VERCEL_ORG_ID=team_TlTo8L6Rvgb0H7uJh0G5GLDD VERCEL_PROJECT_ID=prj_BoMZ2AXdLIJQXAAe6RqDGBveyq3n vercel deploy --prod --yes
   ```
   (Must run from `finnor-os/` root, not `apps/api/`, so the npm workspace's
   `packages/*` deps get uploaded — Vercel's monorepo detection finds
   `finnor-os/package.json`'s `workspaces` field from there.)
4. **Deploy the worker** (`apps/worker`, Railway project `innovative-prosperity`,
   service `finnor-worker`) if worker code changed: `railway up` from `finnor-os/`
   with the Railway CLI already authenticated to that project, or via the Railway
   dashboard's redeploy button. **Binding env vars
   (`CRM_BINDING`/`SCHEDULING_BINDING`/`INVENTORY_BINDING`/`DOCUMENTS_BINDING`/
   `COMMUNICATIONS_BINDING`) are resolved in the worker, not the API** — a change to
   any of them needs the worker redeployed too, a gotcha this project has hit before
   (Phase 4's session note).
5. **Deploy the marketing site** (`finnor-agency`, Vercel project id
   `prj_dttKVOUzFBGnSg6zNdRualYjQ3oe`, `finnorai.com`) if `src/` changed:
   ```
   cd /Users/paramdave/FINNOR
   VERCEL_ORG_ID=team_TlTo8L6Rvgb0H7uJh0G5GLDD VERCEL_PROJECT_ID=prj_dttKVOUzFBGnSg6zNdRualYjQ3oe vercel deploy --prod --yes
   ```
6. **Verify live, every time, not just "the deploy succeeded":** anonymous `curl` on a
   private path returns 401, a public path (`stats`/`setup/status`) returns 200,
   `https://finnorai.com/jarvis` loads and (signed in) shows real data. This is the
   step every phase's session log in `phase-status.md` already treats as non-negotiable
   — restated here as the last step of the flow, not a new requirement.

## What Task 6.7 still needs that's owner-blocked

**Auto-deploy to staging** genuinely cannot exist until a staging environment exists
(Task 6.1 — separate Supabase/Railway/Vercel projects, 100% owner-blocked, see
`owner-actions.md`'s new Phase 6 section). Once it does, the natural addition to
`ci.yml` is a `deploy-staging` job (Vercel/Railway CLI calls against the staging
project ids, gated on `push: branches: [main]`, same shape as the manual steps above)
that runs automatically after `test` passes — not written yet since there is nothing
real to point it at, and a workflow step that always fails is worse than an honest gap.

**Production promotion staying manual is a deliberate decision, not a gap** — the pack's
own Phase 6 DECISIONS text says "production only by manual promotion," which this repo
already does by construction (no auto-deploy-to-prod job exists or is planned). This doc
is what makes that manual step reviewable/repeatable rather than tribal knowledge.
