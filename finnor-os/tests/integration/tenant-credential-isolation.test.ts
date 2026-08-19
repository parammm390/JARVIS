import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import pg from "pg";
import { and, eq } from "drizzle-orm";
import { migrate } from "../../packages/db/migrate";
import { closePool, tenantIntegrations, tenants, withTenant } from "@finnor/db";
import {
  clearTenantCredentialCacheForTesting,
  resolveTenantCredentialContext,
  setTenantSecretReaderForTesting,
  TenantCredentialError,
} from "@finnor/security";
import {
  circuitSnapshot,
  createDefaultRegistry,
  createStripePaymentLink,
  recordProviderFailure,
  recordProviderSuccess,
  testTenantStripeConnection,
} from "@finnor/tools";
import { scanIntegrationHealth } from "../../apps/worker/src/handlers/scan-integration-health";
import { GET as setupStatus } from "../../apps/api/app/api/setup/status/route";

const DB_URL = process.env.DATABASE_URL ?? "postgres://finnor:finnor@localhost:5432/finnor";
const TENANT_A = "20000000-0000-4000-8000-00000000000a";
const TENANT_B = "20000000-0000-4000-8000-00000000000b";

async function dbUp(): Promise<boolean> {
  const client = new pg.Client({ connectionString: DB_URL, connectionTimeoutMillis: 2_000 });
  try {
    await client.connect();
    await client.end();
    return true;
  } catch {
    return false;
  }
}
const available = await dbUp();

async function bindStripe(tenantId: string, credentialRef?: string, credentialVersion?: string) {
  await withTenant(tenantId, (db) => db.insert(tenantIntegrations).values({
    tenantId,
    capability: "payments",
    binding: "stripe",
    mode: "sandbox",
    ...(credentialRef ? { credentialProvider: "aws-secrets-manager" as const, credentialRef, credentialVersion } : {}),
  }));
}

