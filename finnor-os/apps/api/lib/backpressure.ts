import { getPool } from "@finnor/db";
import { AuthError } from "./auth";

/** Protect interactive work when batch processing is saturated. The value is read on
 * every request for safe live tuning; a database error is deliberately not treated as
 * saturation (the normal route error path remains observable rather than returning a
 * fabricated 429). */
export async function enforceBatchBackpressure(): Promise<void> {
  const limit = Number(process.env.BATCH_QUEUE_BACKPRESSURE_LIMIT ?? 1_000);
  const { rows } = await getPool().query<{ depth: string }>("SELECT count(*)::text AS depth FROM jobs WHERE status = 'queued' AND lane = 'batch'");
  const depth = Number(rows[0]?.depth ?? 0);
  if (depth >= limit) {
    throw new AuthError("Non-urgent intake is temporarily paused while queued work drains. Please retry shortly.", 429, { "Retry-After": "60" });
  }
}
