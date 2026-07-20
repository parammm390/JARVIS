# Dealer onboarding pack (Phase 8, §8.5)

**Purpose:** once a real dealer signs up, this document is the entire path from "they
exist" to "JARVIS is running their business for real" — a sprint, not a project. Every
step below references real, already-built, already-tested machinery; nothing here is
aspirational.

## 1. Provision the tenant

```
npx tsx scripts/provision-tenant.ts --name="Acme Water Co" --ownerEmail=owner@acme.com [--timezone=America/Chicago] [--reviewLinkUrl=https://g.page/r/...]
```

This one command (`scripts/provision-tenant.ts`, built this phase) does three real
things, each already independently tested elsewhere in this codebase:
1. Creates the tenant row.
2. Seeds all 42 action-type policies + the price book via `seedTenantPolicies()` —
   the exact function `scripts/seed-tenant-policies.ts`'s own CLI calls (used for
   real to provision both the primary tenant and Dealer Zero in Phase 3).
3. Creates the owner's real Supabase login via `scripts/create-user.ts` (used for
   real to create the actual production owner account in Phase 1).

If `--reviewLinkUrl` is omitted, `create_review_request`'s policy is left as
`PLACEHOLDER_NEEDS_REAL_VALUE` — pass it once the dealer's real Google Business review
link exists (get it from Google Business Profile → "Get more reviews").

**Not yet run end-to-end this session** — deliberately, to avoid creating a real
Supabase Auth user and a real tenant against production for a throwaway test. Its two
real building blocks (`seedTenantPolicies`, `create-user.ts`) are each independently
proven in production already (Phase 1 and Phase 3). The orchestration itself is a
straightforward sequence of two already-proven calls plus one row insert — low risk,
but genuinely untested as a single script until the first real dealer runs it. Run it
once against staging first when that day comes, exactly as every other phase's own
"staging first" rule requires.

After provisioning, confirm readiness before touching any real data:
```
curl -s "https://<api-host>/api/setup/status" -H "authorization: Bearer <owner JWT>"
```
Expect `41/42` or `42/42` configured (only `create_review_request` may still show
`placeholder` if no review link was supplied yet).

## 2. Import the dealer's real data

Real customer data import uses the same `@finnor/data-platform` primitives
(`createLead`, and its siblings for households/equipment/service history) that
`scripts/import-synthetic-dealer.ts` demonstrates against fixture data — that script
is the reference implementation, proven idempotent and dedup-aware
(`tests/integration/canonical-data-import.test.ts`): replaying the same import twice
produces zero duplicates, and malformed/ambiguous rows (missing contact info, likely
duplicate customers) surface as real `data_quality_findings` rows instead of being
silently written or silently dropped.

**Procedure:**
1. Get the dealer's export (most water-treatment CRMs/spreadsheets export CSV — a
   thin CSV→`SyntheticLeadFixture`-shaped mapper is the only new code a real import
   needs; the import primitive itself does not change).
2. Run the import against the real tenant, exactly like the synthetic version:
   `importSyntheticDealerData(tenantId)`-shaped call with the dealer's real rows.
3. Check the tenant's `data-quality` read-model (`GET /api/read-models/data-quality`)
   immediately after — every malformed/duplicate-candidate row the import couldn't
   confidently resolve is there, not silently dropped.
4. Re-run the same import file a second time and confirm the created-count is 0 (the
   idempotency proof, same assertion the test file already makes) — this is the real
   safety net if the dealer's export needs to be re-run after a correction.

## 3. Per-provider live-flip procedure (test/sandbox → live)

Every binding is one environment variable — this was Phase 4's own design goal, and
it holds. **General procedure, same for every provider below:** get the provider's
real live/production credentials from the dealer (never test/sandbox keys), set them
via the secrets flow (`docs/secrets-runbook.md` if `SECRETS_PROVIDER=aws-secrets-manager`
is active, else plain env vars), flip the one `*_BINDING` env var, redeploy `api` +
`finnor-worker`, then run the affected workflow end-to-end against the dealer's own
tenant before considering it live.

