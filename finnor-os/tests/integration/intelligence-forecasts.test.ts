import { afterAll, beforeAll, describe, expect, it } from "vitest";
import pg from "pg";
import { migrate } from "../../packages/db/migrate";
import { seed, SEED_TENANT_ID } from "../../packages/db/seed";
import { closePool, households, invoices, payments, serviceVisits, withTenant } from "@finnor/db";
import { intelligenceForecasts } from "@finnor/read-models";
import { eq } from "drizzle-orm";

const DB_URL = process.env.DATABASE_URL ?? "postgres://finnor:finnor@localhost:5432/finnor";
const available = await (async () => { const client = new pg.Client({ connectionString: DB_URL, connectionTimeoutMillis: 2000 }); try { await client.connect(); await client.end(); return true; } catch { return false; } })();

describe.skipIf(!available)("B3 intelligence forecasts", () => {
  beforeAll(async () => { process.env.DATABASE_URL = DB_URL; await migrate(DB_URL); await seed(DB_URL); });
  afterAll(async () => { await closePool(); });
  it("derives 14-day cash and visit bands from real tenant history", async () => {
    const [invoice, household] = await withTenant(SEED_TENANT_ID, async (db) => [
      (await db.select().from(invoices).where(eq(invoices.tenantId, SEED_TENANT_ID)).limit(1))[0]!,
      (await db.select().from(households).where(eq(households.tenantId, SEED_TENANT_ID)).limit(1))[0]!,
    ]);
    const today = new Date();
    await withTenant(SEED_TENANT_ID, async (db) => {
      for (let day = 0; day < 56; day += 1) {
        const at = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate() - day, 12));
        await db.insert(payments).values({ tenantId: SEED_TENANT_ID, invoiceId: invoice.id, amountUsd: String(100 + (day % 7) * 10), status: "succeeded", receivedAt: at });
        await db.insert(serviceVisits).values({ householdId: household.id, type: "forecast_test", scheduledAt: at });
      }
    });
    const forecasts = await intelligenceForecasts(SEED_TENANT_ID);
    expect(forecasts.cashCollections).toHaveLength(14);
    expect(forecasts.visitVolume).toHaveLength(14);
    expect(forecasts.cashCollections![0]!.high).toBeGreaterThanOrEqual(forecasts.cashCollections![0]!.low);
  });
});
