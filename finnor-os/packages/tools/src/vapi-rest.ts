// Vapi REST client for outbound calls (voice confirmations + spoken failure alerts).
// Wrapped like every other integration: timeout, retry, typed errors — no bare fetch.

import { wrappedCall, type ToolCallResult } from "./wrap";
import { IntegrationError } from "./errors";

export interface OutboundCallOpts {
  /** E.164 number to call (the dealer owner, or a customer). */
  customerNumber: string;
  /** What the assistant says the moment the call connects. */
  firstMessage: string;
  /** Carried on the call object; comes back in the end-of-call webhook. */
  metadata?: Record<string, unknown>;
  /** Values consumed by {{variableName}} placeholders in the saved assistant. */
  variableValues?: Record<string, string>;
  assistantId?: string;
}

export async function placeVapiCall(opts: OutboundCallOpts): Promise<ToolCallResult> {
  return wrappedCall("vapi", async () => {
    const apiKey = process.env.VAPI_API_KEY;
    const phoneNumberId = process.env.VAPI_PHONE_NUMBER_ID;
    const assistantId = opts.assistantId ?? process.env.VAPI_ASSISTANT_ID;
    if (!apiKey) throw new IntegrationError("vapi", "VAPI_API_KEY is not set", false);
    if (!phoneNumberId || phoneNumberId === "PLACEHOLDER_NEEDS_REAL_VALUE") {
      throw new IntegrationError(
        "vapi",
        "VAPI_PHONE_NUMBER_ID is not set — create/import a number in the Vapi dashboard and set its id",
        false,
      );
    }
    if (!assistantId) throw new IntegrationError("vapi", "VAPI_ASSISTANT_ID is not set", false);

    const res = await fetch("https://api.vapi.ai/call", {
      method: "POST",
      headers: { authorization: `Bearer ${apiKey}`, "content-type": "application/json" },
      body: JSON.stringify({
        assistantId,
        phoneNumberId,
        customer: { number: opts.customerNumber },
        metadata: opts.metadata ?? {},
        assistantOverrides: {
          firstMessage: opts.firstMessage,
          ...(opts.variableValues ? { variableValues: opts.variableValues } : {}),
        },
      }),
    });
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      throw new IntegrationError("vapi", `create call failed (${res.status}): ${body.slice(0, 300)}`, res.status >= 500);
    }
    return (await res.json()) as Record<string, unknown>;
  });
}

export interface VapiCampaignCustomer {
  number: string;
  name: string;
  externalId: string;
  assistantOverrides: {
    firstMessage: string;
    variableValues: Record<string, string>;
    metadata: Record<string, unknown>;
    analysisPlan?: Record<string, unknown>;
  };
}

export interface CreateVapiCampaignOpts {
  /** Deterministic per-domain-action name. Used as provider-side idempotency key. */
  name: string;
  assistantId: string;
  customers: VapiCampaignCustomer[];
  schedulePlan: { earliestAt: string; latestAt?: string };
}

type VapiCampaignRecord = Record<string, unknown> & { id?: string; name?: string };

function campaignArray(value: unknown): VapiCampaignRecord[] {
  if (Array.isArray(value)) return value.filter((row): row is VapiCampaignRecord => Boolean(row) && typeof row === "object");
  if (value && typeof value === "object") {
    const source = value as Record<string, unknown>;
    for (const key of ["results", "campaigns", "data"]) {
      if (Array.isArray(source[key])) return campaignArray(source[key]);
    }
  }
  return [];
}

async function findCampaignByName(apiKey: string, name: string): Promise<VapiCampaignRecord | null> {
  const createdAtGe = new Date(Date.now() - 35 * 86_400_000).toISOString();
  const query = new URLSearchParams({ limit: "100", createdAtGe });
  const response = await fetch(`https://api.vapi.ai/campaign?${query.toString()}`, {
    headers: { authorization: `Bearer ${apiKey}` },
  });
  if (!response.ok) {
    const body = await response.text().catch(() => "");
    throw new IntegrationError("vapi", `list campaigns failed (${response.status}): ${body.slice(0, 300)}`, response.status >= 500);
  }
  const rows = campaignArray(await response.json());
  return rows.find((row) => row.name === name) ?? null;
}

/** Creates a provider-managed outbound campaign. The deterministic name is checked
 * before POST and again after a 5xx so a lost response cannot fan out duplicate calls
 * when the workflow retries. The ToolRegistry provides the outer retry/idempotency
 * ledger; this adapter intentionally makes only one create attempt per invocation. */
export async function createVapiCampaign(opts: CreateVapiCampaignOpts): Promise<ToolCallResult> {
  return wrappedCall(
    "vapi",
    async () => {
      const apiKey = process.env.VAPI_API_KEY;
      const phoneNumberId = process.env.VAPI_PHONE_NUMBER_ID;
      if (!apiKey) throw new IntegrationError("vapi", "VAPI_API_KEY is not set", false);
      if (!phoneNumberId || phoneNumberId === "PLACEHOLDER_NEEDS_REAL_VALUE") {
        throw new IntegrationError("vapi", "VAPI_PHONE_NUMBER_ID is not set", false);
      }
      if (!opts.assistantId) throw new IntegrationError("vapi", "A campaign assistantId is required", false);
      if (opts.customers.length === 0) throw new IntegrationError("vapi", "A campaign needs at least one customer", false);

      const existing = await findCampaignByName(apiKey, opts.name);
      if (existing) return { ...existing, idempotentReplay: true };

      const response = await fetch("https://api.vapi.ai/campaign", {
        method: "POST",
        headers: { authorization: `Bearer ${apiKey}`, "content-type": "application/json" },
        body: JSON.stringify({
          name: opts.name,
          assistantId: opts.assistantId,
          phoneNumberId,
          customers: opts.customers,
          schedulePlan: opts.schedulePlan,
        }),
      });
      if (!response.ok) {
        // A provider can accept the write and still lose the HTTP response. Reconcile
        // once before surfacing the error; outer retries will perform the same check.
        if (response.status >= 500) {
          const reconciled = await findCampaignByName(apiKey, opts.name).catch(() => null);
          if (reconciled) return { ...reconciled, reconciledAfterProviderError: true };
        }
        const body = await response.text().catch(() => "");
        throw new IntegrationError("vapi", `create campaign failed (${response.status}): ${body.slice(0, 300)}`, response.status >= 500);
      }
      return (await response.json()) as Record<string, unknown>;
    },
    { attempts: 1, baseDelayMs: 0, timeoutMs: 20_000 },
  );
}
