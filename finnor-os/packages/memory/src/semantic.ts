// Semantic memory: pgvector embeddings, namespaced by tenant_id, queried only within
// that namespace (§10). Tenant isolation is enforced by RLS AND the explicit predicate.

import { createHash } from "node:crypto";
import { withTenant, getPool, embeddingCache } from "@finnor/db";
import { embeddings } from "@finnor/db";
import { PLACEHOLDER_NEEDS_REAL_VALUE } from "@finnor/shared-types";

export interface SemanticHit {
  chunk: string;
  sourceDocId: string | null;
  similarity: number;
  occurredAt?: string;
  entityRefs?: unknown[];
}

/**
 * Embedding provider abstraction. §5.1 (JARVIS 95% MAESTRO PACK): the chosen real
 * provider is Voyage AI voyage-3.5 (VoyageEmbedder below). DeterministicLocalEmbedder
 * hashes token n-grams into a fixed vector — NOT semantically meaningful, a mechanical
 * stand-in that keeps ingestion/retrieval *plumbing* testable without a live API key.
 * Per §5's decision, it may only run under NODE_ENV=test — see defaultEmbedder().
 */
export interface EmbeddingProvider {
  /** Stable identifier for this provider+config, used as the embedding_cache "model"
   *  key so a future provider swap never serves a stale-dimension vector from cache. */
  readonly name: string;
  embed(text: string): Promise<number[]>;
  /** Optional batch path — providers without a real batch API fall back to per-text
   *  embed() calls in embedManyCached() below. */
  embedBatch?(texts: string[]): Promise<number[][]>;
}

export const EMBEDDING_DIMENSIONS = 1024;

export class DeterministicLocalEmbedder implements EmbeddingProvider {
  readonly name = "deterministic-local-v1";

  async embed(text: string): Promise<number[]> {
    const dims = EMBEDDING_DIMENSIONS;
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

const FAIL_CLOSED_MESSAGE =
  "Embeddings are not configured for this environment: EMBEDDINGS_API_KEY is unset " +
  "(or still the placeholder). Real memory never silently falls back to a fake " +
  "embedder outside tests — set a real Voyage AI key, or see " +
  "finnor-os/docs/owner-actions.md for signup steps. Callers must treat this as a " +
  "degraded-mode signal (log + continue), never let it crash an unrelated request.";

/** §5.1: "the silent fallback... is a security-grade bug." This is the fix — instead of
 *  quietly returning fake-but-plausible-looking vectors, any real (non-test) call site
 *  without a real provider gets a loud, typed failure. Deliberately does NOT crash the
 *  process at import time (that would take down unrelated routes/jobs that have nothing
 *  to do with memory) — every caller in this codebase already wraps semantic memory
 *  calls in try/catch or .catch() and degrades gracefully, matching the existing
 *  provider-circuit-breaker convention ("queue as degraded, never silently emulated"). */
export class FailClosedEmbedder implements EmbeddingProvider {
  readonly name = "fail-closed";
  async embed(): Promise<number[]> {
    throw new Error(FAIL_CLOSED_MESSAGE);
  }
  async embedBatch(): Promise<number[][]> {
    throw new Error(FAIL_CLOSED_MESSAGE);
  }
}

const VOYAGE_MODEL = "voyage-3.5";
const VOYAGE_BATCH_SIZE = 128;
const VOYAGE_TIMEOUT_MS = 20_000;
const VOYAGE_MAX_RETRIES = 3;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Full jitter exponential backoff — same shape as workflow-runtime/src/outbox.ts's
 *  jitteredBackoffMs, reimplemented locally rather than adding a cross-package dep. */
function jitteredBackoffMs(attempt: number): number {
  const cap = Math.min(1000 * 2 ** attempt, 8000);
  return Math.floor(Math.random() * cap);
}

/**
 * Real Voyage AI embedder — plain fetch, no SDK dependency (matches this repo's
 * stripe.ts/quickbooks.ts convention). §5.1's exact model name/output_dimension
 * parameter should be reconfirmed against Voyage's live docs at signup time (see
 * docs/owner-actions.md) — this implementation follows Voyage's documented
 * Matryoshka output_dimension option for voyage-3.5 as of this writing, but has never
 * been exercised against a real account (no key exists in this environment).
 */
export class VoyageEmbedder implements EmbeddingProvider {
  readonly name = `voyage-3.5-${EMBEDDING_DIMENSIONS}`;
  private readonly apiKey: string;

  constructor(apiKey?: string) {
    const key = apiKey ?? process.env.EMBEDDINGS_API_KEY;
    if (!key || key === PLACEHOLDER_NEEDS_REAL_VALUE) {
      throw new Error("VoyageEmbedder requires a real EMBEDDINGS_API_KEY");
    }
    this.apiKey = key;
  }

  async embed(text: string): Promise<number[]> {
    const [vec] = await this.embedBatch([text]);
    return vec!;
  }

  async embedBatch(texts: string[]): Promise<number[][]> {
    if (texts.length === 0) return [];
    const out: number[][] = [];
    for (let i = 0; i < texts.length; i += VOYAGE_BATCH_SIZE) {
      out.push(...(await this.embedBatchOnce(texts.slice(i, i + VOYAGE_BATCH_SIZE))));
    }
    return out;
  }

  private async embedBatchOnce(batch: string[], attempt = 0): Promise<number[][]> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), VOYAGE_TIMEOUT_MS);
    try {
      const res = await fetch("https://api.voyageai.com/v1/embeddings", {
        method: "POST",
        headers: { Authorization: `Bearer ${this.apiKey}`, "content-type": "application/json" },
        body: JSON.stringify({
          input: batch,
          model: VOYAGE_MODEL,
          output_dimension: EMBEDDING_DIMENSIONS,
          input_type: "document",
        }),
        signal: controller.signal,
      });
      if (!res.ok) {
        const body = await res.text().catch(() => "");
        const retryable = res.status === 429 || res.status >= 500;
        if (retryable && attempt < VOYAGE_MAX_RETRIES) {
          await sleep(jitteredBackoffMs(attempt));
          return this.embedBatchOnce(batch, attempt + 1);
        }
        throw new Error(`Voyage embeddings API error (${res.status}): ${body.slice(0, 300)}`);
      }
      const data = (await res.json()) as { data: Array<{ embedding: number[]; index: number }> };
      return [...data.data].sort((a, b) => a.index - b.index).map((d) => d.embedding);
    } catch (err) {
      if ((err as Error).name === "AbortError" && attempt < VOYAGE_MAX_RETRIES) {
        await sleep(jitteredBackoffMs(attempt));
        return this.embedBatchOnce(batch, attempt + 1);
      }
      throw err;
    } finally {
      clearTimeout(timeout);
    }
  }
}

