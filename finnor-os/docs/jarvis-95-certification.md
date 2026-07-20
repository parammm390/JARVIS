# JARVIS 95% — Certification (Phase 8)

**Status as of 2026-07-21: NOT YET CERTIFIED.** Per the pack's own exit gate, this
document signs off only when all 12 boxes below carry real, linked evidence. As of
today: **6 of 12 fully met, 4 partial with a precisely-named remaining step, 2 not
met** — one blocked entirely on Param supplying real third-party credentials, the
other blocked on the literal passage of 30 real days (the mechanism that produces
that evidence was built and proven working this session, but 30 days cannot be
compressed). Every box below states its real evidence or its real reason, honestly —
no box is marked done without a link to something that actually proves it.

This document itself is not "the finish line to fake" — it is the live scorecard.
Re-run it (or just re-check the boxes) as more days accumulate and more credentials
arrive; it should get more ✅ over time without anyone editing this file's prose, only
its checkmarks and evidence links.

---

## The 12 boxes

### 1. Zero public tenant-data exposure ✅ MET
External, unauthenticated scan against production (`https://api-psi-brown-95.vercel.app`
and `https://finnorai.com/api/jarvis/*`, zero auth header), re-run 2026-07-21: 18/18
private routes return 401 (`resources/*`, `read-models/*`, `actions/pending`,
`workflows/runs`, `comms`, `insights`, `audit`, `events`, `me`, `receipts`, `overview`,
`data-quality/findings`, `dlq`, `corrections`, the run-control routes, `POST actions`).
The 3 public-tier paths (`stats`, `setup/status`, `integrations/status`) confirmed
aggregate-only, no household-level fields. Evidence:
[`docs/security-verification-2026-07-21.md`](security-verification-2026-07-21.md) §1.

### 2. 42/42 actions configured, placeholder-free, versioned policies, one durable runtime ⚠️ PARTIAL
Dealer Zero: 42/42, zero placeholders (Phase 3, `docs/policy-matrix.md` +
`scripts/seed-tenant-policies.ts --dealerZero`). Primary tenant: **41/42**, re-verified
live today via `GET /api/jarvis/setup/status` — the one gap is
`create_review_request.review_link_url`, a real Google Business review link only Param
can supply (not fakeable, not a code gap — every future tenant hits this same one-field
gap, which is why `docs/dealer-onboarding.md`'s credential checklist lists it
explicitly). "One durable runtime": Phase 2 built two dispatch shapes — synchronous
single-step (`executePluginViaRuntime`) and async multi-step (`enqueueStep`/worker) —
not literally one code path, but every action type executes through exactly one of
these two, both receipted, both DLQ-covered, neither bypassable (verified by exhaustive
grep in Phase 2, re-stated honestly here rather than re-claimed as fully unified).

### 3. Zero emulator bindings; all providers healthy via real round-trips ❌ NOT MET
`GET /api/jarvis/integrations/status`, re-checked live today:
`{"bindings":{"payments":"emulator","esign":"emulator"}}`, plus `quickbooks`/`meta_ads`/
`google_ads` all `configured:false`. **100% blocked on Param supplying real
credentials** — every adapter, webhook (with real signature verification), health
check, and conformance test already exists in code for all 4 remaining providers (Phase
4). Exact, already-verified, no-business-required signup steps:
[`owner-actions.md` §7](owner-actions.md). `vapi` (voice) is real and healthy —
see box 4.

### 4. Real phone number; live inbound + outbound voice with archived transcripts ✅ MET
`+13463636975`, `status: active`. `GET /api/jarvis/integrations/status` re-confirmed
live today: `{"vapi":{"configured":true,"healthy":true}}`. Real outbound confirmation
calls live since 2026-07-19 (Param's explicit go-ahead,
[`owner-actions.md`](owner-actions.md) Vapi section); inbound caller-identity resolution
fixed and tested Phase 14 (`vapi-webhook-identity.test.ts`).

