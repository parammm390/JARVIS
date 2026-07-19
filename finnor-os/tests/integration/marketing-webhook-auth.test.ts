// Phase 4: the marketing conversion-intake webhook (apps/api/app/api/webhooks/
// marketing/route.ts) previously accepted ANY POST with a caller-supplied tenantId —
// a real, unauthenticated way to inject fake leads into any tenant's pipeline. This
// proves the fix: a shared secret is now required, same fail-closed-in-prod posture
// as every other webhook route in this repo.

import { describe, it, expect, beforeAll, afterAll, afterEach } from "vitest";
import pg from "pg";
import { migrate } from "../../packages/db/migrate";
import { withTenant, closePool, tenants, leads, households, adminDb, webhookReceipts } from "@finnor/db";
import { eq } from "drizzle-orm";
import { POST as marketingWebhook } from "../../apps/api/app/api/webhooks/marketing/route";

const DB_URL = process.env.DATABASE_URL ?? "postgres://finnor:finnor@localhost:5432/finnor";
const TENANT_ID = "00000000-0000-4000-8000-100000000f71";

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

function payload(eventId: string) {
  return { tenantId: TENANT_ID, campaignId: "camp-1", eventId, name: "Auth Probe Lead", phone: "+15555550199" };
}

function req(body: unknown, secretHeader?: string): Request {
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (secretHeader !== undefined) headers["x-webhook-secret"] = secretHeader;
  return new Request("http://localhost/api/webhooks/marketing", { method: "POST", headers, body: JSON.stringify(body) });
}

describe.skipIf(!available)("Phase 4: marketing webhook requires a real shared secret", () => {
  beforeAll(async () => {
    process.env.DATABASE_URL = DB_URL;
    await migrate(DB_URL);
    await withTenant(TENANT_ID, (db) => db.insert(tenants).values({ id: TENANT_ID, name: "Marketing Webhook Auth Test" }).onConflictDoNothing());
    // Clean up any webhook_receipts left by a prior run of this exact file — the
    // dedup table has no per-test isolation of its own, and re-running with the same
    // eventId would otherwise be indistinguishable from a real webhook replay.
    await adminDb().delete(webhookReceipts).where(eq(webhookReceipts.provider, "marketing_conversion"));
  }, 30_000);
  afterAll(async () => {
    await closePool();
  });
  afterEach(async () => {
    delete process.env.MARKETING_WEBHOOK_SECRET;
    delete (process.env as Record<string, string | undefined>).NODE_ENV_OVERRIDE;
  });

  it("with a configured secret: wrong or missing secret is rejected with 401, real key is accepted", async () => {
    process.env.MARKETING_WEBHOOK_SECRET = "real-secret-abc123";

    const noHeader = await marketingWebhook(req(payload("evt-noheader")));
    expect(noHeader.status).toBe(401);

    const wrongSecret = await marketingWebhook(req(payload("evt-wrong"), "not-the-secret"));
    expect(wrongSecret.status).toBe(401);

    const correct = await marketingWebhook(req(payload("evt-correct"), "real-secret-abc123"));
    expect(correct.status).toBe(200);
    const body = await correct.json();
    expect(body.leadId).toBeTruthy();

    await withTenant(TENANT_ID, async (db) => {
      const [lead] = await db.select().from(leads).where(eq(leads.id, body.leadId));
      expect(lead).toBeTruthy();
      await db.delete(leads).where(eq(leads.id, body.leadId));
      if (lead?.householdId) await db.delete(households).where(eq(households.id, lead.householdId));
    });
  });

  it("a mismatched-length secret is rejected without throwing (timingSafeEqual guard)", async () => {
    process.env.MARKETING_WEBHOOK_SECRET = "a-fairly-long-real-secret-value";
    const res = await marketingWebhook(req(payload("evt-short"), "x"));
    expect(res.status).toBe(401);
  });
});
