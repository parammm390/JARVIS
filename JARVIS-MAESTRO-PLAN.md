# JARVIS MAESTRO PLAN v2.1 — EXECUTION-GRADE

**Planned by:** Fable 5 (max) · 2026-07-22 · v2.1 (v2 substance unchanged; this revision makes it hands-off executable)
**Executed by:** Sonnet 5 (high) sessions. One phase in focus per session; big phases legitimately span 2–3 sessions — the STATE file makes that safe.
**State file:** `/Users/paramdave/FINNOR/JARVIS-MAESTRO-STATE.md` — task checkboxes + evidence, same convention as `finnor-os/docs/phase-status.md` (P1/P2 style).
**Baseline:** source-verified 2026-07-21. §1 is ground truth and overrides any doc/comment/summary that disagrees.
**Mission:** backend 60→97 with new architecture; frontend 30→92 with a specified motion language. Ledgers in §2.

---

## §0 — EXECUTION PROTOCOL (mandatory, every session)

**Kickoff prompt Param pastes (the only thing he ever types):**

> Read /Users/paramdave/FINNOR/JARVIS-MAESTRO-PLAN.md §0 and §1 fully, then /Users/paramdave/FINNOR/JARVIS-MAESTRO-STATE.md. Execute phase **<ID or plain number — resolve numbers via §9>**: work its unchecked tasks top-down per §0. Evidence for every checkbox. Close with the End Ritual.

### Start Ritual
0. Read `/Users/paramdave/FINNOR/JARVIS-CREDENTIALS-LEDGER.md` — the standing source of truth for which keys exist and where. Never ask Param for a key already ✅ there; never assume a key is missing without checking it first. When Param supplies a new key mid-session, follow that file's own update procedure (set in all 4 surfaces, re-verify, flip the row, unblock the matching ⏸ task) instead of just dropping it into whichever env you're looking at.
1. Read plan §0 + §1, the target phase's section in full, and that phase's block in the STATE file.
2. Read every file on the phase's `Read:` line BEFORE writing code. Where the line says `discover:`, run that discovery first.
3. Orient: `git log --oneline -8` and `git status` in both repos. Note anything dirty before touching it.
4. If asked for a plain-numbered phase ("phase 4"), resolve via the §9 table. If the STATE file shows the phase already complete, say so and stop — never redo green work.

### Work Loop
- Execute tasks strictly in order (T1, T2, …). Skip only tasks marked ⏸ blocked-on-PARAM; continue with the next unblocked task.
- Commit per task or per coherent group; message style matches repo history.
- Check a box in the STATE file ONLY after its verification ran, with `(evidence: …)` — commit sha, test file + pass count, or pasted command output. Mirror the evidence style of `finnor-os/docs/phase-status.md` P1/P2 entries.
- Deviations: if reality differs from the plan in a small way (renamed file, different helper), adapt within the task's goal and add a `Deviation:` line under the checkbox. If it differs in a way that changes the DESIGN, stop — write findings under the phase in the STATE file and report; do not improvise architecture.
- Reuse before build: §1 and the phase notes list machinery that ALREADY EXISTS (ErrorKind, run controls, receipts, rate limiting, CSP headers…). Grep before creating anything with a similar name.

### Hard rules (unchanged from v2)
1. **Verify then claim** — no asserted-but-unprobed "done."
2. **Migrations:** embedded-postgres gate tests → staging (Railway PG + Vercel preview) → prod. Never against live Supabase directly.
3. **`apps/console` untouchable.** Root `src/` (finnorai.com) is the only frontend.
4. **Brand voice:** never "AI receptionist"; ambiguous → ask, don't decide; honesty language everywhere.
5. **Free tier only.** Approved deps per phase; prefer ≤150-line hand-rolls otherwise.
6. **Charts:** load the `dataviz` skill before chart code.
7. **Honest spectacle:** Dealer Zero labeled synthetic; emulator/sandbox labeled; demo labeled demo. Never fake data.
8. **No panel refactors before C1's snapshots cover them.** Strangler per panel.
9. **`PARAM:` = human action.** Surface and mark ⏸; never fake around it.
10. **Perf discipline:** GPU-only animated props; ≤2 ambient loops per viewport; effects pause offscreen/blurred; reduced-motion honored inside the motion primitives.

### Context Budget
When ~25–30% of context remains, stop starting new tasks and run the End Ritual. A phase spanning multiple sessions is normal and planned for — a clean partial handoff beats a rushed finish.

### End Ritual
1. Run the phase-relevant test suites + typecheck in the touched repo(s); paste results.
2. Commit everything; push if that's the session norm.
3. Update the STATE file: checkboxes + evidence; append one Session Log line (`date · phase · tasks done · next task · blockers`).
4. When a phase's EXIT GATE goes fully green, also append a summary entry to `finnor-os/docs/phase-status.md` (keep the P8 convention alive).
5. Final report to Param: what shipped (plain language), evidence pasted, exact next kickoff line to use.

---

## §1 — Ground truth baseline (source-verified 2026-07-21)