### 5. Real embeddings; eval ≥85%; citations on every answer; correction loop live ✅ MET
`GET /api/jarvis/setup/status` re-confirmed live today:
`{"embeddings":{"configured":true,"provider":"voyage-3.5"}}`. Retrieval eval: **95.0%
(38/40)**, run twice consecutively for stability (Phase 5, `tests/eval/retrieval-eval.test.ts`
— not re-run this session, since a fresh run costs real Voyage API calls against real
production-shaped fixtures; cited from its own verified, deterministic Phase 5 result).
Citations wired into every answer action's `DecisionReceipt.evidence`
(`answer-citations.test.ts`). Correction loop live and tested
(`corrections-loop.test.ts` — a differently-phrased re-query returns the corrected
fact, not the stale one).

### 6. Exactly-once effects proven + DLQ operational with replay ✅ MET
Property test: 5 concurrent relayers × 8 events → exactly one delivery per event
(Phase 2, `outbox.test.ts`-family). DLQ routes (`GET/POST /api/dlq*`) re-confirmed
401-anonymous live today; replay/discard tested end-to-end
(6 route tests + 5 function-level tests, Phase 2).

### 7. Staging mirrors production; all deploys via promotion flow ✅ MET (documented deviation)
Staging is live: isolated Postgres 18 (pgvector, all 35 migrations applied), a real
deployed worker (`finnor-worker-staging`), Dealer Zero seeded, simulator on, a Vercel
Preview API build (Phase 6). **Deviation from the pack's literal wording, deliberately
accepted by Param when asked directly:** staging's database is a Railway-hosted
Postgres instance, not a second Supabase project — cheaper and faster to provision, and
judged to satisfy the real isolation goal. `docs/promotion-flow.md` documents the
migrate → deploy-API → deploy-worker → deploy-marketing → verify-live sequence every
phase has actually followed.

### 8. Secrets managed; plaintext path disabled; fail-closed boot proven ⚠️ PARTIAL
AWS Secrets Manager is live for both `api` and `finnor-worker` — re-confirmed today by
pulling production env: `SECRETS_PROVIDER="aws-secrets-manager"`,
`FINNOR_SECRET_IDS` maps `DATABASE_URL`/`SUPABASE_SERVICE_ROLE_KEY`/`VAPI_API_KEY`/
`VAPI_WEBHOOK_SECRET`/`GROQ_API_KEY`/`REDIS_URL`/`SENTRY_DSN` (Phase 6). Fail-closed
boot is proven for the embeddings subsystem (`FailClosedEmbedder` throws when
unconfigured outside `NODE_ENV=test`, Phase 5) and for the plaintext-secrets guard
itself (`ALLOW_PLAINTEXT_ENV_SECRETS` forbidden in production, Phase 6). **"Plaintext
path disabled" is NOT met, deliberately**: the original plaintext env vars (including
`DATABASE_URL`) are still present in Vercel/Railway as an explicit rollback safety net
from the Phase 6 cutover, never removed. Closing this needs a dedicated pass to strip
them once the AWS-sourced path has run long enough to trust removing the fallback.

### 9. Restore drill passed + weekly automated verification green ⚠️ PARTIAL
The CI-tier drill (dump/restore against CI's own ephemeral Postgres,
`scripts/backup-restore-drill.ts` wired into `ci.yml`) is real and was confirmed green
end-to-end in Phase 6 (`docs/restore-drill-2026-07-19.md`) — not re-run this specific
session. **The full ask — restoring an actual production backup into a genuinely
separate, isolated environment, verified weekly on an automated schedule — is NOT
built.** It needs a real restore *target* distinct from both production and the
existing Railway staging DB (staging itself isn't a valid restore target — restoring
into it would destroy real staging data). This is the same gap Task 6.1's original
"second Supabase project" plan would have closed structurally; substituting Railway
for staging (box 7) left this specific piece open.

