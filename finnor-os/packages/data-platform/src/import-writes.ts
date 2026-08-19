import {
  appointments,
  contactMethods,
  contacts,
  equipment,
  households,
  inventoryItems,
  invoices,
  leads,
  payments,
  proposals,
  quoteLineItems,
  quotes,
  serviceVisits,
  technicians,
  workOrders,
  type Db,
} from "@finnor/db";
import { and, eq, sql } from "drizzle-orm";
import { recordBusinessEvent } from "./events";

export type CanonicalImportEntity =
  | "customer"
  | "lead"
  | "appointment"
  | "service_visit"
  | "equipment"
  | "work_order"
  | "quote"
  | "proposal"
  | "invoice"
  | "payment"
  | "inventory_item"
  | "technician";

export type ImportUpdateMode = "insert_only" | "fill_missing" | "source_owned";

export class CanonicalImportError extends Error {
  constructor(
    public readonly code: "ambiguous_match" | "invalid_relationship" | "canonical_missing" | "unsafe_update",
    message: string,
    public readonly field?: string,
  ) {
    super(message);
    this.name = "CanonicalImportError";
  }
}

export interface CanonicalImportWriteParams {
  tenantId: string;
  entity: CanonicalImportEntity;
  data: Record<string, unknown>;
  relationships: Record<string, string>;
  existingId?: string;
  /** True only when existingId came from the same tenant/source/entity/source-id ref. */
  sourceOwned: boolean;
  updateMode: ImportUpdateMode;
  provenance: { sourceSystem: string; sourceId: string };
}

export interface CanonicalImportWriteResult {
  entityType: Exclude<CanonicalImportEntity, "customer"> | "household";
  entityId: string;
  action: "created" | "updated" | "skipped";
  related?: Record<string, string>;
}

const present = (value: unknown): boolean => value !== undefined && value !== null && value !== "";
const stringValue = (value: unknown): string | undefined => present(value) ? String(value) : undefined;
const numberValue = (value: unknown): number | undefined => present(value) ? Number(value) : undefined;
const dateValue = (value: unknown): Date | undefined => value instanceof Date ? value : stringValue(value) ? new Date(String(value)) : undefined;
const canOverwrite = (params: CanonicalImportWriteParams) => params.updateMode === "source_owned" && params.sourceOwned;

function updateValue<T>(current: T | null | undefined, incoming: T | null | undefined, overwrite: boolean): T | undefined {
  if (!present(incoming)) return undefined;
  const equal = current instanceof Date && incoming instanceof Date
    ? current.getTime() === incoming.getTime()
    : current === incoming;
  if (equal) return undefined;
  if (!present(current) || overwrite) return incoming as T;
  return undefined;
}

async function assertRelatedTenant(db: Db, table: "households" | "technicians" | "invoices" | "quotes", id: string, tenantId: string): Promise<void> {
  const rows = table === "households"
    ? await db.select({ tenantId: households.tenantId }).from(households).where(and(eq(households.id, id), eq(households.tenantId, tenantId))).limit(1)
    : table === "technicians"
      ? await db.select({ tenantId: technicians.tenantId }).from(technicians).where(and(eq(technicians.id, id), eq(technicians.tenantId, tenantId))).limit(1)
      : table === "invoices"
        ? await db.select({ tenantId: invoices.tenantId }).from(invoices).where(and(eq(invoices.id, id), eq(invoices.tenantId, tenantId))).limit(1)
        : await db.select({ tenantId: quotes.tenantId }).from(quotes).where(and(eq(quotes.id, id), eq(quotes.tenantId, tenantId))).limit(1);
  if (rows[0]?.tenantId !== tenantId) {
    throw new CanonicalImportError("invalid_relationship", `${table} relationship does not belong to this tenant`, table);
  }
}