describe.skipIf(!available)("tenant credential resolution boundary", () => {
  const savedEnv = {
    legacyTenants: process.env.FINNOR_LEGACY_CREDENTIAL_TENANT_IDS,
    paymentBinding: process.env.PAYMENTS_BINDING,
    stripeKey: process.env.STRIPE_SECRET_KEY,
    authDevBypass: process.env.AUTH_DEV_BYPASS,
  };

  beforeAll(async () => {
    process.env.DATABASE_URL = DB_URL;
    await migrate(DB_URL);
    await withTenant(TENANT_A, (db) => db.insert(tenants).values({ id: TENANT_A, name: "Credential Isolation A" }).onConflictDoNothing());
    await withTenant(TENANT_B, (db) => db.insert(tenants).values({ id: TENANT_B, name: "Credential Isolation B" }).onConflictDoNothing());
  });

  beforeEach(async () => {
    for (const tenantId of [TENANT_A, TENANT_B]) {
      await withTenant(tenantId, (db) => db.delete(tenantIntegrations).where(eq(tenantIntegrations.tenantId, tenantId)));
    }
    delete process.env.FINNOR_LEGACY_CREDENTIAL_TENANT_IDS;
    delete process.env.PAYMENTS_BINDING;
    delete process.env.STRIPE_SECRET_KEY;
    if (savedEnv.authDevBypass === undefined) delete process.env.AUTH_DEV_BYPASS;
    else process.env.AUTH_DEV_BYPASS = savedEnv.authDevBypass;
    setTenantSecretReaderForTesting(null);
    await Promise.all([recordProviderSuccess("stripe", TENANT_A), recordProviderSuccess("stripe", TENANT_B)]);
    clearTenantCredentialCacheForTesting();
    vi.unstubAllGlobals();
  });

  afterAll(async () => {
    setTenantSecretReaderForTesting(null);
    await Promise.all([recordProviderSuccess("stripe", TENANT_A), recordProviderSuccess("stripe", TENANT_B)]);
    if (savedEnv.legacyTenants === undefined) delete process.env.FINNOR_LEGACY_CREDENTIAL_TENANT_IDS;
    else process.env.FINNOR_LEGACY_CREDENTIAL_TENANT_IDS = savedEnv.legacyTenants;
    if (savedEnv.paymentBinding === undefined) delete process.env.PAYMENTS_BINDING;
    else process.env.PAYMENTS_BINDING = savedEnv.paymentBinding;
    if (savedEnv.stripeKey === undefined) delete process.env.STRIPE_SECRET_KEY;
    else process.env.STRIPE_SECRET_KEY = savedEnv.stripeKey;
    if (savedEnv.authDevBypass === undefined) delete process.env.AUTH_DEV_BYPASS;
    else process.env.AUTH_DEV_BYPASS = savedEnv.authDevBypass;
    for (const tenantId of [TENANT_A, TENANT_B]) {
      await withTenant(tenantId, (db) => db.delete(tenantIntegrations).where(eq(tenantIntegrations.tenantId, tenantId)));
    }
    await closePool();
  });

  it("resolves and executes two tenant accounts concurrently with tenant/version cache keys", async () => {
    const refA = `finnor/tenants/${TENANT_A}/stripe`;
    const refB = `finnor/tenants/${TENANT_B}/stripe`;
    await bindStripe(TENANT_A, refA, "stage:AWSCURRENT");
    await bindStripe(TENANT_B, refB, "stage:AWSCURRENT");
    const reads: string[] = [];
    setTenantSecretReaderForTesting(async (reference) => {
      reads.push(reference);
      await new Promise((resolve) => setTimeout(resolve, reference === refA ? 5 : 0));
      return { secretKey: reference === refA ? "key-a" : "key-b" };
    });
    const requests: Array<{ auth: string; tenantId: string }> = [];
    vi.stubGlobal("fetch", vi.fn(async (_url: string, init?: RequestInit) => {
      const body = init?.body as URLSearchParams;
      requests.push({
        auth: String((init?.headers as Record<string, string>).Authorization),
        tenantId: String(body.get("metadata[tenantId]")),
      });
      return new Response(JSON.stringify({ id: `session-${body.get("metadata[tenantId]")}`, url: "https://checkout.example/session" }), { status: 200 });
    }));

    const [contextA, contextB] = await Promise.all([
      resolveTenantCredentialContext(TENANT_A, "stripe"),
      resolveTenantCredentialContext(TENANT_B, "stripe"),
    ]);
    await Promise.all([
      createStripePaymentLink({ tenantId: TENANT_A, invoiceId: "invoice-a", amountUsd: 10, idempotencyKey: "a" }, contextA),
      createStripePaymentLink({ tenantId: TENANT_B, invoiceId: "invoice-b", amountUsd: 20, idempotencyKey: "b" }, contextB),
    ]);

    expect(reads.sort()).toEqual([refA, refB].sort());
    expect(contextA.cacheKey).not.toBe(contextB.cacheKey);
    expect(requests).toEqual(expect.arrayContaining([
      { auth: "Bearer key-a", tenantId: TENANT_A },
      { auth: "Bearer key-b", tenantId: TENANT_B },
    ]));
  });

  it("single-flights one tenant/version and invalidates the cache key on rotation", async () => {
    const reference = `finnor/tenants/${TENANT_A}/stripe`;
    await bindStripe(TENANT_A, reference, "stage:AWSCURRENT");
    const reader = vi.fn(async (_reference: string, version?: string) => ({ secretKey: `key-for-${version}` }));
    setTenantSecretReaderForTesting(reader);
    const current = await Promise.all([
      resolveTenantCredentialContext(TENANT_A, "stripe"),
      resolveTenantCredentialContext(TENANT_A, "stripe"),
    ]);
    expect(reader).toHaveBeenCalledTimes(1);
    expect(current[0]!.cacheKey).toBe(current[1]!.cacheKey);

    await withTenant(TENANT_A, (db) => db.update(tenantIntegrations)
      .set({ credentialVersion: "id:rotated-version" })
      .where(eq(tenantIntegrations.tenantId, TENANT_A)));
    const rotated = await resolveTenantCredentialContext(TENANT_A, "stripe");
    expect(reader).toHaveBeenCalledTimes(2);
    expect(rotated.reference.version).toBe("id:rotated-version");
    expect(rotated.cacheKey).not.toBe(current[0]!.cacheKey);
  });

  it("produces tenant-correct health results in the same process", async () => {
    await bindStripe(TENANT_A, `finnor/tenants/${TENANT_A}/stripe`);
    await bindStripe(TENANT_B, `finnor/tenants/${TENANT_B}/stripe`);
    setTenantSecretReaderForTesting(async (reference) => ({ secretKey: reference.includes(TENANT_A) ? "healthy-a" : "expired-b" }));
    vi.stubGlobal("fetch", vi.fn(async (_url: string, init?: RequestInit) => {
      const auth = String((init?.headers as Record<string, string>).Authorization);
      return new Response("{}", { status: auth.endsWith("healthy-a") ? 200 : 401 });
    }));

    const [healthA, healthB] = await Promise.all([testTenantStripeConnection(TENANT_A), testTenantStripeConnection(TENANT_B)]);
    expect(healthA).toEqual({ configured: true, healthy: true });
    expect(healthB).toMatchObject({ configured: true, healthy: false, error: expect.stringContaining("401") });
  });

  it("binds /api/setup/status health to the authenticated tenant", async () => {
    process.env.AUTH_DEV_BYPASS = "1";
    await bindStripe(TENANT_A, `finnor/tenants/${TENANT_A}/stripe`);
    await bindStripe(TENANT_B, `finnor/tenants/${TENANT_B}/stripe`);
    setTenantSecretReaderForTesting(async (reference) => ({ secretKey: reference.includes(TENANT_A) ? "healthy-a" : "expired-b" }));
    vi.stubGlobal("fetch", vi.fn(async (_url: string, init?: RequestInit) => {
      const auth = String((init?.headers as Record<string, string> | undefined)?.Authorization ?? "");
      return new Response("{}", { status: auth.endsWith("healthy-a") ? 200 : 401 });
    }));
    const request = (tenantId: string) => new Request("http://localhost/api/setup/status", {
      headers: { "x-tenant-id": tenantId, "x-user-role": "owner" },
    });

    const [responseA, responseB] = await Promise.all([setupStatus(request(TENANT_A)), setupStatus(request(TENANT_B))]);
    const [bodyA, bodyB] = await Promise.all([responseA.json(), responseB.json()]) as Array<{
      integrations: { stripe: { configured: boolean; healthy: boolean | null } };
    }>;
    expect(responseA.status).toBe(200);
    expect(responseB.status).toBe(200);
    expect(bodyA!.integrations.stripe).toMatchObject({ configured: true, healthy: true });
    expect(bodyB!.integrations.stripe).toMatchObject({ configured: true, healthy: false });
  });

  it("keeps durable provider health/circuit state tenant-scoped", async () => {
    await recordProviderFailure("stripe", TENANT_A);
    await recordProviderFailure("stripe", TENANT_A);
    await recordProviderFailure("stripe", TENANT_A);
    const [a, b] = await Promise.all([circuitSnapshot("stripe", TENANT_A), circuitSnapshot("stripe", TENANT_B)]);
    expect(a.state).toBe("open");
    expect(b.state).toBe("closed");
    expect(b.consecutiveFailures).toBe(0);
  });

  it("fails closed for missing and cross-tenant references even when a global key exists", async () => {
    process.env.PAYMENTS_BINDING = "stripe";
    process.env.STRIPE_SECRET_KEY = "global-key-that-must-not-be-used";
    await bindStripe(TENANT_A);
    await bindStripe(TENANT_B, `finnor/tenants/${TENANT_A}/stripe`);
    const reader = vi.fn(async () => ({ secretKey: "should-not-be-read" }));
    setTenantSecretReaderForTesting(reader);

    await expect(resolveTenantCredentialContext(TENANT_A, "stripe")).rejects.toMatchObject({ code: "missing_reference" });
    await expect(resolveTenantCredentialContext(TENANT_B, "stripe")).rejects.toMatchObject({ code: "invalid_reference" });
    expect(reader).not.toHaveBeenCalled();
  });

  it("persists only a redacted tenant health error", async () => {
    const secret = "secret-that-must-never-reach-health-evidence";
    await bindStripe(TENANT_A, `finnor/tenants/${TENANT_A}/stripe`);
    setTenantSecretReaderForTesting(async () => ({ secretKey: secret }));
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ error: secret }), { status: 401 })));

    await scanIntegrationHealth({ tenantId: TENANT_A });
    const [row] = await withTenant(TENANT_A, (db) => db.select().from(tenantIntegrations).where(and(
      eq(tenantIntegrations.tenantId, TENANT_A),
      eq(tenantIntegrations.capability, "payments"),
    )));
    expect(row?.health).toBe("degraded");
    expect(row?.lastError).toContain("401");
    expect(row?.lastError).not.toContain(secret);
    expect(JSON.stringify(row)).not.toContain(secret);
  });

  it("keeps emulator execution credential-free", async () => {
    process.env.FINNOR_LEGACY_CREDENTIAL_TENANT_IDS = TENANT_A;
    process.env.PAYMENTS_BINDING = "stripe";
    process.env.STRIPE_SECRET_KEY = "global-key-that-emulator-must-ignore";
    await withTenant(TENANT_A, (db) => db.insert(tenantIntegrations).values({
      tenantId: TENANT_A,
      capability: "communications",
      binding: "emulator",
      mode: "emulator",
    }));
    const reader = vi.fn(async () => ({ apiKey: "must-not-be-read" }));
    setTenantSecretReaderForTesting(reader);
    const result = await createDefaultRegistry().call("vapi_place_call", {
      tenantId: TENANT_A,
      phoneNumber: "+15555550101",
      instructions: "Sandbox only",
    });
    expect(result.ok).toBe(true);
    expect(result.output).toMatchObject({ simulated: true });
    expect(reader).not.toHaveBeenCalled();

    await withTenant(TENANT_A, (db) => db.insert(tenantIntegrations).values({
      tenantId: TENANT_A,
      capability: "payments",
      binding: "emulator",
      mode: "emulator",
    }));
    await expect(resolveTenantCredentialContext(TENANT_A, "stripe")).rejects.toMatchObject({ code: "integration_not_bound" });
  });

  it("allows legacy env credentials only for an explicitly allowlisted tenant", async () => {
    await bindStripe(TENANT_A);
    await bindStripe(TENANT_B);
    process.env.FINNOR_LEGACY_CREDENTIAL_TENANT_IDS = TENANT_A;
    process.env.STRIPE_SECRET_KEY = "explicit-legacy-key";

    const contextA = await resolveTenantCredentialContext(TENANT_A, "stripe");
    expect(contextA.source).toBe("legacy-env");
    expect(contextA.credentials.secretKey).toBe("explicit-legacy-key");
    await expect(resolveTenantCredentialContext(TENANT_B, "stripe")).rejects.toBeInstanceOf(TenantCredentialError);
  });

  it("rejects secret-shaped values in normal integration JSON", async () => {
    await expect(withTenant(TENANT_A, (db) => db.insert(tenantIntegrations).values({
      tenantId: TENANT_A,
      capability: "payments",
      binding: "emulator",
      mode: "emulator",
      config: { apiKey: "must-not-persist" },
    }))).rejects.toThrow();
  });
});