### 10. Load targets met; chaos matrix green in tests AND staging AND injected on production infra ⚠️ PARTIAL
Chaos matrix: green in tests (Phase 2, 18/18 nominal cells, `chaos-matrix.test.ts`) ✅;
green on real staging infra (Phase 6, `staging-infra-chaos-test.ts` — a real Railway
worker restart mid-flight against a real 80-command batch, 160/160 steps exactly-once,
zero duplicated) ✅; **injected on production infra during this certification's own
run** — real evidence now exists, this session: 3 of the calendar's 6 injection kinds
were fired for real against production, all logged with `outcome: pass` in
`finnor_os.failure_injections`: `approval_expiry_pileup` and `provider_egress_block`
(both against Dealer Zero), and `deploy_mid_workflow` — a genuine before/after snapshot
around this session's own real production deploy of `api`, `finnor-worker`, and the
marketing site (0 in-flight runs before, 0 after, reconciliation backlog unchanged at
0 — no orphaned or duplicated effects from the deploy itself). See box 11 and
[`docs/security-verification-2026-07-21.md`](security-verification-2026-07-21.md). This
is a real start, not the full ≥2/week × 30-day cadence the box requires. **Load
targets: NOT met.** Task 6.4's full-scale k6 run (50 events/s, 200 read VUs, 20
approvals/min, 10 min) still misses the pack's literal `p95<500ms`/`p95<800ms`
thresholds — root-caused with hard evidence (PgBouncer's own `SHOW POOLS` watched live
during a real burst) as a genuine session-mode-pooling capacity ceiling, not a bug.
Absolute throughput and successful completions are ~4-5x better than the original
baseline after Phase 6's fixes, but the literal target isn't met. Closing this needs a
real architecture decision (bigger dedicated Postgres/pooler tier, transaction-mode
pooling with a `search_path` rework, or an HTTP-native Postgres driver) — deliberately
not picked unilaterally. Full numbers: `docs/load-test-2026-07-19.md`.

### 11. 30-day Dealer Zero run: ≥99% completion, all injections recovered, scorecard committed ❌ NOT MET
**The mechanism is real and proven working as of today — the 30 days have not yet
passed, and cannot be accelerated.** Built this session: `finnor_os.readiness_log`
(one real row per tenant per day, computed from the same `reliability()` read-model
every hourly alert scan uses — never a fabricated number), a daily `daily_scorecard`
worker job now scheduled in production (`apps/worker/src/index.ts`'s
`PROACTIVE_SCANS`), and `finnor_os.failure_injections` (the real injection log, box 10).
**As of today: exactly 1 day of real scorecard data exists** for both the primary
tenant and Dealer Zero (both rows written live in production this session — reads:
`workflowSuccessRate: null` for both, honestly reflecting zero terminal workflow runs
in today's 1-day window so far, not a fabricated number). The cockpit's "30-Day
Certification" panel (`CertificationStatus.tsx`, this session) renders this trend live
— it will show real progress toward 30/30 days automatically as the scheduled job
keeps running, with zero further code changes needed. **This box closes itself,
mechanically, in 30 real days** — it is not a task that can be finished by writing
more code today.

### 12. Cockpit runs the full day; Playwright green; truthfulness enforcement in CI ✅ MET
Confirmed green two independent ways in Phase 7 (not re-run this session): the CI
debug branch's captured exit code (0, 10 passed / 6 correctly skipped) and the GitHub
Actions API's own run conclusion (`"success"`) for `marketing-ci.yml`'s final commit.
The `no-restricted-properties(Math.random)` ESLint rule fires for real (verified by
deliberately introducing and then removing a violation). Two named, non-blocking gaps
carried honestly from Phase 7, neither of which this box's own wording requires: the
technician board can't filter to "my visits" (needs a `users`↔`technicians` schema FK,
a real backend decision for a future session) and no formal Lighthouse LCP score was
recorded (real Navigation Timing measured directly against production instead: load
~405ms, TTFB ~68ms).