async function writeCustomer(db: Db, params: CanonicalImportWriteParams): Promise<CanonicalImportWriteResult> {
  const firstName = stringValue(params.data.firstName);
  const lastName = stringValue(params.data.lastName);
  const displayName = stringValue(params.data.name) ?? [firstName, lastName].filter(Boolean).join(" ");
  const phone = stringValue(params.data.phone);
  const email = stringValue(params.data.email)?.toLowerCase();
  const address = stringValue(params.data.address);
  let householdId = params.existingId;
  let contactId: string | undefined;
  let sourceOwned = params.sourceOwned;

  if (!householdId && (phone || email)) {
    const result = await db.execute<{ household_id: string; contact_id: string | null }>(sql`
      SELECT DISTINCT h.id::text AS household_id, c.id::text AS contact_id
      FROM finnor_os.households h
      LEFT JOIN finnor_os.contacts c ON c.tenant_id=h.tenant_id AND c.household_id=h.id AND c.archived_at IS NULL
      LEFT JOIN finnor_os.contact_methods cm ON cm.tenant_id=h.tenant_id AND cm.contact_id=c.id
      WHERE h.tenant_id=${params.tenantId}::uuid AND (
        (${email ?? null}::text IS NOT NULL AND (
          lower(cm.value)=lower(${email ?? null}) OR lower(h.contact_info->>'email')=lower(${email ?? null})
        )) OR
        (${phone ?? null}::text IS NOT NULL AND (
          regexp_replace(cm.value, '\\D', '', 'g')=regexp_replace(${phone ?? null}, '\\D', '', 'g') OR
          regexp_replace(h.contact_info->>'phone', '\\D', '', 'g')=regexp_replace(${phone ?? null}, '\\D', '', 'g')
        ))
      )
    `);
    const ids = [...new Set(result.rows.map((row) => row.household_id))];
    if (ids.length > 1) throw new CanonicalImportError("ambiguous_match", "customer email/phone matches multiple households");
    householdId = ids[0];
    contactId = result.rows.find((row) => row.household_id === householdId)?.contact_id ?? undefined;
    sourceOwned = false; // exact canonical match is trusted, but not owned by this source yet
  }

  if (!householdId) {
    const [household] = await db.insert(households).values({
      tenantId: params.tenantId,
      address: address ?? "(address pending)",
      contactInfo: { ...(displayName ? { name: displayName } : {}), ...(phone ? { phone } : {}), ...(email ? { email } : {}) },
      marketingConsent: params.data.marketingConsent === true,
    }).returning();
    const [contact] = await db.insert(contacts).values({
      tenantId: params.tenantId,
      householdId: household!.id,
      name: displayName!,
      firstName: firstName ?? null,
      lastName: lastName ?? null,
      role: stringValue(params.data.role) ?? "primary",
      sourceSystem: params.provenance.sourceSystem,
      externalId: params.provenance.sourceId,
    }).returning();
    if (phone) await db.insert(contactMethods).values({ tenantId: params.tenantId, contactId: contact!.id, methodType: "phone", value: phone }).onConflictDoNothing();
    if (email) await db.insert(contactMethods).values({ tenantId: params.tenantId, contactId: contact!.id, methodType: "email", value: email }).onConflictDoNothing();
    await recordBusinessEvent(db, { tenantId: params.tenantId, entityType: "contact", entityId: contact!.id, eventType: "contact_imported", source: params.provenance.sourceSystem });
    return { entityType: "household", entityId: household!.id, action: "created", related: { contactId: contact!.id } };
  }

  const [household] = await db.select().from(households).where(and(eq(households.tenantId, params.tenantId), eq(households.id, householdId)));
  if (!household) throw new CanonicalImportError("canonical_missing", "referenced household no longer exists");
  if (!contactId) {
    const [existingContact] = await db.select().from(contacts).where(and(eq(contacts.tenantId, params.tenantId), eq(contacts.householdId, householdId)));
    contactId = existingContact?.id;
  }
  if (params.updateMode === "insert_only") return { entityType: "household", entityId: householdId, action: "skipped", ...(contactId ? { related: { contactId } } : {}) };

  const overwrite = params.updateMode === "source_owned" && sourceOwned;
  let changed = false;
  const info = { ...(household.contactInfo as Record<string, unknown>) };
  for (const [key, value] of [["name", displayName], ["phone", phone], ["email", email]] as const) {
    if (present(value) && info[key] !== value && (!present(info[key]) || overwrite)) { info[key] = value; changed = true; }
  }
  const householdPatch: Record<string, unknown> = {};
  const nextAddress = updateValue(household.address === "(address pending)" ? null : household.address, address, overwrite);
  if (nextAddress !== undefined) householdPatch.address = nextAddress;
  if (changed) householdPatch.contactInfo = info;
  if (params.data.marketingConsent === true && !household.marketingConsent) householdPatch.marketingConsent = true;
  if (Object.keys(householdPatch).length) { await db.update(households).set(householdPatch).where(eq(households.id, householdId)); changed = true; }

  if (!contactId) {
    const [contact] = await db.insert(contacts).values({
      tenantId: params.tenantId, householdId, name: displayName!, firstName: firstName ?? null, lastName: lastName ?? null,
      role: stringValue(params.data.role) ?? "primary", sourceSystem: params.provenance.sourceSystem, externalId: params.provenance.sourceId,
    }).returning();
    contactId = contact!.id;
    changed = true;
  } else {
    const [contact] = await db.select().from(contacts).where(and(eq(contacts.tenantId, params.tenantId), eq(contacts.id, contactId)));
    if (!contact) throw new CanonicalImportError("canonical_missing", "referenced contact no longer exists");
    const patch: Record<string, unknown> = {};
    const nextName = updateValue(contact.name, displayName, overwrite);
    const nextFirst = updateValue(contact.firstName, firstName, overwrite);
    const nextLast = updateValue(contact.lastName, lastName, overwrite);
    const nextRole = updateValue(contact.role, stringValue(params.data.role), overwrite);
    if (nextName !== undefined) patch.name = nextName;
    if (nextFirst !== undefined) patch.firstName = nextFirst;
    if (nextLast !== undefined) patch.lastName = nextLast;
    if (nextRole !== undefined) patch.role = nextRole;
    if (Object.keys(patch).length) { await db.update(contacts).set(patch).where(eq(contacts.id, contactId)); changed = true; }
  }
  if (phone) {
    const inserted = await db.insert(contactMethods).values({ tenantId: params.tenantId, contactId, methodType: "phone", value: phone }).onConflictDoNothing().returning({ id: contactMethods.id });
    changed ||= inserted.length > 0;
  }
  if (email) {
    const inserted = await db.insert(contactMethods).values({ tenantId: params.tenantId, contactId, methodType: "email", value: email }).onConflictDoNothing().returning({ id: contactMethods.id });
    changed ||= inserted.length > 0;
  }
  if (changed) await recordBusinessEvent(db, { tenantId: params.tenantId, entityType: "contact", entityId: contactId, eventType: "contact_import_updated", source: params.provenance.sourceSystem });
  return { entityType: "household", entityId: householdId, action: changed ? "updated" : "skipped", related: { contactId } };
}

