import { contacts, contactMethods, households, type Db } from "@finnor/db";
import { and, eq } from "drizzle-orm";
import { recordBusinessEvent } from "./events";

export interface CreateContactParams {
  tenantId: string;
  householdId?: string;
  name: string;
  role?: string;
  provenance?: { sourceSystem: string; externalId?: string; createdBy?: string };
}

export async function createCustomerHousehold(
  db: Db,
  params: {
    tenantId: string;
    name: string;
    phone?: string;
    email?: string;
    address?: string;
    contactInfo?: Record<string, unknown>;
    waterProfile?: Record<string, unknown>;
    marketingConsent?: boolean;
    latitude?: number;
    longitude?: number;
    source?: string;
    externalId?: string;
  },
): Promise<{ householdId: string; contactId: string }> {
  const [household] = await db.insert(households).values({
    tenantId: params.tenantId,
    address: params.address ?? "(address pending — captured from call)",
    contactInfo: { ...params.contactInfo, name: params.name, ...(params.phone ? { phone: params.phone } : {}), ...(params.email ? { email: params.email } : {}) },
    waterProfile: params.waterProfile ?? {},
    marketingConsent: params.marketingConsent ?? false,
    latitude: params.latitude ?? null,
    longitude: params.longitude ?? null,
  }).returning();
  const { contactId } = await createContact(db, {
    tenantId: params.tenantId,
    householdId: household!.id,
    name: params.name,
    role: "primary",
    provenance: {
      sourceSystem: params.source ?? "customer_capture",
      ...(params.externalId ? { externalId: `${params.externalId}:contact` } : {}),
    },
  });
  if (params.phone) {
    await addContactMethod(db, {
      tenantId: params.tenantId,
      contactId,
      methodType: "phone",
      value: params.phone,
      consent: params.marketingConsent,
    });
  }
  if (params.email) {
    await addContactMethod(db, {
      tenantId: params.tenantId,
      contactId,
      methodType: "email",
      value: params.email,
      consent: params.marketingConsent,
    });
  }
  await recordBusinessEvent(db, {
    tenantId: params.tenantId,
    entityType: "household",
    entityId: household!.id,
    eventType: "customer_household_created",
    source: params.source ?? "customer_capture",
  });
  return { householdId: household!.id, contactId };
}

/** Add missing canonical contact/method rows without overwriting customer-maintained data. */
export async function ensureCustomerContact(
  db: Db,
  params: {
    tenantId: string;
    householdId: string;
    name: string;
    phone: string;
    email?: string;
    source?: string;
    externalId?: string;
    consent?: boolean;
  },
): Promise<{ contactId: string; created: boolean }> {
  const [household] = await db.select({ id: households.id }).from(households).where(and(
    eq(households.tenantId, params.tenantId), eq(households.id, params.householdId),
  )).limit(1);
  if (!household) throw new Error("Customer household does not belong to this tenant");

  const [existing] = await db.select().from(contacts).where(and(
    eq(contacts.tenantId, params.tenantId), eq(contacts.householdId, params.householdId),
  )).limit(1);
  const created = !existing;
  const contactId = existing?.id ?? (await createContact(db, {
    tenantId: params.tenantId,
    householdId: params.householdId,
    name: params.name,
    role: "primary",
    provenance: {
      sourceSystem: params.source ?? "customer_capture",
      ...(params.externalId ? { externalId: `${params.externalId}:contact` } : {}),
    },
  })).contactId;
  await addContactMethod(db, {
    tenantId: params.tenantId,
    contactId,
    methodType: "phone",
    value: params.phone,
    consent: params.consent,
  });
  if (params.email) {
    await addContactMethod(db, {
      tenantId: params.tenantId,
      contactId,
      methodType: "email",
      value: params.email,
      consent: params.consent,
    });
  }
  return { contactId, created };
}

/** Stable fixture/location convergence only; no evolving customer state is touched. */
export async function updateCustomerCoordinates(
  db: Db,
  params: { tenantId: string; householdId: string; latitude: number; longitude: number; source?: string },
): Promise<boolean> {
  const [current] = await db.select({ latitude: households.latitude, longitude: households.longitude }).from(households).where(and(
    eq(households.tenantId, params.tenantId), eq(households.id, params.householdId),
  )).limit(1);
  if (!current) return false;
  // Postgres REAL is float4; values read back can differ from their JS input by
  // a few millionths. Treat coordinates within roughly one metre as converged
  // so static reconciliation stays event-idempotent.
  const sameCoordinate = (currentValue: number | null, nextValue: number) =>
    currentValue !== null && Math.abs(currentValue - nextValue) <= 1e-5;
  if (sameCoordinate(current.latitude, params.latitude) && sameCoordinate(current.longitude, params.longitude)) return true;
  await db.update(households).set({ latitude: params.latitude, longitude: params.longitude }).where(and(
    eq(households.tenantId, params.tenantId), eq(households.id, params.householdId),
  ));
  await recordBusinessEvent(db, {
    tenantId: params.tenantId,
    entityType: "household",
    entityId: params.householdId,
    eventType: "customer_location_changed",
    payload: { latitude: params.latitude, longitude: params.longitude },
    source: params.source ?? "customer",
  });
  return true;
}

export async function setCustomerMarketingConsent(
  db: Db,
  params: { tenantId: string; householdId: string; consent: boolean; source?: string },
): Promise<boolean> {
  const [household] = await db.update(households).set({ marketingConsent: params.consent }).where(and(
    eq(households.tenantId, params.tenantId), eq(households.id, params.householdId),
  )).returning({ id: households.id });
  if (!household) return false;
  await recordBusinessEvent(db, {
    tenantId: params.tenantId,
    entityType: "household",
    entityId: params.householdId,
    eventType: "marketing_consent_changed",
    payload: { consent: params.consent },
    source: params.source ?? "customer",
  });
  return true;
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
