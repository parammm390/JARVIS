// Vapi REST client for outbound calls (voice confirmations + spoken failure alerts).
// Wrapped like every other integration: timeout, retry, typed errors — no bare fetch.

import { wrappedCall, type ToolCallResult } from "./wrap";
import { IntegrationError } from "./errors";
import type { TenantCredentialContext } from "@finnor/security";

export type VapiCredentialContext = TenantCredentialContext<"vapi">;

export interface OutboundCallOpts {
  tenantId: string;
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

export async function placeVapiCall(opts: OutboundCallOpts, context: VapiCredentialContext): Promise<ToolCallResult> {
  return wrappedCall("vapi", async () => {
    if (context.tenantId !== opts.tenantId) throw new IntegrationError("vapi", "Vapi credential context tenant mismatch", false);
    const { apiKey, phoneNumberId } = context.credentials;
    const allowedAssistantIds = new Set([context.credentials.assistantId, ...Object.values(context.credentials.assistantIds ?? {})]);
    if (opts.assistantId && !allowedAssistantIds.has(opts.assistantId)) {
      throw new IntegrationError("vapi", "Requested assistant is not part of the tenant credential context", false);
    }
    const assistantId = opts.assistantId ?? context.credentials.assistantId;
    if (!assistantId) throw new IntegrationError("vapi", "VAPI_ASSISTANT_ID is not set", false);

    const res = await fetch("https://api.vapi.ai/call", {
      method: "POST",
      headers: { authorization: `Bearer ${apiKey}`, "content-type": "application/json" },
      body: JSON.stringify({
        assistantId,
        phoneNumberId,
        customer: { number: opts.customerNumber },
        metadata: { ...(opts.metadata ?? {}), tenantId: opts.tenantId },
        assistantOverrides: {
          firstMessage: opts.firstMessage,
          ...(opts.variableValues ? { variableValues: opts.variableValues } : {}),
        },
      }),
    });
    if (!res.ok) {
      throw new IntegrationError("vapi", `create call failed (${res.status})`, res.status >= 500);
    }
    return (await res.json()) as Record<string, unknown>;
  });
}

export interface VapiCallRecord extends Record<string, unknown> {
  id: string;
  status?: string;
  createdAt?: string;
  updatedAt?: string;
  endedAt?: string;
  metadata?: Record<string, unknown>;
}

export async function readVapiCall(id: string, context: VapiCredentialContext): Promise<VapiCallRecord | null> {
  const response = await fetch(`https://api.vapi.ai/call/${encodeURIComponent(id)}`, {
    headers: { authorization: `Bearer ${context.credentials.apiKey}` },
    signal: AbortSignal.timeout(10_000),
  });
  if (response.status === 404) return null;
  if (!response.ok) {
    const authFailure = response.status === 401 || response.status === 403;
    throw new IntegrationError("vapi", `get call failed (${response.status})`, !authFailure && (response.status === 429 || response.status >= 500), authFailure ? "auth" : "retryable");
  }
  return response.json() as Promise<VapiCallRecord>;
}

export async function listVapiCalls(
  context: VapiCredentialContext,
  options: { limit?: number; createdAtGe?: string; createdAtLt?: string } = {},
): Promise<VapiCallRecord[]> {
  const query = new URLSearchParams({ limit: String(Math.min(100, Math.max(1, options.limit ?? 100))) });
  if (options.createdAtGe) query.set("createdAtGe", options.createdAtGe);
  if (options.createdAtLt) query.set("createdAtLt", options.createdAtLt);
  const response = await fetch(`https://api.vapi.ai/call?${query.toString()}`, {
    headers: { authorization: `Bearer ${context.credentials.apiKey}` },
    signal: AbortSignal.timeout(10_000),
  });
  if (!response.ok) {
    const authFailure = response.status === 401 || response.status === 403;
    throw new IntegrationError("vapi", `list calls failed (${response.status})`, !authFailure && (response.status === 429 || response.status >= 500), authFailure ? "auth" : "retryable");
  }
  const payload: unknown = await response.json();
  const candidates = Array.isArray(payload)
    ? payload
    : payload && typeof payload === "object" && Array.isArray((payload as Record<string, unknown>).results)
      ? (payload as Record<string, unknown>).results as unknown[]
      : [];
  return candidates.filter((row): row is VapiCallRecord => Boolean(row) && typeof row === "object" && typeof (row as { id?: unknown }).id === "string");
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
  tenantId: string;
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

async function findCampaignByName(context: VapiCredentialContext, name: string): Promise<VapiCampaignRecord | null> {
  const createdAtGe = new Date(Date.now() - 35 * 86_400_000).toISOString();
  const query = new URLSearchParams({ limit: "100", createdAtGe });
  const response = await fetch(`https://api.vapi.ai/campaign?${query.toString()}`, {
    headers: { authorization: `Bearer ${context.credentials.apiKey}` },
  });
  if (!response.ok) {
    throw new IntegrationError("vapi", `list campaigns failed (${response.status})`, response.status >= 500);
  }
  const rows = campaignArray(await response.json());
  return rows.find((row) => row.name === name) ?? null;
}

/** Creates a provider-managed outbound campaign. The deterministic name is checked
 * before POST and again after a 5xx so a lost response cannot fan out duplicate calls
 * when the workflow retries. The ToolRegistry provides the outer retry/idempotency
 * ledger; this adapter intentionally makes only one create attempt per invocation. */
export async function createVapiCampaign(opts: CreateVapiCampaignOpts, context: VapiCredentialContext): Promise<ToolCallResult> {
  return wrappedCall(
    "vapi",
    async () => {
      if (context.tenantId !== opts.tenantId) throw new IntegrationError("vapi", "Vapi credential context tenant mismatch", false);
      const { apiKey, phoneNumberId } = context.credentials;
      const allowedAssistantIds = new Set([context.credentials.assistantId, ...Object.values(context.credentials.assistantIds ?? {})]);
      if (!allowedAssistantIds.has(opts.assistantId)) {
        throw new IntegrationError("vapi", "Requested campaign assistant is not part of the tenant credential context", false);
      }
      if (!opts.assistantId) throw new IntegrationError("vapi", "A campaign assistantId is required", false);
      if (opts.customers.length === 0) throw new IntegrationError("vapi", "A campaign needs at least one customer", false);

      const existing = await findCampaignByName(context, opts.name);
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
          const reconciled = await findCampaignByName(context, opts.name).catch(() => null);
          if (reconciled) return { ...reconciled, reconciledAfterProviderError: true };
        }
        throw new IntegrationError("vapi", `create campaign failed (${response.status})`, response.status >= 500);
      }
      return (await response.json()) as Record<string, unknown>;
    },
    { attempts: 1, baseDelayMs: 0, timeoutMs: 20_000 },
  );
}
