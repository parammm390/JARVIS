// §5.7 (JARVIS 95% MAESTRO PACK): retrieval eval harness — 40 hand-labeled
// Q -> expected-source fixtures run through the REAL answer-action plugins against
// Dealer Zero's real corpus (see fixtures.ts for exactly what's real vs. hand-authored
// and why). Metric: expected source among the returned citations (semantic hits are
// already capped at hybridRetrieve's top-5 by construction — see retrieval.ts). CI
// gate >= 85%, score printed every run so a regression is visible in plain output, not
// just a boolean.

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import pg from "pg";
import { migrate } from "../../packages/db/migrate";
import { withTenant, closePool, tenants, embeddings } from "@finnor/db";
import { and, eq, inArray } from "drizzle-orm";
import { writeSemantic, DeterministicLocalEmbedder } from "@finnor/memory";
import { createDefaultPluginRegistry } from "@finnor/orchestration";
import { ToolRegistry } from "@finnor/tools";
import type { DomainPolicy } from "@finnor/shared-types";
import { DEALER_ZERO_TENANT_ID, SOP_DOCS, FIXTURES, type EvalFixture } from "./fixtures";

const DB_URL = process.env.DATABASE_URL ?? "postgres://finnor:finnor@localhost:5432/finnor";
const EVAL_PASS_THRESHOLD = 0.85;

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
    id: "eval-policy",
    tenantId: DEALER_ZERO_TENANT_ID,
    actionType: "eval",
    policy: overrides,
    requiresConfirmation: false,
    confirmationTemplate: null,
    version: 1,
  };
}

interface Citation {
  source: string;
  ref: string;
}

async function runFixture(fixture: EvalFixture): Promise<{ fixture: EvalFixture; hit: boolean; citations: Citation[] }> {
  const registry = createDefaultPluginRegistry();
  let actionType: string;
  let payload: Record<string, unknown>;
  if (fixture.route === "water_question") {
    actionType = "answer_water_question";
    payload = { topic: fixture.topic };
  } else if (fixture.route === "business_overview") {
    actionType = "get_business_overview";
    payload = { focus: fixture.question };
  } else if (fixture.route === "business_question") {
    actionType = "answer_business_question";
    payload = { question: fixture.question };
  } else {
    actionType = "answer_customer_question";
    payload = { question: fixture.question, householdId: fixture.householdId };
  }
  const plugin = registry.resolve(actionType)!;
  const draft = await plugin.draft(actionType, payload, policy());
  const result = await plugin.execute(draft, new ToolRegistry());
  const citations = ((result.output as { citations?: Citation[] }).citations ?? []) as Citation[];
  const hit = citations.some(
    (c) => c.source === fixture.expectedSource && (!fixture.expectedRefContains || c.ref.includes(fixture.expectedRefContains)),
  );
  return { fixture, hit, citations };
}

describe.skipIf(!available)("retrieval eval (§5.7) — expected source in top-5 citations", () => {
  beforeAll(async () => {
    process.env.DATABASE_URL = DB_URL;
    await migrate(DB_URL);
    await withTenant(DEALER_ZERO_TENANT_ID, (db) =>
      db.insert(tenants).values({ id: DEALER_ZERO_TENANT_ID, name: "Finnor Water Co. (Dealer Zero)" }).onConflictDoNothing(),
    );
    // Idempotent: skip any SOP already ingested (a real key would embed once, forever
    // — re-running this eval must never re-embed the same real content on every run).
    const already = await withTenant(DEALER_ZERO_TENANT_ID, (db) =>
      db
        .select({ sourceDocId: embeddings.sourceDocId })
        .from(embeddings)
        .where(and(eq(embeddings.tenantId, DEALER_ZERO_TENANT_ID), inArray(embeddings.sourceDocId, SOP_DOCS.map((d) => d.sourceDocId)))),
    );
    const alreadyIds = new Set(already.map((r) => r.sourceDocId));
    const missing = SOP_DOCS.filter((d) => !alreadyIds.has(d.sourceDocId));
    for (const doc of missing) {
      await writeSemantic(DEALER_ZERO_TENANT_ID, doc.sourceDocId, [doc.text], new DeterministicLocalEmbedder());
    }
  });
  afterAll(async () => {
    await closePool();
  });

  it(`clears the ${EVAL_PASS_THRESHOLD * 100}% CI gate across all 40 fixtures`, async () => {
    expect(FIXTURES).toHaveLength(40);
    const results = await Promise.all(FIXTURES.map(runFixture));
    const hits = results.filter((r) => r.hit);
    const score = hits.length / results.length;

    // Printed every run, pass or fail — a regression must be visible in plain output,
    // not just a boolean assertion.
    console.log(`[retrieval-eval] score: ${(score * 100).toFixed(1)}% (${hits.length}/${results.length}), gate: ${EVAL_PASS_THRESHOLD * 100}%`);
    const misses = results.filter((r) => !r.hit);
    if (misses.length > 0) {
      console.log(
        `[retrieval-eval] missed fixtures: ${misses.map((m) => `${m.fixture.id} (got: ${m.citations.map((c) => c.source).join(",") || "none"})`).join("; ")}`,
      );
    }

    expect(score).toBeGreaterThanOrEqual(EVAL_PASS_THRESHOLD);
  });
});
