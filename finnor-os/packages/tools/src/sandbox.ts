// Sandbox comms drivers: same tool names, same schemas, REAL side effects in our own
// database (households, service_visits, communications_log, sandbox_outbox) — the only
// thing simulated is the final carrier hop (PSTN call / SMS delivery). When real keys
// arrive, createDefaultRegistry() swaps these for the live GHL/Vapi drivers with zero
// changes to any plugin or orchestrator code.
//
// Phase 3: also writes the canonical contacts/contact_methods/conversations/messages
// rows (@finnor/data-platform) alongside the legacy households/communications_log/
// sandbox_outbox writes — additive, not a replacement. apps/api/app/api/comms/route.ts
// (the console's Communications view) still reads the legacy tables, so removing them
// would regress a working UI; the canonical rows exist so 6+ plugins whose persisted
// output flows through this one file (bulk-notify, customer-comm, marketing,
// maintenance-agreement, proposal-batch, water-test) now also produce real canonical
// data without any of them needing their own change.

import { z } from "zod";
import type { Tool, ToolRegistry } from "./registry";
import { withTenant, households, serviceVisits, communicationsLog, sandboxOutbox } from "@finnor/db";
import { eq, sql } from "drizzle-orm";
import { createContact, addContactMethod, getOrCreateConversation, persistMessage } from "@finnor/data-platform";

// Exported for reuse by the CRM capability contract's "native" binding
// (packages/tools/src/capabilities/crm.ts) — same logic, one definition.
export async function upsertHouseholdByPhone(
  tenantId: string,
  phone: string,
  name?: string,
  address?: string,
): Promise<{ householdId: string; created: boolean }> {
  return withTenant(tenantId, async (db) => {
    const [existing] = await db
      .select({ id: households.id })
      .from(households)
      .where(sql`${households.contactInfo} ->> 'phone' = ${phone}`);
    if (existing) return { householdId: existing.id, created: false };
    const [created] = await db
      .insert(households)
      .values({
        tenantId,
        address: address ?? "(address pending — captured from call)",
        contactInfo: { phone, ...(name ? { name } : {}) },
      })
      .returning();
    // Dual-write, same pattern as Phase 1's crm plugin: household stays authoritative,
    // the canonical contact/consent record is additive. Only on first creation — a
    // repeat call for a phone we already know about must not mint a second contact.
    const { contactId } = await createContact(db, { tenantId, householdId: created!.id, name: name ?? "Unknown caller" });
    await addContactMethod(db, { tenantId, contactId, methodType: "phone", value: phone });
    return { householdId: created!.id, created: true };
  });
}

// Exported for reuse by the CRM capability contract's "native" binding.
export async function bookServiceVisit(
  tenantId: string,
  householdId: string,
  startTime: string,
): Promise<{ booked: boolean; visitId: string; scheduledAt: string; simulated: true }> {
  const when = new Date(startTime);
  const scheduledAt = Number.isNaN(when.getTime()) ? null : when;
  const visit = await withTenant(tenantId, async (db) => {
    const [row] = await db.insert(serviceVisits).values({ householdId, type: "water_test", scheduledAt }).returning();
    return row!;
  });
  return { booked: true, visitId: visit.id, scheduledAt: visit.scheduledAt?.toISOString() ?? "unscheduled", simulated: true };
}

// Exported for reuse by capability contracts' "native" bindings (crm.ts, marketing.ts).
export async function recordOutbound(
  tenantId: string,
  householdId: string | null,
  channel: "sms" | "call",
  toNumber: string,
  content: string,
): Promise<void> {
  await withTenant(tenantId, async (db) => {
    await db.insert(sandboxOutbox).values({ tenantId, channel, toNumber, content });
    if (householdId) {
      await db.insert(communicationsLog).values({
        householdId,
        channel,
        direction: "outbound",
        content,
      });
    }
    const { conversationId } = await getOrCreateConversation(db, {
      tenantId,
      householdId: householdId ?? undefined,
      channel: channel === "call" ? "voice" : "sms",
    });
    await persistMessage(db, { tenantId, conversationId, direction: "outbound", channel, content });
  });
}

