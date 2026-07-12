// Semantic memory: pgvector embeddings, namespaced by tenant_id, queried only within
// that namespace (§10). Tenant isolation is enforced by RLS AND the explicit predicate.

import { withTenant, getPool } from "@finnor/db";
import { embeddings } from "@finnor/db";
import { PLACEHOLDER_NEEDS_REAL_VALUE } from "@finnor/shared-types";

export interface SemanticHit {
  chunk: string;
  sourceDocId: string | null;
  similarity: number;
}

/**
 * Embedding provider abstraction. The real provider is TBD (§21: EMBEDDINGS_API_KEY is a
 * placeholder — verify current pricing before choosing). Until a provider is configured,
 * DeterministicLocalEmbedder makes ingestion + retrieval testable end-to-end: it hashes
 * token n-grams into a fixed 1536-dim vector. NOT semantically meaningful — a stand-in.
 */
export interface EmbeddingProvider {
  embed(text: string): Promise<number[]>;
}

export class DeterministicLocalEmbedder implements EmbeddingProvider {
  async embed(text: string): Promise<number[]> {
    const dims = 1536;
    const vec = new Array<number>(dims).fill(0);
    const tokens = text.toLowerCase().split(/\W+/).filter(Boolean);
    for (const tok of tokens) {
      let h = 2166136261;
      for (let i = 0; i < tok.length; i++) {
        h ^= tok.charCodeAt(i);
        h = Math.imul(h, 16777619);
      }
      const idx = Math.abs(h) % dims;
      vec[idx] = (vec[idx] ?? 0) + 1;
    }
    const norm = Math.sqrt(vec.reduce((s, v) => s + v * v, 0)) || 1;
    return vec.map((v) => v / norm);
  }
}

export class NotConfiguredEmbedder implements EmbeddingProvider {
  async embed(): Promise<number[]> {
    throw new Error(
      `Embeddings provider not configured (EMBEDDINGS_API_KEY=${PLACEHOLDER_NEEDS_REAL_VALUE}). ` +
        "Choose a provider and set EMBEDDINGS_API_KEY, or use DeterministicLocalEmbedder in dev.",
    );
  }
}

export function defaultEmbedder(): EmbeddingProvider {
  const key = process.env.EMBEDDINGS_API_KEY;
  if (!key || key === PLACEHOLDER_NEEDS_REAL_VALUE) return new DeterministicLocalEmbedder();
  // Real provider integration point: swap in the chosen provider's client here.
  return new DeterministicLocalEmbedder();
}

export async function writeSemantic(
  tenantId: string,
  sourceDocId: string,
  chunks: string[],
  embedder: EmbeddingProvider = defaultEmbedder(),
): Promise<number> {
  const vectors = await Promise.all(chunks.map((c) => embedder.embed(c)));
  await withTenant(tenantId, async (db) => {
    await db.insert(embeddings).values(
      chunks.map((chunk, i) => ({ tenantId, sourceDocId, chunk, embedding: vectors[i]! })),
    );
  });
  return chunks.length;
}

export async function querySemantic(
  tenantId: string,
  query: string,
  limit = 5,
  embedder: EmbeddingProvider = defaultEmbedder(),
): Promise<SemanticHit[]> {
  const qvec = await embedder.embed(query);
  const client = await getPool().connect();
  try {
    await client.query("BEGIN");
    await client.query("SELECT set_config('app.tenant_id', $1, true)", [tenantId]);
    const { rows: ext } = await client.query(
      `SELECT 1 FROM pg_extension WHERE extname = 'vector'`,
    );
    let hits: SemanticHit[];
    if (ext.length > 0) {
      // pgvector path (Supabase, CI): ANN search in SQL.
      const { rows } = await client.query(
        `SELECT chunk, source_doc_id, 1 - (embedding <=> $2::vector) AS similarity
         FROM embeddings
         WHERE tenant_id = $1 AND embedding IS NOT NULL
         ORDER BY embedding <=> $2::vector
         LIMIT $3`,
        [tenantId, JSON.stringify(qvec), limit],
      );
      hits = rows.map((r) => ({
        chunk: r.chunk as string,
        sourceDocId: (r.source_doc_id as string | null) ?? null,
        similarity: Number(r.similarity),
      }));
    } else {
      // jsonb fallback (dev machine without pgvector): cosine similarity in-process.
      // Fine at dev-corpus scale; production always has pgvector.
      const { rows } = await client.query(
        `SELECT chunk, source_doc_id, embedding FROM embeddings
         WHERE tenant_id = $1 AND embedding IS NOT NULL`,
        [tenantId],
      );
      hits = rows
        .map((r) => {
          const vec = (typeof r.embedding === "string" ? JSON.parse(r.embedding) : r.embedding) as number[];
          const dot = qvec.reduce((s, v, i) => s + v * (vec[i] ?? 0), 0);
          return {
            chunk: r.chunk as string,
            sourceDocId: (r.source_doc_id as string | null) ?? null,
            similarity: dot, // vectors are normalized, so dot product == cosine
          };
        })
        .sort((a, b) => b.similarity - a.similarity)
        .slice(0, limit);
    }
    await client.query("COMMIT");
    return hits;
  } catch (err) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw err;
  } finally {
    client.release();
  }
}
