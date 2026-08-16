// Memory layer (§10): short-term (Redis), long-term (Postgres households),
// semantic (pgvector), episodic (action_log). Assembles MemorySnapshot for the Planner.

import type { MemorySnapshot, PatternContext } from "@finnor/shared-types";
import { readShortTerm } from "./short-term";
import { readHouseholdMemory } from "./long-term";
import { querySemantic, type SemanticHit } from "./semantic";
import { readEpisodes } from "./episodic";
import { queryConsolidatedFacts } from "./consolidated";
import { buildPatternContext } from "./patterns";

export * from "./short-term";
export * from "./long-term";
export * from "./semantic";
export * from "./episodic";
export * from "./consolidated";
export * from "./patterns";
export * from "./chunking";
export * from "./ingest";
export * from "./corrections";
export * from "./evidence";
export * from "./evidence-recorder";
export * from "./retrieval";

export async function buildMemorySnapshot(opts: {
  tenantId: string;
  sessionId?: string;
  householdId?: string;
  semanticQuery?: string;
  semanticLimit?: number;
}): Promise<MemorySnapshot> {
  const { tenantId, sessionId, householdId, semanticQuery } = opts;
  const semanticLimit = Math.max(0, Math.min(opts.semanticLimit ?? 5, 10));
  const [shortTerm, longTerm, pgvectorHits, zepHits, episodic, patterns] = await Promise.all([
    sessionId ? readShortTerm(tenantId, sessionId).catch(() => null) : Promise.resolve(null),
    householdId ? readHouseholdMemory(tenantId, householdId).catch(() => null) : Promise.resolve(null),
    semanticQuery && semanticLimit > 0 ? querySemantic(tenantId, semanticQuery, semanticLimit).catch(() => []) : Promise.resolve([] as SemanticHit[]),
    // Additive, not a replacement: absent ZEP_API_KEY this resolves to [] instantly
    // (see consolidated.ts's honest-fallback contract) — pgvector results are always
    // present either way.
    semanticQuery && semanticLimit > 0 ? queryConsolidatedFacts(tenantId, semanticQuery, semanticLimit) : Promise.resolve([] as SemanticHit[]),
    readEpisodes(tenantId, { limit: 10 }).catch(() => []),
    // Phase 9 — same graceful-degradation convention every other memory source here
    // already follows: a pattern-query failure must never break planning.
    buildPatternContext(tenantId, householdId).catch(
      (): PatternContext => ({ householdProposals: null, technicianReliability: [], scanSignals: [] }),
    ),
  ]);
  const seen = new Set<string>();
  const semantic = [...pgvectorHits, ...zepHits]
    .sort((a, b) => (b.relevanceScore ?? b.similarity) - (a.relevanceScore ?? a.similarity))
    .filter((hit) => {
      const key = hit.contentHash ?? `${hit.sourceDocId ?? "unknown"}:${hit.chunk.trim().toLowerCase()}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .slice(0, semanticLimit);
  return {
    shortTerm,
    longTerm: longTerm as Record<string, unknown> | null,
    semantic,
    episodic,
    patterns,
  };
}
