import { afterEach, describe, expect, it, vi } from "vitest";
import { createSourceAdapterRegistry, IntegrationError } from "@finnor/tools";
import type { TenantCredentialContext } from "@finnor/security";

const tenantId = "11111111-1111-4111-8111-111111111111";
const integrationId = "22222222-2222-4222-8222-222222222222";

function credential(provider: "ghl" | "quickbooks" | "stripe" | "vapi", credentials: Record<string, unknown>): TenantCredentialContext {
  return {
    tenantId,
    provider,
    source: "test",
    integration: { id: integrationId, capability: provider === "ghl" ? "crm" : "accounting", binding: provider, mode: "sandbox" },
    reference: { secretProvider: "test", id: `test:${provider}`, version: "1" },
    credentials,
    cacheKey: `${tenantId}:${provider}:test`,
  } as TenantCredentialContext;
}

function context(provider: Parameters<typeof credential>[0], credentials: Record<string, unknown>) {
  return { tenantId, integrationId, config: {}, credentialContext: credential(provider, credentials) };
}

afterEach(() => vi.unstubAllGlobals());

describe("production source adapter contracts with deterministic provider fixtures", () => {
  it("normalizes a paged GHL contact with exact provider identity", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => Response.json({
      contacts: [{ id: "ghl-1", firstName: "Ada", lastName: "Lovelace", email: "ADA@EXAMPLE.TEST", dateUpdated: "2026-08-24T10:00:00Z" }],
      meta: { total: 1 },
    })));
    const page = await createSourceAdapterRegistry().get("ghl").readPage("contacts", { version: 1 }, context("ghl", { apiKey: "test", locationId: "loc-1" }));
    expect(page).toMatchObject({ hasMore: false, records: [{
      tenantId, integrationId, provider: "ghl", externalObjectType: "contact", externalId: "ghl-1",
      canonicalEntity: "customer", data: { firstName: "Ada", lastName: "Lovelace", email: "ada@example.test" },
    }] });
  });

  it("reads final GHL message delivery state for communication verification", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => Response.json({
      id: "message-1", contactId: "contact-1", conversationId: "conversation-1",
      dateAdded: "2026-08-24T10:05:00Z", body: "Your visit is confirmed.", direction: "outbound", status: "delivered", messageType: "SMS",
    })));
    const record = await createSourceAdapterRegistry().get("ghl").readObject("message", "message-1", context("ghl", { apiKey: "test", locationId: "loc-1" }));
    expect(record).toMatchObject({
      externalObjectType: "message", externalId: "message-1", canonicalEntity: "message",
      data: { contactId: "contact-1", body: "Your visit is confirmed.", direction: "outbound", status: "delivered", deliverySucceeded: true },
    });
  });

  it("uses QBO OAuth plus the real query response contract", async () => {
    const fetchMock = vi.fn(async (input: string | URL | Request) => {
      const url = String(input);
      if (url.includes("oauth.platform.intuit.com")) return Response.json({ access_token: "access" });
      return Response.json({ QueryResponse: { Customer: [{
        Id: "qbo-customer-1", SyncToken: "7", DisplayName: "Source Customer",
        PrimaryEmailAddr: { Address: "source@example.test" }, MetaData: { LastUpdatedTime: "2026-08-24T10:10:00Z" },
      }] } });
    });
    vi.stubGlobal("fetch", fetchMock);
    const page = await createSourceAdapterRegistry().get("quickbooks").readPage("customers", { version: 1, page: 0 }, context("quickbooks", {
      clientId: "id", clientSecret: "secret", refreshToken: "refresh", realmId: "realm", environment: "sandbox",
    }));
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(page.records[0]).toMatchObject({ provider: "quickbooks", externalObjectType: "customer", externalId: "qbo-customer-1", sourceVersion: "7" });
  });

  it("reads Stripe Checkout and Vapi call truth for post-write observation", async () => {
    const fetchMock = vi.fn(async (input: string | URL | Request) => {
      const url = String(input);
      if (url.includes("stripe.com")) return Response.json({ id: "cs_1", payment_status: "paid", amount_total: 12500, currency: "usd", metadata: { invoiceId: "invoice-1" } });
      return Response.json({ id: "call-1", status: "ended", endedAt: "2026-08-24T10:20:00Z", updatedAt: "2026-08-24T10:20:01Z" });
    });
    vi.stubGlobal("fetch", fetchMock);
    const stripe = await createSourceAdapterRegistry().get("stripe").readObject("checkout_session", "cs_1", context("stripe", { secretKey: "sk_test" }));
    const vapi = await createSourceAdapterRegistry().get("vapi").readObject("call", "call-1", context("vapi", { apiKey: "key", phoneNumberId: "phone", assistantId: "assistant" }));
    expect(stripe?.data).toMatchObject({ status: "paid", amountUsd: 125, metadata: { invoiceId: "invoice-1" } });
    expect(vapi).toMatchObject({ externalId: "call-1", data: { status: "ended", endedAt: "2026-08-24T10:20:00Z" } });
  });

  it("fails before network access when credential account identity is forged", async () => {
    const forged = context("ghl", { apiKey: "test", locationId: "loc-1" });
    forged.credentialContext = { ...forged.credentialContext, integration: { ...forged.credentialContext.integration, id: "33333333-3333-4333-8333-333333333333" } } as TenantCredentialContext;
    await expect(createSourceAdapterRegistry().get("ghl").readPage("contacts", { version: 1 }, forged)).rejects.toBeInstanceOf(IntegrationError);
  });
});