---

## Summary table

| # | Box | Status |
|---|---|---|
| 1 | Zero public tenant-data exposure | ✅ MET |
| 2 | 42/42 actions, one runtime | ⚠️ PARTIAL — 1 field owner-blocked per tenant |
| 3 | Zero emulator bindings | ❌ NOT MET — owner-blocked (4 providers, credentials) |
| 4 | Real phone number + voice | ✅ MET |
| 5 | Real embeddings, eval ≥85%, citations, corrections | ✅ MET |
| 6 | Exactly-once + DLQ | ✅ MET |
| 7 | Staging mirrors production | ✅ MET (documented deviation, accepted) |
| 8 | Secrets managed, fail-closed | ⚠️ PARTIAL — plaintext fallback not yet removed |
| 9 | Restore drill + weekly automation | ⚠️ PARTIAL — CI-tier only, no full-parity target |
| 10 | Load targets + chaos (tests/staging/prod) | ⚠️ PARTIAL — chaos real on all 3 surfaces now; load ceiling unresolved |
| 11 | 30-day Dealer Zero run | ❌ NOT MET — mechanism proven, needs 30 real days |
| 12 | Cockpit + Playwright + truthfulness | ✅ MET |

**6 fully met, 4 partial with a named remaining step, 2 not met (1 owner-blocked, 1
time-blocked).**

## What closes each remaining box

- **Box 3** (emulator bindings): Param supplies real Stripe/QuickBooks/DocuSign/Ads
  credentials — `owner-actions.md` §7 has exact, no-business-required steps for all
  four. Zero further engineering required per provider beyond flipping the one env var
  once credentials exist.
- **Box 2**'s one field: Param supplies a Google Business review link per tenant.
- **Box 8**: a dedicated pass to remove the plaintext env-var fallback once the
  AWS-sourced path has run long enough in production to trust the removal.
- **Box 9**: provision a genuinely separate restore-target environment (the
  originally-planned second Supabase project, or an equivalent), then wire the same
  weekly-schedule automation Phase 6 already designed for it.
- **Box 10**: a real infrastructure decision on the Postgres/pooler tier (see
  `docs/load-test-2026-07-19.md`'s options), plus continuing the failure-injection
  calendar's remaining 3 kinds (`worker_kill`, `webhook_replay` against a live webhook
  endpoint, `secrets_store_hiccup` against the real store) — each deliberately not
  fired against live production this session because they risk real customer-facing
  disruption (see `scripts/inject-failure.ts`'s own header for the exact reasoning per
  kind); each should run under an explicit go-ahead, the same pattern already used for
  every other real-customer-impacting flip in this project.
- **Box 11**: nothing left to build — the daily job keeps running, the trend keeps
  filling in, and this box goes green on its own in 30 real days.

## Standing infrastructure improvement, not one of the 12 boxes, done this phase

Phase 8 also closed a structural gap first logged 2026-07-18 (Task 1.6) and carried in
every phase's Blockers section since: production had no least-privilege database role
— every query ran as the schema-owning role, meaning RLS (present and correctly
configured on every table) was not actually doing independent work. This phase created
a real, restricted `finnor_app` role, proved it live against production (RLS genuinely
binds: zero rows with no tenant context, real rows with the correct one, zero rows with
a wrong one, DDL rejected outright), and committed the grants as migration `0032`
(corrected by `0034` after this session's own testing caught a real regression in the
first pass — the blanket grant briefly re-opened UPDATE/DELETE on the two
deliberately-append-only audit tables; fixed and re-verified live before this document
was written). **Not yet cut over** — Param chose to defer handing over the AWS
Secrets Manager write access needed to flip `DATABASE_URL` to the new role; the exact
remaining steps are in `owner-actions.md` §11, ready whenever he is.
