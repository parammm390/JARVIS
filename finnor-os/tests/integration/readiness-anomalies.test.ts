import { afterAll, beforeAll, describe, expect, it } from "vitest";
import pg from "pg";
import { migrate } from "../../packages/db/migrate";
import { seed, SEED_TENANT_ID } from "../../packages/db/seed";
import { closePool, readinessLog, withTenant } from "@finnor/db";
import { readinessAnomalies } from "@finnor/read-models";

const DB_URL = process.env.DATABASE_URL ?? "postgres://finnor:finnor@localhost:5432/finnor";
const available = await (async () => { const c = new pg.Client({ connectionString: DB_URL, connectionTimeoutMillis: 2000 }); try { await c.connect(); await c.end(); return true; } catch { return false; } })();
describe.skipIf(!available)("B3 readiness anomalies", () => {
  beforeAll(async () => { process.env.DATABASE_URL = DB_URL; await migrate(DB_URL); await seed(DB_URL); });
  afterAll(async () => closePool());
  it("finds a latest-day failure-rate spike from real readiness rows", async () => {
    await withTenant(SEED_TENANT_ID, async (db) => {
      for (let day = 0; day < 15; day += 1) await db.insert(readinessLog).values({ tenantId: SEED_TENANT_ID, logDate: `2031-01-${String(day + 1).padStart(2, "0")}`, workflowSuccessRate: day === 14 ? 0.1 : 0.95 + (day % 2) * 0.01, reconciliationBacklog: 0, dlqDepth: 0 }).onConflictDoUpdate({ target: [readinessLog.tenantId, readinessLog.logDate], set: { workflowSuccessRate: day === 14 ? 0.1 : 0.95 } });
    });
    const anomalies = await readinessAnomalies(SEED_TENANT_ID);
    expect(anomalies).toHaveLength(1); expect(anomalies[0]!.metric).toBe("failure_rate");
  });
});
