// §5.6 (JARVIS 95% MAESTRO PACK): correction loop. An operator marks an AI answer
// wrong with the correction; it becomes a first-class fact that outranks semantic hits
// on the same topic thereafter — real provenance via an optional receipt link, not a
// free-floating claim.

import { withTenant, memoryCorrections } from "@finnor/db";
import { eq } from "drizzle-orm";
import { defaultEmbedder, embedManyCached, type EmbeddingProvider } from "./semantic";

export interface RecordCorrectionParams {
  tenantId: string;
  receiptId?: string;
  question: string;
  wrongAnswer: string;
  correctedFact: string;
  correctedBy: string;
}

export async function recordCorrection(params: RecordCorrectionParams): Promise<{ id: string }> {
  const [row] = await withTenant(params.tenantId, (db) =>
    db
      .insert(memoryCorrections)
      .values({
        tenantId: params.tenantId,
        receiptId: params.receiptId ?? null,
        question: params.question,
        wrongAnswer: params.wrongAnswer,
        correctedFact: params.correctedFact,
        correctedBy: params.correctedBy,
      })
      .returning({ id: memoryCorrections.id }),
  );
  return { id: row!.id };
}

export interface CorrectionMatch {
  id: string;
  question: string;
  correctedFact: string;
  correctedBy: string;
  similarity: number;
}

const DEFAULT_CORRECTION_MATCH_THRESHOLD = 0.75;

function dot(a: number[], b: number[]): number {
  let sum = 0;
  for (let i = 0; i < a.length; i++) sum += a[i]! * (b[i] ?? 0);
  return sum; // vectors are normalized, so dot product == cosine — same convention as semantic.ts
}

/**
 * Finds the tenant's own correction whose ORIGINAL QUESTION most closely matches the
 * current query, above a strict match threshold — a correction only wins when it's
 * genuinely about the same thing being asked again, never a loose "kind of related"
 * match. A dedicated comparison (not folded into querySemantic's general top-N ANN
 * search) so a correction can never lose to five unrelated hits crowding it out of a
 * limited result set, and so its similarity is computed against the SAME embedder
 * every retrieval call uses — embedManyCached's content-hash cache makes repeated
 * calls for the same (tenant, correction) pair free after the first.
 */
export async function findMatchingCorrection(
  tenantId: string,
  query: string,
  embedder: EmbeddingProvider = defaultEmbedder(),
  threshold = DEFAULT_CORRECTION_MATCH_THRESHOLD,
): Promise<CorrectionMatch | null> {
  const rows = await withTenant(tenantId, (db) => db.select().from(memoryCorrections).where(eq(memoryCorrections.tenantId, tenantId)));
  if (rows.length === 0) return null;

  const [queryVec, ...questionVecs] = await embedManyCached(tenantId, [query, ...rows.map((r) => r.question)], embedder);
  let best: CorrectionMatch | null = null;
  rows.forEach((row, i) => {
    const similarity = dot(queryVec!, questionVecs[i]!);
    if (similarity >= threshold && (!best || similarity > best.similarity)) {
      best = { id: row.id, question: row.question, correctedFact: row.correctedFact, correctedBy: row.correctedBy, similarity };
    }
  });
  return best;
}