const TenantIdSchema = z.string().uuid();

export function registerSandboxComms(registry: ToolRegistry): void {
  const tools: Tool[] = [
    {
      name: "ghl_create_contact",
      description: "SANDBOX: upsert the contact as a household in Finnor's own database",
      integration: "sandbox",
      inputSchema: z
        .object({ phone: z.string().min(7), firstName: z.string().optional(), tenantId: TenantIdSchema })
        .passthrough(),
      piiAllowlist: ["phone", "firstName", "address", "tenantId"],
      async run(input) {
        const { householdId, created } = await upsertHouseholdByPhone(
          String(input.tenantId),
          String(input.phone),
          input.firstName ? String(input.firstName) : undefined,
          input.address ? String(input.address) : undefined,
        );
        return { contactId: householdId, createdNew: created, simulated: true };
      },
    },
    {
      name: "ghl_book_appointment",
      description: "SANDBOX: book the appointment as a real service_visits row",
      integration: "sandbox",
      inputSchema: z
        .object({ contactId: z.string().uuid(), startTime: z.string().min(1), tenantId: TenantIdSchema })
        .passthrough(),
      piiAllowlist: ["contactId", "startTime", "tenantId"],
      async run(input) {
        return bookServiceVisit(String(input.tenantId), String(input.contactId), String(input.startTime));
      },
    },
    {
      name: "ghl_send_sms",
      description: "SANDBOX: record the SMS in the outbox + communications log (carrier hop simulated)",
      integration: "sandbox",
      inputSchema: z
        .object({ contactId: z.string(), message: z.string().min(1), tenantId: TenantIdSchema })
        .passthrough(),
      // tenantId/contactId are structurally required here (route the DB write), not
      // optional metadata — unlike the live GHL/Vapi adapters, never omit them.
      piiAllowlist: ["contactId", "message", "tenantId"],
      async run(input) {
        const tenantId = String(input.tenantId);
        const householdId = /^[0-9a-f-]{36}$/i.test(String(input.contactId)) ? String(input.contactId) : null;
        const phone = householdId
          ? await withTenant(tenantId, async (db) => {
              const [hh] = await db.select({ contactInfo: households.contactInfo }).from(households).where(eq(households.id, householdId));
              return String((hh?.contactInfo as Record<string, unknown> | undefined)?.phone ?? "unknown");
            })
          : String(input.contactId);
        await recordOutbound(tenantId, householdId, "sms", phone, String(input.message));
        return { sent: true, to: phone, simulated: true };
      },
    },
    {
      name: "ghl_list_contacts",
      description: "SANDBOX: list households as contacts",
      integration: "sandbox",
      inputSchema: z.object({ tenantId: TenantIdSchema, limit: z.number().optional() }).passthrough(),
      piiAllowlist: ["tenantId", "limit"],
      async run(input) {
        const rows = await withTenant(String(input.tenantId), (db) =>
          db.select({ id: households.id, contactInfo: households.contactInfo }).from(households).limit(Number(input.limit ?? 20)),
        );
        return { contacts: rows, simulated: true };
      },
    },
    {
      name: "vapi_place_call",
      description: "SANDBOX: record the outbound call script in the outbox (PSTN hop simulated)",
      integration: "sandbox",
      inputSchema: z
        .object({ phoneNumber: z.string().min(7), instructions: z.string().optional(), tenantId: TenantIdSchema })
        .passthrough(),
      piiAllowlist: ["phoneNumber", "instructions", "tenantId"],
      async run(input) {
        const tenantId = String(input.tenantId);
        const [hh] = await withTenant(tenantId, (db) =>
          db
            .select({ id: households.id })
            .from(households)
            .where(sql`${households.contactInfo} ->> 'phone' = ${String(input.phoneNumber)}`),
        );
        await recordOutbound(tenantId, hh?.id ?? null, "call", String(input.phoneNumber), String(input.instructions ?? "(assistant call)"));
        return { callQueued: true, simulated: true };
      },
    },
  ];
  for (const t of tools) {
    if (!registry.has(t.name)) registry.register(t); // real drivers (e.g. live Vapi) take precedence
  }
}
