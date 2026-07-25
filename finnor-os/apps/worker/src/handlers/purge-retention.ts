import { getPool } from "@finnor/db";
import { getLogger } from "@finnor/tools";
import type { JobHandler } from "../queue";

export interface RetentionPurgeResult { callsScrubbed: number; messagesDeleted: number; jobsDeleted: number; retentionDays: number }

/** B7.T2's conservative policy. Holds are active until released_at is set; immutable
 * audit/event/receipt tables are never touched. Source discovery found inbox_events
 * stores only provider ids/hashes (not raw payloads), so it is deliberately retained
 * for reconciliation. `jobs` has no tenant column, so its payload tenant_id is matched
 * exactly and only completed jobs are eligible. */
export async function purgeTenantRetention(tenantId: string): Promise<RetentionPurgeResult> {
  const pool = getPool();
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query("SET LOCAL search_path = finnor_os, public");
    await client.query("SELECT set_config('app.tenant_id', $1, true)", [tenantId]);
    const policy = await client.query<{ retention_days: number }>(
      "SELECT retention_days FROM tenant_data_retention_policies WHERE tenant_id = $1", [tenantId],
    );
    const retentionDays = policy.rows[0]?.retention_days ?? 90;
    const cutoff = new Date(Date.now() - retentionDays * 86_400_000);
    const noHold = (type: string, idColumn: string) => `NOT EXISTS (SELECT 1 FROM data_retention_holds h WHERE h.tenant_id = $1 AND h.resource_type = '${type}' AND h.resource_id = ${idColumn} AND h.released_at IS NULL)`;

    const calls = await client.query(
    `UPDATE calls SET transcript = NULL, from_number = NULL, to_number = NULL, recording_url = NULL, raw = '{}'::jsonb
     WHERE tenant_id = $1 AND created_at < $2 AND ${noHold("call", "calls.id")}
       AND (transcript IS NOT NULL OR from_number IS NOT NULL OR to_number IS NOT NULL OR recording_url IS NOT NULL OR raw <> '{}'::jsonb)`, [tenantId, cutoff],
  );
    const messages = await client.query(
    `DELETE FROM messages WHERE tenant_id = $1 AND sent_at < $2 AND ${noHold("message", "messages.id")}`, [tenantId, cutoff],
  );
    const jobs = await client.query(
    `DELETE FROM jobs WHERE status = 'completed' AND completed_at < $2 AND payload->>'tenantId' = $3::text
      AND ${noHold("job", "jobs.id")}`, [tenantId, cutoff, tenantId],
  );
    await client.query("COMMIT");
    const result = { callsScrubbed: calls.rowCount ?? 0, messagesDeleted: messages.rowCount ?? 0, jobsDeleted: jobs.rowCount ?? 0, retentionDays };
    getLogger().info({ tenantId, ...result }, "[retention] purge completed");
    return result;
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}

export const purgeRetention: JobHandler = async (payload) => {
  const tenantId = String(payload.tenantId ?? "");
  if (!tenantId) throw new Error("purge_retention requires tenantId");
  await purgeTenantRetention(tenantId);
};
