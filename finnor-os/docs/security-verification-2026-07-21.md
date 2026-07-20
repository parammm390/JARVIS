# Security re-verification — 2026-07-21 (Phase 8, Task 8.1)

Real, direct checks against the live production system and this repo's actual git
history/dependency tree — not a re-statement of earlier phases' claims. Every finding
below has the command/evidence that produced it.

## 1. External anonymous scan — every private route, from outside, no local test harness

Ran directly against the deployed backend (`https://api-psi-brown-95.vercel.app`) with
zero auth header, and again through the public proxy (`https://finnorai.com/api/jarvis/*`):

```
resources/households        -> 401
resources/invoices           -> 401
read-models/pipeline-health  -> 401
read-models/reliability      -> 401
actions/pending               -> 401
workflows/runs                -> 401
comms                         -> 401
insights                      -> 401
audit                         -> 401
events                        -> 401
me                            -> 401
receipts                      -> 401
overview                      -> 401
data-quality/findings         -> 401
dlq                            -> 401
corrections                   -> 401
POST actions                  -> 401
POST corrections              -> 401
POST workflows/runs/:id/pause -> 401  (run-control route, added Phase 2.7 —
                                        not in the original Phase 1.8 test list,
                                        checked anyway since it's private)
```

Public tier, confirmed still open and aggregate-only: `stats` (200), `setup/status`
(200), `integrations/status` (200) — matches the pack's own 3-path allowlist.

Through the proxy specifically (`finnorai.com/api/jarvis/...`), the same anonymous 401s
were reconfirmed for `resources/households`, `actions/pending`, `dlq`, `corrections`,
`overview`, `me`. **Zero regressions from Phase 1's original incident** — 3 days after
the original exposure (public household reads with no auth at all), the surface remains
closed.

## 2. Security headers on deployed pages

`curl -sI https://finnorai.com/jarvis`:
```
content-security-policy: default-src 'self'; script-src 'self' 'unsafe-inline' 'unsafe-eval'; ...
permissions-policy: camera=(), microphone=(self), geolocation=()
referrer-policy: strict-origin-when-cross-origin
strict-transport-security: max-age=63072000
x-content-type-options: nosniff
```
All 5 headers configured in Phase 1.4 are still present on the live deployed page,
unchanged.

## 3. npm audit triage (production dependency tree, `npm audit --omit=dev`)

**0 critical, 3 high, 10 moderate — the pack's literal bar ("criticals fixed") is met.**
The 3 highs, triaged with real exposure analysis rather than blanket-flagged:

- **`drizzle-orm@0.36.4`** — GHSA-gpj5-g38j-94v9, "SQL injection via improperly escaped
  SQL identifiers" (CVSS 7.5). The vulnerable surface is dynamic **identifier**
  interpolation (`sql.identifier`/raw identifier templates built from untrusted input).
  Checked directly: `grep -rn "sql\.identifier\|sql\.raw(\`" packages/ apps/` — zero
  hits anywhere in this codebase. Every dynamic-identifier SQL in this repo goes through
  Postgres's own `format('...%I', t)` inside `DO $do$` migration blocks (server-side,
  operator-authored table names, never request input) — a different, non-vulnerable
  mechanism. **Not exploitable via any real code path in this app.** Fix requires
  `drizzle-orm@0.45.2`, a semver-major bump touching every query builder call site in
  the codebase (600+ test files) — too large to ship blind this session. Deferred as a
  documented, low-real-risk follow-up, not hidden.
