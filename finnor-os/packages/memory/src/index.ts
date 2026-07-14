// Memory layer (§10): short-term (Redis), long-term (Postgres households),
// semantic (pgvector), episodic (action_log). Assembles MemorySnapshot for the Planner.

import type { MemorySnapshot } from "@finnor/shared-types";
import { readShortTerm } from "./short-term";
import { readHouseholdMemory } from "./long-term";
import { querySemantic, type SemanticHit } from "./semantic";
import { readEpisodes } from "./episodic";
import { queryConsolidatedFacts } from "./consolidated";

export * from "./short-term";
export * from "./long-term";
export * from "./semantic";
export * from "./episodic";
export * from "./consolidated";

export async function buildMemorySnapshot(opts: {
  tenantId: string;
  sessionId?: string;
  householdId?: string;
  semanticQuery?: string;
}): Promise<MemorySnapshot> {
  const { tenantId, sessionId, householdId, semanticQuery } = opts;
  const [shortTerm, longTerm, pgvectorHits, zepHits, episodic] = await Promise.all([
    sessionId ? readShortTerm(tenantId, sessionId).catch(() => null) : Promise.resolve(null),
    householdId ? readHouseholdMemory(tenantId, householdId).catch(() => null) : Promise.resolve(null),
    semanticQuery ? querySemantic(tenantId, semanticQuery, 5).catch(() => []) : Promise.resolve([] as SemanticHit[]),
    // Additive, not a replacement: absent ZEP_API_KEY this resolves to [] instantly
    // (see consolidated.ts's honest-fallback contract) — pgvector results are always
    // present either way.
    semanticQuery ? queryConsolidatedFacts(tenantId, semanticQuery, 5) : Promise.resolve([] as SemanticHit[]),
    readEpisodes(tenantId, { limit: 10 }).catch(() => []),
  ]);
  return {
    shortTerm,
    longTerm: longTerm as Record<string, unknown> | null,
    semantic: [...pgvectorHits, ...zepHits],
    episodic,
  };
}
