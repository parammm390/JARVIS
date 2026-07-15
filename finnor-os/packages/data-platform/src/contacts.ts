import { contacts, contactMethods, type Db } from "@finnor/db";
import { and, eq } from "drizzle-orm";
import { recordBusinessEvent } from "./events";

export interface CreateContactParams {
  tenantId: string;
  householdId?: string;
  name: string;
  role?: string;
  provenance?: { sourceSystem: string; externalId?: string; createdBy?: string };
}

export async function createContact(db: Db, params: CreateContactParams): Promise<{ contactId: string }> {
  const [contact] = await db
    .insert(contacts)
    .values({
      tenantId: params.tenantId,
      householdId: params.householdId ?? null,
      name: params.name,
      role: params.role ?? null,
      sourceSystem: params.provenance?.sourceSystem ?? null,
      externalId: params.provenance?.externalId ?? null,
      createdBy: params.provenance?.createdBy ?? null,
    })
    .returning();
  await recordBusinessEvent(db, {
    tenantId: params.tenantId,
    entityType: "contact",
    entityId: contact!.id,
    eventType: "contact_created",
  });
  return { contactId: contact!.id };
}

export interface AddContactMethodParams {
  tenantId: string;
  contactId: string;
  methodType: "phone" | "email" | "sms";
  value: string;
  consent?: boolean;
}

// Idempotent by (contact_id, method_type, value) — matches the table's own UNIQUE constraint.
export async function addContactMethod(
  db: Db,
  params: AddContactMethodParams,
): Promise<{ contactMethodId: string }> {
  const [existing] = await db
    .select()
    .from(contactMethods)
    .where(
      and(
        eq(contactMethods.contactId, params.contactId),
        eq(contactMethods.methodType, params.methodType),
        eq(contactMethods.value, params.value),
      ),
    );
  if (existing) return { contactMethodId: existing.id };

  const [method] = await db
    .insert(contactMethods)
    .values({
      tenantId: params.tenantId,
      contactId: params.contactId,
      methodType: params.methodType,
      value: params.value,
      consent: params.consent ?? false,
      consentRecordedAt: params.consent ? new Date() : null,
    })
    .returning();
  return { contactMethodId: method!.id };
}
