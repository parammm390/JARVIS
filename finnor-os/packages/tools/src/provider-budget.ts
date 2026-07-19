// Phase 4 (§4.4): per-tenant daily caps on outbound messages/calls/spend, enforced in
// the capability layer. Reuses the existing api_rate_limits table (bucket_key +
// window_started_at, real unique PK — migration 0006) rather than adding a new one;
// the bucket key convention below is this module's own, that table has no other
// current writer.

import { adminDb, apiRateLimits } from "@finnor/db";
import { and, eq, sql } from "drizzle-orm";

function todayBucket(): string {
  return new Date().toISOString().slice(0, 10); // YYYY-MM-DD
}

function bucketKey(tenantId: string, provider: string, metric: string): string {
  return `budget:${tenantId}:${provider}:${metric}:${todayBucket()}`;
}

export interface BudgetCheck {
  allowed: boolean;
  used: number;
  cap: number;
}

/** Atomically claims one unit against today's cap for (tenant, provider, metric).
 *  Real enforcement, not advisory: if the cap is already hit, the caller must not
 *  proceed with the real provider call. metric distinguishes e.g. "sms" vs "call" vs
 *  "spend_usd" caps on the same provider. */
export async function claimBudget(tenantId: string, provider: string, metric: string, cap: number, amount = 1): Promise<BudgetCheck> {
  const key = bucketKey(tenantId, provider, metric);
  const windowStartedAt = new Date(`${todayBucket()}T00:00:00.000Z`);

  // Claim first (atomic upsert-increment), then check — a caller that loses the race
  // still gets an accurate `used` count; over-cap claims are still counted (so the
  // budget reading in status is honest) but the caller is told not to proceed.
  const [row] = await adminDb()
    .insert(apiRateLimits)
    .values({ bucketKey: key, windowStartedAt, count: amount })
    .onConflictDoUpdate({
      target: [apiRateLimits.bucketKey, apiRateLimits.windowStartedAt],
      set: { count: sql`${apiRateLimits.count} + ${amount}` },
    })
    .returning();

  const used = row!.count;
  return { allowed: used <= cap, used, cap };
}

export async function budgetUsage(tenantId: string, provider: string, metric: string): Promise<number> {
  const key = bucketKey(tenantId, provider, metric);
  const windowStartedAt = new Date(`${todayBucket()}T00:00:00.000Z`);
  const [row] = await adminDb()
    .select()
    .from(apiRateLimits)
    .where(and(eq(apiRateLimits.bucketKey, key), eq(apiRateLimits.windowStartedAt, windowStartedAt)));
  return row?.count ?? 0;
}
