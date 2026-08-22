# Staging environment contract

No active staging deployment target is declared by the production contract. Never infer one from historical evidence, provider dashboards, old service names, or production resources.

Before staging can deploy, commit a small, separately reviewed machine-readable contract that resolves:

- an isolated database and auth project;
- explicit Vercel staging/preview projects;
- an explicit persistent worker target and deployment mechanism;
- whether the orchestrator is embedded or separately required;
- staging-only secrets and tenant data;
- release identity and cross-runtime parity probes.

The staging preflight must reject production database hosts, production Azure resource IDs, and production Vercel projects. Use sandbox provider credentials, real auth, `FINNOR_ENVIRONMENT=staging`, and the same tenant-isolation and dry-run gates as production. Do not add a CI deployment job until every target is authoritative and authenticated.
