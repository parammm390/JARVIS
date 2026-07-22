// A3.T6 acceptance: the payment webhook now matches every other webhook route's own
// fail posture — unset STRIPE_WEBHOOK_SECRET accepts unsigned payloads OUTSIDE
// production only (dev convenience), and fails closed (401) in production. Before this
// fix it was the one route in this repo that accepted an unsigned, caller-supplied-
// tenantId payload unconditionally, in every environment including production.

import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import pg from "pg";
import { createHmac, randomUUID } from "node:crypto";
import { migrate } from "../../packages/db/migrate";
import { withTenant, closePool, tenants, households, invoices } from "@finnor/db";
import { POST as paymentWebhook } from "../../apps/api/app/api/webhooks/payment/route";

const DB_URL = process.env.DATABASE_URL ?? "postgres://finnor:finnor@localhost:5432/finnor";
const TENANT = "00000000-0000-4000-8000-0000000000ee";

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

function devShapeBody(invoiceId: string): string {
  return JSON.stringify({
    tenantId: TENANT,
    invoiceId,
    providerEventId: `evt_${randomUUID()}`,
    amountUsd: 42,
    status: "succeeded",
  });
}

function req(body: string, headers: Record<string, string> = {}): Request {
  return new Request("http://localhost/api/webhooks/payment", { method: "POST", body, headers });
}

describe.skipIf(!available)("POST /api/webhooks/payment (A3.T6)", () => {
  let invoiceId: string;
  const originalSecret = process.env.STRIPE_WEBHOOK_SECRET;

  beforeAll(async () => {
    process.env.DATABASE_URL = DB_URL;
    await migrate(DB_URL);
    await withTenant(TENANT, (db) => db.insert(tenants).values({ id: TENANT, name: "Payment Webhook Test" }).onConflictDoNothing());
    const [household] = await withTenant(TENANT, (db) =>
      db.insert(households).values({ tenantId: TENANT, address: "1 Test St", contactInfo: {} }).returning(),
    );
    const [invoice] = await withTenant(TENANT, (db) =>
      db.insert(invoices).values({ tenantId: TENANT, householdId: household!.id, amountUsd: "42.00", status: "sent" }).returning(),
    );
    invoiceId = invoice!.id;
  });
  afterAll(async () => {
    vi.unstubAllEnvs();
    process.env.STRIPE_WEBHOOK_SECRET = originalSecret;
    await closePool();
  });

  it("accepts the unsigned dev shape OUTSIDE production when no secret is configured — unchanged dev convenience", async () => {
    delete process.env.STRIPE_WEBHOOK_SECRET;
    vi.stubEnv("NODE_ENV", "test");
    const res = await paymentWebhook(req(devShapeBody(invoiceId)));
    expect(res.status).toBe(200);
  });

  it("A3.T6 fix: rejects the SAME unsigned dev shape in production when no secret is configured — real gap, now closed", async () => {
    delete process.env.STRIPE_WEBHOOK_SECRET;
    vi.stubEnv("NODE_ENV", "production");
    const res = await paymentWebhook(req(devShapeBody(invoiceId)));
    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body.error).toBe("Bad signature");
  });

  it("rejects a real stripe-signature header with the wrong secret, in any environment", async () => {
    process.env.STRIPE_WEBHOOK_SECRET = "real-secret";
    vi.stubEnv("NODE_ENV", "production");
    const rawBody = JSON.stringify({ id: "evt_1", type: "checkout.session.completed", data: { object: { amount_total: 4200, metadata: {} } } });
    const t = Math.floor(Date.now() / 1000);
    const badSig = createHmac("sha256", "wrong-secret").update(`${t}.${rawBody}`).digest("hex");
    const res = await paymentWebhook(req(rawBody, { "stripe-signature": `t=${t},v1=${badSig}` }));
    expect(res.status).toBe(401);
  });

  it("accepts a correctly-signed real stripe event once a secret is configured, in production", async () => {
    process.env.STRIPE_WEBHOOK_SECRET = "real-secret";
    vi.stubEnv("NODE_ENV", "production");
    const rawBody = JSON.stringify({
      id: `evt_${randomUUID()}`,
      type: "checkout.session.completed",
      data: { object: { amount_total: 4200, metadata: { tenantId: TENANT, invoiceId } } },
    });
    const t = Math.floor(Date.now() / 1000);
    const goodSig = createHmac("sha256", "real-secret").update(`${t}.${rawBody}`).digest("hex");
    const res = await paymentWebhook(req(rawBody, { "stripe-signature": `t=${t},v1=${goodSig}` }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.received).toBe(true);
  });
});