- One executor call site: `executePluginViaRuntime()` in `finnor-os/packages/orchestration/src/runtime-bridge.ts`; GatedExecutor and the LangGraph node both route through it. 4 async workflow-kind action types (lead-to-water-test, proposal-signature, proposal-to-installation, invoice-to-cash); `DEFAULT_GRAPH_ACTION_TYPES` in `graph/allowlist-executor.ts` lists 5 graph-routed types (schedule_water_test is graph-routed but synchronous).
- **21 plugins, 41 action types** (not 42), **21 worker job types** (not 20), **12 read-model views** (not 11). Fix docs claiming otherwise on first touch.
- DB: 68 tables, 35 migrations (0000–0034), single `finnor_os` schema. RLS via `set_config('app.tenant_id')` in `withTenant()` + explicit tenant filters everywhere. Audit immutability = DB trigger (0015, re-fixed 0034 after a real regression from 0032).
- workflow-runtime: outbox (exactly-once property-tested: 5 relayers × 8 events), inbox, reconciliation, compensation, DLQ with `canApprove(ctx,"*")`-gated replay/discard routes. **Run controls already exist** (pause/resume/cancel/retry/escalate + optimistic `version`, P2 Task 2.7) with owner-only routes under `apps/api/app/api/workflows/runs/[id]/*`.
- **Already-built machinery (from P1/P2 — extend, never duplicate):** `ErrorKind`/`TypedError`/`EventEnvelope`/`DecisionReceipt` in `packages/shared-types`; receipts opened/finalized in `packages/workflow-runtime/src/{receipts,steps}.ts`; approval-expiry hourly scan (`scan-approval-expiry.ts`) + `confirmationTimeoutHours` policy; per-IP rate limiting on the proxy's public tier + CSP/security headers in root `next.config.mjs` (P1 Task 1.4); authz test wall `tests/integration/anonymous-401-enumeration.test.ts`; `correlation_id` threaded through commands/steps.
- Auth: `apps/api/lib/auth.ts:54` gates dev bypass on flag AND `NODE_ENV !== "production"`. Known gap: `apps/api/middleware.ts:31` lacks the NODE_ENV gate (A1 fixes).
- JARVIS proxy `src/app/api/jarvis/[...path]/route.ts`: forwards caller's own Supabase JWT; exactly 3 public aggregate GETs (`stats`, `setup/status`, `integrations/status`) on the service token.
- Semantic memory: `VoyageEmbedder` (voyage-3.5, 1024-dim) real code, **never run with a real key; fails closed in prod**; hash embedder test-only.
- **THE BIG ONE:** binding selection in `apps/worker/src/handlers/run-workflow-step.ts` reads `CRM_BINDING`, `SCHEDULING_BINDING`, `INVENTORY_BINDING`, `DOCUMENTS_BINDING`, `COMMUNICATIONS_BINDING`, `PAYMENTS_BINDING`, `ACCOUNTING_BINDING`, `ESIGN_BINDING`, **defaulting to emulator when unset — and none are set in any checked env.** Even native code and real Vapi likely run emulated today. A1 fixes first.
- Secrets: `packages/security/src/secrets.ts` supports AWS Secrets Manager but defaults to plaintext env; prod's actual provider is unverified from source.
- Restricted role `finnor_app` (0032) built; cutover blocked on PARAM AWS handoff; prod connection role unverified.
- Hygiene: stale `apps/temporal-worker` entry in package-lock; `apps/orchestrator` unused.
- Deferred gaps now in scope: longTerm memory not in planner prompt; technician↔user link missing; session-mode pooling ceiling; Lighthouse never run.
- Frontend: root Next.js app; design tokens + motion stack verified live; **Three.js present but dormant**; ~15 JARVIS panels work today — never regress them.
- Anything "confirmed live via probe" in old summaries = unverified until re-probed this cycle.

---

## §2 — Definition of done: the % ledgers

### Frontend ledger (30 → 92)
| After | % | Jump |
|---|---|---|
| C-track | 42 | typed client, realtime client, FLOW engine, effects, Stage, snapshots, Lighthouse CI |
| D1 | 50 | Command Bridge + Orb + ambient language |
| D2 | 57 | physical approval cockpit, keyboard-complete |
| D3 | 64 | renderer registry: designed UI for all 41 types + 8 flagship scenes |
| D4 | 70 | Pipeline Theater + run browser + DLQ v2 |
| D5 | 75 | Map Theater + technician my-day |
| D6 | 80 | personalization engine + push nudges |
| D7 | 85 | scenes wave 2 + cmd-K + effects sweep |
| D8 | 88 | Showtime demo mode |
| D9 | 92 | sound, 60fps proofs, a11y ≥95, Lighthouse ≥90 |

### Backend ledger (60 → 97)
| After | % | Jump |
|---|---|---|
| A1–A7 | 78 | real bindings, observability, registry+breakers+fault injection, watchdogs/triage/backups, guardrail proofs, pooling, SLO engine |
| B1 | 82 | realtime SSE backbone + CQRS projections |
| B2 | 86 | Planner V2: DAGs, simulation, predicted receipts, clarify, repair, evals |
| B3 | 89 | optimizer, forecasting, anomaly, churn, RAG citations |
| B4 | 91 | Dealer Zero 2.0, counterfactual replay, shadow-diff, training mode |
| B5 | 93 | cost governor, model routing, cost-in-receipts |
| B6 | 94 | policy V2 + dealer-in-a-day bootstrap |
| B7 | 96 | fortress: authz matrix, PII, ladders, k6, fleet worker |
| B8 | 97 | push, digests, auto weekly certification report |

SLOs (A7 establishes in `readiness`; certification panel renders): post-approval success ≥99% · workflow p95 budgeted per kind · queue oldest-pending <60s p99 · heartbeat ≥99.9% · DLQ ~0/day, triage <24h · API 5xx <0.1% · planner evals ≥95% · critic catch ≥90% · cross-tenant leaks 0 nightly · restore drill <30min monthly · **event→pixel <2s** · **prediction accuracy tracked**.

Honesty invariant: every count/status/"live" claim matches probed reality, always.

---

## §3 — Free tool roster

**Status as of 2026-07-22 (audited live via `vercel env ls` + `railway variables` across every project/env):**
- ✅ DONE, live in prod only: `EMBEDDINGS_API_KEY` (Voyage — note: code reads this exact name, NOT `VOYAGE_API_KEY`) in Railway worker prod + Vercel api/finnor-agency prod. `SENTRY_DSN` in Railway worker prod (via AWS Secrets Manager mapping, not a literal var — unconfirmed it actually resolves). `REDIS_URL` in Railway worker+orchestrator prod + Vercel api prod.
- ⚠️ **Established pattern — audit for this on EVERY future credential, not just these three:** every one of the above is prod-only. Missing from Vercel Preview (both projects) and Railway staging (`finnor-worker-staging`) in every case. A1 must close this for existing keys AND enforce it going forward (no new secret ships prod-only).
- ❌ **Still need PARAM to sign up (~15 min, $0):** Axiom (`AXIOM_TOKEN`,`AXIOM_DATASET`) · healthchecks.io (`HEALTHCHECK_PING_URL`) · Cloudflare R2 (`R2_*`) · Resend (`RESEND_API_KEY`, domain finnorai.com).

