# JARVIS 95% — Phase Status

## Phase 1 — Security lockdown & real identity
Status: GATE-GREEN (one non-blocking owner follow-up outstanding — see Task 1.7)
- [x] Task 1.1 — Hotfix: require x-jarvis-key on all private GET routes (evidence: commit 0f6c957, deployed https://finnorai.com, verified `curl https://finnorai.com/api/jarvis/resources/households` → 401, `stats`/`setup/status` still 200)
- [x] Task 1.2 — Clean tree: committed the pre-existing views.tsx typography fix separately (evidence: commit e4b87e2)
- [x] Task 1.3 — Real Supabase email+password login (evidence: commits d8ebc8e, 8ca83bf). Uses `NEXT_PUBLIC_SUPABASE_URL`/`NEXT_PUBLIC_SUPABASE_ANON_KEY` already in Vercel (turned out to already be the correct publishable key for the finnor-os identity project — cross-referenced and confirmed, no new key needed). Login page `/jarvis/login`; session fully library-managed. Verified end-to-end on production (finnorai.com): signed in as the real owner, redirected to `/jarvis`, private paths went from 401→200, real data loaded ($12,491 overdue / 7 invoices, matching live production), sign-out correctly reverted to logged-out degraded view.
- [x] Task 1.4 — Proxy rewrite (evidence: commit d8ebc8e). Private paths forward the caller's bearer token verbatim; only the 3 public paths use the service token. Added zod validation on path segments + query params, per-IP rate limiting on the public tier, security headers (CSP/X-Content-Type-Options/Referrer-Policy/Permissions-Policy) via next.config.mjs. `x-jarvis-key`/`JARVIS_ADMIN_KEY` fully deleted from all code (`grep -rn` empty in both repos) and from the Vercel env var itself. Verified live: anonymous 401 on private paths, 200 on public paths, 400 on a malformed path segment, security headers present on response.
- [x] Task 1.5 — create-user.ts (evidence: commits 6b0430a, 9009aa7). Real owner login created against production: bloodride2@gmail.com, tenant 00000000-0000-4000-8000-000000000001, role owner, finnor_os.users row id b0f9c65d-412e-4613-9ae1-4cbeca32a6af. Password reset and relayed once in chat (account pre-existed in Supabase with an unknown password).
- [x] Task 1.6 — migration 0014 (finnor_app REVOKE, local/CI) + migration 0015 (unconditional trigger — the guarantee that actually holds in production) + audit-immutability.test.ts, 4/4 pass locally including the owner/superuser-connection cases (evidence: commit 9009aa7). **Correction logged:** 0014 alone was verified to be a no-op in production — direct read confirmed no `finnor_app` role exists there; the app connects as the schema-owner role, which always bypasses GRANT/REVOKE. 0015's trigger fires regardless of connecting role. Verified for real in production (not just trusting the migrate endpoint's `"ok":true`): inserted a labeled probe row in `action_log` (id 84a6e40d-8017-4702-94d0-a7fe89e4f2fe, `phase1_trigger_verification_probe`) and confirmed both UPDATE and DELETE against it are rejected with `finnor_os.action_log is append-only`.
- [~] Task 1.7 — Incident doc written (evidence: `docs/incident-2026-07-public-read-exposure.md`). JARVIS_ADMIN_KEY deleted from Vercel (`finnor-agency` production env) now that Task 1.4 is live. Remaining: service-role key rotation, blocked on owner action (no management API token available — see `owner-actions.md`).
- [x] Task 1.8 — Authz test wall (evidence: commit 8dc9917, `tests/integration/anonymous-401-enumeration.test.ts`, 16/16 pass). Anonymous 401 enumerated across every private route (resources, read-models, actions/pending, workflows/runs, comms, insights, stats, setup/status, integrations/status, audit, events, actions POST); resources/invoices tenant-scoped through the real route handler; public-tier responses (stats/setup/status/integrations/status) proven free of household-level fields. "Role without can_approve → 403" already covered by pre-existing `rbac-approval.test.ts`.

**EXIT GATE — evidence:**
- Anonymous curl 401 on every private path in production ∧ 200 on the 3 public paths ∧ 400 on a malformed path segment: verified directly against `https://finnorai.com` (see Log).
- Login works on the deployed site: verified end-to-end in-browser against `https://finnorai.com/jarvis/login` with the real owner account.
- `JARVIS_ADMIN_KEY`/`x-jarvis-key`: zero references in application code in either repo (`grep -rn` empty in `src/` and finnor-os `apps/`/`packages/`); the env var itself deleted from Vercel. (Historical mentions remain in this doc set and one pre-Phase-1 planning doc, which is expected and not in scope of this check.)
- Audit append-only test green: `audit-immutability.test.ts` 4/4 pass locally; production verified for real with a live probe row (see Task 1.6).
- Incident doc committed: `docs/incident-2026-07-public-read-exposure.md`.
- Full suites + typecheck green: finnor-os 378/378 pass (3 skipped, need real provider creds) + typecheck clean; marketing repo has no test framework (pre-existing, not introduced by this phase) but `next lint` and `tsc --noEmit` both clean, and two full `vercel deploy --prod` production builds succeeded.

