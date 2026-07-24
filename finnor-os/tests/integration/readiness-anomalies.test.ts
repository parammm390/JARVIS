import { afterAll, beforeAll, describe, expect, it } from "vitest";
import pg from "pg";
import { migrate } from "../../packages/db/migrate";
import { closePool, getPool, readinessLog, withTenant } from "@finnor/db";
import { readinessAnomalies } from "@finnor/read-models";

const DB_URL = process.env.DATABASE_URL ?? "postgres://finnor:finnor@localhost:5432/finnor";
const TENANT_ID = "00000000-0000-4000-8000-0000000000b4";
const available = await (async () => { const c = new pg.Client({ connectionString: DB_URL, connectionTimeoutMillis: 2000 }); try { await c.connect(); await c.end(); return true; } catch { return false; } })();
describe.skipIf(!available)("B3 readiness anomalies", () => {
  beforeAll(async () => {
    process.env.DATABASE_URL = DB_URL;
    await migrate(DB_URL);
    await getPool().query("INSERT INTO tenants (id, name) VALUES ($1, 'B3 Readiness Anomaly Test Tenant') ON CONFLICT (id) DO NOTHING", [TENANT_ID]);
  });
  afterAll(async () => closePool());
  it("finds a latest-day failure-rate spike from real readiness rows", async () => {
    const today = new Date();
    await withTenant(TENANT_ID, async (db) => {
      for (let day = 0; day < 15; day += 1) {
        const date = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate() - 14 + day));
        await db.insert(readinessLog).values({ tenantId: TENANT_ID, logDate: date.toISOString().slice(0, 10), workflowSuccessRate: day === 14 ? 0.1 : 0.95 + (day % 2) * 0.01, reconciliationBacklog: 0, dlqDepth: 0 }).onConflictDoUpdate({ target: [readinessLog.tenantId, readinessLog.logDate], set: { workflowSuccessRate: day === 14 ? 0.1 : 0.95 } });
      }
    });
    const anomalies = await readinessAnomalies(TENANT_ID);
    expect(anomalies).toHaveLength(1); expect(anomalies[0]!.metric).toBe("failure_rate");
  });
});