async function findOneByQuery(db: Db, query: ReturnType<typeof sql>): Promise<string | undefined> {
  const result = await db.execute<{ id: string }>(query);
  const ids = [...new Set(result.rows.map((row) => row.id))];
  if (ids.length > 1) throw new CanonicalImportError("ambiguous_match", "deterministic identity matches multiple canonical records");
  return ids[0];
}

/**
 * Canonical import write boundary. Import orchestration never writes business tables
 * directly; every supported entity's matching, safe-update policy and event are here.
 */
export async function writeCanonicalImportRow(db: Db, params: CanonicalImportWriteParams): Promise<CanonicalImportWriteResult> {
  if (params.entity === "customer") return writeCustomer(db, params);
  const overwrite = canOverwrite(params);

  if (params.entity === "lead") {
    let id = params.existingId;
    const phone = stringValue(params.data.phone);
    const email = stringValue(params.data.email)?.toLowerCase();
    if (!id && (phone || email)) id = await findOneByQuery(db, sql`SELECT id::text FROM finnor_os.leads WHERE tenant_id=${params.tenantId}::uuid AND archived_at IS NULL AND ((${email ?? null}::text IS NOT NULL AND lower(email)=lower(${email ?? null})) OR (${phone ?? null}::text IS NOT NULL AND regexp_replace(phone,'\\D','','g')=regexp_replace(${phone ?? null},'\\D','','g')))`);
    if (!id) {
      const relationshipHousehold = params.relationships.householdId;
      if (relationshipHousehold) await assertRelatedTenant(db, "households", relationshipHousehold, params.tenantId);
      let householdId = relationshipHousehold;
      if (!householdId) {
        const [hh] = await db.insert(households).values({ tenantId: params.tenantId, address: stringValue(params.data.address) ?? "(address pending)", contactInfo: { name: params.data.name, phone, email } }).returning();
        householdId = hh!.id;
      }
      const [row] = await db.insert(leads).values({
        tenantId: params.tenantId, householdId, name: String(params.data.name), phone: phone ?? null, email: email ?? null,
        address: stringValue(params.data.address) ?? null, notes: stringValue(params.data.notes) ?? null, source: stringValue(params.data.source) ?? null,
        status: (stringValue(params.data.status) as typeof leads.$inferInsert.status) ?? "new",
        sourceSystem: params.provenance.sourceSystem, externalId: params.provenance.sourceId,
      }).returning();
      await recordBusinessEvent(db, { tenantId: params.tenantId, entityType: "lead", entityId: row!.id, eventType: "lead_imported", source: params.provenance.sourceSystem });
      return { entityType: "lead", entityId: row!.id, action: "created", related: { householdId } };
    }
    const [row] = await db.select().from(leads).where(and(eq(leads.tenantId, params.tenantId), eq(leads.id, id)));
    if (!row) throw new CanonicalImportError("canonical_missing", "referenced lead no longer exists");
    if (params.updateMode === "insert_only") return { entityType: "lead", entityId: id, action: "skipped" };
    const patch: Record<string, unknown> = {};
    for (const [field, current, incoming] of [
      ["name", row.name, stringValue(params.data.name)], ["phone", row.phone, phone], ["email", row.email, email],
      ["address", row.address, stringValue(params.data.address)], ["notes", row.notes, stringValue(params.data.notes)], ["source", row.source, stringValue(params.data.source)],
    ] as const) { const next = updateValue(current, incoming, overwrite); if (next !== undefined) patch[field] = next; }
    if (overwrite && stringValue(params.data.status)) patch.status = params.data.status;
    if (!Object.keys(patch).length) return { entityType: "lead", entityId: id, action: "skipped" };
    await db.update(leads).set(patch).where(eq(leads.id, id));
    await recordBusinessEvent(db, { tenantId: params.tenantId, entityType: "lead", entityId: id, eventType: "lead_import_updated", source: params.provenance.sourceSystem });
    return { entityType: "lead", entityId: id, action: "updated" };
  }

  if (params.entity === "technician") {
    let id = params.existingId ?? await findOneByQuery(db, sql`SELECT id::text FROM finnor_os.technicians WHERE tenant_id=${params.tenantId}::uuid AND lower(name)=lower(${String(params.data.name)})`);
    if (!id) {
      const [row] = await db.insert(technicians).values({ tenantId: params.tenantId, name: String(params.data.name), contactInfo: params.data.contactInfo as Record<string, unknown> ?? {}, availability: params.data.availability as Record<string, unknown> ?? {} }).returning();
      await recordBusinessEvent(db, { tenantId: params.tenantId, entityType: "technician", entityId: row!.id, eventType: "technician_imported", source: params.provenance.sourceSystem });
      return { entityType: "technician", entityId: row!.id, action: "created" };
    }
    const [row] = await db.select().from(technicians).where(and(eq(technicians.tenantId, params.tenantId), eq(technicians.id, id)));
    if (!row) throw new CanonicalImportError("canonical_missing", "referenced technician no longer exists");
    if (!overwrite || params.updateMode === "insert_only") return { entityType: "technician", entityId: id, action: "skipped" };
    await db.update(technicians).set({ name: String(params.data.name), ...(params.data.contactInfo ? { contactInfo: params.data.contactInfo as Record<string, unknown> } : {}), ...(params.data.availability ? { availability: params.data.availability as Record<string, unknown> } : {}) }).where(eq(technicians.id, id));
    return { entityType: "technician", entityId: id, action: "updated" };
  }

  if (params.entity === "inventory_item") {
    const sku = String(params.data.sku);
    let id = params.existingId ?? await findOneByQuery(db, sql`SELECT id::text FROM finnor_os.inventory_items WHERE tenant_id=${params.tenantId}::uuid AND sku=${sku}`);
    if (!id) {
      const [row] = await db.insert(inventoryItems).values({ tenantId: params.tenantId, sku, name: String(params.data.name), quantity: numberValue(params.data.quantity) ?? 0, reorderThreshold: numberValue(params.data.reorderThreshold) ?? 0, unitCostUsd: numberValue(params.data.unitCostUsd)?.toFixed(2) ?? null }).returning();
      await recordBusinessEvent(db, { tenantId: params.tenantId, entityType: "inventory_item", entityId: row!.id, eventType: "inventory_item_imported", source: params.provenance.sourceSystem });
      return { entityType: "inventory_item", entityId: row!.id, action: "created" };
    }
    const [row] = await db.select().from(inventoryItems).where(and(eq(inventoryItems.tenantId, params.tenantId), eq(inventoryItems.id, id)));
    if (!row) throw new CanonicalImportError("canonical_missing", "referenced inventory item no longer exists");
    if (!overwrite || params.updateMode === "insert_only") return { entityType: "inventory_item", entityId: id, action: "skipped" };
    await db.update(inventoryItems).set({ name: String(params.data.name), quantity: numberValue(params.data.quantity) ?? row.quantity, reorderThreshold: numberValue(params.data.reorderThreshold) ?? row.reorderThreshold, unitCostUsd: numberValue(params.data.unitCostUsd)?.toFixed(2) ?? row.unitCostUsd }).where(eq(inventoryItems.id, id));
    await recordBusinessEvent(db, { tenantId: params.tenantId, entityType: "inventory_item", entityId: id, eventType: "inventory_item_import_updated", source: params.provenance.sourceSystem });
    return { entityType: "inventory_item", entityId: id, action: "updated" };
  }

  const householdId = params.relationships.householdId;
  if (["appointment", "service_visit", "equipment", "work_order", "quote", "proposal", "invoice"].includes(params.entity)) {
    if (!householdId) throw new CanonicalImportError("invalid_relationship", `${params.entity} requires householdId`, "householdId");
    await assertRelatedTenant(db, "households", householdId, params.tenantId);
  }
  const technicianId = params.relationships.technicianId;
  if (technicianId) await assertRelatedTenant(db, "technicians", technicianId, params.tenantId);

  if (params.entity === "appointment") {
    const scheduledAt = dateValue(params.data.scheduledAt)!;
    let id = params.existingId ?? await findOneByQuery(db, sql`SELECT id::text FROM finnor_os.appointments WHERE tenant_id=${params.tenantId}::uuid AND subject_type='household' AND subject_id=${householdId!}::uuid AND scheduled_at=${scheduledAt}`);
    if (!id) {
      const [row] = await db.insert(appointments).values({ tenantId: params.tenantId, subjectType: "household", subjectId: householdId!, technicianId: technicianId ?? null, scheduledAt, durationMinutes: numberValue(params.data.durationMinutes), notes: stringValue(params.data.notes) ?? null, status: (stringValue(params.data.status) as typeof appointments.$inferInsert.status) ?? "confirmed", sourceSystem: params.provenance.sourceSystem, externalId: params.provenance.sourceId }).returning();
      await recordBusinessEvent(db, { tenantId: params.tenantId, entityType: "appointment", entityId: row!.id, eventType: "appointment_imported", source: params.provenance.sourceSystem });
      return { entityType: "appointment", entityId: row!.id, action: "created" };
    }
    if (!overwrite || params.updateMode === "insert_only") return { entityType: "appointment", entityId: id, action: "skipped" };
    await db.update(appointments).set({ technicianId: technicianId ?? null, scheduledAt, durationMinutes: numberValue(params.data.durationMinutes), notes: stringValue(params.data.notes) ?? null, status: (stringValue(params.data.status) as typeof appointments.$inferInsert.status) ?? "confirmed" }).where(and(eq(appointments.tenantId, params.tenantId), eq(appointments.id, id)));
    return { entityType: "appointment", entityId: id, action: "updated" };
  }

  if (params.entity === "service_visit") {
    const scheduledAt = dateValue(params.data.scheduledAt);
    let id = params.existingId;
    if (!id && scheduledAt) id = await findOneByQuery(db, sql`SELECT id::text FROM finnor_os.service_visits WHERE tenant_id=${params.tenantId}::uuid AND household_id=${householdId!}::uuid AND type=${String(params.data.type)} AND scheduled_at=${scheduledAt}`);
    if (!id) {
      const [row] = await db.insert(serviceVisits).values({ tenantId: params.tenantId, householdId: householdId!, technicianId: technicianId ?? null, type: String(params.data.type), scheduledAt: scheduledAt ?? null, completedAt: dateValue(params.data.completedAt) ?? null, notes: stringValue(params.data.notes) ?? null }).returning();
      await recordBusinessEvent(db, { tenantId: params.tenantId, entityType: "service_visit", entityId: row!.id, eventType: "service_visit_imported", source: params.provenance.sourceSystem });
      return { entityType: "service_visit", entityId: row!.id, action: "created" };
    }
    if (!overwrite || params.updateMode === "insert_only") return { entityType: "service_visit", entityId: id, action: "skipped" };
    await db.update(serviceVisits).set({ technicianId: technicianId ?? null, type: String(params.data.type), scheduledAt: scheduledAt ?? null, completedAt: dateValue(params.data.completedAt) ?? null, notes: stringValue(params.data.notes) ?? null }).where(and(eq(serviceVisits.tenantId, params.tenantId), eq(serviceVisits.id, id)));
    return { entityType: "service_visit", entityId: id, action: "updated" };
  }

  if (params.entity === "equipment") {
    let id = params.existingId ?? await findOneByQuery(db, sql`SELECT id::text FROM finnor_os.equipment WHERE tenant_id=${params.tenantId}::uuid AND household_id=${householdId!}::uuid AND type=${String(params.data.type)} AND coalesce(model,'')=coalesce(${stringValue(params.data.model) ?? null},'')`);
    if (!id) {
      const [row] = await db.insert(equipment).values({ tenantId: params.tenantId, householdId: householdId!, type: String(params.data.type), model: stringValue(params.data.model) ?? null, installDate: dateValue(params.data.installDate) ?? null, source: (stringValue(params.data.source) as "finnor" | "competitor") ?? "finnor" }).returning();
      await recordBusinessEvent(db, { tenantId: params.tenantId, entityType: "equipment", entityId: row!.id, eventType: "equipment_imported", source: params.provenance.sourceSystem });
      return { entityType: "equipment", entityId: row!.id, action: "created" };
    }
    if (!overwrite || params.updateMode === "insert_only") return { entityType: "equipment", entityId: id, action: "skipped" };
    await db.update(equipment).set({ type: String(params.data.type), model: stringValue(params.data.model) ?? null, installDate: dateValue(params.data.installDate) ?? null, source: (stringValue(params.data.source) as "finnor" | "competitor") ?? "finnor" }).where(and(eq(equipment.tenantId, params.tenantId), eq(equipment.id, id)));
    return { entityType: "equipment", entityId: id, action: "updated" };
  }

  if (params.entity === "work_order") {
    let id = params.existingId;
    const quoteId = params.relationships.quoteId;
    if (quoteId) await assertRelatedTenant(db, "quotes", quoteId, params.tenantId);
    if (!id) {
      const [row] = await db.insert(workOrders).values({ tenantId: params.tenantId, householdId: householdId!, quoteId: quoteId ?? null, type: String(params.data.type) as typeof workOrders.$inferInsert.type, status: (stringValue(params.data.status) as typeof workOrders.$inferInsert.status) ?? "draft", technicianId: technicianId ?? null, depositAmountUsd: numberValue(params.data.depositAmountUsd)?.toFixed(2) ?? null, scheduledAt: dateValue(params.data.scheduledAt) ?? null, completedAt: dateValue(params.data.completedAt) ?? null, sourceSystem: params.provenance.sourceSystem, externalId: params.provenance.sourceId }).returning();
      await recordBusinessEvent(db, { tenantId: params.tenantId, entityType: "work_order", entityId: row!.id, eventType: "work_order_imported", source: params.provenance.sourceSystem });
      return { entityType: "work_order", entityId: row!.id, action: "created" };
    }
    if (!overwrite || params.updateMode === "insert_only") return { entityType: "work_order", entityId: id, action: "skipped" };
    await db.update(workOrders).set({ quoteId: quoteId ?? null, type: String(params.data.type) as typeof workOrders.$inferInsert.type, status: (stringValue(params.data.status) as typeof workOrders.$inferInsert.status) ?? "draft", technicianId: technicianId ?? null, depositAmountUsd: numberValue(params.data.depositAmountUsd)?.toFixed(2) ?? null, scheduledAt: dateValue(params.data.scheduledAt) ?? null, completedAt: dateValue(params.data.completedAt) ?? null }).where(and(eq(workOrders.tenantId, params.tenantId), eq(workOrders.id, id)));
    return { entityType: "work_order", entityId: id, action: "updated" };
  }

  if (params.entity === "quote") {
    let id = params.existingId;
    const lineItems = params.data.lineItems as Array<{ sku?: string; label: string; quantity?: number; unitPriceUsd: number }>;
    const total = lineItems.reduce((sum, item) => sum + (item.quantity ?? 1) * item.unitPriceUsd, 0);
    if (!id) {
      const [row] = await db.insert(quotes).values({ tenantId: params.tenantId, householdId: householdId!, status: (stringValue(params.data.status) as typeof quotes.$inferInsert.status) ?? "draft", totalUsd: total.toFixed(2), validUntil: dateValue(params.data.validUntil) ?? null, sourceSystem: params.provenance.sourceSystem, externalId: params.provenance.sourceId }).returning();
      await db.insert(quoteLineItems).values(lineItems.map((item) => ({ tenantId: params.tenantId, quoteId: row!.id, sku: item.sku ?? null, label: item.label, quantity: item.quantity ?? 1, unitPriceUsd: item.unitPriceUsd.toFixed(2) })));
      await recordBusinessEvent(db, { tenantId: params.tenantId, entityType: "quote", entityId: row!.id, eventType: "quote_imported", source: params.provenance.sourceSystem });
      return { entityType: "quote", entityId: row!.id, action: "created" };
    }
    // Imported financial line history is never silently replaced. Explicit source-owned
    // updates may advance status/validity; correcting line items requires a new quote.
    if (!overwrite || params.updateMode === "insert_only") return { entityType: "quote", entityId: id, action: "skipped" };
    await db.update(quotes).set({ status: (stringValue(params.data.status) as typeof quotes.$inferInsert.status) ?? "draft", validUntil: dateValue(params.data.validUntil) ?? null }).where(and(eq(quotes.tenantId, params.tenantId), eq(quotes.id, id)));
    return { entityType: "quote", entityId: id, action: "updated" };
  }

  if (params.entity === "proposal") {
    let id = params.existingId;
    const quoteId = params.relationships.quoteId;
    if (quoteId) await assertRelatedTenant(db, "quotes", quoteId, params.tenantId);
    if (!id) {
      const [row] = await db.insert(proposals).values({
        tenantId: params.tenantId,
        householdId: householdId!,
        quoteId: quoteId ?? null,
        content: params.data.content as Record<string, unknown>,
        status: stringValue(params.data.status) ?? "draft",
        sentAt: dateValue(params.data.sentAt) ?? null,
      }).returning();
      await recordBusinessEvent(db, { tenantId: params.tenantId, entityType: "proposal", entityId: row!.id, eventType: "proposal_imported", source: params.provenance.sourceSystem });
      return { entityType: "proposal", entityId: row!.id, action: "created" };
    }
    const [row] = await db.select().from(proposals).where(and(eq(proposals.tenantId, params.tenantId), eq(proposals.id, id)));
    if (!row) throw new CanonicalImportError("canonical_missing", "referenced proposal no longer exists");
    if (params.updateMode === "insert_only") return { entityType: "proposal", entityId: id, action: "skipped" };
    const contentEmpty = !row.content || Object.keys(row.content as Record<string, unknown>).length === 0;
    const patch: Record<string, unknown> = {};
    if (contentEmpty || overwrite) patch.content = params.data.content;
    const nextStatus = updateValue(row.status, stringValue(params.data.status), overwrite);
    const nextSentAt = updateValue(row.sentAt, dateValue(params.data.sentAt), overwrite);
    if (nextStatus !== undefined) patch.status = nextStatus;
    if (nextSentAt !== undefined) patch.sentAt = nextSentAt;
    if (!Object.keys(patch).length) return { entityType: "proposal", entityId: id, action: "skipped" };
    await db.update(proposals).set(patch).where(eq(proposals.id, id));
    await recordBusinessEvent(db, { tenantId: params.tenantId, entityType: "proposal", entityId: id, eventType: "proposal_import_updated", source: params.provenance.sourceSystem });
    return { entityType: "proposal", entityId: id, action: "updated" };
  }

  if (params.entity === "invoice") {
    let id = params.existingId;
    if (!id) {
      const [row] = await db.insert(invoices).values({ tenantId: params.tenantId, householdId: householdId!, amountUsd: Number(params.data.amountUsd).toFixed(2), status: (stringValue(params.data.status) as typeof invoices.$inferInsert.status) ?? "draft", memo: stringValue(params.data.memo) ?? null, dueDate: dateValue(params.data.dueDate) ?? null }).returning();
      await recordBusinessEvent(db, { tenantId: params.tenantId, entityType: "invoice", entityId: row!.id, eventType: "invoice_imported", source: params.provenance.sourceSystem });
      return { entityType: "invoice", entityId: row!.id, action: "created" };
    }
    const [row] = await db.select().from(invoices).where(and(eq(invoices.tenantId, params.tenantId), eq(invoices.id, id)));
    if (!row) throw new CanonicalImportError("canonical_missing", "referenced invoice no longer exists");
    if (params.updateMode === "insert_only") return { entityType: "invoice", entityId: id, action: "skipped" };
    const patch: Record<string, unknown> = {};
    const nextMemo = updateValue(row.memo, stringValue(params.data.memo), overwrite);
    const nextDue = updateValue(row.dueDate, dateValue(params.data.dueDate), overwrite);
    if (nextMemo !== undefined) patch.memo = nextMemo;
    if (nextDue !== undefined) patch.dueDate = nextDue;
    if (overwrite) { patch.amountUsd = Number(params.data.amountUsd).toFixed(2); if (params.data.status) patch.status = params.data.status; }
    if (!Object.keys(patch).length) return { entityType: "invoice", entityId: id, action: "skipped" };
    await db.update(invoices).set(patch).where(eq(invoices.id, id));
    await recordBusinessEvent(db, { tenantId: params.tenantId, entityType: "invoice", entityId: id, eventType: "invoice_import_updated", source: params.provenance.sourceSystem });
    return { entityType: "invoice", entityId: id, action: "updated" };
  }

  if (params.entity === "payment") {
    const invoiceId = params.relationships.invoiceId;
    if (!invoiceId) throw new CanonicalImportError("invalid_relationship", "payment requires invoiceId", "invoiceId");
    await assertRelatedTenant(db, "invoices", invoiceId, params.tenantId);
    if (params.existingId) return { entityType: "payment", entityId: params.existingId, action: "skipped" };
    const [row] = await db.insert(payments).values({ tenantId: params.tenantId, invoiceId, amountUsd: Number(params.data.amountUsd).toFixed(2), method: (stringValue(params.data.method) as typeof payments.$inferInsert.method) ?? "other", status: (stringValue(params.data.status) as typeof payments.$inferInsert.status) ?? "succeeded", receivedAt: dateValue(params.data.receivedAt) ?? new Date(), sourceSystem: params.provenance.sourceSystem, externalId: params.provenance.sourceId }).returning();
    if (row!.status === "succeeded") await db.update(invoices).set({ status: "paid" }).where(and(eq(invoices.tenantId, params.tenantId), eq(invoices.id, invoiceId)));
    await recordBusinessEvent(db, { tenantId: params.tenantId, entityType: "payment", entityId: row!.id, eventType: "payment_imported", source: params.provenance.sourceSystem });
    return { entityType: "payment", entityId: row!.id, action: "created" };
  }

  throw new CanonicalImportError("unsafe_update", `unsupported canonical import entity ${params.entity}`);
}
