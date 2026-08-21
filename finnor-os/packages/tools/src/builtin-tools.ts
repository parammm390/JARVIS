// Built-in tool set registered at service startup (§11–12). Each tool is either
// MCP-backed (GHL, Vapi) or an explicit not_implemented stub behind the same
// interface (§31) — swapping a stub for a real implementation never touches callers.

import { z } from "zod";
import { ToolRegistry, type Tool, type ToolRuntimeContext } from "./registry";
import { connectGhl, connectVapi, callMcpTool } from "./mcp-client";
import { registerSandboxComms } from "./sandbox";
import { sendEmail } from "./email";
import { geocodeAddress, distanceMiles } from "./maps";
import { createVapiCampaign, placeVapiCall } from "./vapi-rest";
import { VOICE_AGENT_KEYS } from "./voice-personas";
import { exaSearch } from "./exa";
import { firecrawlScrape } from "./firecrawl";
import { syncInvoiceToQuickBooks } from "./quickbooks";
import { launchAdCampaign, type CampaignLaunchInput } from "./ads-write";
import { enqueueJob, sandboxOutbox, withTenant } from "@finnor/db";
import { IntegrationError } from "./errors";
import { resolveCredentialContext } from "@finnor/security";
import { getTenantAdPerformance } from "./tenant-provider";
import { resolveCapabilityBindingsForTenant } from "./binding-resolution";

const DAILY_CAMPAIGN_CUSTOMER_LIMIT = 200;

function actor(runtime: Readonly<ToolRuntimeContext> | undefined): string {
  return runtime?.actorId ?? "system:tool-runtime";
}

function purpose(runtime: Readonly<ToolRuntimeContext> | undefined, fallback: string): string {
  return runtime?.purpose?.trim() || fallback;
}

const ghlBacked = (name: string, description: string, mcpTool: string, inputSchema: z.ZodTypeAny, piiAllowlist?: readonly string[]): Tool => ({
  name,
  description,
  integration: "ghl",
  inputSchema,
  piiAllowlist,
  async run(input, runtime) {
    // tenantId is Finnor-internal routing context — never forwarded to GHL.
    const { tenantId: _tenantId, ...providerArgs } = input;
    const tenantId = String(input.tenantId ?? "");
    if (!tenantId) throw new IntegrationError("ghl", `${name} requires tenantId`, false);
    const credentialContext = mcpTool === "conversations_send-a-new-message"
      ? await resolveCredentialContext(tenantId, actor(runtime), "ghl", purpose(runtime, name), {
          channel: "sms",
          ...(runtime?.communicationIdentityId ? { communicationIdentityId: runtime.communicationIdentityId } : {}),
        })
      : mcpTool === "calendars_create-appointment"
        ? await resolveCredentialContext(tenantId, actor(runtime), "ghl", purpose(runtime, name), {
            channel: "calendar",
            ...(runtime?.communicationIdentityId ? { communicationIdentityId: runtime.communicationIdentityId } : {}),
          })
        : await resolveCredentialContext(tenantId, actor(runtime), "ghl", purpose(runtime, name), {
            application: "ghl",
            ...(runtime?.authProfileRef ? { authProfileRef: runtime.authProfileRef } : {}),
          });
    const args = { ...providerArgs };
    if (mcpTool === "calendars_create-appointment" && !args.calendarId) {
      if (!credentialContext.credentials.waterTestCalendarId) {
        throw new IntegrationError("ghl", "GHL tenant credentials do not define a water-test calendar", false);
      }
      args.calendarId = credentialContext.credentials.waterTestCalendarId;
    }
    const conn = await connectGhl(credentialContext);
    try {
      return await callMcpTool(conn, "ghl", mcpTool, args);
    } finally {
      await conn.close().catch(() => undefined);
    }
  },
});

/**
 * COMMS_MODE selects the comms drivers:
 *  - "real":    always live GHL/Vapi (fails loudly if keys are missing)
 *  - "sandbox": always sandbox (real DB side effects, carrier hop simulated)
 *  - "auto":    follows the non-secret CRM_BINDING legacy switch (default native)
 *
 * Runtime tool execution is tenant-routed and does not use this compatibility helper.
 */
