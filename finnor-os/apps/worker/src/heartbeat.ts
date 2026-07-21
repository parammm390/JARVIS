// A2.T4: worker dead-man switch. Two independent signals on the same 30s cadence —
// a durable DB row /api/vitals reads for staleness (migration 0035), and a
// healthchecks.io ping that alerts externally the moment beats stop arriving (the DB
// row alone can't page anyone; healthchecks.io is the part that actually notices the
// worker died). Fixed id "worker" — single process today, see migration 0035's note
// on B7.T6's later fleet-worker widening.

import { adminDb, workerHeartbeat } from "@finnor/db";
import { getLogger } from "@finnor/tools";

export const WORKER_HEARTBEAT_ID = "worker";

async function beat(): Promise<void> {
  const now = new Date();
  await adminDb()
    .insert(workerHeartbeat)
    .values({ id: WORKER_HEARTBEAT_ID, lastBeatAt: now })
    .onConflictDoUpdate({ target: workerHeartbeat.id, set: { lastBeatAt: now } });

  const pingUrl = process.env.HEALTHCHECK_PING_URL;
  if (!pingUrl) return; // ⏸ PARAM signup pending (see JARVIS-CREDENTIALS-LEDGER.md) — no-op, not a fake ping
  try {
    await fetch(pingUrl);
  } catch (err) {
    getLogger().warn({ err: err instanceof Error ? err.message : String(err) }, "[heartbeat] healthchecks.io ping failed");
  }
}

export function startHeartbeat(intervalMs = 30_000, signal?: AbortSignal): void {
  const log = getLogger();
  const tick = () => {
    if (signal?.aborted) return;
    void beat().catch((err) => {
      log.error({ err: err instanceof Error ? err.message : String(err) }, "[heartbeat] upsert failed");
    });
  };
  tick(); // first beat immediately on boot, not 30s after
  const handle = setInterval(tick, intervalMs);
  signal?.addEventListener("abort", () => clearInterval(handle));
}
