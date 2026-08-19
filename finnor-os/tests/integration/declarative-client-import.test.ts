import { afterAll, beforeAll, describe, expect, it } from "vitest";
import pg from "pg";
import { and, eq } from "drizzle-orm";
import { migrate } from "../../packages/db/migrate";
import {
  appointments, closePool, contactMethods, contacts, equipment, households, importEntityRefs, importRows, importRuns,
  inventoryItems, invoices, leads, payments, proposals, quoteLineItems, quotes, serviceVisits, technicians, tenants, withTenant, workOrders,
} from "@finnor/db";
import { parseImportDefinition, runDeclarativeImport } from "@finnor/import-engine";

const DB_URL = process.env.DATABASE_URL ?? "postgres://finnor:finnor@localhost:5432/finnor";
const TENANT_A = "00000000-0000-4000-8000-0000000003a1";
const TENANT_B = "00000000-0000-4000-8000-0000000003b2";
const TENANT_C = "00000000-0000-4000-8000-0000000003c3";

async function dbUp(): Promise<boolean> {
  const client = new pg.Client({ connectionString: DB_URL, connectionTimeoutMillis: 2000 });
  try { await client.connect(); await client.end(); return true; } catch { return false; }
}
const available = await dbUp();

const dealerA = parseImportDefinition({
  key: "dealer-a-customers", format: "csv", version: 1, entity: "customer", sourceSystem: "dealer-a-crm",
  fields: {
    firstName: { from: "cust_fname", required: true, normalize: ["trim", "title_case"] },
    lastName: { from: "cust_lname", normalize: ["trim", "title_case"] },
    phone: { from: "cell", normalize: ["phone_e164", "empty_to_null"] },
    email: { from: "mail", normalize: ["trim", "lowercase", "empty_to_null"] },
    address: { from: "service_addr", normalize: ["trim"] },
  },
  externalId: { from: "cust_id", required: true, normalize: ["trim"] },
  identity: [{ fields: ["email"] }, { fields: ["phone"] }], updateMode: "source_owned",
});

const dealerB = parseImportDefinition({
  key: "dealer-b-customers", format: "csv", version: 1, entity: "customer", sourceSystem: "dealer-b-export",
  fields: {
    firstName: { from: "FIRST_NAME", required: true, normalize: ["trim", "title_case"] },
    lastName: { from: "SURNAME", normalize: ["trim", "title_case"] },
    phone: { from: "PHONE_NUMBER", normalize: ["phone_e164", "empty_to_null"] },
    email: { from: "EMAIL_ADDRESS", normalize: ["trim", "lowercase", "empty_to_null"] },
    address: { compose: { from: ["STREET", "CITY"], separator: ", " }, normalize: ["trim"] },
  },
  externalId: { from: "ACCOUNT_NO", required: true }, identity: [{ fields: ["email"] }, { fields: ["phone"] }],
});

function appointmentDefinition(sourceSystem = "dealer-a-crm") {
  return parseImportDefinition({
    key: "appointments", format: "csv", version: 1, entity: "appointment", sourceSystem,
    fields: { scheduledAt: { from: "starts", type: "date", required: true }, status: { from: "state", valueMap: { BOOKED: "confirmed" }, required: true }, notes: { from: "notes", normalize: ["trim"] } },
    externalId: { from: "appt_id", required: true },
    relationships: { householdId: { entity: "customer", sourceId: { from: "cust_id", required: true }, required: true } },
  });
}

