// Phase 4 (§4.4): the durable, Postgres-backed circuit breaker and per-tenant daily
// budget — real behavior against real Postgres, not mocked. Distinct from the older
// in-process provider-health.ts (Phase 13, LLM-fallback signal only).

import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import pg from "pg";
import { migrate } from "../../packages/db/migrate";
import { adminDb, providerCircuitState, apiRateLimits, closePool } from "@finnor/db";
import { eq, like } from "drizzle-orm";
import { isCircuitOpen, recordProviderFailure, recordProviderSuccess, circuitSnapshot, withCircuitBreaker } from "../../packages/tools/src/provider-circuit-breaker";
import { claimBudget, budgetUsage } from "../../packages/tools/src/provider-budget";

const DB_URL = process.env.DATABASE_URL ?? "postgres://finnor:finnor@localhost:5432/finnor";
const TEST_PROVIDER = "test_provider_4_4";
const TEST_TENANT = "00000000-0000-4000-8000-0000000000f8";

async function dbUp(): Promise<boolean> {
  const c = new pg.Client({ connectionString: DB_URL, connectionTimeoutMillis: 2000 });
  try {
    await c.connect();
    await c.end();
    return true;
  } catch {
    return false;
  }
}
const available = await dbUp();

describe.skipIf(!available)("Phase 4 §4.4: durable circuit breaker + per-tenant budget", () => {
  beforeAll(async () => {
    process.env.DATABASE_URL = DB_URL;
    await migrate(DB_URL);
  }, 30_000);
  afterAll(async () => {
    await closePool();
  });
  beforeEach(async () => {
    await adminDb().delete(providerCircuitState).where(eq(providerCircuitState.provider, TEST_PROVIDER));
    await adminDb().delete(apiRateLimits).where(like(apiRateLimits.bucketKey, `budget:${TEST_TENANT}:%`));
  });

  it("closed by default; stays closed on success", async () => {
    expect(await isCircuitOpen(TEST_PROVIDER)).toBe(false);
    await recordProviderSuccess(TEST_PROVIDER);
    expect(await isCircuitOpen(TEST_PROVIDER)).toBe(false);
  });

  it("opens after 3 real consecutive failures, not before", async () => {
    await recordProviderFailure(TEST_PROVIDER);
    expect(await isCircuitOpen(TEST_PROVIDER)).toBe(false);
    await recordProviderFailure(TEST_PROVIDER);
    expect(await isCircuitOpen(TEST_PROVIDER)).toBe(false);
    const third = await recordProviderFailure(TEST_PROVIDER);
    expect(third.state).toBe("open");
    expect(await isCircuitOpen(TEST_PROVIDER)).toBe(true);
  });

  it("a success after opening closes it again and resets the failure count", async () => {
    await recordProviderFailure(TEST_PROVIDER);
    await recordProviderFailure(TEST_PROVIDER);
    await recordProviderFailure(TEST_PROVIDER);
    expect(await isCircuitOpen(TEST_PROVIDER)).toBe(true);
    await recordProviderSuccess(TEST_PROVIDER);
    expect(await isCircuitOpen(TEST_PROVIDER)).toBe(false);
    const snap = await circuitSnapshot(TEST_PROVIDER);
    expect(snap.consecutiveFailures).toBe(0);
  });

  it("withCircuitBreaker refuses to even attempt the call while open — zero real calls made while degraded", async () => {
    let realCalls = 0;
    const failing = () => {
      realCalls++;
      return Promise.reject(new Error("real provider down"));
    };
    for (let i = 0; i < 3; i++) {
      await expect(withCircuitBreaker(TEST_PROVIDER, failing)).rejects.toThrow();
    }
    expect(realCalls).toBe(3); // each of the first 3 genuinely attempted the real call
    expect(await isCircuitOpen(TEST_PROVIDER)).toBe(true);

    await expect(withCircuitBreaker(TEST_PROVIDER, failing)).rejects.toThrow(/degraded/);
    expect(realCalls).toBe(3); // the 4th call never touched the real provider at all
  });

  it("claimBudget enforces a real daily cap per tenant+provider+metric, independent metrics don't interfere", async () => {
    const first = await claimBudget(TEST_TENANT, TEST_PROVIDER, "call", 2);
    expect(first).toEqual({ allowed: true, used: 1, cap: 2 });
    const second = await claimBudget(TEST_TENANT, TEST_PROVIDER, "call", 2);
    expect(second).toEqual({ allowed: true, used: 2, cap: 2 });
    const third = await claimBudget(TEST_TENANT, TEST_PROVIDER, "call", 2);
    expect(third.allowed).toBe(false);
    expect(third.used).toBe(3);

    // A different metric on the same provider+tenant has its own independent cap.
    const otherMetric = await claimBudget(TEST_TENANT, TEST_PROVIDER, "sms", 5);
    expect(otherMetric).toEqual({ allowed: true, used: 1, cap: 5 });

    expect(await budgetUsage(TEST_TENANT, TEST_PROVIDER, "call")).toBe(3);
  });
});
