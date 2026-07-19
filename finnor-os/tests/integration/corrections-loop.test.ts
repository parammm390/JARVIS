// §5.6: "test proves the corrected fact wins on re-query." Two layers — the raw
// hybridRetrieve mechanics, and the full answer_customer_question plugin end-to-end
// (so a correction demonstrably changes what a customer actually gets told, not just
// what a lower-level function returns).

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import pg from "pg";
import { migrate } from "../../packages/db/migrate";
import { withTenant, closePool, tenants, embeddings, memoryCorrections } from "@finnor/db";
import { eq } from "drizzle-orm";
import { writeSemantic, DeterministicLocalEmbedder, hybridRetrieve, recordCorrection, findMatchingCorrection } from "@finnor/memory";
import { createDefaultPluginRegistry } from "@finnor/orchestration";
import { ToolRegistry } from "@finnor/tools";
import type { DomainPolicy } from "@finnor/shared-types";

const DB_URL = process.env.DATABASE_URL ?? "postgres://finnor:finnor@localhost:5432/finnor";
const TENANT_ID = "00000000-0000-4000-8000-0000000000f3";
const WRONG_SOP_TEXT = "Our service radius is 10 miles from the shop, we don't travel further than that.";
const QUESTION = "how far do you travel for service calls";

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

function policy(overrides: Record<string, unknown> = {}): DomainPolicy {
  return {
    id: "policy-1",
    tenantId: TENANT_ID,
    actionType: "answer_customer_question",
    policy: overrides,
    requiresConfirmation: false,
    confirmationTemplate: null,
    version: 1,
  };
}

describe.skipIf(!available)("correction loop — the corrected fact wins on re-query (§5.6)", () => {
  beforeAll(async () => {
    process.env.DATABASE_URL = DB_URL;
    await migrate(DB_URL);
    await withTenant(TENANT_ID, (db) => db.insert(tenants).values({ id: TENANT_ID, name: "Correction Loop Test Dealer" }).onConflictDoNothing());
    await withTenant(TENANT_ID, (db) => db.delete(embeddings).where(eq(embeddings.tenantId, TENANT_ID)));
    await withTenant(TENANT_ID, (db) => db.delete(memoryCorrections).where(eq(memoryCorrections.tenantId, TENANT_ID)));
    // Seed the OLD, wrong fact into semantic memory — this is what the answer would
    // say before any correction exists.
    await writeSemantic(TENANT_ID, "sop-service-radius-wrong", [WRONG_SOP_TEXT], new DeterministicLocalEmbedder());
  });
  afterAll(async () => {
    await withTenant(TENANT_ID, (db) => db.delete(embeddings).where(eq(embeddings.tenantId, TENANT_ID)));
    await withTenant(TENANT_ID, (db) => db.delete(memoryCorrections).where(eq(memoryCorrections.tenantId, TENANT_ID)));
    await closePool();
  });

  it("before any correction: retrieval has no correction fact, semantic memory alone answers", async () => {
    const before = await hybridRetrieve({ tenantId: TENANT_ID, query: QUESTION });
    expect(before.facts.correction).toBeUndefined();
  });

  it("findMatchingCorrection returns null before any correction exists, then the real correction after one is recorded", async () => {
    const before = await findMatchingCorrection(TENANT_ID, QUESTION);
    expect(before).toBeNull();

    await recordCorrection({
      tenantId: TENANT_ID,
      question: QUESTION,
      wrongAnswer: WRONG_SOP_TEXT,
      correctedFact: "We actually now service up to a 25 mile radius as of this year.",
      correctedBy: "owner-test-user",
    });

    const after = await findMatchingCorrection(TENANT_ID, QUESTION);
    expect(after).not.toBeNull();
    expect(after!.correctedFact).toBe("We actually now service up to a 25 mile radius as of this year.");
  });

  it("after a correction: hybridRetrieve puts it first among structured facts and first in citations", async () => {
    const result = await hybridRetrieve({ tenantId: TENANT_ID, query: QUESTION });
    expect(result.facts.correction).toMatchObject({ correctedFact: "We actually now service up to a 25 mile radius as of this year." });
    expect(result.citations[0]!.source).toBe("correction");
    expect(result.confidence).toBe("high"); // a correction is itself a structured fact
  });

  it("a differently-phrased but same-topic re-query still matches the correction (semantic, not exact-string)", async () => {
    const result = await hybridRetrieve({ tenantId: TENANT_ID, query: "how far do you drive for service calls" });
    expect(result.facts.correction).toBeTruthy();
  });

  it("an unrelated re-query does not spuriously match the correction", async () => {
    const result = await hybridRetrieve({ tenantId: TENANT_ID, query: "do you accept credit card payments" });
    expect(result.facts.correction).toBeUndefined();
  });

  it("end-to-end: answer_customer_question actually tells the customer the corrected fact, not the old wrong one", async () => {
    const registry = createDefaultPluginRegistry();
    const plugin = registry.resolve("answer_customer_question")!;
    const draft = await plugin.draft("answer_customer_question", { question: QUESTION }, policy());
    const result = await plugin.execute(draft, new ToolRegistry());
    const answer = String((result.output as { answer: string }).answer);
    expect(answer).toContain("25 mile radius");
    expect(answer).not.toContain("10 miles");
    expect((result.output as { citations: Array<{ source: string }> }).citations[0]!.source).toBe("correction");
  });
});
