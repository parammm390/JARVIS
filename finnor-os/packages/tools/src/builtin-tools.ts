// Built-in tool set registered at service startup (§11–12). Each tool is either
// MCP-backed (GHL, Vapi) or an explicit not_implemented stub behind the same
// interface (§31) — swapping a stub for a real implementation never touches callers.

import { z } from "zod";
import type { ToolRegistry, Tool } from "./registry";
import { connectGhl, connectVapi, callMcpTool } from "./mcp-client";
import { NotImplementedError } from "./errors";
import { PLACEHOLDER_NEEDS_REAL_VALUE } from "@finnor/shared-types";
import { registerSandboxComms } from "./sandbox";
import { sendEmail } from "./email";
import { geocodeAddress, distanceMiles } from "./maps";
import { placeVapiCall } from "./vapi-rest";
import { exaSearch } from "./exa";

const ghlBacked = (name: string, description: string, mcpTool: string, inputSchema: z.ZodTypeAny): Tool => ({
  name,
  description,
  integration: "ghl",
  inputSchema,
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
    ),
  );
  registry.register(
    ghlBacked(
      "ghl_book_appointment",
      "Book a calendar slot in GoHighLevel",
      "calendars_create-appointment",
      z.object({ calendarId: z.string(), contactId: z.string(), startTime: z.string(), endTime: z.string().optional() }).passthrough(),
    ),
  );
  registry.register(
    ghlBacked(
      "ghl_send_sms",
      "Send an SMS via GoHighLevel conversations",
      "conversations_send-a-new-message",
      z.object({ contactId: z.string(), message: z.string() }).passthrough(),
    ),
  );
  registry.register(
    ghlBacked(
      "ghl_list_contacts",
      "Read-only: list/search contacts in GoHighLevel (used by acceptance test §32.5)",
      "contacts_get-contacts",
      z.object({ query: z.string().optional(), limit: z.number().optional() }).passthrough(),
    ),
  );

  registry.register({
    name: "vapi_place_call",
    description: "Place an outbound call via Vapi",
    integration: "vapi",
    inputSchema: z.object({ phoneNumber: z.string(), assistantId: z.string().optional(), instructions: z.string().optional() }).passthrough(),
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
      description: "Place a REAL outbound call via the dealer's Vapi phone number",
      integration: "vapi",
      inputSchema: z.object({ phoneNumber: z.string().min(7), instructions: z.string().optional() }).passthrough(),
      async run(input) {
        const r = await placeVapiCall({
          customerNumber: String(input.phoneNumber),
          firstMessage: String(input.instructions ?? "Hello! This is Finnor calling on behalf of your water treatment dealer."),
          metadata: input.tenantId ? { tenantId: String(input.tenantId) } : {},
        });
        if (!r.ok) throw new Error(r.error ?? "Vapi call failed");
        return { ...r.output, live: true };
      },
    });
  }
  registry.register({
    name: "web_search",
    description: "Real-time web search via Exa (competitors, reviews, news, anything)",
    integration: "exa",
    inputSchema: z.object({ query: z.string().min(2), numResults: z.number().int().min(1).max(10).optional() }).passthrough(),
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
    async run(input) {
      const i = input as { a: { lat: number; lon: number }; b: { lat: number; lon: number } };
      return { miles: distanceMiles(i.a, i.b) };
    },
  });
  registerAccountingStub(registry);
}

function registerAccountingStub(registry: ToolRegistry): void {
  // Accounting: interface defined, no implementation yet (§20). Explicit stub, never silent.
  registry.register({
    name: "accounting_create_invoice",
    description: `Create an invoice in the accounting system (QuickBooks-class). NOT IMPLEMENTED — API credential is ${PLACEHOLDER_NEEDS_REAL_VALUE}; no dealer has requested this integration yet.`,
    integration: "accounting",
    inputSchema: z.object({ householdId: z.string(), amountUsd: z.number(), memo: z.string().optional() }),
    async run() {
      throw new NotImplementedError("accounting");
    },
  });
}
