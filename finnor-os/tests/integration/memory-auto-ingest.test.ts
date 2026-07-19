// §5.2 (JARVIS 95% MAESTRO PACK): the post-step runtime hook auto-ingests every
// completed workflow step's receipt into semantic memory, and every closed voice call
// ingests its full transcript — both real, tenant-scoped, citable chunks, not fixtures.

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import pg from "pg";
import { migrate } from "../../packages/db/migrate";
import {
  withTenant,
  closePool,
  tenants,
  workflowSteps,
  workflowRuns,
  commands,
  decisionReceipts,
  embeddings,
  voiceSessions,
  voiceTurns,
} from "@finnor/db";
import { eq } from "drizzle-orm";
import { submitCommand, claimStep, completeStep } from "@finnor/workflow-runtime";
import { openVoiceSession, appendVoiceTurn, closeVoiceSession } from "@finnor/voice-os";
import { querySemantic } from "@finnor/memory";

const DB_URL = process.env.DATABASE_URL ?? "postgres://finnor:finnor@localhost:5432/finnor";
const TENANT_ID = "00000000-0000-4000-8000-0000000000eb";

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

describe.skipIf(!available)("memory auto-ingest (§5.2)", () => {
  beforeAll(async () => {
    process.env.DATABASE_URL = DB_URL;
    await migrate(DB_URL);
    await withTenant(TENANT_ID, (db) => db.insert(tenants).values({ id: TENANT_ID, name: "Memory Auto-Ingest Test Dealer" }).onConflictDoNothing());
  });
  afterAll(async () => {
    await withTenant(TENANT_ID, async (db) => {
      await db.delete(embeddings).where(eq(embeddings.tenantId, TENANT_ID));
      // decisionReceipts has its own tenant_id — delete directly by that rather than
      // looping steps, so no receipt (however it's linked) survives to block the
      // workflow_runs FK below.
      await db.delete(decisionReceipts).where(eq(decisionReceipts.tenantId, TENANT_ID));
      await db.delete(workflowSteps).where(eq(workflowSteps.tenantId, TENANT_ID));
      await db.delete(workflowRuns).where(eq(workflowRuns.tenantId, TENANT_ID));
      await db.delete(commands).where(eq(commands.tenantId, TENANT_ID));
      await db.delete(voiceTurns).where(eq(voiceTurns.tenantId, TENANT_ID));
      await db.delete(voiceSessions).where(eq(voiceSessions.tenantId, TENANT_ID));
    });
    await closePool();
  });

  it("completeStep writes a real, citable chunk sourced from the step's own receipt", async () => {
    const submitted = await withTenant(TENANT_ID, (db) =>
      submitCommand(db, {
        tenantId: TENANT_ID,
        commandType: "auto_ingest_test",
        payload: {},
        workflowType: "lead_to_water_test",
        idempotencyKey: "auto-ingest-receipt-1",
        steps: [{ stepType: "log_visit_report", payload: {} }],
      }),
    );
    const stepId = submitted.stepIds[0]!;
    await claimStep(TENANT_ID, stepId);
    await completeStep(TENANT_ID, stepId, {
      output: { hardnessGpg: 14.3, notes: "raw water sample collected before the softener, technician confirmed access" },
    });

    const [receipt] = await withTenant(TENANT_ID, (db) => db.select().from(decisionReceipts).where(eq(decisionReceipts.workflowStepId, stepId)));
    expect(receipt).toBeTruthy();

    const rows = await withTenant(TENANT_ID, (db) => db.select({ chunk: embeddings.chunk, sourceDocId: embeddings.sourceDocId, entityRefs: embeddings.entityRefs }).from(embeddings).where(eq(embeddings.sourceDocId, `receipt:${receipt!.id}`)));
    expect(rows.length).toBeGreaterThan(0);
    expect(rows[0]!.chunk).toContain("raw water sample");
    expect(rows[0]!.chunk).toContain("lead_to_water_test");
    expect((rows[0]!.entityRefs as Array<{ type: string; id: string }>).some((r) => r.type === "workflow_run")).toBe(true);

    const hits = await querySemantic(TENANT_ID, "raw water sample before softener", 3);
    expect(hits.some((h) => h.sourceDocId === `receipt:${receipt!.id}`)).toBe(true);
  });

  it("a failed step is never ingested — nothing to cite from a failure", async () => {
    const submitted = await withTenant(TENANT_ID, (db) =>
      submitCommand(db, {
        tenantId: TENANT_ID,
        commandType: "auto_ingest_test",
        payload: {},
        workflowType: "lead_to_water_test",
        idempotencyKey: "auto-ingest-fail-1",
        steps: [{ stepType: "log_visit_report", payload: {} }],
      }),
    );
    const stepId = submitted.stepIds[0]!;
    await claimStep(TENANT_ID, stepId);
    const { failStep } = await import("@finnor/workflow-runtime");
    await failStep(TENANT_ID, stepId, "technician could not access the property");

    const [receipt] = await withTenant(TENANT_ID, (db) => db.select().from(decisionReceipts).where(eq(decisionReceipts.workflowStepId, stepId)));
    const rows = await withTenant(TENANT_ID, (db) => db.select({ chunk: embeddings.chunk, sourceDocId: embeddings.sourceDocId, entityRefs: embeddings.entityRefs }).from(embeddings).where(eq(embeddings.sourceDocId, `receipt:${receipt!.id}`)));
    expect(rows).toHaveLength(0);
  });

  it("closeVoiceSession ingests the full transcript as one document, retrievable by content", async () => {
    const session = await openVoiceSession(TENANT_ID, "call-ext-auto-ingest-1");
    await appendVoiceTurn({ tenantId: TENANT_ID, voiceSessionId: session.id, role: "caller", transcriptText: "My water smells like rotten eggs, is that dangerous?" });
    await appendVoiceTurn({
      tenantId: TENANT_ID,
      voiceSessionId: session.id,
      role: "assistant",
      transcriptText: "That's hydrogen sulfide, common in well water — we can fix it with an air-injection oxidizing filter.",
    });
    await closeVoiceSession(TENANT_ID, session.id);

    const rows = await withTenant(TENANT_ID, (db) => db.select({ chunk: embeddings.chunk, sourceDocId: embeddings.sourceDocId, entityRefs: embeddings.entityRefs }).from(embeddings).where(eq(embeddings.sourceDocId, `voice_session:${session.id}`)));
    expect(rows.length).toBeGreaterThan(0);
    expect(rows[0]!.chunk).toContain("rotten eggs");
    expect(rows[0]!.chunk).toContain("air-injection oxidizing filter");

    const hits = await querySemantic(TENANT_ID, "rotten egg smell well water", 3);
    expect(hits.some((h) => h.sourceDocId === `voice_session:${session.id}`)).toBe(true);
  });

  it("a call with no turns writes nothing — never an empty chunk", async () => {
    const session = await openVoiceSession(TENANT_ID, "call-ext-auto-ingest-empty");
    await closeVoiceSession(TENANT_ID, session.id);
    const rows = await withTenant(TENANT_ID, (db) => db.select({ chunk: embeddings.chunk, sourceDocId: embeddings.sourceDocId, entityRefs: embeddings.entityRefs }).from(embeddings).where(eq(embeddings.sourceDocId, `voice_session:${session.id}`)));
    expect(rows).toHaveLength(0);
  });

  it("ingestMemory never throws even when the underlying write genuinely fails", async () => {
    const { ingestMemory } = await import("@finnor/memory");
    // A tenantId that isn't a real uuid fails the real INSERT — proves ingestMemory
    // swallows a real DB error rather than propagating it: a completed workflow step
    // or an ended call may never fail because the memory layer did.
    const result = await ingestMemory({ tenantId: "not-a-real-uuid", sourceDocId: "doc1", text: "some real content that would otherwise chunk fine" });
    expect(result).toBe(0);
  });
});
