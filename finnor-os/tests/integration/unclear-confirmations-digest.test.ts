// Phase 14 retrieval half: computeLearningDigest's unclearConfirmations field, real
// Postgres. Proves the DB-touching wiring — pending_confirmations that resolved this
// window, joined to their session's caller voice_turns, re-parsed with the tenant's
// own current voice_confirmation policy phrases. The pure re-parse logic itself
// (computeUnclearConfirmations) is covered by tests/unit/learning-digest.test.ts.

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import pg from "pg";
import { migrate } from "../../packages/db/migrate";
import { getPool, closePool, withTenant, voiceSessions, voiceTurns, pendingConfirmations, domainActions, domainPolicies } from "@finnor/db";
import { eq } from "drizzle-orm";
import { computeLearningDigest } from "@finnor/orchestration";

const DB_URL = process.env.DATABASE_URL ?? "postgres://finnor:finnor@localhost:5432/finnor";
const TENANT_ID = "00000000-0000-4000-8000-0000000000e5"; // dedicated, isolated from other fixtures

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

describe.skipIf(!available)("computeLearningDigest — unclearConfirmations (Phase 14)", () => {
  let sessionId: string;
  let actionId: string;

  beforeAll(async () => {
    process.env.DATABASE_URL = DB_URL;
    await migrate(DB_URL);
    await getPool().query(`INSERT INTO tenants (id, name) VALUES ($1, 'Unclear Confirmations Test Tenant') ON CONFLICT (id) DO NOTHING`, [TENANT_ID]);

    await withTenant(TENANT_ID, async (db) => {
      const [session] = await db
        .insert(voiceSessions)
        .values({ tenantId: TENANT_ID, callExternalId: `unclear-digest-${TENANT_ID}-${randomUUID()}` })
        .returning();
      sessionId = session!.id;

      const [action] = await db
        .insert(domainActions)
        .values({ tenantId: TENANT_ID, actionType: "answer_customer_question", payload: {}, policyId: null, status: "completed" })
        .returning();
      actionId = action!.id;

      // The caller fumbles twice before a clear "yes" — the confirmation still
      // resolves (status='confirmed'), so this session's earlier unclear turns are
      // exactly the kind of "had to repeat themselves" moment the digest surfaces.
      await db.insert(voiceTurns).values([
        { tenantId: TENANT_ID, voiceSessionId: sessionId, sequence: 1, role: "caller", transcriptText: "hmm let me think" },
        { tenantId: TENANT_ID, voiceSessionId: sessionId, sequence: 2, role: "assistant", transcriptText: "Say yes to approve, or no to reject." },
        { tenantId: TENANT_ID, voiceSessionId: sessionId, sequence: 3, role: "caller", transcriptText: "yes, go ahead" },
      ]);

      const [pc] = await db
        .insert(pendingConfirmations)
        .values({ tenantId: TENANT_ID, voiceSessionId: sessionId, domainActionId: actionId, promptText: "test prompt" })
        .returning();
      await db.update(pendingConfirmations).set({ status: "confirmed", resolvedAt: new Date() }).where(eq(pendingConfirmations.id, pc!.id));
    });
  });

  afterAll(async () => {
    await closePool();
  });

  it("surfaces the unclear caller turn from a session whose confirmation resolved", async () => {
    const digest = await computeLearningDigest(TENANT_ID);
    expect(digest.unclearConfirmations.some((u) => u.transcript.includes("let me think"))).toBe(true);
    // The eventual clear "yes" turn is not itself unclear — must not appear.
    expect(digest.unclearConfirmations.some((u) => u.transcript.includes("go ahead"))).toBe(false);
  });

  it("self-cleans once the phrase is added to the tenant's own voice_confirmation policy", async () => {
    await getPool().query(
      `INSERT INTO domain_policies (tenant_id, action_type, policy, requires_confirmation)
       VALUES ($1, 'voice_confirmation', $2, true)
       ON CONFLICT DO NOTHING`,
      [TENANT_ID, JSON.stringify({ approvePhrases: ["let me think"] })],
    );
    const digest = await computeLearningDigest(TENANT_ID);
    expect(digest.unclearConfirmations.some((u) => u.transcript.includes("let me think"))).toBe(false);
    await withTenant(TENANT_ID, (db) => db.delete(domainPolicies).where(eq(domainPolicies.tenantId, TENANT_ID)));
  });

  it("a confirmation that never resolved (still awaiting) does not contribute its turns", async () => {
    await withTenant(TENANT_ID, async (db) => {
      const [session2] = await db
        .insert(voiceSessions)
        .values({ tenantId: TENANT_ID, callExternalId: `unclear-digest-unresolved-${TENANT_ID}-${randomUUID()}` })
        .returning();
      const [action2] = await db
        .insert(domainActions)
        .values({ tenantId: TENANT_ID, actionType: "answer_customer_question", payload: {}, policyId: null, status: "pending" })
        .returning();
      await db.insert(voiceTurns).values([
        { tenantId: TENANT_ID, voiceSessionId: session2!.id, sequence: 1, role: "caller", transcriptText: "never resolved mystery phrase" },
      ]);
      await db.insert(pendingConfirmations).values({
        tenantId: TENANT_ID,
        voiceSessionId: session2!.id,
        domainActionId: action2!.id,
        promptText: "test prompt",
        status: "awaiting",
      });
    });
    const digest = await computeLearningDigest(TENANT_ID);
    expect(digest.unclearConfirmations.some((u) => u.transcript.includes("never resolved mystery phrase"))).toBe(false);
  });
});
