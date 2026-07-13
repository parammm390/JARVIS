// Critic-review handler acceptance: real DB, real episode writes, real status
// escalation. The Bedrock HTTP call itself is mocked — BedrockOpenAICompatProvider
// (packages/tools/src/llm.ts) is a plain fetch() call, so stubbing global fetch is
// the correct, narrow seam; this never spends a real Bedrock token in CI.

import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from "vitest";
import pg from "pg";
import { migrate } from "../../packages/db/migrate";
import { getPool, closePool, withTenant, domainActions } from "@finnor/db";
import { eq } from "drizzle-orm";
import { appendEpisode, readEpisodes } from "@finnor/memory";
import { criticReview } from "../../apps/worker/src/handlers/critic-review";

const DB_URL = process.env.DATABASE_URL ?? "postgres://finnor:finnor@localhost:5432/finnor";
const TENANT_ID = "00000000-0000-4000-8000-0000000000f2"; // dedicated, isolated from other fixtures

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

function mockFetchOnce(content: string) {
  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ choices: [{ message: { content } }] }),
    }),
  );
}

async function draftPendingAction(instruction: string | null): Promise<string> {
  const [row] = await withTenant(TENANT_ID, (db) =>
    db
      .insert(domainActions)
      .values({ tenantId: TENANT_ID, actionType: "create_invoice", payload: { amountUsd: 50 }, status: "pending", summary: "Create a $50 invoice." })
      .returning(),
  );
  await appendEpisode(
    TENANT_ID,
    row!.id,
    "planned",
    instruction ? { instruction } : { source: "system_scan" },
    { actionType: "create_invoice", reasoning: instruction ? "Caller asked for a $50 invoice." : null },
  );
  return row!.id;
}

describe.skipIf(!available)("critic_review handler", () => {
  beforeAll(async () => {
    process.env.DATABASE_URL = DB_URL;
    await migrate(DB_URL);
    await getPool().query(`INSERT INTO tenants (id, name) VALUES ($1, 'Critic Review Test Tenant') ON CONFLICT (id) DO NOTHING`, [TENANT_ID]);
  });

  afterAll(async () => {
    vi.unstubAllGlobals();
    await closePool();
  });

  beforeEach(() => {
    delete process.env.AWS_BEDROCK_API_KEY;
    vi.unstubAllGlobals();
  });

  it("is a clean no-op when Bedrock isn't configured — never touches the action, never calls fetch", async () => {
    const actionId = await draftPendingAction("Create a $50 invoice for the Petersons.");
    await expect(criticReview({ tenantId: TENANT_ID, actionId })).resolves.toBeUndefined();
    const [row] = await withTenant(TENANT_ID, (db) => db.select().from(domainActions).where(eq(domainActions.id, actionId)));
    expect(row!.status).toBe("pending");
  });

  it("is a no-op when the action has no instruction (system-originated draft)", async () => {
    process.env.AWS_BEDROCK_API_KEY = "test-key";
    const actionId = await draftPendingAction(null);
    await criticReview({ tenantId: TENANT_ID, actionId });
    const episodes = await readEpisodes(TENANT_ID, { domainActionId: actionId });
    expect(episodes.some((e) => e.step === "critic_review")).toBe(false);
  });

  it("is a no-op when the action is no longer pending", async () => {
    process.env.AWS_BEDROCK_API_KEY = "test-key";
    const actionId = await draftPendingAction("Create a $50 invoice for the Petersons.");
    await withTenant(TENANT_ID, (db) => db.update(domainActions).set({ status: "approved" }).where(eq(domainActions.id, actionId)));
    await criticReview({ tenantId: TENANT_ID, actionId });
    const episodes = await readEpisodes(TENANT_ID, { domainActionId: actionId });
    expect(episodes.some((e) => e.step === "critic_review")).toBe(false);
  });

  it("records an unflagged verdict as a real episode without touching status", async () => {
    process.env.AWS_BEDROCK_API_KEY = "test-key";
    mockFetchOnce('{"flagged": false, "reason": "Matches the instruction."}');
    const actionId = await draftPendingAction("Create a $50 invoice for the Petersons.");
    await criticReview({ tenantId: TENANT_ID, actionId });
    const episodes = await readEpisodes(TENANT_ID, { domainActionId: actionId });
    const critic = episodes.find((e) => e.step === "critic_review");
    expect(critic).toBeTruthy();
    expect((critic!.output as Record<string, unknown>).flagged).toBe(false);
    const [row] = await withTenant(TENANT_ID, (db) => db.select().from(domainActions).where(eq(domainActions.id, actionId)));
    expect(row!.status).toBe("pending");
  });

  it("escalates to needs_human_review when the critic flags a real mismatch", async () => {
    process.env.AWS_BEDROCK_API_KEY = "test-key";
    mockFetchOnce('{"flagged": true, "reason": "Instruction said $50, drafted action says $5000."}');
    const actionId = await draftPendingAction("Create a $50 invoice for the Petersons.");
    await criticReview({ tenantId: TENANT_ID, actionId });
    const [row] = await withTenant(TENANT_ID, (db) => db.select().from(domainActions).where(eq(domainActions.id, actionId)));
    expect(row!.status).toBe("needs_human_review");
    const episodes = await readEpisodes(TENANT_ID, { domainActionId: actionId });
    const critic = episodes.find((e) => e.step === "critic_review");
    expect((critic!.output as Record<string, unknown>).flagged).toBe(true);
  });
});
