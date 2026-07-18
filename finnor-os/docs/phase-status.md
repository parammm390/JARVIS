# JARVIS 95% — Phase Status

## Phase 1 — Security lockdown & real identity
Status: in-progress
- [x] Task 1.1 — Hotfix: require x-jarvis-key on all private GET routes (evidence: commit 0f6c957, deployed https://finnorai.com, verified `curl https://finnorai.com/api/jarvis/resources/households` → 401, `stats`/`setup/status` still 200)
- [x] Task 1.2 — Clean tree: committed the pre-existing views.tsx typography fix separately (evidence: commit e4b87e2)
- [ ] Task 1.3 — Real Supabase login on the JARVIS frontend (blocked — see Blockers)
- [ ] Task 1.4 — Proxy rewrite: forward caller's real JWT, drop shared admin-key gate
- [x] Task 1.5 — create-user.ts (evidence: commits 6b0430a, 9009aa7). Real owner login created against production: bloodride2@gmail.com, tenant 00000000-0000-4000-8000-000000000001, role owner, finnor_os.users row id b0f9c65d-412e-4613-9ae1-4cbeca32a6af. Password reset and relayed once in chat (account pre-existed in Supabase with an unknown password).
- [x] Task 1.6 — migration 0014 (finnor_app REVOKE, local/CI) + migration 0015 (unconditional trigger — the guarantee that actually holds in production) + audit-immutability.test.ts, 4/4 pass locally including the owner/superuser-connection cases (evidence: commit 9009aa7). **Correction logged:** 0014 alone was verified to be a no-op in production — direct read confirmed no `finnor_app` role exists there; the app connects as the schema-owner role, which always bypasses GRANT/REVOKE. 0015's trigger fires regardless of connecting role. Verified for real in production (not just trusting the migrate endpoint's `"ok":true`): inserted a labeled probe row in `action_log` (id 84a6e40d-8017-4702-94d0-a7fe89e4f2fe, `phase1_trigger_verification_probe`) and confirmed both UPDATE and DELETE against it are rejected with `finnor_os.action_log is append-only`.
- [~] Task 1.7 — Incident doc written (evidence: `docs/incident-2026-07-public-read-exposure.md`). Service-role key rotation blocked on owner action (no management API token available — see `owner-actions.md`). JARVIS_ADMIN_KEY deletion deliberately deferred until Task 1.4 ships (deleting it now would lock out all write access with no replacement auth live yet).
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
- **Structural gap discovered (2026-07-18):** production Postgres has no restricted application role at all — every query the app makes runs as the schema-owner role. This is bigger than just the audit tables; it means there is currently no DB-level blast-radius limit on what a bug or compromised code path could do to ANY table in production, not just action_log/business_events. Phase 1's scope only required fixing the audit tables specifically (done via the trigger, which works regardless of role), so this broader gap was not fixed — flagging it here as a real, separate finding worth a deliberate look (likely: create a real least-privilege production role and repoint DATABASE_URL to it, which is riskier than anything done in Phase 1 so far since it affects every single request, not just audit-log edits).

## Log (newest first)
- 2026-07-18 — Task 1.7: wrote `incident-2026-07-public-read-exposure.md` (exposure window ~1 day, since commit aca99e6; confirmed not search-engine indexed; no historical Vercel access log available via CLI to fully rule out direct access). Added the service-role-key rotation ask to `owner-actions.md`.
- 2026-07-18 — Task 1.6 corrected: discovered migration 0014's REVOKE was a no-op in production (no `finnor_app` role exists there). Added migration 0015 (unconditional trigger, fires regardless of connecting role) and verified for real against production with a live probe row — UPDATE/DELETE both genuinely rejected. Commit 9009aa7.
- 2026-07-18 — Task 1.5 executed against production: real owner login created/password-reset for bloodride2@gmail.com. Task 1.6 (migration 0014 + audit-immutability.test.ts) written, verified against local embedded Postgres first: 2/2 pass, full suite 360/360 pass (3 skipped, need real provider creds), typecheck clean. Commit 6b0430a.
- 2026-07-18 — Task 1.1 shipped and verified live: anonymous GET on `resources/households` and `audit` now 401; `stats`/`setup/status`/`integrations/status` remain public. This closes the live incident (public read access to real customer data) confirmed active at session start.
- 2026-07-18 — Task 1.2: committed pre-existing coherent views.tsx diff separately (commit e4b87e2), tree was clean before further work began.
- 2026-07-18 — Phase 1 execution started from the JARVIS 95% MAESTRO PACK. Entry check confirmed the incident was live (`curl` returned 200 on households/audit, not 401).
