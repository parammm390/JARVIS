// Phase 4 (§4.4): per-tenant daily caps on outbound messages/calls/spend, enforced in
// the capability layer. Reuses the existing api_rate_limits table (bucket_key +
// window_started_at, real unique PK — migration 0006) rather than adding a new one;
// the bucket key convention below is this module's own, that table has no other
// current writer.

import { adminDb, apiRateLimits, getPool } from "@finnor/db";
import { and, eq, sql } from "drizzle-orm";

function todayBucket(): string {
  return new Date().toISOString().slice(0, 10); // YYYY-MM-DD
}

function normalizeBucketDate(value?: string | Date): string {
  const date = value instanceof Date ? value.toISOString().slice(0, 10) : value ?? todayBucket();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || Number.isNaN(new Date(`${date}T00:00:00.000Z`).getTime())) {
    throw new Error(`Invalid provider budget date: ${date}`);
  }
  return date;
}

function bucketKey(tenantId: string, provider: string, metric: string, date = todayBucket()): string {
  return `budget:${tenantId}:${provider}:${metric}:${date}`;
}

export interface BudgetCheck {
  allowed: boolean;
  used: number;
  cap: number;
}

export interface BudgetReservation extends BudgetCheck {
  requested: number;
  granted: number;
  date: string;
}

/** Atomically reserves up to `amount` units on any calendar bucket. Unlike the old
 * increment-then-check implementation, refused capacity is never counted as usage;
 * callers can reserve a future 200-call Vapi batch without racing another campaign. */
export async function reserveBudget(
  tenantId: string,
  provider: string,
  metric: string,
  cap: number,
  amount: number,
  bucketDate?: string | Date,
  reservationKey?: string,
): Promise<BudgetReservation> {
  if (!Number.isInteger(amount) || amount < 0) throw new Error("Provider budget amount must be a non-negative integer");
  if (!Number.isInteger(cap) || cap < 0) throw new Error("Provider budget cap must be a non-negative integer");
  const date = normalizeBucketDate(bucketDate);
  const key = bucketKey(tenantId, provider, metric, date);
  const markerKey = reservationKey ? `budget-reservation:${tenantId}:${provider}:${metric}:${date}:${reservationKey}` : null;
  const windowStartedAt = new Date(`${date}T00:00:00.000Z`);
  const client = await getPool().connect();
  try {
    await client.query("BEGIN");
    await client.query("SET LOCAL search_path = finnor_os, public");
    await client.query("SET LOCAL statement_timeout = 10000");
    // A transaction-scoped lock avoids two reservations both reading the same prior
    // count. hashtextextended keeps the key stable without exposing tenant data.
    await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1, 0))", [key]);
    if (markerKey) {
      const marker = await client.query<{ count: number }>(
        "SELECT count FROM api_rate_limits WHERE bucket_key = $1 AND window_started_at = $2",
        [markerKey, windowStartedAt],
      );
      if (marker.rows[0]) {
        const aggregate = await client.query<{ count: number }>(
          "SELECT count FROM api_rate_limits WHERE bucket_key = $1 AND window_started_at = $2",
          [key, windowStartedAt],
        );
        await client.query("COMMIT");
        const granted = marker.rows[0].count;
        return { allowed: granted === amount, requested: amount, granted, used: aggregate.rows[0]?.count ?? granted, cap, date };
      }
    }
    const existing = await client.query<{ count: number }>(
      "SELECT count FROM api_rate_limits WHERE bucket_key = $1 AND window_started_at = $2 FOR UPDATE",
      [key, windowStartedAt],
    );
    const prior = existing.rows[0]?.count ?? 0;
    const granted = Math.max(0, Math.min(amount, cap - prior));
    const used = prior + granted;
    if (existing.rowCount) {
      await client.query("UPDATE api_rate_limits SET count = $3 WHERE bucket_key = $1 AND window_started_at = $2", [key, windowStartedAt, used]);
    } else {
      await client.query("INSERT INTO api_rate_limits (bucket_key, window_started_at, count) VALUES ($1, $2, $3)", [key, windowStartedAt, used]);
    }
    if (markerKey) {
      await client.query("INSERT INTO api_rate_limits (bucket_key, window_started_at, count) VALUES ($1, $2, $3)", [markerKey, windowStartedAt, granted]);
    }
    await client.query("COMMIT");
    return { allowed: granted === amount, requested: amount, granted, used, cap, date };
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}

/** Releases only capacity this process previously reserved, used when provider-side
 * campaign creation fails before Vapi accepts the batch. */
export async function releaseBudget(
  tenantId: string,
  provider: string,
  metric: string,
  amount: number,
  bucketDate?: string | Date,
  reservationKey?: string,
): Promise<number> {
  if (!Number.isInteger(amount) || amount < 0) throw new Error("Provider budget release must be a non-negative integer");
  const date = normalizeBucketDate(bucketDate);
  const key = bucketKey(tenantId, provider, metric, date);
  const windowStartedAt = new Date(`${date}T00:00:00.000Z`);
  if (reservationKey) {
    const markerKey = `budget-reservation:${tenantId}:${provider}:${metric}:${date}:${reservationKey}`;
    const client = await getPool().connect();
    try {
      await client.query("BEGIN");
      await client.query("SET LOCAL search_path = finnor_os, public");
      await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1, 0))", [key]);
      const marker = await client.query<{ count: number }>(
        "SELECT count FROM api_rate_limits WHERE bucket_key = $1 AND window_started_at = $2 FOR UPDATE",
        [markerKey, windowStartedAt],
      );
      const released = Math.min(amount, marker.rows[0]?.count ?? 0);
      if (released > 0) {
        await client.query("UPDATE api_rate_limits SET count = greatest(0, count - $3) WHERE bucket_key = $1 AND window_started_at = $2", [key, windowStartedAt, released]);
        if (released >= (marker.rows[0]?.count ?? 0)) {
          await client.query("DELETE FROM api_rate_limits WHERE bucket_key = $1 AND window_started_at = $2", [markerKey, windowStartedAt]);
        } else {
          await client.query("UPDATE api_rate_limits SET count = count - $3 WHERE bucket_key = $1 AND window_started_at = $2", [markerKey, windowStartedAt, released]);
        }
      }
      const aggregate = await client.query<{ count: number }>(
        "SELECT count FROM api_rate_limits WHERE bucket_key = $1 AND window_started_at = $2",
        [key, windowStartedAt],
      );
      await client.query("COMMIT");
      return aggregate.rows[0]?.count ?? 0;
    } catch (error) {
      await client.query("ROLLBACK").catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }
  }
  const [row] = await adminDb()
    .update(apiRateLimits)
    .set({ count: sql`greatest(0, ${apiRateLimits.count} - ${amount})` })
    .where(and(eq(apiRateLimits.bucketKey, key), eq(apiRateLimits.windowStartedAt, windowStartedAt)))
    .returning({ count: apiRateLimits.count });
  return row?.count ?? 0;
}

/** Atomically claims one unit against today's cap for (tenant, provider, metric).
 *  Real enforcement, not advisory: if the cap is already hit, the caller must not
 *  proceed with the real provider call. metric distinguishes e.g. "sms" vs "call" vs
 *  "spend_usd" caps on the same provider. */
export async function claimBudget(tenantId: string, provider: string, metric: string, cap: number, amount = 1): Promise<BudgetCheck> {
  const reservation = await reserveBudget(tenantId, provider, metric, cap, amount);
  return { allowed: reservation.allowed, used: reservation.used, cap: reservation.cap };
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
