// §5.1: content-hash embedding cache — re-embedding unchanged chunks must be a cache
// hit (no embedder call), a changed chunk (or a different model/provider) must be a
// real miss, and the cache must stay tenant-scoped like every other table here.

import { describe, it, expect, beforeAll } from "vitest";
import pg from "pg";
import { migrate } from "../../packages/db/migrate";
import { seed, SEED_TENANT_ID } from "../../packages/db/seed";
import { embedManyCached, EMBEDDING_DIMENSIONS, type EmbeddingProvider } from "@finnor/memory";

const SUPER_URL = process.env.DATABASE_URL ?? "postgres://finnor:finnor@localhost:5432/finnor";
const TENANT_B = "00000000-0000-4000-8000-000000000002";

async function dbUp(): Promise<boolean> {
  const c = new pg.Client({ connectionString: SUPER_URL, connectionTimeoutMillis: 2000 });
  try {
    await c.connect();
    await c.end();
    return true;
  } catch {
    return false;
  }
}
const available = await dbUp();

/** Counts real embed calls so the test can assert cache hits never reach the "provider". */
class CountingEmbedder implements EmbeddingProvider {
  readonly name: string;
  calls = 0;
  constructor(name = "counting-test-v1") {
    this.name = name;
  }
  async embed(text: string): Promise<number[]> {
    this.calls++;
    // Real pgvector (CI, staging, prod) enforces the embedding_cache column's declared
    // vector(1024) dimension -- a short stub vector only "worked" against local dev's
    // jsonb fallback (no pgvector, no dimension check). Distinguish calls/texts via the
    // first two real dimensions, zero-fill the rest to the real width.
    const v = new Array(EMBEDDING_DIMENSIONS).fill(0);
    v[0] = text.length;
    v[1] = this.calls;
    return v;
  }
}

describe.skipIf(!available)("embedding cache (§5.1)", () => {
  beforeAll(async () => {
    process.env.DATABASE_URL = SUPER_URL;
    await migrate();
    await seed();
    const c = new pg.Client({ connectionString: SUPER_URL });
    await c.connect();
    await c.query("BEGIN");
    await c.query("SELECT set_config('app.tenant_id', $1, true)", [TENANT_B]);
    await c.query(`INSERT INTO tenants (id, name) VALUES ($1, 'Cache Test Tenant B') ON CONFLICT (id) DO NOTHING`, [TENANT_B]);
    await c.query("COMMIT");
    // The local embedded Postgres data directory persists across test runs — clear out
    // any cache rows a previous run of this same suite left behind, or "first call is a
    // real miss" would flake into a false cache hit on a re-run.
    await c.query("DELETE FROM embedding_cache WHERE tenant_id = ANY($1::uuid[])", [[SEED_TENANT_ID, TENANT_B]]);
    await c.end();
  });

  it("second call with the same text is a cache hit — the embedder is not called again", async () => {
    const embedder = new CountingEmbedder();
    const first = await embedManyCached(SEED_TENANT_ID, ["hard water at 14 gpg"], embedder);
    expect(embedder.calls).toBe(1);
    const second = await embedManyCached(SEED_TENANT_ID, ["hard water at 14 gpg"], embedder);
    expect(embedder.calls).toBe(1); // still 1 — the second call was served from cache
    expect(second).toEqual(first);
  });

  it("a different text is a real miss even when a similarly-worded chunk is cached", async () => {
    const embedder = new CountingEmbedder();
    await embedManyCached(SEED_TENANT_ID, ["iron above 0.3 ppm"], embedder);
    expect(embedder.calls).toBe(1);
    await embedManyCached(SEED_TENANT_ID, ["iron above 0.4 ppm"], embedder);
    expect(embedder.calls).toBe(2);
  });

  it("a cache hit under one model name does not satisfy a lookup under a different model", async () => {
    const embedderA = new CountingEmbedder("model-a");
    const embedderB = new CountingEmbedder("model-b");
    await embedManyCached(SEED_TENANT_ID, ["model swap test text"], embedderA);
    expect(embedderA.calls).toBe(1);
    await embedManyCached(SEED_TENANT_ID, ["model swap test text"], embedderB);
    expect(embedderB.calls).toBe(1); // real miss under the new model name, not served from model-a's cache
  });

  it("cache is tenant-scoped — tenant B never gets a free hit off tenant A's cached text", async () => {
    const embedder = new CountingEmbedder("tenant-scope-test");
    await embedManyCached(SEED_TENANT_ID, ["tenant isolation probe text"], embedder);
    expect(embedder.calls).toBe(1);
    await embedManyCached(TENANT_B, ["tenant isolation probe text"], embedder);
    expect(embedder.calls).toBe(2);
  });

  it("mixed batch: cached entries are skipped, only real misses call the embedder", async () => {
    const embedder = new CountingEmbedder("mixed-batch-test");
    await embedManyCached(SEED_TENANT_ID, ["mixed batch alpha"], embedder);
    expect(embedder.calls).toBe(1);
    const vecs = await embedManyCached(SEED_TENANT_ID, ["mixed batch alpha", "mixed batch beta"], embedder);
    expect(embedder.calls).toBe(2); // alpha was cached, only beta triggered a real call
    expect(vecs).toHaveLength(2);
  });
});
