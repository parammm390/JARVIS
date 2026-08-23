import { getPool } from "@finnor/db";
import { getLogger } from "@finnor/tools";
import type { JobHandler } from "../queue";

export interface RetentionPurgeResult {
  callsScrubbed: number;
  messagesDeleted: number;
  jobsDeleted: number;
  computerArtifactContentsScrubbed: number;
  modelRecordsDeleted: number;
  operationalDeltasDeleted: number;
  retentionDays: number;
  dataClassDays: Record<string, number>;
}

/** B7.T2's conservative policy. Holds are active until released_at is set; immutable
 * audit/event/receipt tables are never touched. Source discovery found inbox_events
 * stores only provider ids/hashes (not raw payloads), so it is deliberately retained
 * for reconciliation. `jobs` has no tenant column, so its payload tenant_id is matched
 * exactly and only completed jobs are eligible. Wake-linked jobs are durable causal
 * evidence and remain alongside their immutable wake claim. */
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
    const classes = await client.query<{ data_class: string; retention_days: number; legal_hold: boolean }>(
      "SELECT data_class,retention_days,legal_hold FROM tenant_retention_policies WHERE tenant_id=$1", [tenantId],
    );
    const configured = new Map(classes.rows.map((row) => [row.data_class, row]));
    const days = (dataClass: string) => configured.get(dataClass)?.retention_days ?? retentionDays;
    const held = (dataClass: string) => configured.get(dataClass)?.legal_hold === true;
    const cutoff = (dataClass: string) => new Date(Date.now() - days(dataClass) * 86_400_000);
    const noHold = (type: string, idColumn: string) => `NOT EXISTS (SELECT 1 FROM data_retention_holds h WHERE h.tenant_id = $1 AND h.resource_type = '${type}' AND h.resource_id = ${idColumn} AND h.released_at IS NULL)`;

    const calls = held("messages") ? { rowCount: 0 } : await client.query(
    `UPDATE calls SET transcript = NULL, from_number = NULL, to_number = NULL, recording_url = NULL, raw = '{}'::jsonb
     WHERE tenant_id = $1 AND created_at < $2 AND ${noHold("call", "calls.id")}
       AND (transcript IS NOT NULL OR from_number IS NOT NULL OR to_number IS NOT NULL OR recording_url IS NOT NULL OR raw <> '{}'::jsonb)`, [tenantId, cutoff("messages")],
  );
    const messages = held("messages") ? { rowCount: 0 } : await client.query(
    `DELETE FROM messages WHERE tenant_id = $1 AND sent_at < $2 AND ${noHold("message", "messages.id")}`, [tenantId, cutoff("messages")],
  );
    const jobs = held("job_payloads") ? { rowCount: 0 } : await client.query(
    `DELETE FROM jobs WHERE status = 'completed' AND completed_at < $2 AND payload->>'tenantId' = $3::text
      AND ${noHold("job", "jobs.id")}
      AND NOT EXISTS (SELECT 1 FROM work_wake_claims wake WHERE wake.tenant_id = $1 AND wake.job_id = jobs.id)`, [tenantId, cutoff("job_payloads"), tenantId],
  );
    const artifacts = held("computer_artifact_content") ? { rowCount: 0 } : await client.query(
      `UPDATE computer_artifacts SET content=NULL,storage_ref=NULL
        WHERE tenant_id=$1 AND created_at<$2 AND (content IS NOT NULL OR storage_ref IS NOT NULL)`,
      [tenantId, cutoff("computer_artifact_content")],
    );
    const modelRecords = held("model_records") ? { rowCount: 0 } : await client.query(
      `DELETE FROM llm_calls WHERE tenant_id=$1 AND created_at<$2`,
      [tenantId, cutoff("model_records")],
    );
    // Realtime invalidations contain refs/tags only and have a fixed, bounded replay
    // window independent of business-data retention policy. The per-tenant cursor is
    // retained, so a client older than this window gets an explicit resync_required.
    const deltaRetention = await client.query<{ deleted: string }>(
      "SELECT finnor_os.purge_operational_deltas($1,$2) AS deleted",
      [tenantId, new Date(Date.now() - 7 * 86_400_000)],
    );
    await client.query("COMMIT");
    const result = {
      callsScrubbed: calls.rowCount ?? 0,
      messagesDeleted: messages.rowCount ?? 0,
      jobsDeleted: jobs.rowCount ?? 0,
      computerArtifactContentsScrubbed: artifacts.rowCount ?? 0,
      modelRecordsDeleted: modelRecords.rowCount ?? 0,
      operationalDeltasDeleted: Number(deltaRetention.rows[0]?.deleted ?? 0),
      retentionDays,
      dataClassDays: Object.fromEntries(["messages", "job_payloads", "computer_artifact_content", "model_records"].map((key) => [key, days(key)])),
    };
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
