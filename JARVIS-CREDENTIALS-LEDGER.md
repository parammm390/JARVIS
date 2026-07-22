# JARVIS Credentials Ledger

Single source of truth for which third-party keys exist and where they're actually set. **Read this before asking Param for a key or before assuming one doesn't exist.** Never store actual secret values here — only presence/absence per environment and the env var name. When Param supplies a new key in chat: set it in ALL FOUR surfaces below in the same session (Railway prod, Railway staging, Vercel prod, Vercel Preview) — never prod-only — then update this file's row. That's the standing rule from JARVIS-MAESTRO-PLAN.md §3; this file is where it gets enforced in practice.

Surfaces: **RW-prod** = Railway `innovative-prosperity` (finnor-worker + finnor-orchestrator) · **RW-stg** = Railway `imaginative-enchantment` (finnor-worker-staging) · **V-api** = Vercel project `api` · **V-agency** = Vercel project `finnor-agency` (each has Production + Preview).

| Credential | Env var(s) | RW-prod | RW-stg | V-api Prod | V-api Preview | V-agency Prod | V-agency Preview | Status |
|---|---|---|---|---|---|---|---|---|
| Voyage (embeddings) | `EMBEDDINGS_API_KEY` | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | **DONE** — live everywhere (2026-07-22) |
| Sentry | `SENTRY_DSN` (mapped via AWS Secrets Manager in RW-prod; literal plaintext var everywhere else) | ⚠️ mapped, unconfirmed resolves | ✅ | ✅ | ✅ | ❌ | ❌ | **DONE for RW-stg + V-api (2026-07-22).** No AWS CLI locally, but Node + `@aws-sdk/client-secrets-manager` (already a repo dependency) is — used Vercel api prod's own `AWS_ACCESS_KEY_ID`/`AWS_SECRET_ACCESS_KEY`/`FINNOR_SECRET_IDS` (a one-time read, Param's explicit go-ahead: "do the sentry thing yourself") to pull the plaintext DSN out of Secrets Manager, then set it as a literal `SENTRY_DSN` on RW-stg and V-api Preview — same outcome as option (a) below, no new standing AWS access granted to staging/preview (they just hold the plain string, nothing that can read Secrets Manager itself). V-agency (Prod+Preview) still not done — not touched this pass, out of scope (finnor-agency doesn't currently read `SENTRY_DSN` in code as far as verified). RW-prod's own Secrets-Manager resolution still unconfirmed (no direct read access to prove `secretProviderStatus()`'s `loaded: true` actually maps to a working Sentry init — that's an A2 task, not this one).|
| Redis | `REDIS_URL` | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | **DONE** — live everywhere (2026-07-22) |
| Bindings (native×4 + vapi) | `CRM_BINDING` `SCHEDULING_BINDING` `INVENTORY_BINDING` `DOCUMENTS_BINDING` `COMMUNICATIONS_BINDING` | ✅ | ❓ untested | ✅ | ✅ (added 2026-07-22) | n/a | n/a | Done in Railway+V-api; RW-stg not yet checked |
| Axiom | `AXIOM_TOKEN`, `AXIOM_DATASET=jarvis` | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | **DONE** — both vars live everywhere (2026-07-22; token was rotated once mid-session, updated cleanly) |
| healthchecks.io | `HEALTHCHECK_PING_URL` | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | **DONE** — live everywhere (2026-07-22) |
| Cloudflare R2 | `R2_ACCESS_KEY_ID` `R2_SECRET_ACCESS_KEY` `R2_ENDPOINT` `R2_BUCKET` | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | **BLOCKED, not just pending — Param doesn't have a debit/credit card to put on file (2026-07-22).** Cloudflare requires a payment method on file to enable R2 even for free-tier usage; what was pasted earlier (a Cloudflare API Token *policy* JSON) predates realizing this and isn't real R2 credentials anyway. No workaround found yet — flagging for whoever picks up A4.T4 (backups → R2) to either find a card-free path or pick a different $0 backup target when that phase starts. Not re-attempting until this changes. |
| Resend | `RESEND_API_KEY` (domain finnorai.com must be DNS-verified in Resend before real sends work — verify separately) | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | Key live everywhere (2026-07-22) — **domain verification status in Resend unconfirmed, check before A3.T5 relies on it** |

Last verified live via CLI (`vercel env ls`, `railway variables --kv`): 2026-07-22.

## Cloudflare R2 — what's actually needed (still pending)
What Param pasted was a Cloudflare **API Token policy** (the JSON you see when creating/editing a broad account-level API token — permission_groups + resources, no secret value included, and this particular one is very broad: ~280 permission groups, essentially full-account scope). R2 object storage doesn't use this kind of token at all — it uses **S3-compatible credentials** generated from a different screen: Cloudflare dashboard → R2 → "Manage R2 API Tokens" → create a token scoped to just "Object Read & Write" on one bucket. That flow outputs exactly 4 things needed here: `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, an account-specific endpoint URL (`https://<account_id>.r2.cloudflarestorage.com`), and the bucket name (create one first if none exists, e.g. "finnor-backups"). Ask Param for those 4 specifically, not another copy of the broad API token policy — and if that broad token was actually created (not just viewed), it's worth deleting since it's far wider-scoped than anything this project needs.

## When Param pastes new keys in chat
1. Set the env var(s) in all 4 surfaces above (6 actual targets counting Prod/Preview split) — don't stop at prod.
2. Re-run the relevant CLI probe to confirm they took.
3. Flip this file's row to all ✅ and update Status.
4. If the key unblocks a specific ⏸ task in JARVIS-MAESTRO-STATE.md, unblock it there too in the same edit.
