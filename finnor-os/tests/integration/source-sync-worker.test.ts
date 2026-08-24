import { randomUUID } from "node:crypto";
import pg from "pg";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { and, eq } from "drizzle-orm";
import { closePool, externalRefs, integrationSyncCheckpoints, tenantIntegrations, withTenant } from "@finnor/db";
import { setTenantSecretReaderForTesting } from "@finnor/security";
import { syncSource } from "../../apps/worker/src/handlers/sync-source";
import { migrate } from "../../packages/db/migrate";

const DB_URL = process.env.DATABASE_URL ?? "postgres://finnor:finnor@localhost:5432/finnor";
const available = await (async () => {
  const client = new pg.Client({ connectionString: DB_URL, connectionTimeoutMillis: 2_000 });
  try { await client.connect(); await client.end(); return true; } catch { return false; }
})();

const fixtures = ["healthy", "rate-limit", "revoked"].map((kind) => ({ kind, tenantId: randomUUID(), integrationId: randomUUID() }));

describe.skipIf(!available)("source sync worker/checkpoint lifecycle", () => {
  beforeAll(async () => {
    process.env.DATABASE_URL = DB_URL;
    await migrate(DB_URL);
    const admin = new pg.Client({ connectionString: DB_URL });
    await admin.connect();
    for (const fixture of fixtures) await admin.query("INSERT INTO finnor_os.tenants(id,name) VALUES ($1,$2)", [fixture.tenantId, `Sync ${fixture.kind}`]);
    await admin.end();
    for (const fixture of fixtures) {
      await withTenant(fixture.tenantId, (db) => db.insert(tenantIntegrations).values({
        id: fixture.integrationId,
        tenantId: fixture.tenantId,
        capability: "crm",
        binding: "ghl",
        mode: "sandbox",
        credentialProvider: "aws-secrets-manager",
        credentialRef: `finnor/tenants/${fixture.tenantId}/ghl`,
        credentialMetadata: { locationId: `location-${fixture.kind}` },
        sourcePolicy: { default: "external", direction: "inbound" },
        freshnessPolicy: { scope: "contacts", maxAgeSeconds: 300, criticality: "operational", staleBehavior: "refresh_then_degrade" },
        syncScopes: ["contacts"],
      }));
    }
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    setTenantSecretReaderForTesting(null);
  });
  afterAll(async () => { await closePool(); });

  it("commits canonical rows before its cursor and converges safely on replay", async () => {
    const fixture = fixtures[0]!;
    setTenantSecretReaderForTesting(async () => ({ apiKey: "test", locationId: "location-healthy" }));
    vi.stubGlobal("fetch", vi.fn(async () => Response.json({
      contacts: [{ id: "contact-1", firstName: "Grace", lastName: "Hopper", email: "grace@example.test", dateUpdated: "2026-08-24T10:00:00Z" }],
      meta: { total: 1 },
    })));
    await syncSource({ tenantId: fixture.tenantId, integrationId: fixture.integrationId, scope: "contacts" });
    await syncSource({ tenantId: fixture.tenantId, integrationId: fixture.integrationId, scope: "contacts" });
    const [integration, checkpoints, refs] = await withTenant(fixture.tenantId, async (db) => Promise.all([
      db.select().from(tenantIntegrations).where(eq(tenantIntegrations.id, fixture.integrationId)).then((rows) => rows[0]),
      db.select().from(integrationSyncCheckpoints).where(and(eq(integrationSyncCheckpoints.integrationId, fixture.integrationId), eq(integrationSyncCheckpoints.sourceScope, "contacts"))),
      db.select().from(externalRefs).where(and(eq(externalRefs.integrationId, fixture.integrationId), eq(externalRefs.externalId, "contact-1"))),
    ]));
    expect(integration).toMatchObject({ health: "ok", syncStatus: "synced", freshnessState: "fresh", reconciliationStatus: "healthy" });
    expect(integration?.syncInitializedAt).toBeTruthy();
    expect(checkpoints).toEqual([expect.objectContaining({ status: "idle", cursor: { version: 1 }, errorCode: null })]);
    expect(refs).toHaveLength(1);
  });

  it("honors rate-limit failure as degraded state instead of a request storm", async () => {
    const fixture = fixtures[1]!;
    setTenantSecretReaderForTesting(async () => ({ apiKey: "test", locationId: "location-rate-limit" }));
    const fetchMock = vi.fn(async () => new Response("rate limited", { status: 429, headers: { "retry-after": "30" } }));
    vi.stubGlobal("fetch", fetchMock);
    await expect(syncSource({ tenantId: fixture.tenantId, integrationId: fixture.integrationId, scope: "contacts" })).rejects.toThrow(/429/);
    const [integration, checkpoint] = await withTenant(fixture.tenantId, async (db) => Promise.all([
      db.select().from(tenantIntegrations).where(eq(tenantIntegrations.id, fixture.integrationId)).then((rows) => rows[0]),
      db.select().from(integrationSyncCheckpoints).where(eq(integrationSyncCheckpoints.integrationId, fixture.integrationId)).then((rows) => rows[0]),
    ]));
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(integration).toMatchObject({ health: "degraded", syncStatus: "degraded", reconciliationStatus: "degraded" });
    expect(checkpoint).toMatchObject({ status: "degraded", errorCode: "provider_retryable", recovery: { safeAction: "retry_with_backoff" } });
  });

  it("turns revoked/unavailable authentication into blocked source truth", async () => {
    const fixture = fixtures[2]!;
    setTenantSecretReaderForTesting(async () => { throw new Error("revoked"); });
    await expect(syncSource({ tenantId: fixture.tenantId, integrationId: fixture.integrationId, scope: "contacts" })).rejects.toThrow();
    const [integration, checkpoint] = await withTenant(fixture.tenantId, async (db) => Promise.all([
      db.select().from(tenantIntegrations).where(eq(tenantIntegrations.id, fixture.integrationId)).then((rows) => rows[0]),
      db.select().from(integrationSyncCheckpoints).where(eq(integrationSyncCheckpoints.integrationId, fixture.integrationId)).then((rows) => rows[0]),
    ]));
    expect(integration).toMatchObject({ health: "down", syncStatus: "blocked", reconciliationStatus: "blocked", lastError: "Provider authentication is unavailable or revoked" });
    expect(checkpoint).toMatchObject({ status: "blocked", errorCode: "auth_failure", recovery: { safeAction: "reauthenticate" } });
  });
});
