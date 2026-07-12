// Short-term memory: Redis, keyed by session id, TTL 30 minutes (§10).

import Redis from "ioredis";

const TTL_SECONDS = 30 * 60;

let redis: Redis | null = null;

function getRedis(): Redis {
  if (!redis) {
    const url = process.env.REDIS_URL;
    if (!url) throw new Error("REDIS_URL is not set");
    redis = new Redis(url, { maxRetriesPerRequest: 2, lazyConnect: false });
  }
  return redis;
}

function key(tenantId: string, sessionId: string): string {
  return `stm:${tenantId}:${sessionId}`;
}

export async function writeShortTerm(
  tenantId: string,
  sessionId: string,
  data: Record<string, unknown>,
): Promise<void> {
  await getRedis().set(key(tenantId, sessionId), JSON.stringify(data), "EX", TTL_SECONDS);
}

export async function readShortTerm(
  tenantId: string,
  sessionId: string,
): Promise<Record<string, unknown> | null> {
  const raw = await getRedis().get(key(tenantId, sessionId));
  return raw ? (JSON.parse(raw) as Record<string, unknown>) : null;
}

export async function appendShortTerm(
  tenantId: string,
  sessionId: string,
  entry: Record<string, unknown>,
): Promise<void> {
  const existing = (await readShortTerm(tenantId, sessionId)) ?? { turns: [] };
  const turns = Array.isArray(existing.turns) ? existing.turns : [];
  turns.push(entry);
  await writeShortTerm(tenantId, sessionId, { ...existing, turns });
}

export async function closeShortTerm(): Promise<void> {
  if (redis) {
    await redis.quit();
    redis = null;
  }
}
