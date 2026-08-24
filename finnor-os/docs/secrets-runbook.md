# Secrets Runbook — moving to AWS Secrets Manager

## Phase 2 tenant credential boundary (authoritative)

`FINNOR_SECRET_IDS` and `ensureSecretsLoaded()` remain for process-wide infrastructure
secrets such as the database, Supabase Auth, Redis, LLMs, and observability. Customer
provider accounts must not use that process-global loader.

For QuickBooks, Vapi, Stripe, DocuSign, GHL, tenant-specific Resend, Meta Ads, and
Google Ads, create one JSON secret per tenant/provider under:

```
finnor/tenants/<tenant-uuid>/<provider>
```

Store only this contract on that tenant's existing `tenant_integrations` row:

```json
{
  "credentialProvider": "aws-secrets-manager",
  "credentialRef": "finnor/tenants/<tenant-uuid>/stripe",
  "credentialVersion": "stage:AWSCURRENT",
  "credentialMetadata": {}
}
```

`credentialVersion` accepts `stage:<stage>`, `id:<version-id>`, or an unprefixed AWS
stage for backward compatibility. Runtime resolution re-reads the tenant integration,
requires the reference to be inside that tenant's namespace, validates a
provider-specific JSON shape, and returns an immutable credential context. Cache and
single-flight keys contain tenant, provider, reference, and version; rotation therefore
cannot reuse another tenant's entry or an old explicitly-versioned entry. The default
cache is 60 seconds and is capped at five minutes.

Normal application tables reject secret-shaped keys in integration `config` and
`credential_metadata`. Provider response bodies and credential values must never be
copied into health errors, logs, receipts, or evidence.

Legacy provider env vars are disabled by default. During migration, list only the
specific existing tenant ids allowed to use them in
`FINNOR_LEGACY_CREDENTIAL_TENANT_IDS`; the tenant must also have the matching provider
binding/reference. An invalid or cross-tenant reference never falls through to env.
Remove each tenant from the allowlist after its secret reference is live.

Shared system credentials require a separate explicit allowlist in
`FINNOR_SYSTEM_CREDENTIAL_PROVIDERS`. The intended current value is `resend` for
Finnor-owned notifications. Do not add customer-account providers to that list.

The remainder of this runbook describes the legacy/system process-wide loader. Its
provider examples are migration inputs, not the configuration model for new tenants.

The code side of this is done (`packages/security/src/secrets.ts`): a provider switch
(`SECRETS_PROVIDER=env|aws-secrets-manager`), a `FINNOR_SECRET_IDS` JSON map from env-var
name to secret id/ARN, retry with a non-retryable fast-fail path
(`AccessDenied`/`ResourceNotFoundException`/`InvalidRequestException`/`DecryptionFailure`
never retry), a 5-minute refresh window (`SECRET_REFRESH_MS`), single-flight init (a
concurrent caller joins the in-flight fetch instead of starting a second one), and a
production plaintext guard (`ALLOW_PLAINTEXT_ENV_SECRETS=1` + `NODE_ENV=production`
throws at startup rather than running quietly on unmanaged env vars). This doc is the
part that isn't code: the actual JSON shape for this repo's real secret set, the IAM
policy, the platform env flips, how to verify the cutover, and how to roll back.

## 1. The real `FINNOR_SECRET_IDS` shape for this repo

Enumerated from `.env.example` — process-wide infrastructure plus legacy migration
vars. Customer provider credentials should instead use the tenant contract above. Every
var that is a credential, token, or connection
string carrying a password (not a URL/toggle/model-name config value). One AWS secret
per line below is the simplest layout (Secrets Manager charges per secret/month, so
grouping related creds into one JSON secret is also valid — either shape is supported,
since `readAwsSecretOnce` accepts a JSON object with multiple keys OR a single
`{ value: "..." }`).