export function commsMode(): "ghl" | "native" {
  const mode = process.env.COMMS_MODE ?? "auto";
  if (mode === "real" || mode === "ghl") return "ghl";
  if (mode === "sandbox" || mode === "native") return "native";
  return process.env.CRM_BINDING === "ghl" ? "ghl" : "native";
}

export function registerBuiltinTools(registry: ToolRegistry): void {
  const native = new ToolRegistry();
  registerSandboxComms(native);
  registerUniversalTools(registry, native);
  const tenantRoutedGhl = (name: string, description: string, mcpTool: string, inputSchema: z.ZodTypeAny, piiAllowlist?: readonly string[]): Tool => {
    const live = ghlBacked(name, description, mcpTool, inputSchema, piiAllowlist);
    return {
      ...live,
      integration: "tenant-routed",
      async run(input, runtime) {
        const tenantId = String(input.tenantId ?? "");
        if (!tenantId) throw new IntegrationError("ghl", `${name} requires tenantId`, false);
        const mode = (await resolveCapabilityBindingsForTenant(tenantId)).crm.mode;
        if (mode === "ghl") return live.run(input, runtime);
        const result = await native.call(name, input);
        if (!result.ok) throw new IntegrationError("native", result.error ?? `${name} failed`, false);
        return result.output;
      },
    };
  };

  registry.register(
    tenantRoutedGhl(
      "ghl_create_contact",
      "Create or update a contact in GoHighLevel",
      "contacts_upsert-contact",
      z.object({ firstName: z.string().optional(), lastName: z.string().optional(), phone: z.string().optional(), email: z.string().optional() }).passthrough(),
      ["firstName", "lastName", "phone", "email", "tenantId"],
    ),
  );
  registry.register({
    name: "send_sms_to_number",
    description: "Send an SMS to an execution-resolved phone number through the tenant's governed SMS identity",
    integration: "tenant-routed",
    inputSchema: z.object({ tenantId: z.string().uuid(), phoneNumber: z.string().min(7).max(40), message: z.string().min(1).max(5000) }).passthrough(),
    piiAllowlist: ["tenantId", "phoneNumber", "message"],
    async run(input, runtime) {
      const tenantId = String(input.tenantId);
      const mode = (await resolveCapabilityBindingsForTenant(tenantId)).crm.mode;
      if (mode === "native" || mode === "emulator") {
        const [row] = await withTenant(tenantId, (db) => db.insert(sandboxOutbox).values({
          tenantId,
          channel: "sms",
          toNumber: String(input.phoneNumber),
          content: String(input.message),
          simulated: true,
        }).returning({ id: sandboxOutbox.id }));
        return { sent: true, simulated: true, messageId: row!.id };
      }
      if (mode !== "ghl") throw new IntegrationError("ghl", `Unsupported tenant SMS binding: ${mode}`, false, "config");
      const credentialContext = await resolveCredentialContext(tenantId, actor(runtime), "ghl", purpose(runtime, "send_sms_to_number"), {
        channel: "sms",
        ...(runtime?.communicationIdentityId ? { communicationIdentityId: runtime.communicationIdentityId } : {}),
      });
      const conn = await connectGhl(credentialContext);
      try {
        const contact = await callMcpTool(conn, "ghl", "contacts_upsert-contact", { phone: String(input.phoneNumber) });
        const contactId = opaqueProviderId(contact, ["contactId", "id"]);
        if (!contactId) throw new IntegrationError("ghl", "Contact upsert did not return a contact identifier", false, "provider_down");
        const sent = await callMcpTool(conn, "ghl", "conversations_send-a-new-message", { contactId, message: String(input.message) });
        return { sent: true, messageId: opaqueProviderId(sent, ["messageId", "id"]), contactId, communicationIdentityId: credentialContext.access.communicationIdentityId };
      } finally {
        await conn.close().catch(() => undefined);
      }
    },
  });
  registry.register(
    tenantRoutedGhl(
      "ghl_book_appointment",
      "Book a calendar slot in GoHighLevel",
      "calendars_create-appointment",
      z.object({ calendarId: z.string().optional(), contactId: z.string(), startTime: z.string(), endTime: z.string().optional() }).passthrough(),
      ["calendarId", "contactId", "startTime", "endTime", "tenantId"],
    ),
  );
  registry.register(
    tenantRoutedGhl(
      "ghl_send_sms",
      "Send an SMS via GoHighLevel conversations",
      "conversations_send-a-new-message",
      z.object({ contactId: z.string(), message: z.string() }).passthrough(),
      ["contactId", "message", "tenantId"],
    ),
  );
  registry.register(
    tenantRoutedGhl(
      "ghl_list_contacts",
      "Read-only: list/search contacts in GoHighLevel (used by acceptance test §32.5)",
      "contacts_get-contacts",
      z.object({ query: z.string().optional(), limit: z.number().optional() }).passthrough(),
      ["query", "limit", "tenantId"],
    ),
  );

  if (!registry.has("vapi_place_call")) {
    registry.register({
      name: "vapi_place_call",
      description: "Place an outbound call via Vapi",
      integration: "vapi",
      inputSchema: z.object({ phoneNumber: z.string(), assistantId: z.string().optional(), instructions: z.string().optional() }).passthrough(),
      piiAllowlist: ["phoneNumber", "assistantId", "instructions", "tenantId"],
      async run(input, runtime) {
        const tenantId = String(input.tenantId ?? "");
        if (!tenantId) throw new IntegrationError("vapi", "vapi_place_call requires tenantId", false);
        const conn = await connectVapi(await resolveCredentialContext(tenantId, actor(runtime), "vapi", purpose(runtime, "vapi_place_call"), {
          channel: "voice",
          ...(runtime?.communicationIdentityId ? { communicationIdentityId: runtime.communicationIdentityId } : {}),
        }));
        try {
          return await callMcpTool(conn, "vapi", "create_call", input);
        } finally {
          await conn.close().catch(() => undefined);
        }
      },
    });
  }

}

