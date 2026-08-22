# Production environment contract

Values are never stored in this document. `infra/deployment/production.contract.json` defines the targets; `.github/workflows/production-release.yml` binds authenticated credentials to them.

| Scope | Required names |
| --- | --- |
| Every runtime | `FINNOR_COMMIT_SHA`, `FINNOR_BUILD_ID`, `FINNOR_VERSION`, `FINNOR_ENVIRONMENT`, `FINNOR_RELEASE_SOURCE` |
| GitHub production release | secret `VERCEL_TOKEN`; variables `AZURE_CLIENT_ID`, `AZURE_TENANT_ID`, `AZURE_SUBSCRIPTION_ID` |
| Database migration | production `DATABASE_URL` resolved from the API production environment; fresh matching preflight evidence |
| Azure worker | existing `/etc/finnor/jarvis-worker.env`; generated non-secret `/etc/finnor/release.env` |
| Tenant providers | tenant-scoped credential references; no process-global mutable tenant credential values |

Preflight must resolve every required name without printing values, confirm the database host and migration assumptions, prove the Azure resource identity and unit contract, and fail before migration when any target or credential is unavailable.