**Not required by the exit gate, tracked anyway:** the Supabase service-role key rotation (see Task 1.7) remains pending on the owner. The pack's own EXIT GATE text for Phase 1 does not list this as a required condition — only the incident doc, which is committed.

## Phase 2 — One runtime, receipts for everything
Status: in-progress
- [x] Task 2.1 — Effect census (evidence: `finnor-os/docs/effect-census.md`). Key finding: only 4/42 action types (`start_water_test_workflow`, `request_proposal_signature`, `start_installation_workflow`, `start_invoice_to_cash_workflow`) run on `@finnor/workflow-runtime` today; the other ~38 execute via two bare-call paths (`GatedExecutor.execute` and its LangGraph mirror `graph/nodes.ts`) that call `plugin.execute()` directly with only a per-tool-call idempotency ledger — no workflow_run, no receipt, no DLQ, no chaos coverage. AMC renewal (Temporal, Task 2.6) only owns wait/timer/escalation logic and drafts through the same `domain_actions` pipeline, not a separate effect surface. This reframes 2.5 as generalizing path 3 (one adapter so every single-step action submits a 1-step `workflow_run`) rather than migrating 21 plugins' internals individually.
- [ ] Task 2.2 — Contracts (DecisionReceipt, event envelope, migrations)
- [ ] Task 2.3 — Exactly-once outbox + DLQ
- [ ] Task 2.4 — Receipts in the engine
- [ ] Task 2.5 — The great rewiring
- [ ] Task 2.6 — Temporal exit
- [ ] Task 2.7 — Run controls
- [ ] Task 2.8 — Chaos matrix

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
- ~~Supabase publishable/anon key~~ — resolved, `NEXT_PUBLIC_SUPABASE_ANON_KEY` already in Vercel was the correct one.
- `git push origin main` fails locally (`could not read Username for 'https://github.com': Device not configured` — no git credential helper configured in this environment). Does NOT block production deploys: `vercel deploy --prod` deploys directly from the local build and is working (verified). GitHub's copy of the repo is currently behind what's live on finnorai.com. See `owner-actions.md`.
- **Structural gap discovered (2026-07-18):** production Postgres has no restricted application role at all — every query the app makes runs as the schema-owner role. This is bigger than just the audit tables; it means there is currently no DB-level blast-radius limit on what a bug or compromised code path could do to ANY table in production, not just action_log/business_events. Phase 1's scope only required fixing the audit tables specifically (done via the trigger, which works regardless of role), so this broader gap was not fixed — flagging it here as a real, separate finding worth a deliberate look (likely: create a real least-privilege production role and repoint DATABASE_URL to it, which is riskier than anything done in Phase 1 so far since it affects every single request, not just audit-log edits).

## Log (newest first)
- 2026-07-18 — Task 1.8 shipped (commit 8dc9917), full suite 378/378 + typecheck green. **Phase 1 is GATE-GREEN** — every exit-gate item has direct evidence (re-verified live against https://finnorai.com in this session: anonymous 401 on households/audit/actions-pending, 200 on stats/setup-status, 400 on a malformed path segment, security headers present, real owner login works end-to-end). One follow-up remains outside the gate's required scope: service-role key rotation, owner-blocked (see Blockers).
- 2026-07-18 — Tasks 1.3+1.4 shipped and verified live on finnorai.com: real Supabase login, proxy forwards caller JWT, shared admin key fully deleted (code + Vercel env). Found and fixed along the way: local .env.local had a stale Supabase URL pointing at a different, older project (production's was already correct); the real owner account's email was never confirmed (pre-existing account from something else), fixed by extending create-user.ts's --reset-password to also set email_confirm. Commits d8ebc8e, 8ca83bf.
- 2026-07-18 — Task 1.7: wrote `incident-2026-07-public-read-exposure.md` (exposure window ~1 day, since commit aca99e6; confirmed not search-engine indexed; no historical Vercel access log available via CLI to fully rule out direct access). Added the service-role-key rotation ask to `owner-actions.md`.
- 2026-07-18 — Task 1.6 corrected: discovered migration 0014's REVOKE was a no-op in production (no `finnor_app` role exists there). Added migration 0015 (unconditional trigger, fires regardless of connecting role) and verified for real against production with a live probe row — UPDATE/DELETE both genuinely rejected. Commit 9009aa7.
- 2026-07-18 — Task 1.5 executed against production: real owner login created/password-reset for bloodride2@gmail.com. Task 1.6 (migration 0014 + audit-immutability.test.ts) written, verified against local embedded Postgres first: 2/2 pass, full suite 360/360 pass (3 skipped, need real provider creds), typecheck clean. Commit 6b0430a.
- 2026-07-18 — Task 1.1 shipped and verified live: anonymous GET on `resources/households` and `audit` now 401; `stats`/`setup/status`/`integrations/status` remain public. This closes the live incident (public read access to real customer data) confirmed active at session start.
- 2026-07-18 — Task 1.2: committed pre-existing coherent views.tsx diff separately (commit e4b87e2), tree was clean before further work began.
- 2026-07-18 — Phase 1 execution started from the JARVIS 95% MAESTRO PACK. Entry check confirmed the incident was live (`curl` returned 200 on households/audit, not 401).
