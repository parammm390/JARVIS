// A3.T5 acceptance: the Resend adapter enforces its recipient allowlist and daily
// volume cap BEFORE ever making a real network call, and agrees with the real
// Postgres-backed circuit breaker on repeated real-call failure. Real Postgres for
// claimBudget/circuit breaker state (not mocked); fetch is stubbed (never a real
// network call to Resend in tests).

import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import pg from "pg";
import { migrate } from "../../packages/db/migrate";
import { adminDb, apiRateLimits, providerCircuitState, closePool } from "@finnor/db";
import { eq, like } from "drizzle-orm";
import {
  sendResendEmail,
  isAllowlistedRecipient,
  setResendFetchForTesting,
  resendProviderStatus,
} from "../../packages/tools/src/resend";
import { circuitSnapshot } from "../../packages/tools/src/provider-circuit-breaker";

const DB_URL = process.env.DATABASE_URL ?? "postgres://finnor:finnor@localhost:5432/finnor";
const TENANT = "00000000-0000-4000-8000-0000000000ed";

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

describe.skipIf(!available)("Resend adapter (A3.T5)", () => {
  const originalApiKey = process.env.RESEND_API_KEY;
  const originalOwner = process.env.RESEND_ALLOWLIST_OWNER_EMAIL;
  const originalCap = process.env.RESEND_DAILY_CAP;

  beforeAll(async () => {
    process.env.DATABASE_URL = DB_URL;
    await migrate(DB_URL);
    process.env.RESEND_API_KEY = "test-key-not-real";
    process.env.RESEND_ALLOWLIST_OWNER_EMAIL = "owner@example.com";
  });
  afterAll(async () => {
    process.env.RESEND_API_KEY = originalApiKey;
    process.env.RESEND_ALLOWLIST_OWNER_EMAIL = originalOwner;
    process.env.RESEND_DAILY_CAP = originalCap;
    setResendFetchForTesting(null);
    await closePool();
  });
  beforeEach(async () => {
    await adminDb().delete(apiRateLimits).where(like(apiRateLimits.bucketKey, `budget:${TENANT}:resend:%`));
    await adminDb().delete(providerCircuitState).where(eq(providerCircuitState.provider, "resend"));
    setResendFetchForTesting(null);
  });

  it("allowlists *@finnorai.com and the configured owner address only", () => {
    expect(isAllowlistedRecipient("someone@finnorai.com")).toBe(true);
    expect(isAllowlistedRecipient("OWNER@EXAMPLE.COM")).toBe(true); // case-insensitive
    expect(isAllowlistedRecipient("random.customer@gmail.com")).toBe(false);
  });

  it("blocks a non-allowlisted recipient with an honest, non-throwing result — never a real network call", async () => {
    let calls = 0;
    setResendFetchForTesting((async () => {
      calls++;
      throw new Error("should never be called");
    }) as unknown as typeof fetch);

    const result = await sendResendEmail({ tenantId: TENANT, to: "a.real.customer@gmail.com", subject: "hi", html: "<p>hi</p>" });
    expect(result).toEqual({ sent: false, blocked: true, reason: expect.stringMatching(/not on the pre-launch allowlist/) });
    expect(calls).toBe(0);
  });

  it("sends for real (stubbed fetch) to an allowlisted address and returns the provider's message id", async () => {
    setResendFetchForTesting((async (_url: string, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body));
      expect(body.to).toEqual(["someone@finnorai.com"]);
      expect(body.from).toMatch(/finnorai\.com/);
      return new Response(JSON.stringify({ id: "resend_msg_123" }), { status: 200 });
    }) as unknown as typeof fetch);

    const result = await sendResendEmail({ tenantId: TENANT, to: "someone@finnorai.com", subject: "Test", html: "<p>Test</p>" });
    expect(result).toEqual({ sent: true, messageId: "resend_msg_123" });
  });

  it("enforces the daily volume cap — the (cap+1)th allowlisted send is blocked, none of them touch the real call once over cap", async () => {
    process.env.RESEND_DAILY_CAP = "2";
    let calls = 0;
    setResendFetchForTesting((async () => {
      calls++;
      return new Response(JSON.stringify({ id: `msg_${calls}` }), { status: 200 });
    }) as unknown as typeof fetch);

    const r1 = await sendResendEmail({ tenantId: TENANT, to: "someone@finnorai.com", subject: "1", html: "1" });
    const r2 = await sendResendEmail({ tenantId: TENANT, to: "someone@finnorai.com", subject: "2", html: "2" });
    const r3 = await sendResendEmail({ tenantId: TENANT, to: "someone@finnorai.com", subject: "3", html: "3" });
    expect(r1.sent).toBe(true);
    expect(r2.sent).toBe(true);
    expect(r3).toEqual({ sent: false, blocked: true, reason: expect.stringMatching(/daily Resend send cap reached/) });
    expect(calls).toBe(2); // the 3rd never reached the real call
    delete process.env.RESEND_DAILY_CAP; // don't leak this test's cap into later tests
  });

  it("agrees with a real open circuit breaker after repeated real-call failures — refuses further attempts", async () => {
    setResendFetchForTesting((async () => new Response("server error", { status: 500 })) as unknown as typeof fetch);

    for (let i = 0; i < 3; i++) {
      await expect(sendResendEmail({ tenantId: TENANT, to: "someone@finnorai.com", subject: "x", html: "x" })).rejects.toThrow();
    }
    const snap = await circuitSnapshot("resend");
    expect(snap.state).toBe("open");

    await expect(sendResendEmail({ tenantId: TENANT, to: "someone@finnorai.com", subject: "x", html: "x" })).rejects.toThrow(/degraded/);
  });

  it("reports configured:true only when RESEND_API_KEY is set", () => {
    expect(resendProviderStatus().configured).toBe(true);
    const original = process.env.RESEND_API_KEY;
    delete process.env.RESEND_API_KEY;
    expect(resendProviderStatus().configured).toBe(false);
    process.env.RESEND_API_KEY = original;
  });
});
