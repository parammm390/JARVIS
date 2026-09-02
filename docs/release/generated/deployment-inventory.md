# Canonical deployment inventory

Target topology from `infra/deployment/production.contract.json`; the JSON contract is authoritative. A target is not considered live until the guarded production release records fresh runtime evidence.

| Component | Provider / target | Release proof |
| --- | --- | --- |
| Frontend / marketing | Vercel `finnor-agency` (`prj_dttKVOUzFBGnSg6zNdRualYjQ3oe`), `finnorai.com` | `/api/release` commit-derived metadata |
| API | Vercel `api` (`prj_BoMZ2AXdLIJQXAAe6RqDGBveyq3n`), `api-psi-brown-95.vercel.app` | `/api/release` commit-derived metadata |
| Worker | AWS ECS Fargate cluster `finnor-production`, service/task family `finnor-worker`, immutable ECR repository `finnor-worker`, region `us-east-1` | database heartbeat, ECS task image digest, ALB target health, and `https://realtime.finnorai.com/healthz` release metadata |
| Orchestrator | Embedded in the ECS worker process; no separate production service is contracted | worker release identity and embedded orchestrator health contract |
| Database | Production PostgreSQL endpoint matching `aws-1-ap-northeast-1.pooler.supabase.com` | migration ledger head `0108_operating_product_closure.sql` |

All required components deploy from one exact `origin/main` SHA in `.github/workflows/production-release.yml`. Missing or mismatched evidence is FAILED/PARTIAL, never PASS.
