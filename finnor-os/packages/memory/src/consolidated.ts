// Zep-backed memory consolidation — layered ON TOP of the existing 4 tiers, never
// replacing them (short-term.ts, long-term.ts, semantic.ts, episodic.ts are all
// untouched). Zep's temporal knowledge graph does automatic entity/fact extraction
// over mirrored conversation turns and tracks how facts change over time (e.g.
// "renewal price was $199, now $249") — the compounding, gets-smarter-over-time
// behavior the deterministic-only learning digest (Pillar 3) doesn't provide.
//
// Honest fallback, matching every other integration adapter in this codebase: absent
// ZEP_API_KEY, every function here is a silent no-op (empty results / no mirroring) —
// never a fabricated hit, never a hard failure for a tenant that hasn't configured it,
// and never something that can break the gated pipeline it's layered onto.

import { ZepClient } from "@getzep/zep-cloud";
import type { SemanticHit } from "./semantic";

let client: ZepClient | null = null;

function zepConfigured(): boolean {
  return Boolean(process.env.ZEP_API_KEY);
}

export function zepProviderStatus(): { configured: boolean } {
  return { configured: zepConfigured() };
}

function getZepClient(): ZepClient {
  client ??= new ZepClient({ apiKey: process.env.ZEP_API_KEY });
  return client;
}

function zepUserId(tenantId: string): string {
  return `finnor-tenant-${tenantId}`;
}

function zepThreadId(tenantId: string, sessionId: string): string {
  return `finnor-${tenantId}-${sessionId}`;
}

const ensuredThreads = new Set<string>();

/** Creates the tenant's Zep user + this session's thread if they don't exist yet.
 *  Cached per-process so repeated mirror calls in the same session don't re-issue the
 *  create calls; "already exists" errors are swallowed either way. */
async function ensureThread(tenantId: string, sessionId: string): Promise<void> {
  const key = `${tenantId}:${sessionId}`;
  if (ensuredThreads.has(key)) return;
  const zc = getZepClient();
  await zc.user.add({ userId: zepUserId(tenantId) }).catch(() => undefined);
  await zc.thread.create({ threadId: zepThreadId(tenantId, sessionId), userId: zepUserId(tenantId) }).catch(() => undefined);
  ensuredThreads.add(key);
}

/**
 * Mirrors one conversation turn (instruction + outcome) into Zep as a message, so
 * Zep's own extraction pipeline can build a temporal knowledge graph over it. Called
 * alongside appendShortTerm (packages/memory/src/short-term.ts) — same session scope,
 * same call site (FinnorOrchestrator.handleInstruction) — never inside appendEpisode
 * itself, which is scoped per-domain-action, not per-session, and has no natural Zep
 * thread identity. Best-effort: never throws — a Zep outage must never break or slow
 * the gated pipeline it's mirroring alongside.
 */
export async function mirrorTurnToZep(tenantId: string, sessionId: string, content: string): Promise<void> {
  if (!zepConfigured()) return;
  try {
    await ensureThread(tenantId, sessionId);
    await getZepClient().thread.addMessages(zepThreadId(tenantId, sessionId), {
      messages: [{ content, role: "system" }],
    });
  } catch {
    // Best-effort — see module header.
  }
}

/**
 * Searches the tenant's Zep knowledge graph for facts relevant to the query. Returns
 * [] (not an error) when Zep isn't configured or the search itself fails.
 * buildMemorySnapshot merges these into the SAME `semantic: SemanticHit[]` array
 * pgvector results already populate — additive, not a separate field the Planner
 * would need to learn about.
 */
export async function queryConsolidatedFacts(tenantId: string, query: string, limit = 5): Promise<SemanticHit[]> {
  if (!zepConfigured()) return [];
  try {
    const results = await getZepClient().graph.search({ userId: zepUserId(tenantId), query, limit });
    return (results.edges ?? []).map((edge) => ({
      chunk: edge.fact,
      sourceDocId: edge.uuid ?? null,
      similarity: edge.score ?? edge.relevance ?? 0,
    }));
  } catch {
    return [];
  }
}
