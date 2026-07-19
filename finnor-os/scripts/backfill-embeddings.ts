// §5.2 (JARVIS 95% MAESTRO PACK): backfill semantic memory over a tenant's history —
// every finalized, successful DecisionReceipt and every ended voice call that existed
// before this phase's auto-ingest hooks shipped (or before a real embeddings key
// existed). Idempotent: re-running skips any sourceDocId already in `embeddings`, so
// it's safe to run again after the hooks have been live a while and only need to
// catch up on what predates them.
//
// Requires a real EMBEDDINGS_API_KEY in production (defaultEmbedder() fails closed
// otherwise — see packages/memory/src/semantic.ts and docs/owner-actions.md for
// Voyage AI signup steps). Under NODE_ENV=test it uses the deterministic local
// embedder instead, which is fine for proving this script's own logic but produces no
// real semantic signal.
//
// Usage: npx tsx scripts/backfill-embeddings.ts [tenantId]   (defaults to Dealer Zero)

import "dotenv/config";
import { withTenant, closePool, decisionReceipts, embeddings, voiceSessions } from "@finnor/db";
import { and, eq, isNotNull } from "drizzle-orm";
import { ingestReceipt } from "@finnor/workflow-runtime";
import { ingestCallTranscript } from "@finnor/voice-os";
import { DEALER_ZERO_TENANT_ID } from "@finnor/shared-types";

async function alreadyIngestedSourceDocIds(tenantId: string, prefix: string): Promise<Set<string>> {
  const rows = await withTenant(tenantId, (db) =>
    db.select({ sourceDocId: embeddings.sourceDocId }).from(embeddings).where(eq(embeddings.tenantId, tenantId)),
  );
  return new Set(rows.map((r) => r.sourceDocId).filter((id) => id.startsWith(prefix)));
}

async function backfillReceipts(tenantId: string): Promise<{ scanned: number; ingested: number; chunks: number }> {
  const rows = await withTenant(tenantId, (db) =>
    db
      .select()
      .from(decisionReceipts)
      .where(and(eq(decisionReceipts.tenantId, tenantId), isNotNull(decisionReceipts.finalizedAt), isNotNull(decisionReceipts.actualResult))),
  );
  const done = await alreadyIngestedSourceDocIds(tenantId, "receipt:");
  let ingested = 0;
  let chunks = 0;
  for (const row of rows) {
    if (done.has(`receipt:${row.id}`)) continue;
    const n = await ingestReceipt(tenantId, row as unknown as Parameters<typeof ingestReceipt>[1]);
    if (n > 0) {
      ingested++;
      chunks += n;
    }
  }
  return { scanned: rows.length, ingested, chunks };
}

async function backfillVoiceSessions(tenantId: string): Promise<{ scanned: number; ingested: number; chunks: number }> {
  const rows = await withTenant(tenantId, (db) =>
    db.select({ id: voiceSessions.id }).from(voiceSessions).where(and(eq(voiceSessions.tenantId, tenantId), eq(voiceSessions.status, "ended"))),
  );
  const done = await alreadyIngestedSourceDocIds(tenantId, "voice_session:");
  let ingested = 0;
  let chunks = 0;
  for (const row of rows) {
    if (done.has(`voice_session:${row.id}`)) continue;
    const n = await ingestCallTranscript(tenantId, row.id);
    if (n > 0) {
      ingested++;
      chunks += n;
    }
  }
  return { scanned: rows.length, ingested, chunks };
}

async function main() {
  const tenantId = process.argv[2] ?? DEALER_ZERO_TENANT_ID;
  console.log(`[backfill-embeddings] tenant=${tenantId}`);
  const receiptsResult = await backfillReceipts(tenantId);
  console.log(
    `[backfill-embeddings] receipts: scanned=${receiptsResult.scanned} newly_ingested=${receiptsResult.ingested} chunks_written=${receiptsResult.chunks}`,
  );
  const sessionsResult = await backfillVoiceSessions(tenantId);
  console.log(
    `[backfill-embeddings] voice sessions: scanned=${sessionsResult.scanned} newly_ingested=${sessionsResult.ingested} chunks_written=${sessionsResult.chunks}`,
  );
  await closePool();
}

main().catch(async (err) => {
  console.error("[backfill-embeddings] failed:", err);
  await closePool();
  process.exit(1);
});