function opaqueProviderId(value: unknown, keys: readonly string[]): string | null {
  if (!value || typeof value !== "object") return null;
  const row = value as Record<string, unknown>;
  for (const key of keys) if (typeof row[key] === "string" && row[key]) return String(row[key]);
  for (const child of Object.values(row)) {
    const nested = opaqueProviderId(child, keys);
    if (nested) return nested;
  }
  return null;
}

function registerUniversalTools(registry: ToolRegistry, native: ToolRegistry): void {
  // Register the real adapters based on operating mode, not import-time secret
  // visibility. ToolRegistry loads managed secrets immediately before execution;
  // checking env here made a correctly configured Secrets Manager deployment omit
  // the campaign tool for the lifetime of a warm process.
  {
    // REAL outbound phone calls — Vapi phone number is configured.
    registry.register({
      name: "vapi_place_call",
      description: "Tenant-routed outbound call: the tenant's Vapi account or its configured sandbox emulator",
      integration: "tenant-routed",
      inputSchema: z
        .object({
          tenantId: z.string().uuid(),
          phoneNumber: z.string().min(7),
          instructions: z.string().optional(),
          assistantId: z.string().optional(),
          purpose: z.string().optional(),
          agentKey: z.enum(VOICE_AGENT_KEYS).optional(),
          domainActionId: z.string().min(1).optional(),
          householdId: z.string().min(1).optional(),
          invoiceId: z.string().min(1).optional(),
          variableValues: z.record(z.string()).optional(),
        })
        .passthrough(),
      // These are causal/audit keys, not provider secrets. Keep the allowlist explicit
      // so future planner payload fields never flow into Vapi metadata by accident.
      piiAllowlist: ["phoneNumber", "instructions", "assistantId", "purpose", "tenantId", "agentKey", "domainActionId", "householdId", "invoiceId", "variableValues"],
      async run(input, runtime) {
        const tenantId = String(input.tenantId);
        if ((await resolveCapabilityBindingsForTenant(tenantId)).communications.mode !== "vapi") {
          const simulated = await native.call("vapi_place_call", input);
          if (!simulated.ok) throw new IntegrationError("sandbox", simulated.error ?? "sandbox Vapi call failed", false);
          return simulated.output;
        }
        const credentialContext = await resolveCredentialContext(tenantId, actor(runtime), "vapi", purpose(runtime, "vapi_place_call"), {
          channel: "voice",
          ...(runtime?.communicationIdentityId ? { communicationIdentityId: runtime.communicationIdentityId } : {}),
        });
        const r = await placeVapiCall({
          tenantId,
          customerNumber: String(input.phoneNumber),
          firstMessage: String(input.instructions ?? "Hello! This is Finnor calling on behalf of your water treatment dealer."),
          metadata: {
            direction: "outbound",
            ...(input.tenantId ? { tenantId: String(input.tenantId) } : {}),
            ...(input.purpose ? { purpose: String(input.purpose) } : {}),
            ...(input.agentKey ? { agentKey: String(input.agentKey) } : {}),
            ...(input.domainActionId ? { domainActionId: String(input.domainActionId) } : {}),
            ...(input.householdId ? { householdId: String(input.householdId) } : {}),
            ...(input.invoiceId ? { invoiceId: String(input.invoiceId) } : {}),
          },
          assistantId: input.assistantId ? String(input.assistantId) : undefined,
          variableValues: input.variableValues && typeof input.variableValues === "object"
            ? Object.fromEntries(Object.entries(input.variableValues as Record<string, unknown>).map(([key, value]) => [key, String(value)]))
            : undefined,
        }, credentialContext);
        if (!r.ok) throw new Error(r.error ?? "Vapi call failed");
        return { ...r.output, live: true, communicationIdentityId: credentialContext.access.communicationIdentityId };
      },
    });
    registry.register({
      name: "vapi_create_campaign",
      description: "Tenant-routed campaign: the tenant's Vapi account or its configured sandbox emulator",
      integration: "tenant-routed",
      inputSchema: z.object({
        tenantId: z.string().uuid(),
        name: z.string().min(3).max(200),
        assistantId: z.string().min(1),
        schedulePlan: z.object({ earliestAt: z.string().datetime(), latestAt: z.string().datetime().optional() }),
        customers: z.array(z.object({
          number: z.string().min(7),
          name: z.string().min(1).max(200),
          externalId: z.string().min(1).max(200),
          assistantOverrides: z.object({
            firstMessage: z.string().min(1).max(1000),
            variableValues: z.record(z.string()),
            metadata: z.record(z.unknown()),
            analysisPlan: z.record(z.unknown()).optional(),
          }),
        })).min(1).max(DAILY_CAMPAIGN_CUSTOMER_LIMIT),
      }),
      // This nested customer payload is deliberately forwarded: it is the approved
      // campaign cohort and the minimum context the saved Vapi assistant needs.
      piiAllowlist: ["tenantId", "name", "assistantId", "schedulePlan", "customers"],
      retryPolicy: { attempts: 3, baseDelayMs: 500, timeoutMs: 25_000 },
      async run(input, runtime) {
        const tenantId = String(input.tenantId);
        if ((await resolveCapabilityBindingsForTenant(tenantId)).communications.mode !== "vapi") {
          const simulated = await native.call("vapi_create_campaign", input);
          if (!simulated.ok) throw new IntegrationError("sandbox", simulated.error ?? "sandbox Vapi campaign failed", false);
          return simulated.output;
        }
        const result = await createVapiCampaign(input as unknown as Parameters<typeof createVapiCampaign>[0], await resolveCredentialContext(
          tenantId,
          actor(runtime),
          "vapi",
          purpose(runtime, "vapi_create_campaign"),
          {
            channel: "voice",
            ...(runtime?.communicationIdentityId ? { communicationIdentityId: runtime.communicationIdentityId } : {}),
          },
        ));
        if (!result.ok) {
          const kind = result.errorKind ?? "provider_down";
          throw new IntegrationError("vapi", result.error ?? "Vapi campaign creation failed", kind === "retryable" || kind === "provider_down", kind);
        }
        return { ...result.output, live: true };
      },
    });
  }
  registry.register({
    name: "get_ad_performance",
    description:
      "Real ad campaign performance (spend, clicks, CTR, conversions). Uses Meta or Google Ads if connected, otherwise clearly-labeled demo data.",
    integration: "ads",
    inputSchema: z.object({ tenantId: z.string().uuid(), windowDays: z.number().int().min(1).max(90).optional() }).passthrough(),
    piiAllowlist: ["tenantId", "windowDays"],
    async run(input, runtime) {
      const report = await getTenantAdPerformance(String(input.tenantId), input.windowDays ? Number(input.windowDays) : 7);
      return { ...report } as unknown as Record<string, unknown>;
    },
  });
  registry.register({
    name: "web_search",
    description: "Real-time web search via Exa (competitors, reviews, news, anything)",
    integration: "exa",
    inputSchema: z.object({ query: z.string().min(2), numResults: z.number().int().min(1).max(10).optional() }).passthrough(),
    piiAllowlist: ["query", "numResults"],
    async run(input) {
      const results = await exaSearch({ query: String(input.query), numResults: input.numResults ? Number(input.numResults) : 5 });
      return { results };
    },
  });
  registry.register({
    name: "firecrawl_scrape",
    description: "Read-only source retrieval via Firecrawl with robots, URL-safety, and citation metadata",
    integration: "firecrawl",
    inputSchema: z
      .object({
        url: z.string().url().max(2048),
        maxChars: z.number().int().min(100).max(40_000).optional(),
        allowedDomains: z.array(z.string().min(1).max(253)).max(20).optional(),
        termsApproved: z.boolean().optional(),
        requireTermsApproval: z.boolean().optional(),
      })
      .passthrough(),
    piiAllowlist: ["url", "maxChars", "allowedDomains", "termsApproved", "requireTermsApproval"],
    async run(input) {
      const result = await firecrawlScrape({
        url: String(input.url),
        maxChars: input.maxChars === undefined ? undefined : Number(input.maxChars),
        allowedDomains: Array.isArray(input.allowedDomains) ? input.allowedDomains.map(String) : undefined,
        termsApproved: input.termsApproved === true,
        requireTermsApproval: input.requireTermsApproval === true,
      });
      return { result };
    },
  });
  registry.register({
    name: "send_email",
    description: "Send a real email via the dealer's Gmail account",
    integration: "email",
    inputSchema: z.object({ tenantId: z.string().uuid(), to: z.string().email(), subject: z.string().min(1), body: z.string().min(1) }).passthrough(),
    piiAllowlist: ["tenantId", "to", "subject", "body"],
    async run(input, runtime) {
      const tenantId = String(input.tenantId);
      const credentialContext = await resolveCredentialContext(tenantId, actor(runtime), "gmail", purpose(runtime, "send_email"), {
        channel: "email",
        ...(runtime?.communicationIdentityId ? { communicationIdentityId: runtime.communicationIdentityId } : {}),
      });
      const r = await sendEmail({ tenantId, to: String(input.to), subject: String(input.subject), body: String(input.body) }, credentialContext);
      return { sent: true, messageId: r.messageId, communicationIdentityId: credentialContext.access.communicationIdentityId };
    },
  });
  registry.register({
    name: "send_finnor_notification",
    // A3.T5: Finnor's OWN outbound channel (win-back nudges, digests, alerts) via
    // Resend — never the dealer's Gmail (that's send_email above). Pre-launch: the
    // recipient allowlist lives INSIDE sendResendEmail(), enforced regardless of what
    // called this tool — a blocked recipient returns an honest {sent:false,blocked:true}
    // result, never a thrown error masquerading as a system failure.
    description: "Send a real email from Finnor itself (win-back/digest/alert), allowlisted to finnorai.com + the configured owner address only",
    integration: "resend",
    inputSchema: z.object({ tenantId: z.string().uuid(), to: z.string().email(), subject: z.string().min(1), html: z.string().min(1) }).passthrough(),
    piiAllowlist: ["tenantId", "to", "subject", "html"],
    async run(input, runtime) {
      // Provider failures must use the worker's real bounded retry/dead-letter
      // lifecycle, not turn this synchronous tool call into a dropped notification.
      // Allowlisting is still enforced inside the adapter when the job runs.
      await enqueueJob("send_resend_email", {
        tenantId: String(input.tenantId), to: String(input.to),
        subject: String(input.subject), html: String(input.html),
      });
      return { queued: true, delivery: "pending" };
    },
  });
  registry.register({
    name: "geocode_address",
    description: "Geocode a street address (OpenStreetMap, no key needed)",
    integration: "maps",
    inputSchema: z.object({ address: z.string().min(3) }),
    piiAllowlist: ["address"],
    async run(input) {
      const p = await geocodeAddress(String(input.address));
      return { ...p };
    },
  });
  registry.register({
    name: "distance_miles",
    description: "Great-circle distance in miles between two lat/lon points",
    integration: "maps",
    inputSchema: z.object({
      a: z.object({ lat: z.number(), lon: z.number() }),
      b: z.object({ lat: z.number(), lon: z.number() }),
    }),
    piiAllowlist: ["a", "b"],
    async run(input) {
      const i = input as { a: { lat: number; lon: number }; b: { lat: number; lon: number } };
      return { miles: distanceMiles(i.a, i.b) };
    },
  });
  registerAccountingSync(registry);
  registry.register({
    name: "launch_ad_campaign",
    description: "Launch a paid ad campaign (dry-run, clearly labeled, until write-scope Ads credentials are connected)",
    integration: "ads",
    inputSchema: z
      .object({ tenantId: z.string().uuid(), name: z.string().min(1), dailyBudgetUsd: z.number().positive(), objective: z.string().optional(), targetZip: z.string().optional() })
      .passthrough(),
    piiAllowlist: ["tenantId", "name", "dailyBudgetUsd", "objective", "targetZip"],
    async run(input) {
      const result = await launchAdCampaign(input as unknown as CampaignLaunchInput);
      return { ...result };
    },
  });
}

