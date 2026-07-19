// §5.5: below-threshold retrieval states what's missing instead of guessing.
// answer_customer_question is the one answer action that can realistically hit "low"
// confidence in practice (no household context, thin/no semantic hits) — the other
// three always have a structured fact grounding them (see retrieval.ts's confidence
// rule), so this is where the refusal behavior actually has a codepath to exercise.

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import pg from "pg";
import { migrate } from "../../packages/db/migrate";
import { withTenant, closePool, tenants, embeddings } from "@finnor/db";
import { eq } from "drizzle-orm";
import { writeSemantic, DeterministicLocalEmbedder } from "@finnor/memory";
import { createDefaultPluginRegistry } from "@finnor/orchestration";
import { ToolRegistry } from "@finnor/tools";
import type { DomainPolicy } from "@finnor/shared-types";

const DB_URL = process.env.DATABASE_URL ?? "postgres://finnor:finnor@localhost:5432/finnor";
const TENANT_ID = "00000000-0000-4000-8000-0000000000ee";
// Dedicated, permanently empty tenant — the "genuinely zero hits" case must not depend
// on the deterministic hash embedder's similarity scoring (it's explicitly NOT
// semantically meaningful, so "unrelated" text can still score arbitrarily against a
// real corpus; see the other two tests below for how threshold-gating is actually
// proven instead). Zero rows, guaranteed, is the one thing this tenant can promise.
const EMPTY_TENANT_ID = "00000000-0000-4000-8000-0000000000ef";
const SOFTENER_SOP_TEXT = "Our softener installation SOP: shut off main water supply, install bypass valve, connect drain line.";

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

function policy(tenantId: string, overrides: Record<string, unknown> = {}): DomainPolicy {
  return {
    id: "policy-1",
    tenantId,
    actionType: "answer_customer_question",
    policy: overrides,
    requiresConfirmation: false,
    confirmationTemplate: null,
    version: 1,
  };
}

describe.skipIf(!available)("answer_customer_question — confidence + refusal (§5.5)", () => {
  beforeAll(async () => {
    process.env.DATABASE_URL = DB_URL;
    await migrate(DB_URL);
    await withTenant(TENANT_ID, (db) => db.insert(tenants).values({ id: TENANT_ID, name: "Confidence Refusal Test Dealer" }).onConflictDoNothing());
    await withTenant(EMPTY_TENANT_ID, (db) => db.insert(tenants).values({ id: EMPTY_TENANT_ID, name: "Empty Corpus Test Dealer" }).onConflictDoNothing());
    await withTenant(TENANT_ID, (db) => db.delete(embeddings).where(eq(embeddings.tenantId, TENANT_ID)));
    await withTenant(EMPTY_TENANT_ID, (db) => db.delete(embeddings).where(eq(embeddings.tenantId, EMPTY_TENANT_ID)));
    await writeSemantic(TENANT_ID, "sop-softener-install", [SOFTENER_SOP_TEXT], new DeterministicLocalEmbedder());
  });
  afterAll(async () => {
    await withTenant(TENANT_ID, (db) => db.delete(embeddings).where(eq(embeddings.tenantId, TENANT_ID)));
    await withTenant(EMPTY_TENANT_ID, (db) => db.delete(embeddings).where(eq(embeddings.tenantId, EMPTY_TENANT_ID)));
    await closePool();
  });

  it("refuses honestly with a genuinely empty corpus — states what's missing, cites nothing fabricated", async () => {
    const registry = createDefaultPluginRegistry();
    const plugin = registry.resolve("answer_customer_question")!;
    const draft = await plugin.draft("answer_customer_question", { question: "how do you install a softener" }, policy(EMPTY_TENANT_ID));
    const result = await plugin.execute(draft, new ToolRegistry());
    expect((result.output as { citations: unknown[] }).citations).toEqual([]);
    expect(String((result.output as { answer: string }).answer)).toMatch(/don't have anything/i);
  });

  it("refuses honestly when a real hit exists but a strict policy threshold isn't cleared", async () => {
    const registry = createDefaultPluginRegistry();
    const plugin = registry.resolve("answer_customer_question")!;
    // Query with the corpus's own exact text — the deterministic embedder gives this a
    // perfect self-similarity, so an (effectively unreachable) threshold of 1.01 is the
    // only way to force confidence:"low" here without depending on the hash embedder's
    // non-semantic scoring for anything else — proving the gate checks the real
    // confidence value, not just whether any hit exists.
    const draft = await plugin.draft("answer_customer_question", { question: SOFTENER_SOP_TEXT }, policy(TENANT_ID, { retrievalConfidenceThreshold: 1.01 }));
    const result = await plugin.execute(draft, new ToolRegistry());
    expect(String((result.output as { answer: string }).answer)).toMatch(/not confident enough/i);
  });

  it("proceeds past the refusal gate for a real, strongly-matching hit under the default threshold", async () => {
    const registry = createDefaultPluginRegistry();
    const plugin = registry.resolve("answer_customer_question")!;
    // Same self-similarity trick, but with the real default threshold (no override) —
    // proves the default gate lets a genuinely strong match through.
    const draft = await plugin.draft("answer_customer_question", { question: SOFTENER_SOP_TEXT }, policy(TENANT_ID));
    const result = await plugin.execute(draft, new ToolRegistry());
    const answer = String((result.output as { answer: string }).answer);
    expect(answer).not.toMatch(/not confident enough/i);
    expect(answer).not.toMatch(/don't have anything/i);
    expect((result.output as { citations: Array<{ source: string }> }).citations.some((c) => c.source === "semantic_memory")).toBe(true);
  });
});