function embeddingsConfigured(): boolean {
  const key = process.env.EMBEDDINGS_API_KEY;
  return Boolean(key) && key !== PLACEHOLDER_NEEDS_REAL_VALUE;
}

export function embeddingsProviderStatus(): { configured: boolean; provider: string; healthy: boolean | null } {
  // healthy stays null (never tested) rather than guessed — a real round-trip health
  // check would cost a real embedding call on every /api/setup/status poll, which is
  // not worth it for a provider with no per-call side effects to worry about failing
  // silently; "configured" is the honest signal this endpoint can cheaply give.
  return { configured: embeddingsConfigured(), provider: VOYAGE_MODEL, healthy: embeddingsConfigured() ? null : false };
}

/** §5's binding decision: DeterministicLocalEmbedder may only stand in for a real
 *  provider under NODE_ENV=test. Everywhere else — local dev included — a missing key
 *  is a loud FailClosedEmbedder, never a silent fake. */
export function defaultEmbedder(): EmbeddingProvider {
  if (embeddingsConfigured()) return new VoyageEmbedder();
  if (process.env.NODE_ENV === "test") return new DeterministicLocalEmbedder();
  return new FailClosedEmbedder();
}

function contentHash(text: string): string {
  return createHash("sha256").update(text).digest("hex");
}

/** §5.1: content-hash cache wrapping any embedder — skips re-embedding chunks whose
 *  exact text was embedded before under the same provider/model, tenant-scoped (see
 *  migration 0028 for why not a global cache). Falls back to per-text embed() calls
 *  when the provider has no embedBatch. */
