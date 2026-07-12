// Episodic memory: action_log, append-only, one row per orchestration step (§10, §19).
// Never updated or deleted — enforced by a DB trigger, not just convention.

import { withTenant, actionLog } from "@finnor/db";
import { desc, eq } from "drizzle-orm";

export async function appendEpisode(
  tenantId: string,
  domainActionId: string,
  step: string,
  input: Record<string, unknown>,
  output: Record<string, unknown>,
): Promise<void> {
  await withTenant(tenantId, async (db) => {
    await db.insert(actionLog).values({ tenantId, domainActionId, step, input, output });
  });
}

export async function readEpisodes(
  tenantId: string,
  opts: { domainActionId?: string; limit?: number } = {},
): Promise<Array<Record<string, unknown>>> {
  return withTenant(tenantId, async (db) => {
    const base = db.select().from(actionLog);
    const rows = opts.domainActionId
      ? await base.where(eq(actionLog.domainActionId, opts.domainActionId)).orderBy(desc(actionLog.timestamp)).limit(opts.limit ?? 100)
      : await base.orderBy(desc(actionLog.timestamp)).limit(opts.limit ?? 100);
    return rows as Array<Record<string, unknown>>;
  });
}
