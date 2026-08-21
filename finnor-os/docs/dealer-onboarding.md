# Dealer onboarding pack (Phase 8, §8.5)

**Purpose:** once a real dealer signs up, this document is the entire path from "they
exist" to "JARVIS is running their business for real" — a sprint, not a project. Every
step below references real, already-built, already-tested machinery; nothing here is
aspirational.

## 1. Provision the tenant

Phase 4 operators should normally use the durable factory, which covers provisioning,
credential-reference checks, import, and tenant health in one resumable run:

```
npm run factory:client -- --command=start --manifest=/absolute/path/client.json
npm run factory:client -- --command=status --clientKey=acme-water
```

See `docs/client-factory.md` for resume, retry, cancellation, and foreground execution.
The lower-level commands below remain supported Phase 1–3 diagnostics.

After the factory is `passed`, run Phase 5 client certification with the PASS core
artifact plus verified deployment and tenant journey evidence. `ready_for_certification`
is not production approval. See `docs/release-certification.md`.

```
npx tsx scripts/provision-tenant.ts --clientKey=acme-water --name="Acme Water Co" --ownerEmail=owner@acme.com [--timezone=America/Chicago] [--reviewLinkUrl=https://g.page/r/...]
# or, for the versioned Phase 1 manifest foundation:
npx tsx scripts/provision-tenant.ts --manifest=docs/client-manifest.example.json
```

This one command (`scripts/provision-tenant.ts`, extended in B6) does four real
things, each already independently tested elsewhere in this codebase:
1. Resolves the tenant by its immutable, database-unique `clientKey`; reruns converge
   the same tenant rather than creating another row.
2. Seeds all 42 action-type policies + the price book via `seedTenantPolicies()` —
   the exact function `scripts/seed-tenant-policies.ts`'s own CLI calls (used for
   real to provision both the primary tenant and Dealer Zero in Phase 3).
3. Creates all nine integration checklist rows (native CRM/scheduling/inventory/documents;
   explicitly labeled emulator rows for unconfigured external providers).
4. Ensures the owner's Supabase login and application user. An email already owned by
   another tenant hard-fails before tenant or auth mutation; it is never reassigned.

Run provisioning with the migration/admin `DATABASE_URL`, not the restricted runtime
role. The command deliberately disables RLS for its global identity preflight and will
fail before touching Supabase Auth if the connection cannot perform that admin check.

If `--reviewLinkUrl` is omitted, `create_review_request`'s policy is left as
`PLACEHOLDER_NEEDS_REAL_VALUE` — pass it once the dealer's real Google Business review
link exists (get it from Google Business Profile → "Get more reviews").

The complete convergence path is covered against real Postgres by
`tests/integration/client-provisioning.test.ts`, including ten reruns, partial recovery,
tenant isolation, policy revision behavior, and settings/integration/location drift.
Run the command against staging before production as usual.

After provisioning, confirm readiness before touching any real data:
```
curl -s "https://<api-host>/api/setup/status" -H "authorization: Bearer <owner JWT>"
```
Expect `41/42` or `42/42` configured (only `create_review_request` may still show
`placeholder` if no review link was supplied yet).

## 2. Import the dealer's real data

Real customer data runs through `@finnor/import-engine`, which maps CSV/JSON/JSONL
into the existing `@finnor/data-platform` canonical write boundary. The synthetic
dealer script now calls that same engine; it is not a separate importer. See
`docs/declarative-client-imports.md` for the mapping contract, supported domains,
identity precedence, relationship order, safe update modes, and quarantine model.

**Procedure:**
1. Add a validated mapping under the Phase 1 manifest's `imports` array (or a standalone
   version-controlled mapping JSON). No client-specific TypeScript importer is needed.
2. Dry-run with `npm run import:client -- --tenantId=<uuid> --manifest=<path>
   --importKey=<key> --file=<export> --dry-run`; confirm the report and quarantine rows.
3. Run without `--dry-run`. A nonzero quarantine count returns exit code 2 and must be
   reviewed; valid rows still commit independently.
4. Import parents before children, then rerun corrected/previously blocked child files.
5. Replay each final file and confirm `created: 0`; source references and exact identity
   rules prevent duplicates while safe update modes protect trusted canonical values.

## 3. Per-provider live-flip procedure (test/sandbox → live)

External provider activation is tenant-scoped. **General procedure:** create the
provider-specific JSON secret under `finnor/tenants/<tenant-id>/<provider>`, put only
its reference/version on that tenant's `tenant_integrations` row (or manifest
`integration.credential`), set that row's binding/mode, then run the tenant-authenticated
setup/status probe and affected workflow. No process env mutation or per-tenant
redeploy is part of activation. See `docs/secrets-runbook.md`.

| Provider | Tenant binding | What the dealer needs to supply | Reference |
|---|---|---|---|
| Voice (Vapi) | `communications → vapi` | Their Vapi account, assistant, and phone-number identifiers | `owner-actions.md` §7 |
| CRM + scheduling | `crm/scheduling → native` or `crm → ghl` | GHL token/location/calendar only when GHL is selected | `owner-actions.md` §6 |
| Accounting (QuickBooks) | `accounting → quickbooks` | Their QuickBooks Online company + OAuth consent | `owner-actions.md` §7 |
| Payments (Stripe) | `payments → stripe` | Their Stripe account key and webhook signing secret | `owner-actions.md` §7 |
| E-sign (DocuSign) | `esign → docusign` | Their DocuSign account, integration key, RSA keypair, and Connect secret | `owner-actions.md` §7 |
| Marketing (Meta/Google Ads) | `marketing → meta_ads/google_ads` | Their ad account and OAuth/token material | `owner-actions.md` §7 |
| Documents | `documents → native` | Nothing — already real (PDF + Postgres) | Phase 4 |
| Inventory | `inventory → native` | Nothing — already real | Phase 4 |

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
