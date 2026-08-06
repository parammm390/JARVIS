# P0 Deployment Inventory

Generated from committed deployment configuration and local, read-only target discovery on
2026-08-06. This is an inventory, not a deployment or a production migration.

## Migration state

- Repository migration head: `0064_evidence_corpus_search.sql`.
- A disposable local database applied migrations `0000` through `0064` successfully; see
  `docs/release/evidence/P0/p0-t6-clean-db-prerequisites.txt`.
- Staging unapplied migrations: **not queried**. A Vercel Preview environment exposes a historical
  Railway Postgres endpoint, but the current endpoint resets during the PostgreSQL handshake and its
  Supabase auth origin matches Production. Read-only Railway account discovery also found only one
  accessible project/environment (`confident-wisdom` / `production`). P0 does not infer or apply a
  migration. This remains an explicit P3 staging-identity and migration prerequisite, not evidence
  that staging is current.

## Deployable services and configured targets

| Service | Source / deploy command | Recorded target | Health or readiness endpoint | Inventory status |
| --- | --- | --- | --- | --- |
| API | `finnor-os/apps/api`; Vercel Next.js project | Project `api` (`prj_BoMZ2AXdLIJQXAAe6RqDGBveyq3n`), root `apps/api`; current read-only listing found Ready Preview deployments `api-oqjj3i98u-bloodride2-3212s-projects.vercel.app` and `api-altwe0pzh-bloodride2-3212s-projects.vercel.app`, both 12 days old. | No unauthenticated generic health route found. Authenticated operational routes: `/api/vitals`, `/api/integrations/status`, and `/api/setup/status`. | Preview target recorded but not staging-certified: its database handshake resets and its Supabase auth origin matches Production. |
| Console frontend | `finnor-os/apps/console`; Vercel Next.js project | Project `finnor-agency` (`prj_dttKVOUzFBGnSg6zNdRualYjQ3oe`), root `.`; current read-only listing exposes Ready Production deployments only. | No standalone health endpoint found; frontend must be checked at its configured Vercel URL in P3. | Production deployments observed read-only; no verified non-production frontend target. |
| Worker | `finnor-os/apps/worker/src/index.ts`; Railway start command `npx tsx apps/$SERVICE_APP/src/index.ts` | CI names `finnor-worker-staging`; read-only Railway status found the separate accessible production service `finnor-worker` at `finnor-worker-production-745f.up.railway.app`, target port 8080. | `/healthz` when the worker HTTP/SSE listener is started with `PORT`; worker heartbeat is recorded in the database. | Production service observed RUNNING/SUCCESS at the read-only query; not used as staging and not changed. |
| Orchestrator | `finnor-os/apps/orchestrator/src/index.ts`; same Railway dynamic start command | No service name, Railway project, environment, or URL is committed. | `/health` on `ORCHESTRATOR_PORT` (default `3200`). | Target must be supplied/linked before staging certification. |

## Source evidence

- `finnor-os/railway.json` and `finnor-os/railway.staging.json` specify the dynamic Railway start
  command and restart policy, but no project/service identifier.
- `.github/workflows/ci.yml` names only the staging worker target above; it has no production deployment
  action.
- `finnor-os/infra/deployment/vercel.json` specifies the two Vercel root directories, but no URL.
- The ignored `.vercel/project.json` files link the local checkout to projects `api` and `finnor-agency`;
  they are not committed deployment records.
- Read-only Vercel Preview metadata and the sanitized endpoint/connection probe are retained in
  `docs/release/evidence/P0/p0-t7-vercel-preview-audit.txt`; no environment value was committed.
- Read-only `railway project list` reported only project `confident-wisdom`; read-only
  `railway status --project confident-wisdom --environment production --json` reported one
  production environment, one `finnor-worker` service, and no staging environment. Output is
  summarized without deployment metadata or secrets in `docs/release/evidence/P0/p0-t7-railway-status.txt`.

No production migration, deployment, credentials, or environment values were used or changed.
