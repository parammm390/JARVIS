// CRM capability contract (Phase 3 domain 1 of 5). Two bindings prove each capability:
// `native` (packages/tools/src/sandbox.ts's real, Phase-3-upgraded logic — households +
// canonical contacts/contact_methods/conversations/messages) and `ghl` (the real
// GoHighLevel MCP adapter, packages/tools/src/mcp-client.ts), gated behind
// GOHIGHLEVEL_API_KEY exactly like Phase 2's Vapi gate.

import { z } from "zod";
import type { CapabilityContract, CapabilityBinding, RetryPolicy } from "@finnor/workflow-runtime";
import { connectGhl, callMcpTool } from "../mcp-client";
import { upsertHouseholdByPhone, recordOutbound, bookServiceVisit } from "../sandbox";
import {
  emulatorUpsertContact,
  emulatorSendMessage,
  emulatorBookProviderAppointment,
  type UpsertContactInput,
  type UpsertContactOutput,
  type SendMessageInput,
  type SendMessageOutput,
  type BookProviderAppointmentInput,
  type BookProviderAppointmentOutput,
} from "../emulators/crm-emulator";

export type {
  UpsertContactInput,
  UpsertContactOutput,
  SendMessageInput,
  SendMessageOutput,
  BookProviderAppointmentInput,
  BookProviderAppointmentOutput,
};

export const UpsertContactInputSchema = z.object({
  tenantId: z.string().uuid(),
  phone: z.string().min(7),
  firstName: z.string().optional(),
  address: z.string().optional(),
  idempotencyKey: z.string().min(1),
});
export const UpsertContactOutputSchema = z.object({ contactId: z.string(), createdNew: z.boolean() });

export const SendMessageInputSchema = z.object({
  tenantId: z.string().uuid(),
  contactId: z.string(),
  message: z.string().min(1),
  channel: z.enum(["sms", "email"]).optional(),
  idempotencyKey: z.string().min(1),
});
export const SendMessageOutputSchema = z.object({ sent: z.literal(true), channel: z.string() });

export const BookProviderAppointmentInputSchema = z.object({
  tenantId: z.string().uuid(),
  contactId: z.string(),
  startTime: z.string(),
  idempotencyKey: z.string().min(1),
});
export const BookProviderAppointmentOutputSchema = z.object({
  booked: z.literal(true),
  visitId: z.string(),
  scheduledAt: z.string(),
});

const RETRY_POLICY: RetryPolicy = { attempts: 3, baseDelayMs: 200, timeoutMs: 8_000 };

export function isGhlConfigured(): boolean {
  return Boolean(process.env.GOHIGHLEVEL_API_KEY);
}

// --- upsert_contact ---------------------------------------------------------

export const upsertContactContract: CapabilityContract<UpsertContactInput, UpsertContactOutput> = {
  domain: "crm",
  capability: "upsert_contact",
  version: 1,
  idempotencyKeyFrom: (input) => input.idempotencyKey,
  retryPolicy: RETRY_POLICY,
  requiredPermission: "crm:upsert_contact",
  piiAllowlist: ["phone", "firstName", "address"],
  // Upsert-by-phone is naturally idempotent on the provider side — a retry after an
  // unknown-delivery crash converges to the same contact, never a duplicate.
  retryOnUnknown: true,
};

export const upsertContactEmulatorBinding: CapabilityBinding<UpsertContactInput, UpsertContactOutput> = {
  name: "emulator",
  call: emulatorUpsertContact,
};

export const upsertContactNativeBinding: CapabilityBinding<UpsertContactInput, UpsertContactOutput> = {
  name: "native",
  async call(input) {
    const { householdId, created } = await upsertHouseholdByPhone(input.tenantId, input.phone, input.firstName, input.address);
    return { contactId: householdId, createdNew: created };
  },
};

export const upsertContactGhlBinding: CapabilityBinding<UpsertContactInput, UpsertContactOutput> = {
  name: "ghl",
  async call(input) {
    const conn = await connectGhl();
    try {
      const result = await callMcpTool(conn, "ghl", "contacts_upsert-contact", {
        firstName: input.firstName,
        phone: input.phone,
      });
      return { contactId: String(result.contactId ?? input.idempotencyKey), createdNew: true };
    } finally {
      await conn.close().catch(() => undefined);
    }
  },
};

// --- send_message ------------------------------------------------------------

export const sendMessageContract: CapabilityContract<SendMessageInput, SendMessageOutput> = {
  domain: "crm",
  capability: "send_message",
  version: 1,
  idempotencyKeyFrom: (input) => input.idempotencyKey,
  retryPolicy: RETRY_POLICY,
  requiredPermission: "crm:send_message",
  piiAllowlist: ["contactId", "message"],
  // A crash after the message is actually sent but before we recorded it must never be
  // auto-retried — a blind retry could double-send.
  retryOnUnknown: false,
};

export const sendMessageEmulatorBinding: CapabilityBinding<SendMessageInput, SendMessageOutput> = {
  name: "emulator",
  call: emulatorSendMessage,
};

export const sendMessageNativeBinding: CapabilityBinding<SendMessageInput, SendMessageOutput> = {
  name: "native",
  async call(input) {
    await recordOutbound(input.tenantId, input.contactId, "sms", input.contactId, input.message);
    return { sent: true, channel: input.channel ?? "sms" };
  },
};

export const sendMessageGhlBinding: CapabilityBinding<SendMessageInput, SendMessageOutput> = {
  name: "ghl",
  async call(input) {
    const conn = await connectGhl();
    try {
      await callMcpTool(conn, "ghl", "conversations_send-a-new-message", { contactId: input.contactId, message: input.message });
      return { sent: true, channel: input.channel ?? "sms" };
    } finally {
      await conn.close().catch(() => undefined);
    }
  },
};

// --- book_provider_appointment ------------------------------------------------

export const bookProviderAppointmentContract: CapabilityContract<BookProviderAppointmentInput, BookProviderAppointmentOutput> = {
  domain: "crm",
  capability: "book_provider_appointment",
  version: 1,
  idempotencyKeyFrom: (input) => input.idempotencyKey,
  retryPolicy: RETRY_POLICY,
  requiredPermission: "crm:book_provider_appointment",
  piiAllowlist: ["contactId", "startTime"],
  retryOnUnknown: false,
};

export const bookProviderAppointmentEmulatorBinding: CapabilityBinding<BookProviderAppointmentInput, BookProviderAppointmentOutput> = {
  name: "emulator",
  call: emulatorBookProviderAppointment,
};

export const bookProviderAppointmentNativeBinding: CapabilityBinding<BookProviderAppointmentInput, BookProviderAppointmentOutput> = {
  name: "native",
  async call(input) {
    const result = await bookServiceVisit(input.tenantId, input.contactId, input.startTime);
    return { booked: true, visitId: result.visitId, scheduledAt: result.scheduledAt };
  },
};

export const bookProviderAppointmentGhlBinding: CapabilityBinding<BookProviderAppointmentInput, BookProviderAppointmentOutput> = {
  name: "ghl",
  async call(input) {
    const conn = await connectGhl();
    try {
      const result = await callMcpTool(conn, "ghl", "calendars_create-appointment", {
        contactId: input.contactId,
        startTime: input.startTime,
      });
      return {
        booked: true,
        visitId: String(result.id ?? input.idempotencyKey),
        scheduledAt: input.startTime,
      };
    } finally {
      await conn.close().catch(() => undefined);
    }
  },
};
