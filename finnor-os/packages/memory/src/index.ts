// Memory layer (§10): short-term (Redis), long-term (Postgres households),
// semantic (pgvector), episodic (action_log). Assembles MemorySnapshot for the Planner.

import type { MemorySnapshot } from "@finnor/shared-types";
import { readShortTerm } from "./short-term";
import { readHouseholdMemory } from "./long-term";
import { querySemantic } from "./semantic";
import { readEpisodes } from "./episodic";

export * from "./short-term";
export * from "./long-term";
export * from "./semantic";
export * from "./episodic";

export async function buildMemorySnapshot(opts: {
  tenantId: string;
  sessionId?: string;
  householdId?: string;
  semanticQuery?: string;
}): Promise<MemorySnapshot> {
  const { tenantId, sessionId, householdId, semanticQuery } = opts;
  const [shortTerm, longTerm, semantic, episodic] = await Promise.all([
    sessionId ? readShortTerm(tenantId, sessionId).catch(() => null) : Promise.resolve(null),
    householdId ? readHouseholdMemory(tenantId, householdId).catch(() => null) : Promise.resolve(null),
    semanticQuery ? querySemantic(tenantId, semanticQuery, 5).catch(() => []) : Promise.resolve([]),
    readEpisodes(tenantId, { limit: 10 }).catch(() => []),
  ]);
  return {
    shortTerm,
    longTerm: longTerm as Record<string, unknown> | null,
    semantic,
    episodic,
  };
}