Zero-signup free: MapLibre GL + OpenFreeMap tiles (no key) · Protomaps PMTiles on R2 (fallback tiles) · pgvector (Supabase extension) · Web Push/VAPID (self-generated) · k6 OSS · fast-check (already in style) · oasdiff · OSRM public demo (internal-grade) · Web Audio (synthesized) · GitHub Actions (2000 min/mo — replay on PR, heavy stuff nightly).

Existing: Vapi (real number), Anthropic API, Supabase, Vercel ×2, Railway.
Never needed: real dealer accounts, real provider production keys, anything paid. §8 sandboxes are $0 developer environments — a standing decision.

---

## §4 — TRACK A: Foundation

### A1 — Truth & Config Day (≈½–1 session; FIRST)
Read: `apps/worker/src/handlers/run-workflow-step.ts` · `apps/api/middleware.ts` · `apps/api/lib/auth.ts` · `packages/memory/src/semantic.ts` · discover: setup/status route file
Discover env reality yourself, don't trust any doc including this one: `vercel env ls` (link both `apps/api` and root repo dirs first) and `railway variables --service <name> --kv` for `finnor-worker`, `finnor-orchestrator` (project innovative-prosperity), and `finnor-worker-staging` (project imaginative-enchantment).
- T1 Grep-confirm the full `*_BINDING` list + default logic; **verify/set** in Railway prod, Railway staging, Vercel prod, AND Vercel Preview (2026-07-22 audit found bindings + `EMBEDDINGS_API_KEY`/`SENTRY_DSN`/`REDIS_URL` all prod-only — close that everywhere, not just where it was already caught): CRM/SCHEDULING/INVENTORY/DOCUMENTS=`native`, COMMUNICATIONS=`vapi`.
- T2 Invert the default in code: Finnor-owned capabilities (crm/scheduling/inventory/documents) default `native`; emulator for them = explicit opt-in. External caps keep emulator default. Fix any tests that relied on the old default (tests become explicit, never the default).
- T3 Binding report in `setup/status`: capability → resolved binding, source (env/default; tenant-row source arrives A3), mode.
- T4 `middleware.ts:31`: add the NODE_ENV gate to match auth.ts.
- T5 Docs honesty pass: 41/21/12 wherever 42/20/11 is claimed (phase-status.md, certification doc, onboarding pack).
- T6 Hygiene: `npm install` prunes stale temporal lockfile entry; delete `apps/orchestrator` (git preserves).
- T7 Env-consistency sweep (not a signup task — these 3 already exist, just prod-only): propagate `EMBEDDINGS_API_KEY` (real Voyage key, confirmed live) and `REDIS_URL` to Vercel Preview + Railway staging; propagate/verify `SENTRY_DSN` resolves via the AWS Secrets Manager mapping in Railway prod and add it to Vercel (both projects, both envs) + Railway staging.
- T8 ⏸ PARAM: remaining signups only — Axiom, healthchecks.io, Cloudflare R2, Resend (Voyage/Sentry/Redis already done — see T7).
EXIT GATE: staging+prod `setup/status` shows native/vapi with sources (pasted); one Dealer Zero smoke action's receipt shows `binding=native`; grep shows zero temporal lockfile refs; `vercel env ls` + `railway variables` for both projects/all envs pasted showing EMBEDDINGS_API_KEY/SENTRY_DSN/REDIS_URL present everywhere, not just prod.

