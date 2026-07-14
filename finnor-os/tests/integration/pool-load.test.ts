// Connection-pool / concurrency proof — packages/db/index.ts caps the pool at max:2
// in production specifically because Supabase Supavisor's session-mode pooler has a
// low concurrent-client ceiling on the default tier (see that file's own comment).
// This proves the pipeline genuinely serializes concurrent withTenant() calls through
// that tiny pool without dropping or corrupting any write — real Postgres, real
// concurrency, not mocked.

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import pg from "pg";
import { eq } from "drizzle-orm";
import { migrate } from "../../packages/db/migrate";
import { seed, SEED_TENANT_ID } from "../../packages/db/seed";
import { withTenant, closePool, scanFindings } from "@finnor/db";

const DB_URL = process.env.DATABASE_URL ?? "postgres://finnor:finnor@localhost:5432/finnor";

async function dbUp(): Promise<boolean> {
  const c = new pg.Client({ connectionString: DB_URL, connectionTimeoutMillis: 2000 });
  try {
    await c.connect();
    await c.end();
    return true;
  } catch {
    return false;
  }
}
const available = await dbUp();

describe.skipIf(!available)("connection pool under concurrent load", () => {
  beforeAll(async () => {
    process.env.DATABASE_URL = DB_URL;
    await migrate(DB_URL);
    await seed(DB_URL);
    await withTenant(SEED_TENANT_ID, (db) => db.delete(scanFindings).where(eq(scanFindings.scanType, "pool_load_test")));
  });
  afterAll(async () => {
    await withTenant(SEED_TENANT_ID, (db) => db.delete(scanFindings).where(eq(scanFindings.scanType, "pool_load_test")));
    await closePool();
  });

  it("20 concurrent withTenant() writes all commit, none dropped or corrupted", async () => {
    const concurrency = 20;
    const results = await Promise.all(
      Array.from({ length: concurrency }, (_, i) =>
        withTenant(SEED_TENANT_ID, (db) =>
          db.insert(scanFindings).values({ tenantId: SEED_TENANT_ID, scanType: "pool_load_test", summary: `run-${i}`, details: { i } }).returning(),
        ),
      ),
    );
    expect(results).toHaveLength(concurrency);
    expect(results.every((r) => r.length === 1)).toBe(true);

    const rows = await withTenant(SEED_TENANT_ID, (db) => db.select().from(scanFindings).where(eq(scanFindings.scanType, "pool_load_test")));
    expect(rows).toHaveLength(concurrency);
    const summaries = new Set(rows.map((r) => r.summary));
    for (let i = 0; i < concurrency; i++) expect(summaries.has(`run-${i}`)).toBe(true);
  }, 30_000);

  it("50 concurrent reads all return the same consistent count — no torn reads under load", async () => {
    const reads = await Promise.all(
      Array.from({ length: 50 }, () => withTenant(SEED_TENANT_ID, (db) => db.select().from(scanFindings).where(eq(scanFindings.scanType, "pool_load_test")))),
    );
    const counts = new Set(reads.map((r) => r.length));
    expect(counts.size).toBe(1); // every concurrent reader sees the same committed state
  }, 30_000);
});
