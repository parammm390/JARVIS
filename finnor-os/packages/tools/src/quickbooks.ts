// QuickBooks Online adapter — mirrors ads.ts's exact shape: real OAuth2 client, a
// real self-test, and a clear "not configured" state, never a fabricated response.
//
// QuickBooks Online is NOT a static-API-key service — it authenticates via OAuth2
// (authorization-code flow once, then refresh-token from then on) plus a company
// "realm ID." That's five env vars instead of one for the same reason Google Ads
// needed five: it's the provider's actual requirement, not an extra hoop added here.
// QUICKBOOKS_CLIENT_ID / QUICKBOOKS_CLIENT_SECRET / QUICKBOOKS_REFRESH_TOKEN /
// QUICKBOOKS_REALM_ID, plus QUICKBOOKS_ENVIRONMENT ("sandbox" | "production").
//
// Finnor's own `invoices` table stays the system of record regardless — this adapter
// is a best-effort SYNC outward, never a dependency the native path blocks on (see
// apps/worker/src/handlers/quickbooks-sync.ts, which calls this asynchronously after
// a native invoice write, never inline in the accounting plugin's execute()).

import { IntegrationError, type ProviderHealth } from "./errors";
import type { TenantCredentialContext } from "@finnor/security";

export type QuickBooksCredentialContext = TenantCredentialContext<"quickbooks">;

function apiBase(context: QuickBooksCredentialContext): string {
  return context.credentials.environment === "production"
    ? "https://quickbooks.api.intuit.com"
    : "https://sandbox-quickbooks.api.intuit.com";
}

/** OAuth2 refresh -> short-lived access token, Intuit's standard token endpoint
 *  (Basic auth with client_id:client_secret, same shape as most OAuth2 providers). */
async function quickbooksAccessToken(context: QuickBooksCredentialContext): Promise<string> {
  const { clientId, clientSecret, refreshToken } = context.credentials;
  const basicAuth = Buffer.from(`${clientId}:${clientSecret}`).toString("base64");
  const res = await fetch("https://oauth.platform.intuit.com/oauth2/v1/tokens/bearer", {
    method: "POST",
    headers: {
      Authorization: `Basic ${basicAuth}`,
      "content-type": "application/x-www-form-urlencoded",
      accept: "application/json",
    },
    body: new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token: refreshToken,
    }),
  });
  if (!res.ok) {
    throw new IntegrationError("quickbooks", `OAuth token refresh failed (${res.status})`, res.status >= 500);
  }
  const data = (await res.json()) as { access_token?: string };
  if (!data.access_token) throw new IntegrationError("quickbooks", "OAuth refresh returned no access_token", false);
  return data.access_token;
}

/** Real, cheap QBO call (CompanyInfo, the standard health-check endpoint) — proves
 *  the refresh token and realm id are both actually valid, not just present. */
export async function testQuickBooksConnection(context: QuickBooksCredentialContext): Promise<ProviderHealth> {
  try {
    const accessToken = await quickbooksAccessToken(context);
    const realmId = context.credentials.realmId;
    const res = await fetch(`${apiBase(context)}/v3/company/${realmId}/companyinfo/${realmId}`, {
      headers: { Authorization: `Bearer ${accessToken}`, accept: "application/json" },
    });
    if (!res.ok) {
      return { configured: true, healthy: false, error: `QuickBooks CompanyInfo failed (${res.status})` };
    }
    return { configured: true, healthy: true };
  } catch {
    return { configured: true, healthy: false, error: "QuickBooks authenticated connection failed" };
  }
}

interface QboCustomerRef {
  id: string;
  displayName: string;
}

/** Find a customer by exact DisplayName, or create one — QBO has no concept of "our"
 *  household id, DisplayName is the closest stable natural key we can round-trip. */
async function findOrCreateCustomer(context: QuickBooksCredentialContext, accessToken: string, realmId: string, displayName: string, phone?: string): Promise<QboCustomerRef> {
  const query = `SELECT Id, DisplayName FROM Customer WHERE DisplayName = '${displayName.replace(/'/g, "\\'")}'`;
  const searchRes = await fetch(`${apiBase(context)}/v3/company/${realmId}/query?query=${encodeURIComponent(query)}`, {
    headers: { Authorization: `Bearer ${accessToken}`, accept: "application/json" },
  });
  if (searchRes.ok) {
    const data = (await searchRes.json()) as { QueryResponse?: { Customer?: Array<{ Id: string; DisplayName: string }> } };
    const existing = data.QueryResponse?.Customer?.[0];
    if (existing) return { id: existing.Id, displayName: existing.DisplayName };
  }
  const createRes = await fetch(`${apiBase(context)}/v3/company/${realmId}/customer`, {
    method: "POST",
    headers: { Authorization: `Bearer ${accessToken}`, "content-type": "application/json", accept: "application/json" },
    body: JSON.stringify({ DisplayName: displayName, ...(phone ? { PrimaryPhone: { FreeFormNumber: phone } } : {}) }),
  });
  if (!createRes.ok) {
    throw new IntegrationError("quickbooks", `customer create failed (${createRes.status})`, createRes.status >= 500);
  }
  const created = (await createRes.json()) as { Customer?: { Id: string; DisplayName: string } };
  if (!created.Customer) throw new IntegrationError("quickbooks", "customer create returned no Customer object", false);
  return { id: created.Customer.Id, displayName: created.Customer.DisplayName };
}

export interface QuickBooksInvoiceSync {
  customerName: string;
  customerPhone?: string;
  amountUsd: number;
  memo?: string;
}

export interface QuickBooksInvoiceSyncResult {
  quickbooksInvoiceId: string;
  quickbooksCustomerId: string;
}

/** Real QBO invoice creation — a single line item for the full amount (QBO requires
 *  an ItemRef; SalesItemLineDetail with no specific item is not valid, so this uses
 *  QBO's built-in generic "Sales" account line via DescriptionOnly, which every QBO
 *  company has by default and needs no per-dealer product-catalog setup first). */
export async function syncInvoiceToQuickBooks(invoice: QuickBooksInvoiceSync, context: QuickBooksCredentialContext): Promise<QuickBooksInvoiceSyncResult> {
  const accessToken = await quickbooksAccessToken(context);
  const realmId = context.credentials.realmId;
  const customer = await findOrCreateCustomer(context, accessToken, realmId, invoice.customerName, invoice.customerPhone);

  const res = await fetch(`${apiBase(context)}/v3/company/${realmId}/invoice`, {
    method: "POST",
    headers: { Authorization: `Bearer ${accessToken}`, "content-type": "application/json", accept: "application/json" },
    body: JSON.stringify({
      CustomerRef: { value: customer.id },
      Line: [
        {
          Amount: invoice.amountUsd,
          DetailType: "DescriptionOnly",
          Description: invoice.memo ?? "Water treatment service",
        },
      ],
    }),
  });
  if (!res.ok) {
    throw new IntegrationError("quickbooks", `invoice create failed (${res.status})`, res.status >= 500);
  }
  const data = (await res.json()) as { Invoice?: { Id: string } };
  if (!data.Invoice) throw new IntegrationError("quickbooks", "invoice create returned no Invoice object", false);
  return { quickbooksInvoiceId: data.Invoice.Id, quickbooksCustomerId: customer.id };
}

export function quickbooksProviderStatus(context: QuickBooksCredentialContext | null): { configured: boolean } {
  return { configured: Boolean(context) };
}
