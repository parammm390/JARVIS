// A3.T6 acceptance: the payment webhook now matches every other webhook route's own
// fail posture. The generic emulator shape is also signed and resolves its tenant
// from an opaque configured route; a caller-supplied tenantId is never trusted.

import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import pg from "pg";
import { createHmac, randomUUID } from "node:crypto";
import { migrate } from "../../packages/db/migrate";
import { withTenant, closePool, tenants, households, invoices, tenantIntegrations } from "@finnor/db";
import { POST as paymentWebhook } from "../../apps/api/app/api/webhooks/payment/route";
import { setTenantSecretReaderForTesting } from "@finnor/security";

const DB_URL = process.env.DATABASE_URL ?? "postgres://finnor:finnor@localhost:5432/finnor";
const TENANT = "00000000-0000-4000-8000-0000000000ee";
const ROUTE_ID = "payment-emulator-route-ee";

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
    invoiceId,
    providerEventId: `evt_${randomUUID()}`,
    amountUsd: 42,
    status: "succeeded",
  });
}

function req(body: string, headers: Record<string, string> = {}): Request {
  return new Request("http://localhost/api/webhooks/payment", { method: "POST", body, headers });
}

function emulatorHeaders(body: string, secret = "emulator-secret"): Record<string, string> {
  const t = Math.floor(Date.now() / 1000);
  const signature = createHmac("sha256", secret).update(`${t}.${body}`).digest("hex");
  return { "x-payment-signature": `t=${t},v1=${signature}`, "x-finnor-route-id": ROUTE_ID };
}

describe.skipIf(!available)("POST /api/webhooks/payment (A3.T6)", () => {
  let invoiceId: string;
  const originalSecret = process.env.STRIPE_WEBHOOK_SECRET;

  beforeAll(async () => {
    process.env.DATABASE_URL = DB_URL;
    await migrate(DB_URL);
    await withTenant(TENANT, (db) => db.insert(tenants).values({ id: TENANT, name: "Payment Webhook Test" }).onConflictDoNothing());
    await withTenant(TENANT, (db) => db.insert(tenantIntegrations).values({
      tenantId: TENANT,
      capability: "payments",
      binding: "stripe",
      mode: "sandbox",
      credentialProvider: "aws-secrets-manager",
      credentialRef: `finnor/tenants/${TENANT}/stripe`,
      config: { webhookRouteId: ROUTE_ID },
    }).onConflictDoUpdate({
      target: [tenantIntegrations.tenantId, tenantIntegrations.capability],
      set: { binding: "stripe", mode: "sandbox", credentialProvider: "aws-secrets-manager", credentialRef: `finnor/tenants/${TENANT}/stripe`, config: { webhookRouteId: ROUTE_ID } },
    }));
    setTenantSecretReaderForTesting(async () => ({ secretKey: "stripe-test-key", webhookSecret: "real-secret" }));
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
    setTenantSecretReaderForTesting(null);
    process.env.STRIPE_WEBHOOK_SECRET = originalSecret;
    delete process.env.PAYMENT_EMULATOR_WEBHOOK_SECRET;
    await closePool();
  });

  it("accepts the signed emulator shape outside production through a tenant-bound route", async () => {
    delete process.env.STRIPE_WEBHOOK_SECRET;
    process.env.PAYMENT_EMULATOR_WEBHOOK_SECRET = "emulator-secret";
    vi.stubEnv("NODE_ENV", "test");
    const body = devShapeBody(invoiceId);
    const res = await paymentWebhook(req(body, emulatorHeaders(body)));
    expect(res.status).toBe(200);
  });

  it("rejects an unsigned emulator shape in every environment", async () => {
    delete process.env.STRIPE_WEBHOOK_SECRET;
    delete process.env.PAYMENT_EMULATOR_WEBHOOK_SECRET;
    vi.stubEnv("NODE_ENV", "test");
    const res = await paymentWebhook(req(devShapeBody(invoiceId)));
    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body.error).toBe("Bad signature");
  });

  it("rejects a caller-supplied tenant selector even when the emulator signature is valid", async () => {
    delete process.env.STRIPE_WEBHOOK_SECRET;
    process.env.PAYMENT_EMULATOR_WEBHOOK_SECRET = "emulator-secret";
    vi.stubEnv("NODE_ENV", "test");
    const body = JSON.stringify({
      ...JSON.parse(devShapeBody(invoiceId)),
      tenantId: "00000000-0000-4000-8000-0000000000ff",
    });
    const res = await paymentWebhook(req(body, emulatorHeaders(body)));
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe("Malformed webhook");
  });

  it("rejects a real stripe-signature header with the wrong secret, in any environment", async () => {
    process.env.STRIPE_WEBHOOK_SECRET = "global-secret-must-not-be-used";
    vi.stubEnv("NODE_ENV", "production");
    const rawBody = JSON.stringify({ id: "evt_1", type: "checkout.session.completed", data: { object: { id: "cs_bad_signature", amount_total: 4200, metadata: { tenantId: TENANT, invoiceId } } } });
    const t = Math.floor(Date.now() / 1000);
    const badSig = createHmac("sha256", "wrong-secret").update(`${t}.${rawBody}`).digest("hex");
    const res = await paymentWebhook(req(rawBody, { "stripe-signature": `t=${t},v1=${badSig}` }));
    expect(res.status).toBe(401);
  });

  it("accepts a correctly-signed real stripe event once a secret is configured, in production", async () => {
    process.env.STRIPE_WEBHOOK_SECRET = "global-secret-must-not-be-used";
    vi.stubEnv("NODE_ENV", "production");
    const rawBody = JSON.stringify({
      id: `evt_${randomUUID()}`,
      type: "checkout.session.completed",
      data: { object: { id: `cs_${randomUUID()}`, amount_total: 4200, metadata: { tenantId: TENANT, invoiceId } } },
    });
    const t = Math.floor(Date.now() / 1000);
    const goodSig = createHmac("sha256", "real-secret").update(`${t}.${rawBody}`).digest("hex");
    const res = await paymentWebhook(req(rawBody, { "stripe-signature": `t=${t},v1=${goodSig}` }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.received).toBe(true);
  });
});
