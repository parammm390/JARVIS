// GET /api/vitals (A2.T5) — the operational-health answer: queue depth, oldest-pending
// age, worker heartbeat age, this tenant's open DLQ count, resolved capability bindings
// (tenant-row -> env -> default, A3.T1), and per-scan-type "last run" clocks. Each
// section is one cheap, already-indexed query; nothing here is a fan-out over the same
// tables /api/setup/status already reads.

import { getPool, withTenant, authProfiles, deadLetters, tenantIntegrations } from "@finnor/db";
import { and, eq, sql } from "drizzle-orm";
import { resolveCapabilityBindingsForTenant } from "@finnor/tools";
import { requireContext, errorResponse } from "../../../lib/auth";

// A worker beats every 30s (apps/worker/src/heartbeat.ts) — 3x that cadence is enough
// slack for a slow tick without calling a merely-jittery worker unhealthy.
const HEARTBEAT_STALE_AFTER_SECONDS = 90;

// Mirrors apps/worker/src/index.ts's PROACTIVE_SCANS — the job types the scheduler
// enqueues on a clock, not reactively. Kept as a literal list (not imported from the
// worker app) since apps/api doesn't depend on apps/worker and shouldn't start to.
const SCAN_JOB_TYPES = [
  "scheduled_reminder",
  "scan_cold_leads",
  "scan_low_inventory",
  "scan_service_due",
  "scan_data_quality",
  "relay_outbox_events",
  "scan_appointment_no_shows",
  "scan_approval_expiry",
  "scan_reliability_alerts",
  "scan_integration_health",
  "scan_connection_health",
  "learning_digest",
  "simulator_tick",
  "owner_digest",
  "daily_scorecard",
];

export async function GET(req: Request): Promise<Response> {
  try {
    const ctx = await requireContext(req);

    const [queueRow, heartbeatRow, dlqRows, scanRows, bindings, integrationHealthRows, connectionRows] = await Promise.all([
      getPool().query<{ depth: string; oldest_pending_age_seconds: number | null }>(
        `SELECT count(*)::int AS depth, extract(epoch FROM (now() - min(run_at)))::int AS oldest_pending_age_seconds
         FROM jobs WHERE status = 'queued' AND run_at <= now()`,
      ),
      getPool().query<{ age_seconds: number | null; healthy_instances: number; instances: number; release_sha: string | null; migration_head: string | null }>(
        `SELECT extract(epoch FROM (now() - max(last_beat_at)))::int AS age_seconds,
                count(*) FILTER (WHERE last_beat_at > now() - interval '90 seconds')::int AS healthy_instances,
                count(*)::int AS instances,
                (array_agg(release_sha ORDER BY last_beat_at DESC))[1] AS release_sha,
                (array_agg(migration_head ORDER BY last_beat_at DESC))[1] AS migration_head
           FROM service_release_heartbeats
          WHERE service='worker'`,
      ),
      withTenant(ctx.tenantId, (db) =>
        db
          .select({ count: sql<number>`count(*)::int` })
          .from(deadLetters)
          .where(and(eq(deadLetters.tenantId, ctx.tenantId), eq(deadLetters.status, "open"))),
      ),
      getPool().query<{ type: string; last_run_at: string }>(
        `SELECT type, max(run_at) AS last_run_at FROM jobs WHERE type = ANY($1::text[]) GROUP BY type`,
        [SCAN_JOB_TYPES],
      ),
      resolveCapabilityBindingsForTenant(ctx.tenantId),
      withTenant(ctx.tenantId, (db) =>
        db
          .select({
            capability: tenantIntegrations.capability,
            binding: tenantIntegrations.binding,
            health: tenantIntegrations.health,
            lastCheckAt: tenantIntegrations.lastCheckAt,
            lastError: tenantIntegrations.lastError,
          })
          .from(tenantIntegrations)
          .where(eq(tenantIntegrations.tenantId, ctx.tenantId)),
      ),
      withTenant(ctx.tenantId, (db) => db.select({
        authProfileRef: authProfiles.authProfileRef,
        authMethod: authProfiles.authMethod,
        status: authProfiles.connectionStatus,
        required: authProfiles.connectionRequired,
        lastVerifiedAt: authProfiles.lastVerifiedAt,
        errorCode: authProfiles.lastConnectionErrorCode,
      }).from(authProfiles).where(eq(authProfiles.tenantId, ctx.tenantId))),
    ]);

    const heartbeatAgeSeconds = heartbeatRow.rows[0]?.age_seconds ?? null;
    const lastRunByType = Object.fromEntries(scanRows.rows.map((r) => [r.type, r.last_run_at]));

    return Response.json(
      {
        queue: {
          depth: queueRow.rows[0]?.depth ?? 0,
          oldestPendingAgeSeconds: queueRow.rows[0]?.oldest_pending_age_seconds ?? null,
        },
        heartbeat: {
          ageSeconds: heartbeatAgeSeconds,
          healthy: heartbeatAgeSeconds !== null && heartbeatAgeSeconds < HEARTBEAT_STALE_AFTER_SECONDS,
          healthyInstances: heartbeatRow.rows[0]?.healthy_instances ?? 0,
          instances: heartbeatRow.rows[0]?.instances ?? 0,
          releaseSha: heartbeatRow.rows[0]?.release_sha ?? null,
          migrationHead: heartbeatRow.rows[0]?.migration_head ?? null,
        },
        dlq: { openCount: dlqRows[0]?.count ?? 0 },
        bindings,
        // A3.T2: real per-binding health (breaker-aware) for whichever capabilities
        // this tenant has an explicit tenant_integrations row for — EMU-tagged
        // implicitly via `binding` (D1.T2's pulse bar reads this field for that label).
        integrationHealth: integrationHealthRows,
        connections: {
          requiredCount: connectionRows.filter((row) => row.required).length,
          usableCount: connectionRows.filter((row) => row.required && ["active", "degraded"].includes(row.status)).length,
          profiles: connectionRows,
        },
        scans: SCAN_JOB_TYPES.reduce<Record<string, string | null>>((acc, type) => {
          acc[type] = lastRunByType[type] ?? null;
          return acc;
        }, {}),
      },
      { headers: { "cache-control": "no-store" } },
    );
  } catch (err) {
    return errorResponse(err);
  }
}
