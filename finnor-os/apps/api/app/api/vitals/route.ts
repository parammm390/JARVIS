// GET /api/vitals (A2.T5) — the operational-health answer: queue depth, oldest-pending
// age, worker heartbeat age, this tenant's open DLQ count, resolved capability bindings
// (a placeholder — A3's tenant_integrations gives these real per-binding health), and
// per-scan-type "last run" clocks. Each section is one cheap, already-indexed query;
// nothing here is a fan-out over the same tables /api/setup/status already reads.

import { getPool, withTenant, deadLetters } from "@finnor/db";
import { and, eq, sql } from "drizzle-orm";
import { resolveCapabilityBindings } from "@finnor/tools";
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
  "learning_digest",
  "simulator_tick",
  "owner_digest",
  "daily_scorecard",
];

export async function GET(req: Request): Promise<Response> {
  try {
    const ctx = await requireContext(req);

    const [queueRow, heartbeatRow, dlqRows, scanRows] = await Promise.all([
      getPool().query<{ depth: string; oldest_pending_age_seconds: number | null }>(
        `SELECT count(*)::int AS depth, extract(epoch FROM (now() - min(run_at)))::int AS oldest_pending_age_seconds
         FROM jobs WHERE status = 'queued' AND run_at <= now()`,
      ),
      getPool().query<{ age_seconds: number | null }>(
        `SELECT extract(epoch FROM (now() - last_beat_at))::int AS age_seconds FROM worker_heartbeat WHERE id = 'worker'`,
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
        },
        dlq: { openCount: dlqRows[0]?.count ?? 0 },
        // Placeholder per A2.T5's own scope note — real per-binding health (breaker
        // state, last_check_at) arrives with A3's tenant_integrations table.
        bindings: resolveCapabilityBindings(),
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
