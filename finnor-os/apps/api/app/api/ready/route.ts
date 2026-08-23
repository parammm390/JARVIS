import { getPool } from "@finnor/db";
import { ensureSecretsLoaded, secretProviderStatus } from "@finnor/security";
import { getReleaseMetadata } from "../../../lib/release";

const MIGRATION_HEAD = "0095_phase5_causal_replay.sql";

/** Dependency readiness, deliberately separate from /api/health liveness. Optional
 * provider connections are tenant-level degradation and never make the whole API
 * unready; Postgres, the migration contract, a current worker, and the configured
 * secret backend are process-level dependencies. */
export async function GET(): Promise<Response> {
  const checks: Record<string, { ok: boolean; detail?: string | number }> = {};
  try {
    const result = await getPool().query<{
      migration_head: string | null;
      healthy_workers: number;
    }>(
      `SELECT
         (SELECT max(name) FROM finnor_os._migrations) AS migration_head,
         (SELECT count(*)::int FROM finnor_os.service_release_heartbeats
           WHERE service='worker'
             AND migration_head=$1
             AND ($2::text IS NULL OR release_sha=$2)
             AND last_beat_at>now()-interval '90 seconds') AS healthy_workers`,
      [MIGRATION_HEAD, process.env.FINNOR_COMMIT_SHA?.trim() || null],
    );
    const row = result.rows[0];
    checks.database = { ok: true };
    checks.migrations = { ok: row?.migration_head === MIGRATION_HEAD, detail: row?.migration_head ?? "none" };
    checks.workerFleet = { ok: Number(row?.healthy_workers ?? 0) > 0, detail: Number(row?.healthy_workers ?? 0) };
  } catch {
    checks.database = { ok: false, detail: "unavailable" };
    checks.migrations = { ok: false, detail: "unknown" };
    checks.workerFleet = { ok: false, detail: 0 };
  }

  try {
    await ensureSecretsLoaded();
    const status = secretProviderStatus();
    checks.secrets = {
      ok: process.env.NODE_ENV !== "production" || status.provider === "aws-secrets-manager",
      detail: status.provider,
    };
  } catch {
    checks.secrets = { ok: false, detail: "unavailable" };
  }

  const ok = Object.values(checks).every((check) => check.ok);
  return Response.json(
    { ok, service: "finnor-api", checks, provenance: getReleaseMetadata("finnor-api") },
    { status: ok ? 200 : 503, headers: { "cache-control": "no-store" } },
  );
}