function registerAccountingSync(registry: ToolRegistry): void {
  // Finnor's own invoices table is always the system of record — this tool is a
  // best-effort SYNC outward, called async/non-blocking after a native invoice write
  // (apps/worker/src/handlers/quickbooks-sync.ts), never inline in the accounting
  // plugin's execute(). Real when QuickBooks is connected, an explicit typed
  // not_implemented result otherwise — never silent, never guessed.
  registry.register({
    name: "quickbooks_sync_invoice",
    description: "Sync a native Finnor invoice to QuickBooks Online, if connected.",
    integration: "quickbooks",
    inputSchema: z.object({ tenantId: z.string().uuid(), customerName: z.string(), customerPhone: z.string().optional(), amountUsd: z.number(), memo: z.string().optional() }),
    piiAllowlist: ["tenantId", "customerName", "customerPhone", "amountUsd", "memo"],
    async run(input, runtime) {
      const i = input as { customerName: string; customerPhone?: string; amountUsd: number; memo?: string };
      // Throws IntegrationError (not-connected, or a real API failure) — wrappedCall
      // (registry.call()'s caller) already catches and types it uniformly; no
      // per-tool try/catch needed here.
      const tenantId = String(input.tenantId);
      const credentialContext = await resolveCredentialContext(tenantId, actor(runtime), "quickbooks", purpose(runtime, "quickbooks_sync_invoice"), {
        application: "quickbooks",
        ...(runtime?.authProfileRef ? { authProfileRef: runtime.authProfileRef } : {}),
      });
      const result = await syncInvoiceToQuickBooks(i, credentialContext);
      return { ...result, synced: true, authProfileRef: credentialContext.access.authProfileRef };
    },
  });
}