- **`next@14.2.35`** — 3 high/moderate advisories, most specific to `images.remotePatterns`,
  `i18n`, and `rewrites` config. Checked directly: `grep -n "remotePatterns\|i18n\|rewrites\|images"`
  on both the marketing site's and the API's `next.config.mjs` — **zero matches, neither
  feature is configured anywhere in this deployment.** The one advisory that applies
  regardless of config (RSC request deserialization DoS, GHSA-h25m) is a real, live
  exposure on any App-Router app taking traffic, which this one does. Fix requires a
  Next.js 14→16 major bump; the marketing repo has **no automated test suite** (a
  pre-existing, separately-tracked gap — Phase 1's own exit-gate note), so a blind major
  bump against the live production site has no regression net. **Deferred, not fixed
  this session** — flagged as the single most valuable next security hardening pass,
  needs its own dedicated, verified upgrade session (add Playwright coverage first or
  run the bump behind a Preview deploy with the full Playwright suite as the gate).
- **`langsmith`** (transitive, via `@langchain/*`) — SSRF/prototype-pollution/redaction-
  bypass advisories in a tracing SDK. This codebase's LLM calls go through AWS Bedrock
  directly (`us.anthropic.claude-sonnet-4-6`), not LangSmith's own hosted tracing —
  `langsmith` is pulled in transitively by `@langchain/langgraph`'s checkpointer, not
  actively used for tracing. Real exposure is low; deferred alongside drizzle-orm/next
  since fixing it requires the same `@langchain/langgraph@1.x` major bump chain.

## 4. Git-history secrets scan (gitleaks v8.21.2, full history, 160 commits)

```
gitleaks detect --source . --log-opts="--all" --report-format json --exit-code 0
```
**1 finding, real but not a secret:** `NEXT_PUBLIC_SUPABASE_ANON_KEY` committed in
`.github/workflows/marketing-ci.yml` (commit 076f4e5). This is the Supabase
**publishable/anon** key (RLS-protected server-side, meant to be public) — Next.js
already bakes every `NEXT_PUBLIC_*` value into the client-side JS bundle on every page
load regardless of where else it appears, so committing it to a public CI workflow adds
no real exposure beyond what already ships to every browser tab that opens
finnorai.com. Confirmed via the Phase 7 log: this was a deliberate choice, not an
accident. **Zero real secrets (service-role keys, private keys, API secrets) found
anywhere in git history.** `.gitignore` correctly excludes `.env`, `.env.local`,
`.env.*.local`, `.env.vercel`.

## 5. RLS re-verification on every tenant-scoped table added since Phase 1

Audited every migration from `0016` through `0031` directly (not trusting the prior
phase notes) for `CREATE TABLE` + RLS enablement:

| Table (migration) | tenant_id? | RLS enabled + FORCED? |
|---|---|---|
| `decision_receipts`, `dead_letters` (0016) | yes | yes |
| `tenant_settings` (0024) | yes | yes |
| `document_contents`, `external_refs` (0025) | yes | yes |
| `provider_circuit_state` (0026) | **no — by design** (global per-provider, documented in the migration's own header; per-tenant budgets reuse `api_rate_limits` instead) | n/a |
| `embedding_cache` (0028) | yes | yes |
| `memory_corrections` (0030) | yes | yes |

`embeddings` (altered in 0027, but originally created in `0000_init.sql`, pre-dating
Phase 1) was double-checked too since it holds real tenant-derived semantic content —
confirmed present in `0000_init.sql`'s original bulk RLS-enable block alongside
`households`/`domain_actions`/etc. **Zero new tenant-scoped tables lack RLS.** This
matches (and re-confirms, not just repeats) every prior phase's own claim.

## 6. The one real, still-open, structurally significant finding — re-flagged, not newly found

**Production has no least-privilege application database role.** First discovered
2026-07-18 during Phase 1 (Task 1.6's audit-immutability fix), re-confirmed via file
audit this session, **still unresolved**: the app's `DATABASE_URL` in production
connects as the schema-owning role, not a restricted `finnor_app` role. Every table
above genuinely has `ENABLE ROW LEVEL SECURITY` + `FORCE ROW LEVEL SECURITY` set — but
Postgres's own documented semantics are that **superusers and the table owner itself
bypass RLS even when FORCE is set**, unless the connecting role is a distinct,
non-owning, non-superuser role. Supabase's project connection defaults to a role with
owner-equivalent privileges. This means: **the real, load-bearing tenant-isolation
guarantee in production today is the application layer's explicit `.where(eq(table.tenantId, ctx.tenantId))`
predicate on every tenant-scoped query (§0.3.5's "RLS + explicit tenant predicate,
both, always" rule) — not RLS itself.** RLS is real, present, and correctly configured,
but it is a second layer that isn't currently doing independent work in production,
because there is no restricted role for it to constrain. `tests/integration/anonymous-401-enumeration.test.ts`
and `tenant-isolation.test.ts` both already know this — they explicitly swap
`DATABASE_URL` to a `finnor_app` role (which doesn't exist in production) specifically
so RLS gets genuinely exercised in CI, rather than trusting a bypassed check.

**Not fixed this session, deliberately.** Creating a real least-privilege production
role and repointing `DATABASE_URL` touches every single production request — the
highest-blast-radius change this codebase could make, explicitly deferred by two prior
sessions (2026-07-18, 2026-07-19) as "riskier than anything else in this phase... needs
a dedicated pass." Phase 8 is that dedicated pass by charter (measurement/hardening/
certification, not new features) and this is squarely in its "zero cross-tenant access"
SLO — but it is also the single action in this entire phase most capable of a
production outage if done carelessly (a role-permission mistake fails closed = every
query breaks). **Flagging this explicitly for Param's decision rather than acting
unilaterally on shared production infrastructure** — see the open question at the end
of this session's summary.

## Honest bottom line

- External 401 scan: **clean**, zero regressions.
- Security headers: **present**, unchanged.
- npm audit: **0 critical** (pack's bar met); 3 highs triaged with real
  exposure analysis, all either not exploitable via this codebase's actual usage or
  requiring a major-version bump too risky to ship blind this session — deferred with
  reasons stated, not hidden.
- Git-history secrets scan: **clean** (the one hit is a deliberately-public key, not a
  secret).
- RLS-by-migration-audit: **clean**, every new tenant-scoped table has it.
- **One real, structurally significant, already-known gap re-confirmed, not newly
  introduced or newly discovered**: no least-privilege production DB role, meaning RLS
  isn't independently enforcing anything in production today — the app-layer tenant
  filter is doing 100% of the real work. This is Phase 8's most important open item for
  the "zero cross-tenant access" certification box.