```json
{
  "DATABASE_URL": "finnor/prod/database-url",
  "SUPABASE_SERVICE_ROLE_KEY": "finnor/prod/supabase-service-role-key",
  "VAPI_API_KEY": "finnor/prod/vapi-api-key",
  "VAPI_WEBHOOK_SECRET": "finnor/prod/vapi-webhook-secret",
  "GROQ_API_KEY": "finnor/prod/groq-api-key",
  "GOHIGHLEVEL_API_KEY": "finnor/prod/ghl-api-key",
  "REDIS_URL": "finnor/prod/redis-url",
  "SENTRY_DSN": "finnor/prod/sentry-dsn",
  "STRIPE_SECRET_KEY": "finnor/prod/stripe-secret-key",
  "STRIPE_WEBHOOK_SECRET": "finnor/prod/stripe-webhook-secret",
  "DOCUSIGN_INTEGRATION_KEY": "finnor/prod/docusign-integration-key",
  "DOCUSIGN_PRIVATE_KEY": "finnor/prod/docusign-private-key",
  "DOCUSIGN_CONNECT_SECRET": "finnor/prod/docusign-connect-secret",
  "QUICKBOOKS_CLIENT_SECRET": "finnor/prod/quickbooks-client-secret",
  "QUICKBOOKS_REFRESH_TOKEN": "finnor/prod/quickbooks-refresh-token",
  "META_ADS_ACCESS_TOKEN": "finnor/prod/meta-ads-access-token",
  "GOOGLE_ADS_CLIENT_SECRET": "finnor/prod/google-ads-client-secret",
  "GOOGLE_ADS_REFRESH_TOKEN": "finnor/prod/google-ads-refresh-token"
}
```

Left out on purpose: everything that's a public identifier, a fixed URL with no
password, or a `*_BINDING`/`*_MODE` toggle — `SUPABASE_URL`, `VAPI_PUBLIC_KEY`,
`VAPI_ASSISTANT_ID`, `VAPI_PHONE_NUMBER_ID`, `GHL_LOCATION_ID`,
`GHL_WATER_TEST_CALENDAR_ID`, `GHL_WEBHOOK_PUBLIC_KEY` (GHL's own published key, not a
secret you hold), `GROQ_MODEL`, `DOCUSIGN_USER_ID`, `DOCUSIGN_ACCOUNT_ID`,
`DOCUSIGN_BASE_URL`, `QUICKBOOKS_CLIENT_ID`, `QUICKBOOKS_REALM_ID`,
`QUICKBOOKS_ENVIRONMENT`, `META_ADS_ACCOUNT_ID`, `GOOGLE_ADS_*_ID`/`*_TOKEN` (developer
token, customer id), `PAYMENTS_RETURN_URL_BASE`, every `*_BINDING`/`COMMS_MODE` value,
and `ORCHESTRATION_ENGINE_GRAPH_ACTION_TYPES`. Those stay as plain env vars regardless
of `SECRETS_PROVIDER` — they carry no credential.

Add each secret in AWS Secrets Manager as a **single-string** secret (`SecretString` =
the raw value, no JSON wrapper needed) — `readAwsSecretOnce` falls back to
`{ value: raw }` when the string doesn't parse as JSON, then `ensureSecretsLoaded`
reads `secret[envName] ?? secret.value`, so a plain string "just works."

## 2. IAM policy — least privilege, named ARNs only

