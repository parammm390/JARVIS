# FINNOR credential placement ledger

This file records credential locations, never values. The deployment topology authority is [`infra/deployment/production.contract.json`](infra/deployment/production.contract.json); target names must not be inferred from this ledger.

| Surface | Current purpose | Credential rule |
| --- | --- | --- |
| GitHub `production` environment | Runs the one guarded production release | `VERCEL_TOKEN` is a secret; `AWS_GITHUB_ACTIONS_ROLE_ARN` is a deployment variable consumed through GitHub OIDC. No static AWS credentials are stored in GitHub. |
| Vercel project `api` | API runtime | Infrastructure/shared runtime vars only. Tenant provider credentials must not be stored here. |
| Vercel project `finnor-agency` | Frontend/marketing runtime | Public/build configuration only unless source explicitly requires a secret. |
| AWS ECS Fargate `finnor-production` / `finnor-worker` | Persistent worker with embedded orchestrator and SSE gateway | The ECS task role `finnor-worker-task` reads the existing `finnor/prod/*` secrets and tenant-scoped `finnor/tenants/*` references from AWS Secrets Manager. Task definitions contain identifiers only, never secret values or static AWS credentials. |
| Production database | Tenant credential references and operational state | Tenant integration rows store provider, reference, version, and non-secret metadata only; secret material stays in the referenced secret provider. |

Required release identity on every runtime: `FINNOR_COMMIT_SHA`, `FINNOR_BUILD_ID`, `FINNOR_VERSION`, `FINNOR_ENVIRONMENT`, `FINNOR_RELEASE_SOURCE`.

Tenant credentials are resolved per tenant and provider, remain immutable for one execution context, and fail closed on invalid/cross-tenant references. Never copy tenant credentials into process-global mutable state, logs, health responses, this repository, or CI evidence.

When a credential changes, update only its authoritative surface, keep its value out of transcripts, run the integration-health probe for the affected tenant, and deploy through the canonical release workflow when a runtime restart is required. Do not rotate unrelated credentials during a release repair.
