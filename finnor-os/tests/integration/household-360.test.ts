// Household 360 acceptance (Phase 11, docs/jarvis-99-phase-10-16-execution-plan.md's
// PHASE 11 section): real Postgres, real traversal across both table generations —
// proves the two-stage appointment hop (household -> work_order -> appointment),
// the business_events timeline union, cross-household isolation, and the route's
// query-param contract. Dedicated tenant ...fc, FK-ordered cleanup in afterAll.

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { eq, inArray } from "drizzle-orm";
import pg from "pg";
import { migrate } from "../../packages/db/migrate";
import {
  getPool,
  closePool,
  withTenant,
  households,
  contacts,
  contactMethods,
  leads,
  opportunities,
  quotes,
  invoices,
  payments,
  workOrders,
  appointments,
  conversations,
  messages,
  documents,
  businessEvents,
} from "@finnor/db";
import { household360 } from "@finnor/read-models";
import { GET } from "../../apps/api/app/api/read-models/[view]/route";

const DB_URL = process.env.DATABASE_URL ?? "postgres://finnor:finnor@localhost:5432/finnor";
const TENANT_ID = "00000000-0000-4000-8000-0000000000fc";

async function dbUp(): Promise<boolean> {
  const c = new pg.Client({ connectionString: DB_URL, connectionTimeoutMillis: 2000 });
  try {
    await c.connect();
    await c.end();
    return true;
  } catch {
    return false;
  }
}
const available = await dbUp();

function req(qs = ""): Request {
  return new Request(`http://localhost/api/read-models/household-360${qs}`, {
    headers: { "x-tenant-id": TENANT_ID, "x-user-role": "owner" },
  });
}

