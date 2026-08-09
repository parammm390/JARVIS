# Phase 1 + Phase 2 live publish verification

**Date:** 2026-08-08
**Target:** Vercel Production
**Project:** `finnor-agency`
**Deployment ID:** `dpl_3EroTTrkDYy9DWpaQawbUoLyEFrX`
**Deployment URL:** https://finnor-agency-fctkbk6yp-bloodride2-3212s-projects.vercel.app
**Canonical alias:** https://finnorai.com
**Status:** Ready

## Build

- Local `npm run build`: passed.
- Vercel `npm run build`: passed.
- Existing Sentry ESM warning remained non-fatal in both builds.
- Vercel route manifest includes `/jarvis`, `/jarvis/work`, `/jarvis/customers`, `/jarvis/schedule`, and `/jarvis/money`.

## Live smoke

| Route | HTTP status | Content marker |
|---|---:|---|
| `/jarvis` | 200 | JARVIS |
| `/jarvis/work` | 200 | Work |
| `/jarvis/customers` | 200 | Household 360 |
| `/jarvis/schedule` | 200 | Dispatch Field |
| `/jarvis/money` | 200 | Cash Pressure |

The first deployment exposed a Vercel upload defect: the existing `.vercelignore` pattern `work` excluded `src/app/jarvis/work`. The pattern was narrowed to `/work`, the deployment was repeated, and the second production deployment above contains the Work route. No product or backend data was fabricated; unauthenticated live surfaces retain their explicit truth states.