export async function embedManyCached(
  tenantId: string,
  texts: string[],
  embedder: EmbeddingProvider,
): Promise<number[][]> {
  if (texts.length === 0) return [];
  const hashes = texts.map(contentHash);
  // Raw client, not Drizzle's typed `.select()` — Drizzle's pgvector column mapper
  // assumes the on-the-wire value is always pgvector's text format, but the dev-machine
  // jsonb fallback (no pgvector extension, same convention as querySemantic below)
  // returns an already-parsed JS array from node-postgres, which that mapper chokes on.
  // A raw query sidesteps the mapper entirely and handles both shapes explicitly, same
  // pattern querySemantic already uses for its own dual pgvector/jsonb read path.
  const client = await getPool().connect();
  let cached: Array<{ content_hash: string; embedding: unknown }>;
  try {
    await client.query("SELECT set_config('app.tenant_id', $1, true)", [tenantId]);
    const { rows } = await client.query(
      `SELECT content_hash, embedding FROM embedding_cache
       WHERE tenant_id = $1 AND model = $2 AND content_hash = ANY($3::text[])`,
      [tenantId, embedder.name, hashes],
    );
    cached = rows;
  } finally {
    client.release();
  }
  const byHash = new Map(
    cached.map((r) => [
      r.content_hash,
      (typeof r.embedding === "string" ? JSON.parse(r.embedding) : r.embedding) as number[],
    ]),
  );
  const result: (number[] | null)[] = texts.map((_, i) => byHash.get(hashes[i]!) ?? null);
  const missIdx = result.reduce<number[]>((acc, v, i) => (v === null ? [...acc, i] : acc), []);

  if (missIdx.length > 0) {
    const missTexts = missIdx.map((i) => texts[i]!);
    const fresh = embedder.embedBatch ? await embedder.embedBatch(missTexts) : await Promise.all(missTexts.map((t) => embedder.embed(t)));
    await withTenant(tenantId, (db) =>
      db
        .insert(embeddingCache)
        .values(missIdx.map((idx, j) => ({ tenantId, contentHash: hashes[idx]!, model: embedder.name, embedding: fresh[j]! })))
        .onConflictDoNothing({ target: [embeddingCache.tenantId, embeddingCache.contentHash, embeddingCache.model] }),
    );
    missIdx.forEach((idx, j) => {
      result[idx] = fresh[j]!;
    });
  }
  return result as number[][];
}

export interface WriteSemanticChunk {
  chunk: string;
  entityRefs?: unknown[];
  occurredAt?: Date;
}

export async function writeSemantic(
  tenantId: string,
  sourceDocId: string,
  chunksInput: string[] | WriteSemanticChunk[],
  embedder: EmbeddingProvider = defaultEmbedder(),
): Promise<number> {
  const chunks: WriteSemanticChunk[] = chunksInput.map((c) => (typeof c === "string" ? { chunk: c } : c));
  const vectors = await embedManyCached(
    tenantId,
    chunks.map((c) => c.chunk),
    embedder,
  );
  await withTenant(tenantId, async (db) => {
    await db.insert(embeddings).values(
      chunks.map((c, i) => ({
        tenantId,
        sourceDocId,
        chunk: c.chunk,
        embedding: vectors[i]!,
        entityRefs: c.entityRefs ?? [],
        occurredAt: c.occurredAt ?? new Date(),
      })),
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
  const [qvec] = await embedManyCached(tenantId, [query], embedder);
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
        `SELECT chunk, source_doc_id, entity_refs, occurred_at, 1 - (embedding <=> $2::vector) AS similarity
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
        occurredAt: (r.occurred_at as Date | null)?.toISOString?.(),
        entityRefs: (r.entity_refs as unknown[] | null) ?? [],
      }));
    } else {
      // jsonb fallback (dev machine without pgvector): cosine similarity in-process.
      // Fine at dev-corpus scale; production always has pgvector.
      const { rows } = await client.query(
        `SELECT chunk, source_doc_id, entity_refs, occurred_at, embedding FROM embeddings
         WHERE tenant_id = $1 AND embedding IS NOT NULL`,
        [tenantId],
      );
      hits = rows
        .map((r) => {
          const vec = (typeof r.embedding === "string" ? JSON.parse(r.embedding) : r.embedding) as number[];
          const dot = qvec!.reduce((s, v, i) => s + v * (vec[i] ?? 0), 0);
          return {
            chunk: r.chunk as string,
            sourceDocId: (r.source_doc_id as string | null) ?? null,
            similarity: dot, // vectors are normalized, so dot product == cosine
            occurredAt: (r.occurred_at as Date | null)?.toISOString?.(),
            entityRefs: (r.entity_refs as unknown[] | null) ?? [],
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