| Provider | Binding var | What the dealer needs to supply | Reference |
|---|---|---|---|
| Voice (Vapi) | `COMMUNICATIONS_BINDING=vapi` | A real Vapi phone number for their business (or reuse Finnor's own dialing number if the dealer is fine sharing it — ask first) | `owner-actions.md` §7 Vapi section — exact steps already run once for Finnor's own primary tenant |
| CRM + scheduling | `CRM_BINDING`/`SCHEDULING_BINDING=native` | Nothing — this is Finnor's own database, already the system of record, already live for every tenant today | `owner-actions.md` §6 |
| Accounting (QuickBooks) | `ACCOUNTING_BINDING=quickbooks`, `QUICKBOOKS_ENVIRONMENT=production` | Their real QuickBooks Online company + OAuth consent (one click on Intuit's screen) | `owner-actions.md` §7 |
| Payments (Stripe) | `PAYMENTS_BINDING=stripe` | Their real Stripe account, live secret key (`sk_live_...`), and a real webhook signing secret once the endpoint is live | `owner-actions.md` §7 |
| E-sign (DocuSign) | `ESIGN_BINDING=docusign` | Their real DocuSign account (not the demo/developer one), integration key + RSA keypair | `owner-actions.md` §7 |
| Marketing (Meta/Google Ads) | `MARKETING_BINDING=ads` | Their real ad accounts; `launch_ad_campaign` creates PAUSED campaigns only, forever — real spend requires a separate manual approval outside this system, by design | `owner-actions.md` §7 |
| Documents | `DOCUMENTS_BINDING=native` | Nothing — already real (pdf-lib, Postgres-backed) for every tenant today | Phase 4 |
| Inventory | `INVENTORY_BINDING=native` | Nothing — already real for every tenant today | Phase 4 |

**Database role:** every new tenant automatically gets the same least-privilege
`finnor_app` database role protection as every existing tenant (Phase 8, §8.1) — RLS
is enforced identically regardless of which tenant is provisioned when, no per-tenant
setup step needed here.

## 4. First-week supervision protocol

**No new mechanism needed — the existing risk-tier design already IS the first-week
protocol.** Per the pack's own §3 decision, carried unchanged into every policy this
system seeds: any action that contacts a customer, moves inventory, or touches money
keeps `requiresConfirmation: true` — this is the default for every newly-provisioned
tenant, not something to turn on specially for week one.

**What "supervision" concretely means for a new dealer's first week:**
1. The owner (or whoever the dealer designates) reviews every card in the Approval
   Inbox (`finnorai.com/jarvis`, signed in) before approving — the cockpit's "Why?"
   view (Phase 7, §7.3) shows the full evidence/policy/expected-outcome for each one,
   so this is a real review, not a rubber stamp.
2. Watch `GET /api/setup/status` and the new Phase 8 "30-Day Certification" panel
   (`CertificationStatus.tsx`, this session) daily — a fresh tenant's own
   `readiness_log` starts accumulating from day one, same mechanism Dealer Zero's
   30-day certification run uses.
3. Any read-only/pure-informational action type (`check_stock_level`,
   `check_technician_availability`, `size_equipment_for_household`, etc.) already
   auto-runs with no confirmation, per the pack's own policy matrix
   (`docs/policy-matrix.md`) — this is unchanged and correct for week one too; only
   customer/money/inventory-touching actions need the human loop.
4. **Nothing in this system currently offers a way to relax `requiresConfirmation`
   per action type after week one** — that's deliberate: the pack's own DECISIONS
   section calls this confirmation gate a permanent security boundary
   (`packages/orchestration/src/executor.ts`'s own words), not a training-wheels
   setting to remove later. If a real dealer eventually wants faster auto-approval
   for a specific, proven-safe action type, that is a genuine future policy decision
   requiring its own explicit sign-off — not a step in this onboarding pack.

## 5. Credential checklist (copy/paste for the dealer conversation)

- [ ] Vapi phone number (or confirm sharing Finnor's own)
- [ ] QuickBooks Online company + OAuth consent
- [ ] Stripe live secret key + webhook signing secret
- [ ] DocuSign production account + integration key + RSA keypair
- [ ] Meta Ads account + access token (optional — only if they want ad management)
- [ ] Google Ads account + developer token + OAuth (optional — same)
- [ ] Their customer/lead data export (CSV or similar) for the canonical import
- [ ] Google Business review link (for `create_review_request`)
- [ ] Owner's email for their real JARVIS login

None of these require a registered business beyond what the dealer already has to run
a real water-treatment company — same framing `owner-actions.md` already established
for Finnor's own primary tenant.