describe.skipIf(!available).sequential("Phase 3 declarative client import", () => {
  beforeAll(async () => {
    process.env.DATABASE_URL = DB_URL;
    await migrate(DB_URL);
    for (const [id, name] of [[TENANT_A, "Import Dealer A"], [TENANT_B, "Import Dealer B"], [TENANT_C, "Import Dealer C"]] as const) {
      await withTenant(id, (db) => db.insert(tenants).values({ id, name }).onConflictDoNothing());
      await withTenant(id, async (db) => {
        await db.delete(importRows).where(eq(importRows.tenantId, id));
        await db.delete(importEntityRefs).where(eq(importEntityRefs.tenantId, id));
        await db.delete(importRuns).where(eq(importRuns.tenantId, id));
        await db.delete(payments).where(eq(payments.tenantId, id));
        await db.delete(workOrders).where(eq(workOrders.tenantId, id));
        await db.delete(proposals).where(eq(proposals.tenantId, id));
        await db.delete(quoteLineItems).where(eq(quoteLineItems.tenantId, id));
        await db.delete(quotes).where(eq(quotes.tenantId, id));
        await db.delete(invoices).where(eq(invoices.tenantId, id));
        await db.delete(appointments).where(eq(appointments.tenantId, id));
        await db.delete(serviceVisits).where(eq(serviceVisits.tenantId, id));
        await db.delete(equipment).where(eq(equipment.tenantId, id));
        await db.delete(leads).where(eq(leads.tenantId, id));
        await db.delete(contactMethods).where(eq(contactMethods.tenantId, id));
        await db.delete(contacts).where(eq(contacts.tenantId, id));
        await db.delete(households).where(eq(households.tenantId, id));
        await db.delete(inventoryItems).where(eq(inventoryItems.tenantId, id));
        await db.delete(technicians).where(eq(technicians.tenantId, id));
      });
    }
  });
  afterAll(() => closePool());

  it("maps two differently shaped dealer files into the same canonical customer model", async () => {
    const reportA = await runDeclarativeImport({ tenantId: TENANT_A, definition: dealerA, source: { name: "a.csv", content: "cust_id,cust_fname,cust_lname,cell,mail,service_addr\nA-1,ada,lovelace,3195550101,ADA@EXAMPLE.COM,1 River Rd\n" } });
    const reportB = await runDeclarativeImport({ tenantId: TENANT_B, definition: dealerB, source: { name: "b.csv", content: "ACCOUNT_NO,FIRST_NAME,SURNAME,PHONE_NUMBER,EMAIL_ADDRESS,STREET,CITY\nB-9,grace,hopper,3195550102,GRACE@EXAMPLE.COM,2 Lake St,Cedar Falls\n" } });
    expect(reportA.created).toBe(1);
    expect(reportB.created).toBe(1);
    const [contactA] = await withTenant(TENANT_A, (db) => db.select().from(contacts).where(eq(contacts.tenantId, TENANT_A)));
    const [contactB] = await withTenant(TENANT_B, (db) => db.select().from(contacts).where(eq(contacts.tenantId, TENANT_B)));
    expect(contactA).toMatchObject({ firstName: "Ada", lastName: "Lovelace" });
    expect(contactB).toMatchObject({ firstName: "Grace", lastName: "Hopper" });
  });

  it("replays without duplicates and performs deterministic source-owned updates", async () => {
    const replay = await runDeclarativeImport({ tenantId: TENANT_A, definition: dealerA, source: { name: "a.csv", content: "cust_id,cust_fname,cust_lname,cell,mail,service_addr\nA-1,Ada,Byron,3195550199,ada@example.com,1 River Rd\n" } });
    expect(replay.updated).toBe(1);
    const rows = await withTenant(TENANT_A, (db) => db.select().from(households).where(eq(households.tenantId, TENANT_A)));
    expect(rows).toHaveLength(1);
    const [contact] = await withTenant(TENANT_A, (db) => db.select().from(contacts).where(eq(contacts.tenantId, TENANT_A)));
    expect(contact!.lastName).toBe("Byron");
    const replayAgain = await runDeclarativeImport({ tenantId: TENANT_A, definition: dealerA, source: { name: "a.csv", content: "cust_id,cust_fname,cust_lname,cell,mail,service_addr\nA-1,Ada,Byron,3195550199,ada@example.com,1 River Rd\n" } });
    expect(replayAgain.created).toBe(0);
    expect(replayAgain.skipped).toBe(1);
    const sourceIdChanged = await runDeclarativeImport({ tenantId: TENANT_A, definition: dealerA, source: { name: "a.csv", content: "cust_id,cust_fname,cust_lname,cell,mail,service_addr\nA-RENAMED,Ada,Byron,3195550199,ada@example.com,1 River Rd\n" } });
    expect(sourceIdChanged.created).toBe(0);
    expect(await withTenant(TENANT_A, (db) => db.select().from(households).where(eq(households.tenantId, TENANT_A)))).toHaveLength(1);
  });

  it("dry-run mutates no business data and invalid rows quarantine with exact reasons", async () => {
    const before = await withTenant(TENANT_C, (db) => db.select().from(households).where(eq(households.tenantId, TENANT_C)));
    const dry = await runDeclarativeImport({ tenantId: TENANT_C, definition: dealerA, dryRun: true, source: { name: "dry.csv", content: "cust_id,cust_fname,cust_lname,cell,mail,service_addr\nC-1,Alan,Turing,3195550103,alan@example.com,3 Spring Rd\n" } });
    expect(dry.planned).toBe(1);
    expect(await withTenant(TENANT_C, (db) => db.select().from(households).where(eq(households.tenantId, TENANT_C)))).toHaveLength(before.length);
    const invalid = await runDeclarativeImport({ tenantId: TENANT_C, definition: dealerA, source: { name: "bad.csv", content: "cust_id,cust_fname,cust_lname,cell,mail,service_addr\nC-2,No,Contact,,,\n" } });
    expect(invalid.quarantined).toBe(1);
    const [quarantine] = await withTenant(TENANT_C, (db) => db.select().from(importRows).where(and(eq(importRows.runId, invalid.runId), eq(importRows.status, "quarantined"))));
    expect(quarantine!.reasons).toEqual(expect.arrayContaining([expect.objectContaining({ code: "contact_method_required", stage: "validation" })]));
  });

  it("resolves relationships tenant-locally and partial reruns recover after parents arrive", async () => {
    const definition = appointmentDefinition("dealer-c-crm");
    const source = { name: "appointments.csv", content: "appt_id,cust_id,starts,state,notes\nP-1,C-42,2026-09-01T15:00:00Z,BOOKED,annual service\n" };
    const missingParent = await runDeclarativeImport({ tenantId: TENANT_C, definition, source });
    expect(missingParent.quarantined).toBe(1);
    const customer = parseImportDefinition({ ...dealerA, key: "dealer-c-customers", sourceSystem: "dealer-c-crm" });
    await runDeclarativeImport({ tenantId: TENANT_C, definition: customer, source: { name: "customers.csv", content: "cust_id,cust_fname,cust_lname,cell,mail,service_addr\nC-42,Katherine,Johnson,3195550142,katherine@example.com,42 Orbit Ave\n" } });
    const recovered = await runDeclarativeImport({ tenantId: TENANT_C, definition, source });
    expect(recovered.created).toBe(1);
    const [appointment] = await withTenant(TENANT_C, (db) => db.select().from(appointments).where(eq(appointments.tenantId, TENANT_C)));
    const [household] = await withTenant(TENANT_C, (db) => db.select().from(households).where(eq(households.tenantId, TENANT_C)));
    expect(appointment!.subjectId).toBe(household!.id);

    const crossTenant = await runDeclarativeImport({ tenantId: TENANT_B, definition, source });
    expect(crossTenant.quarantined).toBe(1);
    expect(await withTenant(TENANT_B, (db) => db.select().from(appointments).where(eq(appointments.tenantId, TENANT_B)))).toHaveLength(0);
  });

  it("does not overwrite trusted canonical values after an exact identity match", async () => {
    const [trustedHousehold] = await withTenant(TENANT_C, (db) => db.insert(households).values({ tenantId: TENANT_C, address: "Trusted Address", contactInfo: { name: "Trusted Name", phone: "+1319550177" } }).returning());
    await withTenant(TENANT_C, (db) => db.insert(contacts).values({ tenantId: TENANT_C, householdId: trustedHousehold!.id, name: "Trusted Name", firstName: "Trusted", lastName: "Name", role: "primary" }));
    const unsafe = parseImportDefinition({ ...dealerA, key: "untrusted-match", sourceSystem: "new-untrusted-source", updateMode: "source_owned" });
    await runDeclarativeImport({ tenantId: TENANT_C, definition: unsafe, source: { name: "untrusted.csv", content: "cust_id,cust_fname,cust_lname,cell,mail,service_addr\nU-1,Overwrite,Attempt,3195550177,new@example.com,Untrusted Address\n" } });
    const [contact] = await withTenant(TENANT_C, (db) => db.select().from(contacts).where(eq(contacts.householdId, trustedHousehold!.id)));
    const [household] = await withTenant(TENANT_C, (db) => db.select().from(households).where(eq(households.id, trustedHousehold!.id)));
    expect(contact).toMatchObject({ name: "Trusted Name", firstName: "Trusted", lastName: "Name" });
    expect(household!.address).toBe("Trusted Address");
  });

  it("routes every declared operational domain through canonical writes", async () => {
    const sourceSystem = "dealer-c-crm";
    const run = async (key: string, entity: string, fields: Record<string, unknown>, row: Record<string, unknown>, relationships: Record<string, unknown> = {}) =>
      runDeclarativeImport({
        tenantId: TENANT_C,
        definition: parseImportDefinition({ key, format: "json", version: 1, entity, sourceSystem, fields, externalId: { from: "id", required: true }, relationships }),
        source: { name: `${key}.json`, content: JSON.stringify([row]) },
      });

    expect((await run("technicians-import", "technician", { name: { from: "name", required: true }, contactInfo: { from: "contact", type: "json" } }, { id: "T-1", name: "Alex Tech", contact: { phone: "+1319550150" } })).created).toBe(1);
    const householdRelationship = { householdId: { entity: "customer", sourceId: { from: "customerId", required: true } } };
    const householdAndTech = { ...householdRelationship, technicianId: { entity: "technician", sourceId: { from: "technicianId", required: true } } };
    expect((await run("equipment-import", "equipment", { type: { from: "type", required: true }, model: { from: "model" }, installDate: { from: "installed", type: "date" } }, { id: "E-1", customerId: "C-42", type: "softener", model: "S100", installed: "2024-01-01" }, householdRelationship)).created).toBe(1);
    expect((await run("service-import", "service_visit", { type: { from: "type", required: true }, scheduledAt: { from: "scheduled", type: "date" }, completedAt: { from: "completed", type: "date" }, notes: { from: "notes" } }, { id: "S-1", customerId: "C-42", technicianId: "T-1", type: "maintenance", scheduled: "2025-01-01", completed: "2025-01-01", notes: "completed" }, householdAndTech)).created).toBe(1);
    expect((await run("quotes-import", "quote", { status: { from: "status" }, lineItems: { from: "items", type: "json", required: true } }, { id: "Q-1", customerId: "C-42", status: "accepted", items: [{ sku: "SOFT-1", label: "Softener", quantity: 1, unitPriceUsd: 2200 }] }, householdRelationship)).created).toBe(1);
    expect((await run("proposals-import", "proposal", { status: { from: "status" }, content: { from: "content", type: "json", required: true }, sentAt: { from: "sent", type: "date" } }, { id: "PR-1", customerId: "C-42", quoteId: "Q-1", status: "sent", content: { summary: "Softener proposal" }, sent: "2026-08-01" }, { ...householdRelationship, quoteId: { entity: "quote", sourceId: { from: "quoteId", required: true } } })).created).toBe(1);
    expect((await run("work-orders-import", "work_order", { type: { from: "type", required: true }, status: { from: "status" }, scheduledAt: { from: "scheduled", type: "date" } }, { id: "W-1", customerId: "C-42", technicianId: "T-1", quoteId: "Q-1", type: "install", status: "scheduled", scheduled: "2026-09-03" }, { ...householdAndTech, quoteId: { entity: "quote", sourceId: { from: "quoteId", required: true } } })).created).toBe(1);
    expect((await run("invoices-import", "invoice", { amountUsd: { from: "amount", type: "number", required: true }, status: { from: "status" }, dueDate: { from: "due", type: "date" } }, { id: "I-1", customerId: "C-42", amount: "2200", status: "sent", due: "2026-10-01" }, householdRelationship)).created).toBe(1);
    expect((await run("payments-import", "payment", { amountUsd: { from: "amount", type: "number", required: true }, method: { from: "method" }, receivedAt: { from: "received", type: "date" } }, { id: "P-1", invoiceId: "I-1", amount: 2200, method: "check", received: "2026-09-10" }, { invoiceId: { entity: "invoice", sourceId: { from: "invoiceId", required: true } } })).created).toBe(1);
    expect((await run("inventory-import", "inventory_item", { sku: { from: "sku", required: true }, name: { from: "name", required: true }, quantity: { from: "quantity", type: "integer" }, reorderThreshold: { from: "threshold", type: "integer" } }, { id: "STOCK-1", sku: "FILTER-10", name: "10 inch filter", quantity: 20, threshold: 5 })).created).toBe(1);
    expect((await run("leads-import", "lead", { name: { from: "name", required: true }, phone: { from: "phone", normalize: ["phone_e164"] }, status: { from: "status" } }, { id: "L-1", name: "New Lead", phone: "3195550188", status: "qualified" })).created).toBe(1);

    expect(await withTenant(TENANT_C, (db) => db.select().from(equipment).where(eq(equipment.tenantId, TENANT_C)))).toHaveLength(1);
    expect(await withTenant(TENANT_C, (db) => db.select().from(serviceVisits).where(eq(serviceVisits.tenantId, TENANT_C)))).toHaveLength(1);
    expect(await withTenant(TENANT_C, (db) => db.select().from(workOrders).where(eq(workOrders.tenantId, TENANT_C)))).toHaveLength(1);
    expect(await withTenant(TENANT_C, (db) => db.select().from(quotes).where(eq(quotes.tenantId, TENANT_C)))).toHaveLength(1);
    expect(await withTenant(TENANT_C, (db) => db.select().from(payments).where(eq(payments.tenantId, TENANT_C)))).toHaveLength(1);
    expect(await withTenant(TENANT_C, (db) => db.select().from(inventoryItems).where(eq(inventoryItems.tenantId, TENANT_C)))).toHaveLength(1);
  });
});