describe.skipIf(!available)("household360 (Phase 11)", () => {
  let householdId: string;
  let decoyHouseholdId: string;
  let leadId: string;
  let opportunityId: string;
  let quoteId: string;
  let invoiceId: string;
  let workOrderId: string;
  let appointmentId: string;
  let conversationId: string;
  let contactIds: string[] = [];
  let documentId: string;
  let decoyLeadId: string;

  beforeAll(async () => {
    process.env.DATABASE_URL = DB_URL;
    process.env.AUTH_DEV_BYPASS = "1";
    await migrate(DB_URL);
    await getPool().query(`INSERT INTO tenants (id, name) VALUES ($1, 'Household 360 Test Tenant') ON CONFLICT (id) DO NOTHING`, [TENANT_ID]);

    await withTenant(TENANT_ID, async (db) => {
      const [household] = await db.insert(households).values({ tenantId: TENANT_ID, address: "1 Traversal Ave", marketingConsent: true }).returning();
      householdId = household!.id;
      const [decoy] = await db.insert(households).values({ tenantId: TENANT_ID, address: "2 Decoy Ave" }).returning();
      decoyHouseholdId = decoy!.id;

      // 2 contacts, 3 methods total.
      const [contact1] = await db.insert(contacts).values({ tenantId: TENANT_ID, householdId, name: "Pat Owner", role: "primary" }).returning();
      const [contact2] = await db.insert(contacts).values({ tenantId: TENANT_ID, householdId, name: "Sam Spouse", role: "spouse" }).returning();
      contactIds = [contact1!.id, contact2!.id];
      await db.insert(contactMethods).values([
        { tenantId: TENANT_ID, contactId: contact1!.id, methodType: "phone", value: "+15551110001", consent: true },
        { tenantId: TENANT_ID, contactId: contact1!.id, methodType: "email", value: "pat@example.com", consent: true },
        { tenantId: TENANT_ID, contactId: contact2!.id, methodType: "phone", value: "+15551110002", consent: false },
      ]);

      const [lead] = await db.insert(leads).values({ tenantId: TENANT_ID, householdId, name: "Pat Owner", status: "qualified", source: "voice" }).returning();
      leadId = lead!.id;

      const [opportunity] = await db.insert(opportunities).values({ tenantId: TENANT_ID, householdId, leadId, pipelineStage: "quote_sent", expectedValueUsd: "2500" }).returning();
      opportunityId = opportunity!.id;

      const [quote] = await db.insert(quotes).values({ tenantId: TENANT_ID, householdId, leadId, status: "sent", totalUsd: "2500" }).returning();
      quoteId = quote!.id;

      const [invoice] = await db.insert(invoices).values({ tenantId: TENANT_ID, householdId, amountUsd: "2500", status: "sent" }).returning();
      invoiceId = invoice!.id;
      await db.insert(payments).values({ tenantId: TENANT_ID, invoiceId, amountUsd: "500", method: "card", status: "succeeded" });

      const [workOrder] = await db.insert(workOrders).values({ tenantId: TENANT_ID, householdId, quoteId, type: "install", status: "scheduled" }).returning();
      workOrderId = workOrder!.id;

      // Appointment hangs off the WORK ORDER, not the household directly — proves the
      // two-stage traversal (household -> work_orders -> appointments).
      const [appointment] = await db
        .insert(appointments)
        .values({ tenantId: TENANT_ID, subjectType: "work_order", subjectId: workOrderId, status: "confirmed", scheduledAt: new Date() })
        .returning();
      appointmentId = appointment!.id;

      const [conversation] = await db.insert(conversations).values({ tenantId: TENANT_ID, householdId, contactId: contact1!.id, channel: "voice", status: "closed" }).returning();
      conversationId = conversation!.id;
      await db.insert(messages).values([
        { tenantId: TENANT_ID, conversationId, direction: "inbound", channel: "voice", content: "Hi, need service." },
        { tenantId: TENANT_ID, conversationId, direction: "outbound", channel: "voice", content: "Happy to help." },
      ]);

      const [document] = await db.insert(documents).values({ tenantId: TENANT_ID, householdId, kind: "proposal_pdf", title: "Proposal #1" }).returning();
      documentId = document!.id;

      const base = Date.now();
      await db.insert(businessEvents).values([
        { tenantId: TENANT_ID, entityType: "household", entityId: householdId, eventType: "household_created", occurredAt: new Date(base - 7000) },
        { tenantId: TENANT_ID, entityType: "lead", entityId: leadId, eventType: "lead_qualified", occurredAt: new Date(base - 6000) },
        { tenantId: TENANT_ID, entityType: "opportunity", entityId: opportunityId, eventType: "opportunity_advanced", occurredAt: new Date(base - 5000) },
        { tenantId: TENANT_ID, entityType: "quote", entityId: quoteId, eventType: "quote_sent", occurredAt: new Date(base - 4000) },
        { tenantId: TENANT_ID, entityType: "invoice", entityId: invoiceId, eventType: "invoice_sent", occurredAt: new Date(base - 3000) },
        { tenantId: TENANT_ID, entityType: "work_order", entityId: workOrderId, eventType: "work_order_scheduled", occurredAt: new Date(base - 2000) },
        { tenantId: TENANT_ID, entityType: "appointment", entityId: appointmentId, eventType: "appointment_confirmed", occurredAt: new Date(base - 1000) },
        { tenantId: TENANT_ID, entityType: "contact", entityId: contact1!.id, eventType: "contact_created", occurredAt: new Date(base - 8000) },
      ]);

      // Decoy household's own rows — must never appear in the main household's traversal.
      const [decoyLead] = await db.insert(leads).values({ tenantId: TENANT_ID, householdId: decoyHouseholdId, name: "Decoy Lead", status: "new" }).returning();
      decoyLeadId = decoyLead!.id;
      await db.insert(businessEvents).values({ tenantId: TENANT_ID, entityType: "household", entityId: decoyHouseholdId, eventType: "household_created" });
    });
  });

  afterAll(async () => {
    // FK-ordered cleanup: children before parents.
    await withTenant(TENANT_ID, async (db) => {
      await db.delete(messages).where(eq(messages.conversationId, conversationId));
      await db.delete(conversations).where(eq(conversations.id, conversationId));
      await db.delete(payments).where(eq(payments.invoiceId, invoiceId));
      await db.delete(appointments).where(eq(appointments.id, appointmentId));
      await db.delete(workOrders).where(eq(workOrders.id, workOrderId));
      await db.delete(invoices).where(eq(invoices.id, invoiceId));
      await db.delete(quotes).where(eq(quotes.id, quoteId));
      await db.delete(opportunities).where(eq(opportunities.id, opportunityId));
      await db.delete(leads).where(inArray(leads.id, [leadId, decoyLeadId]));
      await db.delete(documents).where(eq(documents.id, documentId));
      await db.delete(contactMethods).where(inArray(contactMethods.contactId, contactIds));
      await db.delete(contacts).where(inArray(contacts.id, contactIds));
      await db.delete(businessEvents).where(eq(businessEvents.tenantId, TENANT_ID));
      await db.delete(households).where(inArray(households.id, [householdId, decoyHouseholdId]));
    });
    await closePool();
  });

  it("1. traverses every array with the seeded fixture's real contents", async () => {
    const result = await household360(TENANT_ID, householdId);
    expect(result).not.toBeNull();
    const r = result!;

    expect(r.household.address).toBe("1 Traversal Ave");
    expect(r.household.marketingConsent).toBe(true);

    expect(r.contacts).toHaveLength(2);
    const pat = r.contacts.find((c) => c.name === "Pat Owner");
    expect(pat!.methods).toHaveLength(2);
    const sam = r.contacts.find((c) => c.name === "Sam Spouse");
    expect(sam!.methods).toHaveLength(1);
    expect(sam!.methods[0]!.consent).toBe(false);

    expect(r.leads).toHaveLength(1);
    expect(r.leads[0]!.status).toBe("qualified");

    expect(r.opportunities).toHaveLength(1);
    expect(r.opportunities[0]!.expectedValueUsd).toBe(2500);

    expect(r.quotes).toHaveLength(1);
    expect(r.quotes[0]!.totalUsd).toBe(2500);

    expect(r.invoices).toHaveLength(1);
    expect(r.invoices[0]!.amountUsd).toBe(2500);
    expect(r.invoices[0]!.payments).toHaveLength(1);
    expect(r.invoices[0]!.payments[0]!.amountUsd).toBe(500);

    expect(r.workOrders).toHaveLength(1);
    expect(r.workOrders[0]!.status).toBe("scheduled");

    expect(r.conversations).toHaveLength(1);
    expect(r.conversations[0]!.messageCount).toBe(2);

    expect(r.documents).toHaveLength(1);
    expect(r.documents[0]!.title).toBe("Proposal #1");

    expect(typeof r.queryMs).toBe("number");
    expect(r.queryMs).toBeGreaterThanOrEqual(0);
  });

  it("2. finds the appointment via the work-order hop (two-stage traversal)", async () => {
    const result = await household360(TENANT_ID, householdId);
    expect(result!.appointments).toHaveLength(1);
    expect(result!.appointments[0]!.id).toBe(appointmentId);
    expect(result!.appointments[0]!.subjectType).toBe("work_order");
  });

  it("3. timeline merges all entity-type batches, newest first, capped correctly", async () => {
    const result = await household360(TENANT_ID, householdId);
    const eventTypes = result!.timeline.map((e) => e.eventType);
    expect(eventTypes).toEqual([
      "appointment_confirmed",
      "work_order_scheduled",
      "invoice_sent",
      "quote_sent",
      "opportunity_advanced",
      "lead_qualified",
      "household_created",
      "contact_created",
    ]);
  });

  it("4. a second household's rows never leak into the traversal", async () => {
    const result = await household360(TENANT_ID, householdId);
    const allIds = [
      ...result!.leads.map((l) => l.id),
      ...result!.timeline.map((e) => e.entityId),
    ];
    expect(allIds).not.toContain(decoyLeadId);
    expect(allIds).not.toContain(decoyHouseholdId);

    const decoyResult = await household360(TENANT_ID, decoyHouseholdId);
    expect(decoyResult!.leads).toHaveLength(1);
    expect(decoyResult!.leads[0]!.id).toBe(decoyLeadId);
    expect(decoyResult!.quotes).toHaveLength(0);
    expect(decoyResult!.contacts).toHaveLength(0);
  });

  it("5. unknown household id returns null", async () => {
    const result = await household360(TENANT_ID, "00000000-0000-4000-8000-00000000dead");
    expect(result).toBeNull();
  });

  it("6. GET /api/read-models/household-360 requires householdId (400 without it)", async () => {
    const res = await GET(req(""), { params: { view: "household-360" } });
    expect(res.status).toBe(400);
  });

  it("7. GET /api/read-models/household-360 returns the traversal for a valid householdId", async () => {
    const res = await GET(req(`?householdId=${householdId}`), { params: { view: "household-360" } });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { data: { household: { address: string } } };
    expect(body.data.household.address).toBe("1 Traversal Ave");
  });

  it("8. GET returns 404 for a household id that doesn't exist", async () => {
    const res = await GET(req(`?householdId=00000000-0000-4000-8000-00000000dead`), { params: { view: "household-360" } });
    expect(res.status).toBe(404);
  });
});
