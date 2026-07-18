# Secrets Runbook — moving to AWS Secrets Manager

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

Enumerated from `.env.example` — every var that is a credential, token, or connection
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

## 3. Platform env-var flips (Vercel / Railway)

Both `apps/api`+`apps/console` (Vercel) and `apps/worker` (Railway) need the same
three vars set for the cutover:

- `SECRETS_PROVIDER=aws-secrets-manager`
- `FINNOR_SECRET_IDS` = the JSON blob from §1, as a single-line env var value
- `AWS_REGION` (or reuse `AWS_BEDROCK_REGION` if already set — `secrets.ts` falls back
  to that, then `us-east-1`) + standard AWS credential env vars
  (`AWS_ACCESS_KEY_ID`/`AWS_SECRET_ACCESS_KEY`, or an attached IAM role on
  Railway/ECS if the platform supports it — prefer the role over static keys)

Every credential-bearing var listed in §1 (`STRIPE_SECRET_KEY`, `DATABASE_URL`, etc.)
can then be **removed** from the platform's plaintext env var UI — `ensureSecretsLoaded`
populates `process.env` at runtime before anything reads them. Non-secret vars
(`*_BINDING`, `GROQ_MODEL`, `PAYMENTS_RETURN_URL_BASE`, …) stay as plain platform env
vars, unaffected by this cutover.

## 4. Verifying the cutover

After deploying with the three vars above set, confirm the app actually pulled from
AWS and not silently fallen back:

- Call `secretProviderStatus()` — either add a temporary admin-only debug route, or
  check via a one-off script (`npx tsx -e "import('@finnor/security').then(s=>console.log(s.secretProviderStatus()))"`
  with the deployed env vars sourced) — expect `{ provider: "aws-secrets-manager",
  loaded: true, loadedAt: <recent ISO string> }`.
- Confirm a request that depends on a managed secret actually works end-to-end (e.g.
  `GET /api/setup/status` reporting the Vapi/GHL integrations healthy) — that only
  happens if the real `VAPI_API_KEY`/`GOHIGHLEVEL_API_KEY` were actually resolved from
  Secrets Manager into `process.env`.
- Watch server logs for the one failure mode this doc's retry logic is built to
  surface fast: an `AccessDenied`/`ResourceNotFoundException` on a specific secret id
  fails on the FIRST attempt (no 1.75s retry burn) with that secret id's ARN in the
  thrown error — if seen, the IAM policy's ARN or the secret's existence is wrong, not
  a transient AWS issue.

## 5. Rollback

Unset `SECRETS_PROVIDER` (or set it back to `env`) on both platforms and restore the
plaintext env vars from a password manager / the previous deploy's config export.
`ensureSecretsLoaded()` no-ops instantly on the `env` provider (aside from the
production plaintext guard, which only fires if `ALLOW_PLAINTEXT_ENV_SECRETS=1` was
also left set — leave that at `0`) — no code path depends on Secrets Manager having
ever run, so this is a clean, immediate revert with no state to unwind.
