# Incident: public read access to real customer data via the JARVIS proxy

## What happened

`src/app/api/jarvis/[...path]/route.ts` (the marketing site's server-side proxy to the
finnor-os backend) accepted every GET request with no authentication check at all,
except three paths that were *meant* to be the only public ones. In practice every GET
was public, because the GET handler never checked for any credential — only POST did.

Anyone on the internet could call, for example:
- `https://finnorai.com/api/jarvis/resources/households` — real household records
  (addresses, contact info, water profiles)
- `https://finnorai.com/api/jarvis/audit` — the full action audit trail
- `https://finnorai.com/api/jarvis/read-models/household-360` — merged customer timelines

## Since when

Introduced in commit `aca99e6` ("JARVIS cinematic frontend: live command center per
spec"), 2026-07-17 — the proxy route was rewritten to talk to the real finnor-os
backend and the GET allowlist (`isAllowedGet`) was added, but no credential check was
ever added alongside it. Confirmed still live at the start of this session
(2026-07-18): `curl https://finnorai.com/api/jarvis/resources/households` returned
`200` with real records.

**Exposure window: roughly 1 day** (2026-07-17 to 2026-07-18, hotfixed same day it was
found).

## Who accessed it, if knowable

- `vercel logs` (CLI) only tails live traffic in this project's plan tier — no
  historical query was available for the exposure window.
- `site:finnorai.com/api/jarvis` returns zero results on web search — the endpoints
  were not indexed by search engines, meaning no evidence of broad crawler discovery.
- No evidence of exploitation was found, but the available tooling doesn't provide a
  complete access history — this can't be stated with full confidence either way.

## What was fixed

- **Same day (commit `0f6c957`):** stopgap — every private GET now requires the
  existing `x-jarvis-key` header (the same key POST already required), leaving only
  `stats`, `setup/status`, `integrations/status` public. Verified in production:
  anonymous `curl` on `resources/households` and `audit` now returns `401`.
- **Planned next (Task 1.4, in progress):** the shared key is being replaced entirely
  with real per-user Supabase JWTs forwarded by the proxy — the backend's existing
  `requireContext`/RBAC becomes the sole authorizer, and the shared admin key is
  deleted from code and Vercel once that ships.

## What was rotated

- Nothing yet. `JARVIS_ADMIN_KEY` stays in place until Task 1.4 ships real per-user
  login (deleting it now, before login exists, would lock out all write access).
- The Supabase **service-role** key should be rotated as a precaution regardless of
  whether exploitation is confirmed — this requires the project owner to roll it from
  the Supabase dashboard (no API-driven rotation available without a management
  access token). See `owner-actions.md`.

## Conclusion

A real, live exposure of customer data existed for approximately one day. It was
found and stopgapped within this session before evidence of exploitation was found
(no search-engine indexing; no way to fully rule out direct access). Full closure
requires: (1) Task 1.4's real per-user auth shipping, (2) the service-role key
rotation once the owner completes it, both tracked in `phase-status.md`.
