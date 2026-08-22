import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";
import pg from "pg";
import { and, eq } from "drizzle-orm";
import { migrate } from "../../packages/db/migrate";
import { adminDb, closePool, integrationEvents, jobs, tenantIntegrations, tenants, withTenant } from "@finnor/db";
import { POST as ghlWebhook } from "../../apps/api/app/api/webhooks/ghl/route";
import { reconciliation } from "../../apps/worker/src/handlers/reconciliation";

const DB_URL = process.env.DATABASE_URL ?? "postgres://finnor:finnor@localhost:5432/finnor";

async function dbUp(): Promise<boolean> {
  const client = new pg.Client({ connectionString: DB_URL, connectionTimeoutMillis: 2_000 });
  try { await client.connect(); await client.end(); return true; } catch { return false; }
}

const available = await dbUp();

describe.skipIf(!available)("Phase 4 GHL canonical event ingestion", () => {
  const tenantA = randomUUID();
  const tenantB = randomUUID();
  const locationId = `ghl-location-${randomUUID()}`;

  beforeAll(async () => {
    process.env.DATABASE_URL = DB_URL;
    await migrate(DB_URL);
    await withTenant(tenantA, async (db) => {
      await db.insert(tenants).values({ id: tenantA, name: "GHL Event Tenant A" });
      await db.insert(tenantIntegrations).values({ tenantId: tenantA, capability: "crm", binding: "ghl", mode: "sandbox", config: { locationId } });
    });
    await withTenant(tenantB, (db) => db.insert(tenants).values({ id: tenantB, name: "GHL Event Tenant B" }));
  });

  afterAll(async () => {
    vi.unstubAllEnvs();
    await closePool();
  });

  function request(webhookId: string): Request {
    return new Request("http://localhost/api/webhooks/ghl", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ type: "ContactUpdate", locationId, contactId: "ghl-contact-123", webhookId }),
    });
  }

  it("resolves the signed provider location, claims replay in the durable queue, and normalizes once", async () => {
    vi.stubEnv("NODE_ENV", "test");
    vi.stubEnv("GHL_WEBHOOK_PUBLIC_KEY", "");
    const webhookId = `ghl-event-${randomUUID()}`;
    const first = await ghlWebhook(request(webhookId));
    expect(first.status).toBe(200);
    expect(await first.json()).toMatchObject({ received: true, duplicate: false });
    const replay = await ghlWebhook(request(webhookId));
    expect(await replay.json()).toMatchObject({ received: true, duplicate: true });

    const queued = await adminDb().select().from(jobs).where(eq(jobs.idempotencyKey, `ghl:${tenantA}:${webhookId}`));
    expect(queued).toHaveLength(1);
    expect(queued[0]!.payload).toMatchObject({ tenantId: tenantA, locationId, _providerEventId: webhookId });
    await reconciliation(queued[0]!.payload as Record<string, unknown>);
    await reconciliation(queued[0]!.payload as Record<string, unknown>);
    const events = await withTenant(tenantA, (db) => db.select().from(integrationEvents).where(and(
      eq(integrationEvents.source, "ghl"),
      eq(integrationEvents.sourceEventId, webhookId),
    )));
    expect(events).toEqual([expect.objectContaining({ eventType: "ghl.contactupdate", trustClass: "untrusted_external", instructionEligible: false })]);
  });

  it("fails closed when the provider location maps ambiguously or production authenticity is unavailable", async () => {
    vi.stubEnv("NODE_ENV", "test");
    vi.stubEnv("GHL_WEBHOOK_PUBLIC_KEY", "");
    await withTenant(tenantB, (db) => db.insert(tenantIntegrations).values({ tenantId: tenantB, capability: "crm", binding: "ghl", mode: "sandbox", config: { locationId } }));
    expect((await ghlWebhook(request(`ambiguous-${randomUUID()}`))).status).toBe(400);

    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("GHL_WEBHOOK_PUBLIC_KEY", "");
    expect((await ghlWebhook(request(`unsigned-production-${randomUUID()}`))).status).toBe(401);
  });
});
