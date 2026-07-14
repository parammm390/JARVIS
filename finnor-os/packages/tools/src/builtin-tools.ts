// Built-in tool set registered at service startup (§11–12). Each tool is either
// MCP-backed (GHL, Vapi) or an explicit not_implemented stub behind the same
// interface (§31) — swapping a stub for a real implementation never touches callers.

import { z } from "zod";
import type { ToolRegistry, Tool } from "./registry";
import { connectGhl, connectVapi, callMcpTool } from "./mcp-client";
import { PLACEHOLDER_NEEDS_REAL_VALUE } from "@finnor/shared-types";
import { registerSandboxComms } from "./sandbox";
import { sendEmail } from "./email";
import { geocodeAddress, distanceMiles } from "./maps";
import { placeVapiCall } from "./vapi-rest";
import { exaSearch } from "./exa";
import { getAdPerformance, adsProviderStatus } from "./ads";
import { syncInvoiceToQuickBooks } from "./quickbooks";
import { launchAdCampaign, type CampaignLaunchInput } from "./ads-write";

const ghlBacked = (name: string, description: string, mcpTool: string, inputSchema: z.ZodTypeAny, piiAllowlist?: readonly string[]): Tool => ({
  name,
  description,
  integration: "ghl",
  inputSchema,
  piiAllowlist,
  async run(input) {
    // tenantId is Finnor-internal routing context — never forwarded to GHL.
    const { tenantId: _tenantId, ...args } = input;
    const conn = await connectGhl();
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
 *  - "auto":    real when GOHIGHLEVEL_API_KEY is set, sandbox otherwise (default)
 */
export function commsMode(): "ghl" | "native" {
  const mode = process.env.COMMS_MODE ?? "auto";
  if (mode === "real" || mode === "ghl") return "ghl";
  if (mode === "sandbox" || mode === "native") return "native";
  return process.env.GOHIGHLEVEL_API_KEY ? "ghl" : "native";
}

export function registerBuiltinTools(registry: ToolRegistry): void {
  registerUniversalTools(registry); // email + maps + accounting: real in every mode
  if (commsMode() === "native") {
    // Finnor's own database is the CRM/calendar system of record. Only SMS carrier
    // delivery is recorded-not-transmitted until an SMS provider is connected.
    registerSandboxComms(registry);
    return;
  }
  registry.register(
    ghlBacked(
      "ghl_create_contact",
      "Create or update a contact in GoHighLevel",
      "contacts_upsert-contact",
      z.object({ firstName: z.string().optional(), lastName: z.string().optional(), phone: z.string().optional(), email: z.string().optional() }).passthrough(),
      ["firstName", "lastName", "phone", "email"],
    ),
  );
  registry.register(
    ghlBacked(
      "ghl_book_appointment",
      "Book a calendar slot in GoHighLevel",
      "calendars_create-appointment",
      z.object({ calendarId: z.string(), contactId: z.string(), startTime: z.string(), endTime: z.string().optional() }).passthrough(),
      ["calendarId", "contactId", "startTime", "endTime"],
    ),
  );
  registry.register(
    ghlBacked(
      "ghl_send_sms",
      "Send an SMS via GoHighLevel conversations",
      "conversations_send-a-new-message",
      z.object({ contactId: z.string(), message: z.string() }).passthrough(),
      ["contactId", "message"],
    ),
  );
  registry.register(
    ghlBacked(
      "ghl_list_contacts",
      "Read-only: list/search contacts in GoHighLevel (used by acceptance test §32.5)",
      "contacts_get-contacts",
      z.object({ query: z.string().optional(), limit: z.number().optional() }).passthrough(),
      ["query", "limit"],
    ),
  );

  registry.register({
    name: "vapi_place_call",
    description: "Place an outbound call via Vapi",
    integration: "vapi",
    inputSchema: z.object({ phoneNumber: z.string(), assistantId: z.string().optional(), instructions: z.string().optional() }).passthrough(),
    piiAllowlist: ["phoneNumber", "assistantId", "instructions", "tenantId"],
    async run(input) {
      const conn = await connectVapi();
      try {
        return await callMcpTool(conn, "vapi", "create_call", input);
      } finally {
        await conn.close().catch(() => undefined);
      }
    },
  });

}

function vapiPstnConfigured(): boolean {
  return Boolean(
    process.env.VAPI_API_KEY &&
      process.env.VAPI_PHONE_NUMBER_ID &&
      process.env.VAPI_PHONE_NUMBER_ID !== PLACEHOLDER_NEEDS_REAL_VALUE,
  );
}

function registerUniversalTools(registry: ToolRegistry): void {
  if (vapiPstnConfigured()) {
    // REAL outbound phone calls — Vapi phone number is configured.
    registry.register({
      name: "vapi_place_call",
      description: "Place a REAL outbound call via the dealer's Vapi phone number, optionally with a specialized assistant persona",
      integration: "vapi",
      inputSchema: z
        .object({ phoneNumber: z.string().min(7), instructions: z.string().optional(), assistantId: z.string().optional(), purpose: z.string().optional() })
        .passthrough(),
      piiAllowlist: ["phoneNumber", "instructions", "assistantId", "purpose", "tenantId"],
      async run(input) {
        const r = await placeVapiCall({
          customerNumber: String(input.phoneNumber),
          firstMessage: String(input.instructions ?? "Hello! This is Finnor calling on behalf of your water treatment dealer."),
          metadata: {
            ...(input.tenantId ? { tenantId: String(input.tenantId) } : {}),
            ...(input.purpose ? { purpose: String(input.purpose) } : {}),
          },
          assistantId: input.assistantId ? String(input.assistantId) : undefined,
        });
        if (!r.ok) throw new Error(r.error ?? "Vapi call failed");
        return { ...r.output, live: true };
      },
    });
  }
  registry.register({
    name: "get_ad_performance",
    description:
      "Real ad campaign performance (spend, clicks, CTR, conversions). Uses Meta or Google Ads if connected, otherwise clearly-labeled demo data.",
    integration: "ads",
    inputSchema: z.object({ windowDays: z.number().int().min(1).max(90).optional() }).passthrough(),
    piiAllowlist: ["windowDays"],
    async run(input) {
      const report = await getAdPerformance(input.windowDays ? Number(input.windowDays) : 7);
      return { ...report, providerStatus: adsProviderStatus() } as unknown as Record<string, unknown>;
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
    name: "send_email",
    description: "Send a real email via the dealer's Gmail account",
    integration: "email",
    inputSchema: z.object({ to: z.string().email(), subject: z.string().min(1), body: z.string().min(1) }).passthrough(),
    piiAllowlist: ["to", "subject", "body"],
    async run(input) {
      const r = await sendEmail({ to: String(input.to), subject: String(input.subject), body: String(input.body) });
      return { sent: true, messageId: r.messageId };
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
      .object({ name: z.string().min(1), dailyBudgetUsd: z.number().positive(), objective: z.string().optional(), targetZip: z.string().optional() })
      .passthrough(),
    piiAllowlist: ["name", "dailyBudgetUsd", "objective", "targetZip"],
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
    inputSchema: z.object({ customerName: z.string(), customerPhone: z.string().optional(), amountUsd: z.number(), memo: z.string().optional() }),
    piiAllowlist: ["customerName", "customerPhone", "amountUsd", "memo"],
    async run(input) {
      const i = input as { customerName: string; customerPhone?: string; amountUsd: number; memo?: string };
      // Throws IntegrationError (not-connected, or a real API failure) — wrappedCall
      // (registry.call()'s caller) already catches and types it uniformly; no
      // per-tool try/catch needed here.
      const result = await syncInvoiceToQuickBooks(i);
      return { ...result, synced: true };
    },
  });
}
