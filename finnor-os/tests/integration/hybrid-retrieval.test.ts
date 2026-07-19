// §5.3 (JARVIS 95% MAESTRO PACK): hybrid retrieval — structured facts first, semantic
// second, merged with citations in the exact {source, ref, timestamp} shape a
// DecisionReceipt's evidence field already uses. "The LLM never answers from semantic
// memory alone when a structured source exists" — proven here via the confidence field.

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import pg from "pg";
import { migrate } from "../../packages/db/migrate";
import { withTenant, closePool, tenants, embeddings } from "@finnor/db";
import { eq } from "drizzle-orm";
import { hybridRetrieve, writeSemantic, DeterministicLocalEmbedder } from "@finnor/memory";

const DB_URL = process.env.DATABASE_URL ?? "postgres://finnor:finnor@localhost:5432/finnor";
const TENANT_ID = "00000000-0000-4000-8000-0000000000ec";

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

describe.skipIf(!available)("hybridRetrieve (§5.3)", () => {
  beforeAll(async () => {
    process.env.DATABASE_URL = DB_URL;
    await migrate(DB_URL);
    await withTenant(TENANT_ID, (db) => db.insert(tenants).values({ id: TENANT_ID, name: "Hybrid Retrieval Test Dealer" }).onConflictDoNothing());
    await withTenant(TENANT_ID, (db) => db.delete(embeddings).where(eq(embeddings.tenantId, TENANT_ID)));
    await writeSemantic(
      TENANT_ID,
      "sop-iron-filter",
      ["Our iron filter SOP: backwash weekly, check the air-injection compressor monthly."],
      new DeterministicLocalEmbedder(),
    );
  });
  afterAll(async () => {
    await withTenant(TENANT_ID, (db) => db.delete(embeddings).where(eq(embeddings.tenantId, TENANT_ID)));
    await closePool();
  });

  it("returns structured facts merged by source, and semantic hits alongside them", async () => {
    const result = await hybridRetrieve({
      tenantId: TENANT_ID,
      query: "iron filter backwash",
      structured: [{ source: "household360", ref: "hh-1", data: { hardnessGpg: 14 } }],
    });
    expect(result.facts.household360).toEqual({ hardnessGpg: 14 });
    expect(result.semanticHits.length).toBeGreaterThan(0);
    expect(result.semanticHits[0]!.chunk).toContain("iron filter SOP");
  });

  it("citations carry structured facts first, in the receipt-evidence shape {source, ref, timestamp}", async () => {
    const result = await hybridRetrieve({
      tenantId: TENANT_ID,
      query: "iron filter backwash",
      structured: [{ source: "household360", ref: "hh-1", data: {} }],
    });
    expect(result.citations[0]).toMatchObject({ source: "household360", ref: "hh-1" });
    expect(typeof result.citations[0]!.timestamp).toBe("string");
    expect(result.citations.some((c) => c.source === "semantic_memory" && c.ref === "sop-iron-filter")).toBe(true);
  });

  it("confidence is high whenever a structured fact exists, regardless of semantic quality", async () => {
    const result = await hybridRetrieve({
      tenantId: TENANT_ID,
      query: "completely unrelated gibberish xyzzy",
      structured: [{ source: "household360", ref: "hh-1", data: {} }],
    });
    expect(result.confidence).toBe("high");
  });

  it("confidence is low with no structured facts and no strong semantic hit", async () => {
    const result = await hybridRetrieve({
      tenantId: TENANT_ID,
      query: "completely unrelated gibberish that matches nothing at all xyzzy plonk",
      confidenceThreshold: 0.99, // effectively unreachable by the deterministic hash embedder
    });
    expect(result.confidence).toBe("low");
  });

  it("a semantic-memory failure never breaks retrieval when structured facts alone can ground the answer", async () => {
    // An invalid tenantId makes querySemantic's real DB call fail — hybridRetrieve
    // must still return the structured facts, matching buildMemorySnapshot's existing
    // graceful-degradation convention.
    const result = await hybridRetrieve({
      tenantId: "not-a-real-uuid",
      query: "anything",
      structured: [{ source: "household360", ref: "hh-1", data: { note: "still real" } }],
    });
    expect(result.facts.household360).toEqual({ note: "still real" });
    expect(result.semanticHits).toEqual([]);
    expect(result.confidence).toBe("high");
  });

  it("with zero structured facts, retrieval is semantic-only but still returns real citations", async () => {
    const result = await hybridRetrieve({ tenantId: TENANT_ID, query: "iron filter backwash" });
    expect(Object.keys(result.facts)).toHaveLength(0);
    expect(result.citations.every((c) => c.source === "semantic_memory")).toBe(true);
  });
});
