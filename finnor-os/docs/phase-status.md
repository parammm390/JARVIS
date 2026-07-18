# JARVIS 95% — Phase Status

## Phase 1 — Security lockdown & real identity
Status: in-progress
- [x] Task 1.1 — Hotfix: require x-jarvis-key on all private GET routes (evidence: commit 0f6c957, deployed https://finnorai.com, verified `curl https://finnorai.com/api/jarvis/resources/households` → 401, `stats`/`setup/status` still 200)
- [x] Task 1.2 — Clean tree: committed the pre-existing views.tsx typography fix separately (evidence: commit e4b87e2)
- [ ] Task 1.3 — Real Supabase login on the JARVIS frontend (blocked — see Blockers)
- [ ] Task 1.4 — Proxy rewrite: forward caller's real JWT, drop shared admin-key gate
- [ ] Task 1.5 — Idempotent create-user script + create the real owner user
- [ ] Task 1.6 — Audit/events tables append-only migration
- [ ] Task 1.7 — Rotate Supabase service-role key, delete JARVIS_ADMIN_KEY, incident doc
- [ ] Task 1.8 — Authz integration test wall

## Phase 2 — One runtime, receipts for everything
Status: not-started

## Phase 3 — All 42 actions configured + Dealer Zero
Status: not-started

## Phase 4 — Real providers on every binding
Status: not-started

## Phase 5 — Real memory & defensible intelligence
Status: not-started

## Phase 6 — Ops-grade platform
Status: not-started

## Phase 7 — The cockpit
Status: not-started

## Phase 8 — Proof of 95% (the certification)
Status: not-started

## Blockers / Owner actions pending
- Supabase **publishable/anon** key for project `kpxrnonhnhexutvdywbh` needed to build real browser login (Task 1.3). The only key currently available in env (`FINNOR_OS_SUPABASE_KEY`) was verified to be the **secret** key (`sb_secret_...` prefix) — confirmed unsafe to ship to the browser, so it was not used. See `owner-actions.md`.
- `git push origin main` fails locally (`could not read Username for 'https://github.com': Device not configured` — no git credential helper configured in this environment). Does NOT block production deploys: `vercel deploy --prod` deploys directly from the local build and is working (verified). GitHub's copy of the repo is currently behind what's live on finnorai.com. See `owner-actions.md`.

## Log (newest first)
- 2026-07-18 — Task 1.1 shipped and verified live: anonymous GET on `resources/households` and `audit` now 401; `stats`/`setup/status`/`integrations/status` remain public. This closes the live incident (public read access to real customer data) confirmed active at session start.
- 2026-07-18 — Task 1.2: committed pre-existing coherent views.tsx diff separately (commit e4b87e2), tree was clean before further work began.
- 2026-07-18 — Phase 1 execution started from the JARVIS 95% MAESTRO PACK. Entry check confirmed the incident was live (`curl` returned 200 on households/audit, not 401).
