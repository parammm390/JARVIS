// Sandbox comms drivers: same tool names, same schemas, REAL side effects in our own
// database (households, service_visits, canonical messages, sandbox_outbox) — the only
// thing simulated is the final carrier hop (PSTN call / SMS delivery). When real keys
// arrive, createDefaultRegistry() swaps these for the live GHL/Vapi drivers with zero
// changes to any plugin or orchestrator code.
//
// Customer communication is written once through the data-platform boundary; the
// legacy communications_log name is now only a read projection of canonical messages.

import { z } from "zod";
import type { Tool, ToolRegistry, ToolRuntimeContext } from "./registry";
import type { Db } from "@finnor/db";
import { withTenant, households, serviceVisits, sandboxOutbox, contacts, contactMethods } from "@finnor/db";
import { and, eq, or, sql } from "drizzle-orm";
import { createCustomerHousehold, createServiceVisit, recordCustomerMessage } from "@finnor/data-platform";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

// Carrier-facing destinations are always stored and forwarded in E.164 form. A UUID
// identifies a record; it is never a routable destination.
export const DestinationPhoneSchema = z.string().trim().regex(/^\+[1-9]\d{7,14}$/, "must be a valid E.164 phone number");

export function validateDestinationPhone(value: string): string {
  return DestinationPhoneSchema.parse(value);
}

function tryValidateDestinationPhone(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const parsed = DestinationPhoneSchema.safeParse(value);
  return parsed.success ? parsed.data : null;
}

export interface SmsDestination {
  householdId: string | null;
  phoneNumber: string;
}

function withExecutionDb<T>(tenantId: string, db: Db | undefined, fn: (db: Db) => Promise<T>): Promise<T> {
  return db ? fn(db) : withTenant(tenantId, fn);
}

/** Resolve the caller-facing contact reference to a validated carrier destination. */
export async function resolveSmsDestination(tenantId: string, contactId: string, executionDb?: Db): Promise<SmsDestination> {
  const identifier = contactId.trim();
  const directPhone = tryValidateDestinationPhone(identifier);
  if (directPhone) return { householdId: null, phoneNumber: directPhone };
  if (!UUID_PATTERN.test(identifier)) throw new Error("SMS contactId must resolve to a valid E.164 phone number");

  return withExecutionDb(tenantId, executionDb, async (db) => {
    const [household] = await db
      .select({ id: households.id, contactInfo: households.contactInfo })
      .from(households)
      .where(and(eq(households.tenantId, tenantId), eq(households.id, identifier)))
      .limit(1);

    const [contact] = await db
      .select({ id: contacts.id, householdId: contacts.householdId })
      .from(contacts)
      .where(and(eq(contacts.tenantId, tenantId), or(eq(contacts.id, identifier), eq(contacts.householdId, identifier))))
      .limit(1);

    const relatedHousehold =
      household ??
      (contact?.householdId
        ? (
            await db
              .select({ id: households.id, contactInfo: households.contactInfo })
              .from(households)
              .where(and(eq(households.tenantId, tenantId), eq(households.id, contact.householdId)))
              .limit(1)
          )[0]
        : undefined);

    const contactPhone = tryValidateDestinationPhone(
      (relatedHousehold?.contactInfo as Record<string, unknown> | undefined)?.phone,
    );
    if (contactPhone) return { householdId: relatedHousehold?.id ?? contact?.householdId ?? null, phoneNumber: contactPhone };

    if (contact) {
      const methods = await db
        .select({ value: contactMethods.value })
        .from(contactMethods)
        .where(
          and(
            eq(contactMethods.tenantId, tenantId),
            eq(contactMethods.contactId, contact.id),
            or(eq(contactMethods.methodType, "phone"), eq(contactMethods.methodType, "sms")),
          ),
        );
      const methodPhone = methods
        .map((method) => tryValidateDestinationPhone(method.value))
        .find((phone): phone is string => phone !== null);
      if (methodPhone) return { householdId: relatedHousehold?.id ?? contact.householdId ?? null, phoneNumber: methodPhone };
    }

    throw new Error("Contact has no validated phone number for SMS");
  });
}

// Exported for reuse by the CRM capability contract's "native" binding
// (packages/tools/src/capabilities/crm.ts) — same logic, one definition.
export async function upsertHouseholdByPhone(
  tenantId: string,
  phone: string,
  name?: string,
  address?: string,
  executionDb?: Db,
): Promise<{ householdId: string; created: boolean }> {
  return withExecutionDb(tenantId, executionDb, async (db) => {
    const [existing] = await db
      .select({ id: households.id })
      .from(households)
      // RLS plus an explicit tenant predicate, always. Test/maintenance connections
      // can be table owners and therefore bypass RLS; omitting this predicate let a
      // same-phone household in tenant A become tenant B's sandbox contact.
      .where(and(eq(households.tenantId, tenantId), sql`${households.contactInfo} ->> 'phone' = ${phone}`));
    if (existing) return { householdId: existing.id, created: false };
    const created = await createCustomerHousehold(db, {
      tenantId,
      name: name ?? "Unknown caller",
      phone,
      ...(address ? { address } : {}),
      source: "sandbox_contact_capture",
    });
    return { householdId: created.householdId, created: true };
  });
}