Create a dedicated IAM user/role for the app (no broader Secrets Manager access):

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Sid": "FinnorReadOwnSecretsOnly",
      "Effect": "Allow",
      "Action": "secretsmanager:GetSecretValue",
      "Resource": [
        "arn:aws:secretsmanager:us-east-1:ACCOUNT_ID:secret:finnor/prod/*"
      ]
    }
  ]
}
```

Replace `ACCOUNT_ID` and the region to match where the secrets are created. The
`finnor/prod/*` wildcard is scoped to the naming prefix used above, not to all secrets
in the account — narrow it further to exact ARNs (with the Secrets-Manager-appended
random suffix) once the secrets exist, if the deploy pipeline can tolerate policy
updates on each new secret. No `PutSecretValue`, `DeleteSecret`, or `ListSecrets` — the
app only ever reads.

## 3. Platform env-var flips (Vercel / Azure)

Both the Vercel API surfaces and the Azure persistent worker need the same
three vars set for the cutover:

- `SECRETS_PROVIDER=aws-secrets-manager`
- `FINNOR_SECRET_IDS` = the JSON blob from §1, as a single-line env var value
- `AWS_REGION` (or reuse `AWS_BEDROCK_REGION` if already set — `secrets.ts` falls back
  to that, then `us-east-1`) + standard AWS credential env vars
  (`AWS_ACCESS_KEY_ID`/`AWS_SECRET_ACCESS_KEY`, or an attached workload identity
  if the runtime supports it — prefer the role over static keys)

Every process-wide credential-bearing var listed in §1 can then be **removed** from
the platform's plaintext env var UI — `ensureSecretsLoaded` populates `process.env`
at runtime before anything reads it. Tenant provider credentials are read directly
from their referenced secret and never populate `process.env`. Non-secret vars
(`*_BINDING`, `GROQ_MODEL`, `PAYMENTS_RETURN_URL_BASE`, …) stay as plain platform env
vars, unaffected by this cutover.

## 4. Verifying the cutover

After deploying with the three vars above set, confirm the app actually pulled from
AWS and not silently fallen back:

- Call `secretProviderStatus()` — either add a temporary admin-only debug route, or
  check via a one-off script (`npx tsx -e "import('@finnor/security').then(s=>console.log(s.secretProviderStatus()))"`
  with the deployed env vars sourced) — expect `{ provider: "aws-secrets-manager",
  loaded: true, loadedAt: <recent ISO string> }`.
- Confirm two tenant-authenticated `GET /api/setup/status` requests report each
  tenant's own Vapi/GHL account. This exercises direct reference resolution; tenant
  provider credentials must not appear in `process.env`.
- Watch server logs for the one failure mode this doc's retry logic is built to
  surface fast: an `AccessDenied`/`ResourceNotFoundException` on a specific secret id
  fails on the FIRST attempt (no 1.75s retry burn) with that secret id's ARN in the
  thrown error — if seen, the IAM policy's ARN or the secret's existence is wrong, not
  a transient AWS issue.

## 5. Rollback

For process-wide infrastructure rollback, unset `SECRETS_PROVIDER` (or set it back to
`env`) and restore the infrastructure vars. Tenant-provider rollback changes the
tenant integration's reference/version to the prior secret version; it does not
replace process-wide env vars or require a redeploy. Legacy env fallback is permitted
only for an explicitly allowlisted migration tenant.
`ensureSecretsLoaded()` no-ops instantly on the `env` provider (aside from the
production plaintext guard, which only fires if `ALLOW_PLAINTEXT_ENV_SECRETS=1` was
also left set — leave that at `0`) — no code path depends on Secrets Manager having
ever run, so this is a clean, immediate revert with no state to unwind.

## 6. Rotation rehearsal (no secret values)

1. Choose one non-production credential and create its replacement in the provider.
2. Update the named secret value on the separately contracted staging runtime and Vercel Preview only; never put
   the value in a terminal transcript, commit, issue, or this document.
3. Deploy staging, run the integration-health probe, and confirm the provider reports
   configured/healthy through a real authenticated no-op.
4. Roll the old value back once to prove rollback, re-probe, then apply the replacement
   again and record only the deployment id/time and pass/fail result.
5. Promote the same value to production only after staging is green; retain the old
   provider-side credential until production’s probe is green, then revoke it.

The rehearsal is complete only when all steps above have an observed provider probe.
It must never be “proved” by printing or comparing a secret value.

### B7 observed rehearsal — 2026-07-25

Vercel Preview automation-bypass credential rotation was rehearsed against the isolated
API Preview deployment. A new provider-side bypass credential was created, the GitHub
Actions K6 secret was cut over, and an authenticated `GET /api/actions/pending` probe
returned HTTP 200. The GitHub secret was then restored to the prior credential, the
new rehearsal credential was revoked provider-side, and the same probe returned HTTP
200 again. No credential value was written to source, logs, or this runbook.
