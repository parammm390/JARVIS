# Staging Environment Setup

Nothing here can be provisioned from this environment — it needs the founder's own Supabase/Railway/Vercel accounts and billing. This documents exactly what to create and how to wire it up; `railway.staging.json` and `.env.example` are the machine-readable half of this doc.

## What to provision

1. **A separate Supabase project** — never point staging at the production project. Staging needs its own `SUPABASE_URL` / `SUPABASE_SERVICE_ROLE_KEY` / `DATABASE_URL`. Run `npm run db:migrate` against it once (from CI, per this repo's existing convention — see root `README.md`).
2. **A separate Railway (or Render) environment** for `apps/worker` — use `railway.staging.json` as the build/deploy config (identical to `railway.json`; kept as a separate file so staging and production deploy configs can diverge later without touching each other).
3. **A separate Vercel preview/staging deployment** for `apps/api` and `apps/console` — Vercel's own preview-deployment or a dedicated staging project both work; either way, point its env vars at the staging Supabase project from step 1, not production.

## Env vars to set

Every var in `.env.example` needs a staging-specific value where it differs from production — in particular:

- `DATABASE_URL`, `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` → the staging Supabase project from step 1.
- `AUTH_DEV_BYPASS` → `0` even in staging (it's hard-disabled outside dev by `apps/api/lib/auth.ts` when `NODE_ENV=production`, but staging should exercise the real auth path anyway — set `NODE_ENV=production` for the staging deploy and never rely on bypass there).
- `SENTRY_DSN` → either a separate Sentry project, or the same project with `environment` (already set from `NODE_ENV` in `packages/tools/src/observability.ts`) distinguishing staging events from production ones.
- Real integration credentials (Vapi, QuickBooks, Ads, GHL) — use sandbox/test-mode credentials from each provider where available (QuickBooks has a real sandbox environment via `QUICKBOOKS_ENVIRONMENT=sandbox`, already supported), rather than live dealer credentials, so staging traffic never touches a real customer.

## Verification once staging exists

Run the exact same manual checks this repo already documents for a fresh dev environment: hit `GET /api/setup/status` against the staging tenant, confirm `readyForProduction` reports honestly, and run `scripts/load-test.ts --concurrency=20` against the staging `DATABASE_URL` before considering it ready for real traffic.