// Exported for reuse by the CRM capability contract's "native" binding.
export async function bookServiceVisit(
  tenantId: string,
  householdId: string,
  startTime: string,
  executionDb?: Db,
): Promise<{ booked: boolean; visitId: string; scheduledAt: string; simulated: true }> {
  const when = new Date(startTime);
  const scheduledAt = Number.isNaN(when.getTime()) ? null : when;
  const visit = await withExecutionDb(tenantId, executionDb, async (db) => {
    return createServiceVisit(db, { tenantId, householdId, type: "water_test", scheduledAt });
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
  executionDb?: Db,
  provenance?: { sourceSystem: string; externalId?: string },
): Promise<{ canonicalMessageRecorded: boolean }> {
  const validatedPhone = validateDestinationPhone(toNumber);
  await withExecutionDb(tenantId, executionDb, async (db) => {
    await db.insert(sandboxOutbox).values({ tenantId, channel, toNumber: validatedPhone, content });
    if (householdId) {
      await recordCustomerMessage(db, {
        tenantId,
        householdId,
        channel,
        direction: "outbound",
        content,
        ...(provenance ? { provenance } : {}),
      });
    }
  });
  return { canonicalMessageRecorded: Boolean(householdId) };
}

async function resolveHouseholdIdByPhone(tenantId: string, phone: string, executionDb?: Db): Promise<string | null> {
  const normalizedPhone = validateDestinationPhone(phone);
  return withExecutionDb(tenantId, executionDb, async (db) => {
    const [household] = await db
      .select({ id: households.id })
      .from(households)
      .where(and(eq(households.tenantId, tenantId), sql`${households.contactInfo} ->> 'phone' = ${normalizedPhone}`))
      .limit(1);
    return household?.id ?? null;
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
      async run(input, runtime?: Readonly<ToolRuntimeContext>) {
        const { householdId, created } = await upsertHouseholdByPhone(
          String(input.tenantId),
          String(input.phone),
          input.firstName ? String(input.firstName) : undefined,
          input.address ? String(input.address) : undefined,
          runtime?.db,
        );
        // `contactId` preserves the pre-canonical GHL-shaped contract. Expose the
        // real native entity ID as well so receipts/read models can link the same
        // execution to Household 360 without guessing that the two namespaces are
        // interchangeable.
        return { contactId: householdId, householdId, createdNew: created, simulated: true };
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
      async run(input, runtime?: Readonly<ToolRuntimeContext>) {
        return bookServiceVisit(String(input.tenantId), String(input.contactId), String(input.startTime), runtime?.db);
      },
    },
    {
      name: "ghl_send_sms",
      description: "SANDBOX: record the SMS in the outbox + canonical message history (carrier hop simulated)",
      integration: "sandbox",
      inputSchema: z
        .object({ contactId: z.string(), message: z.string().min(1), tenantId: TenantIdSchema })
        .passthrough(),
      // tenantId/contactId are structurally required here (route the DB write), not
      // optional metadata — unlike the live GHL/Vapi adapters, never omit them.
      piiAllowlist: ["contactId", "message", "tenantId"],
      async run(input, runtime?: Readonly<ToolRuntimeContext>) {
        const tenantId = String(input.tenantId);
        const destination = await resolveSmsDestination(tenantId, String(input.contactId), runtime?.db);
        const recorded = await recordOutbound(tenantId, destination.householdId, "sms", destination.phoneNumber, String(input.message), runtime?.db,
          runtime?.domainActionId
            ? { sourceSystem: "domain_action", externalId: `${runtime.domainActionId}:sandbox-sms` }
            : undefined,
        );
        return { sent: true, to: destination.phoneNumber, simulated: true, ...recorded };
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
      async run(input, runtime?: Readonly<ToolRuntimeContext>) {
        const tenantId = String(input.tenantId);
        const householdId = await resolveHouseholdIdByPhone(tenantId, String(input.phoneNumber), runtime?.db);
        const recorded = await recordOutbound(tenantId, householdId, "call", String(input.phoneNumber), String(input.instructions ?? "(assistant call)"), runtime?.db,
          runtime?.domainActionId
            ? { sourceSystem: "domain_action", externalId: `${runtime.domainActionId}:sandbox-call` }
            : undefined,
        );
        return { callQueued: true, simulated: true, ...recorded };
      },
    },
    {
      name: "vapi_create_campaign",
      description: "SANDBOX: record a provider-managed campaign as native outbox work without claiming PSTN delivery",
      integration: "sandbox",
      inputSchema: z.object({
        tenantId: TenantIdSchema,
        name: z.string().min(3),
        schedulePlan: z.object({ earliestAt: z.string(), latestAt: z.string().optional() }),
        customers: z.array(z.object({
          number: z.string().min(7),
          externalId: z.string().uuid(),
          assistantOverrides: z.object({ firstMessage: z.string().min(1) }).passthrough(),
        }).passthrough()).min(1),
      }).passthrough(),
      piiAllowlist: ["tenantId", "name", "schedulePlan", "customers"],
      async run(input, runtime?: Readonly<ToolRuntimeContext>) {
        const tenantId = String(input.tenantId);
        const customers = input.customers as Array<{ number: string; externalId: string; assistantOverrides: { firstMessage: string } }>;
        for (const customer of customers) {
          // Vapi's externalId is provider correlation, not a Finnor household
          // identity. Link canonical customer truth only after an exact,
          // tenant-local destination lookup; otherwise keep the outbox fact
          // intentionally unlinked.
          const householdId = await resolveHouseholdIdByPhone(tenantId, customer.number, runtime?.db);
          await recordOutbound(tenantId, householdId, "call", customer.number, customer.assistantOverrides.firstMessage, runtime?.db,
            runtime?.domainActionId
              ? { sourceSystem: "domain_action", externalId: `${runtime.domainActionId}:sandbox-campaign:${customer.externalId}` }
              : undefined,
          );
        }
        return {
          id: `sandbox:${String(input.name)}`,
          simulated: true,
          providerAccepted: false,
          recordedTargets: customers.length,
          schedulePlan: input.schedulePlan,
        };
      },
    },
  ];
  for (const t of tools) {
    if (!registry.has(t.name)) registry.register(t); // real drivers (e.g. live Vapi) take precedence
  }
}