### A2 — Observability & Vitals (1 session)
Read: `apps/worker/src/index.ts` · `apps/worker/src/queue.ts` · `packages/orchestration/src/runtime-bridge.ts` · `packages/workflow-runtime/src/receipts.ts` · note: `correlation_id` already threaded (P2 T2.4) — extend it, don't re-invent.
Deps: pino + Axiom transport, `@sentry/nextjs`, `@sentry/node`.
- T1 `traceId` minted at instruction intake, carried DomainAction → job meta → worker → plugin → receipt (ride the existing correlation_id thread where it already runs); all log lines `{traceId, tenantId, actionId, workflowRunId?}`.
- T2 pino structured logging api+worker → Axiom transport (env-gated; pretty console locally).
- T3 Sentry: api, worker, root frontend (client+server), release-tagged by git SHA.
- T4 Worker heartbeat: 30s upsert `worker_heartbeat` row (migration) + healthchecks.io ping (dead-man switch).
- T5 `GET /api/vitals` (auth'd): queue depth, oldest-pending age, heartbeat age, DLQ count, binding health placeholder, scan clocks — single cheap query each.
- T6 `GET /api/activity?since=<cursor>` (auth'd, tenant-scoped): merged feed (action_log + workflow events + calls), monotonic cursor, limit 50.
EXIT GATE: staged worker kill → healthchecks alert fires (screenshot/email) + vitals shows stale heartbeat; one traceId visible in api log, worker log, and receipt (pasted).

### A3 — Integration Registry & Provider Hardening (≈2 sessions)
Read: `packages/tools/src/` (stripe, quickbooks, docusign, ads, vapi-rest, errors) · `packages/tools/src/emulators/` · `run-workflow-step.ts` binding resolution.
- T1 Migration `tenant_integrations` (tenant_id, capability, binding, mode real|sandbox|emulator, config jsonb, health ok|degraded|down|unknown, last_check_at, last_error) + RLS + tenant filter. Resolution order: tenant-row → env → A1 defaults. Seed rows for primary + Dealer Zero matching reality. `setup/status`/`integrations/status` read from it.
- T2 Health-check job (new job type, 10 min): cheapest authenticated no-op per real binding; writes health/last_error.
- T3 Reliability wrapper `packages/tools/src/reliability.ts` (~120 lines): timeout (15s default, overridable), classified retry w/ jittered backoff (reuse `ErrorKind` — retry RETRYABLE only), circuit breaker (5 fails→open, 60s half-open), metrics logged w/ traceId. Wrap EVERY outbound call in packages/tools. Breaker state → tenant_integrations.health.
- T4 Emulator fault injection: emulators honor `EMULATOR_FAULTS=cap:mode,…` env + per-tenant config — latency/5xx/429/malformed-webhook. Emulators become adversarial doubles.
- T5 Resend adapter (real email): finnorai.com domain; **recipient allowlist enforced inside the adapter** (Param-owned + `*@finnorai.com` only); volume caps consistent with win-back safety.
- T6 Webhook hardening: signature verification on every inbound route (Vapi first); unsigned rejected in prod + logged.
EXIT GATE: fault flag → breaker opens → health degraded → recovery closes (test output pasted); real allowlisted email sent via gated action w/ receipt; Dealer Zero email attempt blocked with honest receipt failure.

### A4 — Reliability Core (≈2 sessions)
Read: `packages/shared-types/src/index.ts` (**ErrorKind/TypedError exist — extend**) · `packages/workflow-runtime/src/{outbox,dlq,steps}.ts` · `apps/worker/src/handlers/` · note: approval-expiry scan already exists (P2 T2.8).
- T1 Taxonomy completion: classify every plugin/runtime failure into the existing ErrorKind space extended to `RETRYABLE|TERMINAL|NEEDS_HUMAN|CONFIG`; reflection retries only RETRYABLE; receipts record the class. Sweep all 21 plugins.
- T2 Watchdog job (5 min): stuck runs (kind-specific deadlines), orphaned steps, aging approvals (nudge only — expiry scan already handles deadline), unfinalized receipts → activity + alert on high severity.
- T3 DLQ auto-triage: rule-based (ErrorKind × provider × count) → suggested disposition stored on the row; replay/discard stay owner-gated.
- T4 Backups: `backup_db` job — 6-hourly pg_dump → R2; retention 14 daily + 8 weekly. `scripts/restore-drill.sh`: latest dump → staging/embedded restore → smoke suite → verdict. Document RPO ≤6h / RTO ≤30min.
- T5 Rate limiting: Upstash token bucket on intake + auth-sensitive private routes (public tier already limited in P1 — extend, don't duplicate); 429 + Retry-After.
- T6 Idempotency: intake + webhooks accept/derive idempotency keys; duplicate submission can't double-create DomainActions; webhook dedupe via inbox for all providers. (External side-effect exactly-once already lives in ScopedToolRegistry/external_operations — leave it.)
EXIT GATE: induced stuck run flagged <5min (pasted); restore drill verdict pasted; poison job replayed clean post-fault; duplicate-intake test green.

### A5 — Guardrail Proof (≈2 sessions)
Read: `tests/integration/anonymous-401-enumeration.test.ts` · `audit-immutability.test.ts` · `packages/security/src/secrets.ts` · migrations 0014/0015/0032/0034.
- T1 Approval-gate property test: every entry point (GatedExecutor, graph path, direct bridge misuse, forged SQL transitions) × fuzzed statuses → zero executions. CI on embedded-postgres.
- T2 Tenant-isolation fuzz: every route enumerated, tenant-A JWT vs tenant-B resources → 0 leaks. CI + nightly live probe vs staging (extends the P1 401-enumeration wall).
- T3 Boot-check, fail-closed in prod (api+worker): bypass var present at all / SECRETS_PROVIDER unset-or-env without loud override / native capability resolving emulator / (post-cutover) owner-role `current_user`. Results into `setup/status`.
- T4 Secrets completion: ⏸ PARAM confirms ASM live; then explicit-provider-required in prod; plaintext path stays only as a LOUD emergency override (Sentry + log siren).
- T5 Role-cutover runbook `docs/runbooks/role-cutover.md` (steps, probes, rollback). ⏸ PARAM AWS handoff to execute.
- T6 CI security: gitleaks + osv-scanner required checks; audit-immutability regression extended to every audit table.
EXIT GATE: CI red/green proofs for T1/T2; one deliberate misconfigured staging boot refused (pasted); nightly probe summary green once.

### A6 — Load Ceiling (1 session)
Read: `packages/db/index.ts` (`withTenant`, `getPool`) · driver/ORM config · chaos harness scripts.
- T1 Transaction-pooling audit: `withTenant` guarantees `set_config(...,is_local=true)` inside explicit transactions; no session prepared statements; nothing needs LISTEN/NOTIFY on the pooled string (B1's gateway uses a direct connection).
- T2 Staging cutover to transaction-mode pooler (port 6543); chaos load before/after with numbers.
- T3 Prod cutover with documented instant-rollback string; coordinate with A5.T5 if the AWS handoff happened (one change, two wins). 48h soak.
EXIT GATE: before/after concurrency numbers pasted; 48h quiet soak (watchdogs+heartbeat).

### A7 — Certification & SLO Engine (1 session)
Read: `packages/read-models/src/index.ts` · daily scorecard job handler · failure-injection calendar doc.
- T1 §2 SLO table computed in `readiness` (extend scorecard): value, target, 30-day trend, error-budget burn.
- T2 Failure-injection calendar v2: restore drill (monthly), secrets-boot drill, pooling load drill, provider-fault drills, worker-kill; outcomes → failure-injections read-model.
- T3 Re-probe + re-date every "confirmed live" claim from old summaries.
EXIT GATE: readiness returns the full SLO payload with real values (pasted); one full drill visible end-to-end.

---

## §5 — TRACK B: Backend Maestro

### B1 — Realtime Backbone + CQRS Projections (≈2 sessions)
Read: `packages/workflow-runtime/src/outbox.ts` · `apps/worker/src/{index,queue}.ts` · `packages/security` (JWT verify) · `packages/read-models/src/index.ts`.
- T1 `pg_notify('jarvis_events', {tenantId,kind,id,ts})` triggers on inserts/updates to action_log, workflow_step, dead_letters, domain_actions(status). IDs only — listeners refetch via authz'd APIs.
- T2 SSE gateway on Railway (Vercel can't hold connections): small Hono/express server in `apps/worker` (own port) — `GET /events` verifies Supabase JWT (reuse packages/security), tenant-scopes, relays NOTIFY. **Direct (non-pooled) PG connection for LISTEN.** 15s heartbeat comments; reconnect contract (Last-Event-ID) documented for C1's client.
- T3 CQRS projections `packages/projections`: projector job consumes outbox events → incrementally maintains materialized rows for the 3 hottest views (pipelineHealth, reliability, activity); API serves precomputed; NOTIFY on update; rebuild-from-scratch command (replayable by design). Other 9 views stay query-time.
- T4 Voice live relay: Vapi webhook status (+ monitor stream where available) → NOTIFY → SSE, so in-progress calls stream to the cockpit.
EXIT GATE: curl SSE w/ JWT → event within 2s of a Dealer Zero action (pasted); projector rebuild rows === query-time rows (diff test green).

### B2 — Planner V2: the Deliberative Loop (≈3 sessions)
Read: `packages/orchestration/src/index.ts` (planner + reflection) · `graph/nodes.ts` · `executor.ts` · `runtime-bridge.ts` · `packages/policy-schema/src/index.ts`.
- T1 Plan DAGs: migration adds `plan_id`,`depends_on[]` to domain_actions. Multi-action plans execute as dynamic workflows on the existing runtime (topological order, per-step receipts). Single actions unchanged.
- T2 `simulate(action)` on the plugin interface: default = schema-level field-change prediction; real dry-runs for quotation, scheduling, inventory, invoice-to-cash, bulk-notify. Output = **predicted receipt** stored beside the pending action.
- T3 Predicted-vs-actual: reflection diffs predicted vs actual receipts (field-level); accuracy tracked per action type → readiness ("predicted correctly N%").
- T4 Clarify-first: first-class `clarification_request` action type — ambiguity yields a question card, never a guess.
- T5 Health-aware planning: integration health in planner context; never plans through an open circuit — degrades to a manual-step suggestion with reason.
- T6 Plan repair: TERMINAL step failure → planner receives the receipt, proposes a revised remainder → normal gate. Repair lineage on the plan.
- T7 Eval harness `tests/planner-evals/`: 60+ golden cases (expected types+params, must-ask, repair, health-degraded). **Replay mode on PR CI ($0), live nightly.** ≥95% gate. Critic seeded evals (cross-tenant ref, off-book price, missing prereq, volume violation) ≥90%.
- T8 Schema-repair loop: one repair attempt w/ validation error, then loud failure. Memory→planner (canonicalSummary + top-k=5 semantic rows, 1.5k-token cap, Voyage via `EMBEDDINGS_API_KEY` — already live prod, confirm staging/preview via A1.T7) behind `PLANNER_MEMORY=1`; ship only if evals don't regress.
EXIT GATE: two-step plan executes in dependency order w/ per-step receipts; simulated quotation shows predicted totals pre-approval + post-execution diff; ambiguous eval case yields a question; replay evals green in CI.

### B3 — Intelligence Layer (≈2 sessions)
Read: `packages/read-models/src/index.ts` · `packages/memory/src/semantic.ts` · scheduling + inventory plugins.
- T1 Route optimizer: OSRM matrix (demo server) + nearest-neighbor + 2-opt (~150 lines, unit-tested vs seeded geo). Daily `route_suggestion` action per technician through the gate; briefing reports km saved vs naive.
- T2 Slot recommender: score = drive time + load balance + SLA risk; used by scheduling proposals.
- T3 Forecasting: hand-rolled Holt-Winters (~120 lines, tested vs known series) — cash collections, visit volume; 14-day bands in briefing.
- T4 Anomaly detection: rolling z-scores on vitals + failure-rate series → `anomaly` activity events + threshold alerts.
- T5 Churn/risk scoring: transparent heuristic (recency, frequency, AMC, balance), labeled "heuristic" in UI; feeds win-back targeting.
- T6 RAG citations: pgvector migration (test seam: in-memory cosine); ingest job chunks reference docs (⏸ PARAM: drop public water-treatment PDFs in a folder, or reuse existing corpus) → Voyage embeddings → water-domain-knowledge answers **with chunk citations in receipts**; planner cites domain claims.
- T7 Reorder points: EWMA usage-rate per item → suggested reorder actions with reasoning.
EXIT GATE: optimizer beats naive on seeded data (number pasted); forecast bands from real Dealer Zero history; one receipt showing document citations.

### B4 — Dealer Zero 2.0: Simulation, Replay, Shadow (≈2 sessions)
Read: discover: `grep -ri "simulator\|life.sim" finnor-os --include=*.ts -l` then read the engine + its fixtures.
- T1 Scenario packs: seeded discrete-event engine — `normal_day`, `brutal_summer`, `payment_crunch`, `equipment_recall`, `chaos_day` (pairs w/ A3 fault flags). Deterministic by seed (same seed → identical stream, tested).
- T2 Time-compression API: scripted day at N× for D8 (sandboxed to Dealer Zero, labeled DEMO).
- T3 Counterfactual replay: record a day's instructions/events; re-run vs a code change in staging; normalized **receipt-diff report** = behavioral regression testing. Nightly staging job + pre-release gate.
- T4 Shadow-diff: candidate build on staging consumes a read-only mirror of Dealer Zero intake; receipts diffed vs prod for N hours pre-promote. Manual first, automated report second.
- T5 Training mode: bootstrap a sandbox tenant mirroring Dealer Zero for dealer onboarding practice (pairs w/ B6.T5).
EXIT GATE: determinism test green; a deliberate behavior change caught by replay diff (report pasted); one shadow report generated.

### B5 — Cost Governor + Model Routing (1 session)
Read: discover: `grep -ri "anthropic" finnor-os/packages --include=*.ts -l` → the LLM client; critic + planner call sites.
- T1 LLM ledger: wrap the client — every call logs model, tokens in/out, cost, purpose, actionId/traceId. Migration `llm_calls`.
- T2 **Cost-per-action in receipts** ("this decision cost $0.004").
- T3 Router: purpose→model map (planning = big model; critic/triage/classification = Haiku; embeddings = Voyage). Prompt caching on stable prefixes (policies, tool defs).
- T4 Budgets: per-tenant daily token budget row; governor pre-call — soft cap warns, hard cap defers non-urgent to next window with an honest CONFIG receipt. Never silent.
- T5 Cost in readiness + briefing (daily spend by purpose/tenant).
EXIT GATE: receipt with real cost pasted; router proof (critic logged as Haiku); forced hard-cap defer with honest receipt.

### B6 — Policy Engine V2 + "Dealer in a Day" (1 session)
Read: `packages/policy-schema/src/index.ts` · domain_policies migrations · P8 onboarding pack doc.
- T1 Policy versioning + effective dating (migration); receipts record the policy **version** applied.
- T2 Policy simulation: candidate policy re-evaluated over last 30 days of receipts → delta report, through the gate.
- T3 Drift guard: action drafted under vN, approved under vN+1 → approval payload flags the diff (D2 renders).
- T4 Coverage lint in CI: every action type's required policy keys present per tenant → red on gap.
- T5 Tenant bootstrap: one command creates a tenant from template — starter policies, integration checklist rows, optional training-mode seed. Onboarding pack updated.
EXIT GATE: policy sim report on real history pasted; lint red/green demo; fresh tenant bootstrapped to full completeness minus the known human-only field.

### B7 — Fortress (≈2 sessions)
Read: `apps/api/middleware.ts` · route dirs for guard patterns · `apps/worker/src/{index,queue}.ts` · A2's pino config · root `next.config.mjs` (**P1 already added CSP/security headers — extend**).
- T1 Authz matrix from code: script extracts route→guard table → `docs/authz-matrix.md`; CI diffs (drift = red).
- T2 PII discipline: pino redact paths (emails/phones/addresses) + redaction unit tests; data-retention purge job per policy.
- T3 Degradation ladders (documented + chaos-tested each): Redis→in-memory+alert · Axiom→console+buffer · Sentry→log-only · Voyage→skip recall, log · Vapi→circuit+manual-step degrade · Resend→queue+retry window. Vendor down ≠ app down.
- T4 Webhook fuzzing: fast-check malformed-payload property tests on all inbound routes.
- T5 k6 suite: intake burst, approval storm, read-model fan-out; nightly-lite vs staging; results → scorecard; capacity model documented.
- T6 Fleet-ready worker: priority lanes (interactive > batch), per-queue concurrency caps, SIGTERM graceful drain (finish/release claims), backpressure (depth → 429 non-urgent intake). Prove 2-process safety locally + brief staging multi-instance.
- T7 CSP tightening pass both frontends; secret-rotation runbook + one rehearsal.
EXIT GATE: ladder matrix run once each (outcomes pasted); k6 numbers vs capacity model; drain test loses zero jobs.

### B8 — Notification & Digest Engine (1 session)
Read: A3's Resend adapter · `voice_notify_failure` job pattern · root app layout for SW registration.
- T1 Web push (VAPID): service worker in root app; `push_subscriptions` migration; worker pushes approval-needed / SLO-burn / watchdog-critical; per-user opt-in.
- T2 Owner daily digest email (Resend, allowlisted): briefing + anomalies + cost + SLO deltas, brand-voiced.
- T3 Auto weekly certification report (readiness + drills + replay diffs) → PDF (pdf-lib) → R2. The honest marketing artifact.
- T4 Notification prefs + quiet hours in user_prefs (D6 pairs).
EXIT GATE: real push received on Param's device from a staged approval; digest email received; one weekly report generated end-to-end.

---

## §6 — TRACK C: Frontend Foundation + FLOW

Deps (free): `@tanstack/react-query` (or systematized SWR if already dominant — ONE layer), `@tanstack/react-virtual`, `cmdk`, `recharts`, `maplibre-gl` (D5). Three.js already present.

### C1 — Data spine + live client + Stage (≈2 sessions)
Read: `src/app/api/jarvis/[...path]/route.ts` · `ls src/components/jarvis/` + read the 3 biggest panels · `finnor-os/openapi.json` (regenerate from zod first if stale) · root `package.json`, tailwind config · discover: design token files.
- T1 Typed client via `openapi-typescript` → `src/lib/jarvis-client.ts`; all fetches through it + the proxy.
- T2 `useLiveQuery`: SSE-first (B1 contract: reconnect w/ backoff + Last-Event-ID) with adaptive-polling fallback (2–3s visible, 15–30s blurred, cursor deltas). One hook, used everywhere.
- T3 Stage `/jarvis/stage` (auth'd): every primitive/choreography/renderer mounted from fixtures — dev harness + visual QA + walkthrough.
- T4 Playwright visual snapshots: Stage + all ~15 existing panels (protection BEFORE strangler work).
- T5 Lighthouse CI on /jarvis routes (≥85 now, ≥90 by D9).
EXIT GATE: typecheck-enforced client in use by ≥1 migrated panel; snapshots green in CI; first Lighthouse report pasted.

### C2 — The FLOW motion engine (≈2 sessions)
Read: grep framer-motion usage · existing motion/token files.
Primitives in `src/components/jarvis/ui/motion/`: `<Enter>` `<Stagger>` `<Ticker>` `<Flight>` `<Press>` + `choreo.*` helpers. Tokens: 150/250/400ms; springs stiff(380,34)/soft(260,28); named easings. **Reduced-motion handled inside the primitives.**
Catalog (trigger → behavior → reduced fallback), built on the Stage with FPS meter:
- T1 Core interaction set FLOW-01..13: 01 PanelSurface (translateY 12→0 + fade, soft spring → fade) · 02 CascadeStagger (30ms → none) · 03 OdometerTicker (600ms roll → swap) · 04 RipplePress (radial 400ms → none) · 05 LiquidFill (vessel + meniscus wobble → bar) · 06 PipeFlow (dash-offset liquid → static highlight) · 07 ValvePulse (1.2s glow → accent) · 08 BurstFail (30-particle spray 500ms → red flash) · 09 BypassUnfurl (path self-draws 400ms → appears) · 10 StampApprove (scale 1.4→1 + 2px/80ms shake + ink → color) · 11 ShatterReject (clip-path fragments → slide-away) · 12 DeckFan (stack→fan → list) · 13 FlyToDock (layoutId flight → reposition fade).
- T2 Ambient/scene set FLOW-14..25: 14 OrbStates (D1 spec → static orb) · 15 CameraPan (scale .98 + slide + fade 400ms → crossfade) · 16 TypeSpeech (20ms/char, skippable → full text) · 17 BorderBeam (3s loop → static) · 18 CausticHeader (SVG turbulence → texture) · 19 RadarSweep (waves under cap → count) · 20 DrawSpark (500ms self-draw → drawn) · 21 RouteDraw (polyline + marker glide → shown) · 22 PinAura (pulse → colored pin) · 23 DigestCinematic (3–5s skippable → text) · 24 ThemeTide (2s crossfade → step) · 25 ShakeDeny (4px/200ms → outline flash).
EXIT GATE: all 25 on the Stage with fixtures + snapshots; FPS ≥55 on the worst one (meter screenshot); reduced-motion pass recorded.

### C3 — Effects toolkit + primitive kit (1 session)
- T1 `ui/fx/`: glow/bloom (tier-colored layered shadows) · glass (backdrop-blur + noise, contrast-checked) · grid/scanline backdrop (Bridge only) · particle micro-burst engine (~100-line canvas; powers FLOW-08 + completions) · decrypt/typewriter · border-beam.
- T2 Primitives: Panel, StatCard, RiskBadge (materials: green glass / amber steel / red obsidian), StatusDot, geometry-matched Skeletons, EmptyState (with next-action), ErrorState (with recovery), Drawer, hand-rolled Sparkline.
- T3 All registered on the Stage + snapshots; dev FPS overlay component.
EXIT GATE: Stage sections complete; snapshots green; glass contrast audit both themes pasted.

---

## §7 — TRACK D: Frontend Maniac

### D1 — Command Bridge + Orb (≈2 sessions)
Read: current `/jarvis` layout + nav components · Three.js's existing integration pattern (grep three) · C-track outputs.
- T1 Bridge layout: left rail (nav + pulse), center stage (contextual scene, FLOW-15 transitions — one continuous space), right rail (ticker + approvals dock). Existing panels become scenes progressively (strangler, snapshots first).
- T2 Pulse bar: heartbeat dot pulsing at real age, queue sparkline (FLOW-20), DLQ badge, binding health lights (**EMU-tagged where emulator** — honesty), scan clock. `/api/vitals` on live hook.
- T3 Activity theater (right rail): SSE-fed, FLOW-02 entries, event iconography, click→receipt. Numbers only tick (FLOW-03).
- T4 The Orb (Three.js awakened): GPU particle water-sphere, 10–20k instanced particles. FLOW-14 states: idle slow-breathing swirl · planning accelerating vortex · executing pulses ejected on orbital rings (one per active run) · blocked amber holding · error fracture→reassembly. SSE-driven. Pauses offscreen/blur; static gradient orb on reduced-motion/low-power (device-memory heuristic).
- T5 Ambient: FLOW-18 caustic header, grid backdrop, FLOW-24 dawn/day/dusk/night palettes.
EXIT GATE: screen recording — backend event → orb + feed react <2s; FPS ≥55 on Bridge (meter shot); reduced-motion walkthrough clean.

### D2 — Approval Cockpit, physical (1 session)
Read: current approval inbox panel · run-control + confirm routes · B2/B6 payload shapes (render gracefully absent until those ship).
- T1 Cards: 3D hover tilt (subtle), RiskBadge materials, param **diff preview** (before/after + price-book provenance), critic chip (expandable), policy-drift flag (B6), predicted receipt (B2).
- T2 Choreography: FLOW-10 stamp → FLOW-13 flight to executing dock (live-tracked) · FLOW-11 shatter on reject · FLOW-12 deck for batch (summed risk; any high-tier requires typed confirmation) · FLOW-25 on blocked.
- T3 Keyboard-complete: j/k, enter, a, r, u; roving tabindex; designed focus.
- T4 Honest undo: approved→pending only while unclaimed (small API PATCH w/ optimistic lock, built here); 5s toast; already-claimed says so truthfully.
EXIT GATE: full approve/reject/batch/undo cycle mouse-free (recording); snapshots green.

### D3 — Action scenes wave 1 (≈2 sessions)
- T1 `renderers/registry.ts`: all 41 types → renderer + fixture. Tiers: flagship / standard (schema-driven designed card, plugin-family styling) / designed fallback (payload behind debug toggle). **Zero raw-JSON default surfaces.** Used in approvals, feed, receipts, workflow steps.
- T2 Flagships 1–4: water_test (gauge cluster, staggered needle sweep, unsafe bands pulse, recommendation callout) · quotation (document assembles: line items cascade, total ticks, PDF "prints" into embed) · voice call (real-peak waveform player, transcript synced to playhead, intent chips pop at their timestamp and fly to a spawned-actions tray; live calls stream via B1) · inventory (tanks drain/fill FLOW-05, thresholds, reorder diff).
- T3 Flagships 5–8: scheduling (slots materialize, chosen slot locks with click animation, load bars) · invoice_to_cash (cash river: particles invoice→paid, aging narrows) · bulk-notify (FLOW-19 radar + volume-safety meter + send-window) · lead_to_water_test (liquid funnel).
EXIT GATE: 41/41 resolve on the Stage; 8 flagships snapshot; same renderer proven in feed + approval + receipt contexts.

### D4 — Pipeline Theater (1 session)
Read: workflow_runs/steps API + **existing run-control routes (pause/resume/cancel/retry/escalate — wire them, don't rebuild)**.
- T1 Live run view (4 async kinds): liquid pipeline — chambers/valves, FLOW-06 edge flow, FLOW-07 active pulse, FLOW-08 burst on fail, FLOW-09 compensation bypass unfurl; node click → step receipt drawer (D3 renderers). Hand-rolled SVG.
- T2 Run browser: filter kind/status/age; expand → theater; watchdog-flagged stuck runs badged; **run-control buttons wired to the existing owner routes**.
- T3 DLQ browser v2: A4 triage suggestion + reasoning; owner-gated replay/discard; post-replay jump-link into the new run's theater.
EXIT GATE: live Dealer Zero workflow watched end-to-end w/ SSE step transitions (recording); a fault-injected run shows the compensation path.

### D5 — Map Theater + My-Day (≈2 sessions)
- T1 Backend pair: technician↔user link migration + `GET /api/technician/my-day`; Dealer Zero households seeded with Houston-metro lat/lngs in simulator fixtures.
- T2 Dispatch map: MapLibre GL, dark style, OpenFreeMap tiles (PMTiles-on-R2 fallback documented): FLOW-22 pin auras, FLOW-21 route self-draw, day scrubber replay, load side panel, pin→household-360 drawer.
- T3 My-day (mobile-first): ordered stops, one-tap external nav, visit checklist, gated complete-visit. "My visits only" finally real.
EXIT GATE: map renders B3's optimized route w/ km-saved; my-day works as the linked technician on a phone viewport (screenshot).

### D6 — Personalization Engine (≈2 sessions)
- T1 `user_prefs` migration + CRUD: homepage, density, pinned panels, accent, sound, notification prefs, quiet hours. RLS by user.
- T2 Role scenes: owner → Bridge+Orb+certification · dispatcher → Map Theater + approvals dock · technician → My-Day. Defaults by role, prefs override. Tenant accent theming through tokens.
- T3 Frecency pre-staging: client frecency ranks panels → pre-fetch likely-first data, order rails; unopened panels collapse to ticker chips.
- T4 Since-you-were-away: `last_seen_at` + digest endpoint → FLOW-23 cinematic (typed orb narration, top-3 mini-scenes, deep links, skippable). Contextual brand-voiced greeting with real stats.
- T5 Push nudges (B8): opt-in in prefs; approval push deep-links to the exact card.
EXIT GATE: two roles land on different scenes (recordings); digest plays real deltas; push tap lands on the exact approval.

### D7 — Scenes wave 2 + cmd-K + effects sweep (≈2 sessions)
- T1 Remaining flagships: AMC countdown ring · web-research source cards w/ extracted claims · ops-overview live tiles · service-reminder timeline · technician-report annotated summary · compliance-doc paginated preview · marketing cards (honest EMU labels) · household-360 scene upgrade.
- T2 cmd-K (`cmdk`): navigate / search (receipts, households, runs) / **instruct** — natural-language → planner's proposed actions materialize as D3 cards in the palette → one keystroke to the gate. The flagship interaction.
- T3 Effects sweep w/ restraint: FLOW-17 beams on executing cards, FLOW-04 ripple on interactive surfaces, glass/glow per hierarchy, designed Empty/Error states everywhere.
EXIT GATE: 41/41 designed (Stage proof); palette instruct-flow recorded end-to-end.

### D8 — Showtime (1 session)
- T1 `/jarvis/showtime`: B4 time-compression drives a scripted Dealer Zero day at ~60× — calls arrive, plans materialize, stamps slam, pipelines flow, map moves, orb reacts. DEMO-labeled throughout.
- T2 Guided tour beacons (skippable), brand-voiced, honesty-forward ("everything you can pause and inspect is a real receipt").
- T3 Pause-and-inspect: every element opens its real receipt. The pitch: nothing here is a mockup.
EXIT GATE: full run screen-recorded start→finish, zero console errors; every inspected element resolves to a real receipt.

### D9 — Sound, 60fps, a11y, ship (≈2 sessions)
- T1 Sound layer (Web Audio, synthesized, zero assets, **off by default**, prefs toggle): stamp thunk, completion chime, alert ping, dock whoosh. Tasteful or deleted.
- T2 Perf: virtualize all long lists; route-level code splitting; orb/map/charts lazy; bundle audit; `content-visibility` on off-stage panels; low-power mode (auto + manual); FPS proofs on Bridge/Theater/Map.
- T3 A11y: focus management (drawers/palette), aria-live="polite" feed, contrast audit on glass+materials both themes, reduced-motion full QA, keyboard path through every primary flow.
- T4 Lighthouse ≥90 perf / ≥95 a11y in CI; all snapshots green; zero-layout-shift verified on primary panels.
EXIT GATE: Lighthouse report pasted; FPS numbers pasted; reduced-motion + keyboard walkthrough recorded.

---

## §8 — S-track: free developer sandboxes ($0 — standing decision)

Prior final decision (95% pack): payments/e-sign ship in test environments; live keys only when a dealer signs. When PARAM creates free dev accounts — Stripe **test mode**, QuickBooks **developer sandbox**, DocuSign **developer demo**, Meta **sandbox ad account** — one session wires all four adapters end-to-end and flips `tenant_integrations.mode` to `sandbox` (UI labels sandbox, never "live"). Until then: emulators + A3 fault injection are the honest stand-in.

---

## §9 — Session order (plain numbers resolve here)

| # | Phase | | # | Phase |
|---|---|---|---|---|
| 1 | A1 | | 15 | A5 |
| 2 | A2 | | 16 | B3 |
| 3 | C1 | | 17 | D5 |
| 4 | B1 | | 18 | B4 |
| 5 | C2 | | 19 | D6 |
| 6 | C3 | | 20 | B5 |
| 7 | D1 ← first jaw-drop | | 21 | D7 |
| 8 | A3 | | 22 | B6 |
| 9 | D2 | | 23 | A6 |
| 10 | A4 | | 24 | B7 |
| 11 | D3 | | 25 | B8 |
| 12 | B2 | | 26 | D8 |
| 13 | D4 | | 27 | A7 |
| 14 | (finish any open A/B) | | 28 | D9 · then S anytime |

~28 phase slots; with the ×2/×3 phases, realistically **~40 focused sessions**. The STATE file makes any phase safely resumable mid-way, so session count never threatens correctness.

Hard dependencies: D1/D4/D6-push ← B1 · D2's predicted-receipt/drift chips ← B2/B6 (render gracefully absent before) · D5 ← its own migration + B3 routes · D8 ← B4 · B2.T8 ← Voyage key · A5.T4/T5 + A6 prod cutovers ← PARAM (ASM confirm / AWS handoff) · D9 gates ← all visual work done.

---

## §10 — Risks & honest engineering notes

- **Orb/WebGL on weak machines:** device-memory + rAF-budget heuristic → static orb; manual low-power toggle; Bridge fully usable with orb off.
- **SSE topology:** gateway on Railway (Vercel can't hold connections), direct PG connection for LISTEN (pooled string carries no NOTIFY — also why A6 doesn't break it). Client always has polling fallback.
- **pgvector tests:** embedded-postgres may lack the extension — test seam = in-memory cosine; prod = real pgvector. Flagged, not hidden.
- **Pooling cutover:** rollback string documented before prod; 48h staging soak.
- **Secrets flip:** rehearse the refused boot on staging deliberately before prod.
- **Binding default inversion:** tests get explicit flags — fix tests, never the default.
- **Tiles/OSRM:** OpenFreeMap keyless; PMTiles-on-R2 fallback; OSRM demo = internal-grade, self-host on Railway only if it ever matters.
- **GH Actions minutes:** replay evals on PR; live evals/fuzz/k6 nightly; cache node_modules + Playwright browsers.
- **Email safety:** allowlist inside the Resend adapter — synthetic households structurally unmailable.
- **Spectacle restraint:** glow/glass/particles follow hierarchy — if everything shines, nothing does. The Stage FPS meter is the taste-cop.
