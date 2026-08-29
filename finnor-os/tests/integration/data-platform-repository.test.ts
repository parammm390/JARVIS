// Repository-layer acceptance: every @finnor/data-platform function against a real
// Postgres — idempotent upserts stay idempotent, and every write records exactly one
// business_events row (the mechanism that makes business_events a trustworthy timeline).

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import pg from "pg";
import { randomUUID } from "node:crypto";
import { migrate } from "../../packages/db/migrate";
import {
  withTenant,
  closePool,
  tenants,
  businessEvents,
  invoices,
  households,
  leads,
  opportunities,
  tasks,
  appointments,
  workOrders,
  priceBookItems,
  quoteLineItems,
  quotes,
  payments,
  messages,
  calls,
  conversations,
  contactMethods,
  contacts,
  documents,
} from "@finnor/db";
import { eq, and, sql } from "drizzle-orm";
import {
  createLead,
  convertLeadToOpportunity,
  updateLeadStatus,
  createTask,
  createAppointment,
  updateAppointmentStatus,
  createWorkOrder,
  upsertPriceBookItem,
  createQuote,
  recordPayment,
  persistCall,
  persistMessage,
  createDocument,
  createContact,
  addContactMethod,
} from "@finnor/data-platform";

const DB_URL = process.env.DATABASE_URL ?? "postgres://finnor:finnor@localhost:5432/finnor";
const TENANT_ID = "00000000-0000-4000-8000-0000000000ab";

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

async function eventCountFor(entityType: string, entityId: string): Promise<number> {
  const rows = await withTenant(TENANT_ID, (db) =>
    db
      .select()
      .from(businessEvents)
      .where(and(eq(businessEvents.tenantId, TENANT_ID), eq(businessEvents.entityType, entityType), eq(businessEvents.entityId, entityId))),
  );
  return rows.length;
}

describe.skipIf(!available)("@finnor/data-platform repository layer", () => {
  beforeAll(async () => {
    process.env.DATABASE_URL = DB_URL;
    await migrate(DB_URL);
    await withTenant(TENANT_ID, (db) =>
      db.insert(tenants).values({ id: TENANT_ID, name: "Repository Test Dealer" }).onConflictDoNothing(),
    );
    // Clean slate: a prior run of this file (or the full suite re-running it) must not
    // make the idempotency assertions below see stale rows and report false negatives —
    // children before parents to respect FKs.
    await withTenant(TENANT_ID, async (db) => {
      // business_events is append-only in real use (migration 0015) — this test-only
      // fixture reset opts in via a transaction-local GUC no application code ever sets.
      await db.execute(sql`SELECT set_config('app.allow_audit_mutation', 'true', true)`);
      await db.delete(businessEvents).where(eq(businessEvents.tenantId, TENANT_ID));
      await db.delete(messages).where(eq(messages.tenantId, TENANT_ID));
      await db.delete(calls).where(eq(calls.tenantId, TENANT_ID));
      await db.delete(conversations).where(eq(conversations.tenantId, TENANT_ID));
      await db.delete(quoteLineItems).where(eq(quoteLineItems.tenantId, TENANT_ID));
      await db.delete(quotes).where(eq(quotes.tenantId, TENANT_ID));
      await db.delete(payments).where(eq(payments.tenantId, TENANT_ID));
      await db.delete(invoices).where(eq(invoices.tenantId, TENANT_ID));
      await db.delete(workOrders).where(eq(workOrders.tenantId, TENANT_ID));
      await db.delete(tasks).where(eq(tasks.tenantId, TENANT_ID));
      await db.delete(appointments).where(eq(appointments.tenantId, TENANT_ID));
      await db.delete(opportunities).where(eq(opportunities.tenantId, TENANT_ID));
      await db.delete(leads).where(eq(leads.tenantId, TENANT_ID));
      await db.delete(contactMethods).where(eq(contactMethods.tenantId, TENANT_ID));
      await db.delete(contacts).where(eq(contacts.tenantId, TENANT_ID));
      await db.delete(documents).where(eq(documents.tenantId, TENANT_ID));
      await db.delete(priceBookItems).where(eq(priceBookItems.tenantId, TENANT_ID));
      await db.delete(households).where(eq(households.tenantId, TENANT_ID));
    });
  });
  afterAll(async () => {
    await closePool();
  });

  it("createLead is idempotent by provenance and records one business event", async () => {
    const first = await withTenant(TENANT_ID, (db) =>
      createLead(db, { tenantId: TENANT_ID, name: "Repo Test Lead", phone: "+13195558801", provenance: { sourceSystem: "test", externalId: "repo-lead-1" } }),
    );
    expect(first.alreadyExisted).toBe(false);
    const second = await withTenant(TENANT_ID, (db) =>
      createLead(db, { tenantId: TENANT_ID, name: "Repo Test Lead", phone: "+13195558801", provenance: { sourceSystem: "test", externalId: "repo-lead-1" } }),
    );
    expect(second.alreadyExisted).toBe(true);
    expect(second.leadId).toBe(first.leadId);
    expect(second.householdId).toBe(first.householdId);
    const [household] = await withTenant(TENANT_ID, (db) => db
      .select({ address: households.address })
      .from(households)
      .where(eq(households.id, first.householdId)));
    expect(household?.address).toBe("(address pending — lead intake)");
    expect(await eventCountFor("lead", first.leadId)).toBe(1);
  });

  it("convertLeadToOpportunity creates then updates the same opportunity, never a duplicate", async () => {
    const lead = await withTenant(TENANT_ID, (db) =>
      createLead(db, { tenantId: TENANT_ID, name: "Opportunity Test Lead", phone: "+13195558802" }),
    );
    const first = await withTenant(TENANT_ID, (db) =>
      convertLeadToOpportunity(db, { tenantId: TENANT_ID, householdId: lead.householdId, status: "quote_sent" }),
    );
    expect(first.opportunityId).toBeTruthy();
    const second = await withTenant(TENANT_ID, (db) =>
      convertLeadToOpportunity(db, { tenantId: TENANT_ID, householdId: lead.householdId, status: "installed" }),
    );
    expect(second.opportunityId).toBe(first.opportunityId);
    const noop = await withTenant(TENANT_ID, (db) =>
      convertLeadToOpportunity(db, { tenantId: TENANT_ID, householdId: lead.householdId, status: "lead" }),
    );
    expect(noop.opportunityId).toBeNull();
  });

  it("updates authoritative lead status idempotently through the tenant-safe boundary", async () => {
    const lead = await withTenant(TENANT_ID, (db) =>
      createLead(db, { tenantId: TENANT_ID, name: "Status Test Lead", phone: "+13195558803" }),
    );
    const first = await withTenant(TENANT_ID, (db) =>
      updateLeadStatus(db, { tenantId: TENANT_ID, leadId: lead.leadId, status: "qualified", source: "test" }),
    );
    expect(first).toMatchObject({ previousStatus: "new", status: "qualified", changed: true });
    const replay = await withTenant(TENANT_ID, (db) =>
      updateLeadStatus(db, { tenantId: TENANT_ID, leadId: lead.leadId, status: "qualified", source: "test" }),
    );
    expect(replay).toMatchObject({ status: "qualified", changed: false });
    expect(await eventCountFor("lead", lead.leadId)).toBe(2); // lead_created + one status change
  });

  it("records at most one status event when identical lead updates race", async () => {
    const lead = await withTenant(TENANT_ID, (db) => createLead(db, {
      tenantId: TENANT_ID,
      name: "Concurrent Status Lead",
      phone: `+1319${randomUUID().replace(/\D/g, "").slice(0, 7)}`,
    }));
    const results = await Promise.all([
      withTenant(TENANT_ID, (db) => updateLeadStatus(db, { tenantId: TENANT_ID, leadId: lead.leadId, status: "qualified", source: "race-test" })),
      withTenant(TENANT_ID, (db) => updateLeadStatus(db, { tenantId: TENANT_ID, leadId: lead.leadId, status: "qualified", source: "race-test" })),
    ]);
    expect(results.filter((result) => result?.changed)).toHaveLength(1);
    expect(results.filter((result) => result && !result.changed)).toHaveLength(1);
    expect(await eventCountFor("lead", lead.leadId)).toBe(2);
  });

  it("createTask and createAppointment each record their entity + one business event", async () => {
    const task = await withTenant(TENANT_ID, (db) =>
      createTask(db, { tenantId: TENANT_ID, subjectType: "test_subject", subjectId: TENANT_ID, title: "Follow up" }),
    );
    expect(await eventCountFor("task", task.taskId)).toBe(1);

    const appt = await withTenant(TENANT_ID, (db) =>
      createAppointment(db, { tenantId: TENANT_ID, subjectType: "test_subject", subjectId: TENANT_ID, scheduledAt: new Date() }),
    );
    expect(await eventCountFor("appointment", appt.appointmentId)).toBe(1);
  });

  it("does not emit a status event when the appointment belongs to no current row", async () => {
    const missingId = randomUUID();
    await expect(withTenant(TENANT_ID, (db) => updateAppointmentStatus(db, {
      tenantId: TENANT_ID,
      appointmentId: missingId,
      status: "confirmed",
    }))).resolves.toBe(false);
    expect(await eventCountFor("appointment", missingId)).toBe(0);
  });

  it("createWorkOrder records the entity + one business event", async () => {
    const [hh] = await withTenant(TENANT_ID, (db) =>
      db.insert(households).values({ tenantId: TENANT_ID, address: "1 Repo Test Ln", contactInfo: {} }).returning(),
    );
    const wo = await withTenant(TENANT_ID, (db) => createWorkOrder(db, { tenantId: TENANT_ID, householdId: hh!.id, type: "install" }));
    expect(await eventCountFor("work_order", wo.workOrderId)).toBe(1);
  });

  it("upsertPriceBookItem is idempotent by (tenant, sku) — re-upsert updates, never duplicates", async () => {
    const first = await withTenant(TENANT_ID, (db) =>
      upsertPriceBookItem(db, { tenantId: TENANT_ID, sku: "REPO-TEST-SKU", label: "Repo Test Item", priceUsd: 100 }),
    );
    const second = await withTenant(TENANT_ID, (db) =>
      upsertPriceBookItem(db, { tenantId: TENANT_ID, sku: "REPO-TEST-SKU", label: "Repo Test Item Updated", priceUsd: 150 }),
    );
    expect(second.itemId).toBe(first.itemId);
  });

  it("createQuote computes the total and records one business event", async () => {
    const quote = await withTenant(TENANT_ID, (db) =>
      createQuote(db, { tenantId: TENANT_ID, lineItems: [{ label: "Item A", unitPriceUsd: 50, quantity: 2 }, { label: "Item B", unitPriceUsd: 25 }] }),
    );
    expect(quote.totalUsd).toBe(125);
    expect(await eventCountFor("quote", quote.quoteId)).toBe(1);
  });

  it("recordPayment inserts a payment, marks the invoice paid, and records one business event", async () => {
    const [hh] = await withTenant(TENANT_ID, (db) =>
      db.insert(households).values({ tenantId: TENANT_ID, address: "2 Repo Test Ln", contactInfo: {} }).returning(),
    );
    const [inv] = await withTenant(TENANT_ID, (db) =>
      db.insert(invoices).values({ tenantId: TENANT_ID, householdId: hh!.id, amountUsd: "75.00", status: "sent" }).returning(),
    );
    const payment = await withTenant(TENANT_ID, (db) => recordPayment(db, { tenantId: TENANT_ID, invoiceId: inv!.id, amountUsd: 75 }));
    expect(await eventCountFor("payment", payment.paymentId)).toBe(1);
    const [updated] = await withTenant(TENANT_ID, (db) => db.select().from(invoices).where(eq(invoices.id, inv!.id)));
    expect(updated!.status).toBe("paid");
  });

  it("keeps a partially paid invoice open until cumulative succeeded payments settle it", async () => {
    const [hh] = await withTenant(TENANT_ID, (db) =>
      db.insert(households).values({ tenantId: TENANT_ID, address: "3 Partial Payment Ln", contactInfo: {} }).returning(),
    );
    const [inv] = await withTenant(TENANT_ID, (db) =>
      db.insert(invoices).values({ tenantId: TENANT_ID, householdId: hh!.id, amountUsd: "1000.00", status: "sent" }).returning(),
    );
    const partial = await withTenant(TENANT_ID, (db) => recordPayment(db, { tenantId: TENANT_ID, invoiceId: inv!.id, amountUsd: 1 }));
    expect(partial).toMatchObject({ amountPaidUsd: 1, balanceUsd: 999, settled: false });
    expect((await withTenant(TENANT_ID, (db) => db.select({ status: invoices.status }).from(invoices).where(eq(invoices.id, inv!.id))))[0]!.status).toBe("sent");

    const settled = await withTenant(TENANT_ID, (db) => recordPayment(db, { tenantId: TENANT_ID, invoiceId: inv!.id, amountUsd: 999 }));
    expect(settled).toMatchObject({ amountPaidUsd: 1000, balanceUsd: 0, settled: true });
    expect((await withTenant(TENANT_ID, (db) => db.select({ status: invoices.status }).from(invoices).where(eq(invoices.id, inv!.id))))[0]!.status).toBe("paid");
  });

  it("persistCall is idempotent by (tenant, source, external id) and links to a conversation", async () => {
    const runId = randomUUID();
    const first = await withTenant(TENANT_ID, (db) =>
      persistCall(db, { tenantId: TENANT_ID, provenance: { sourceSystem: "test", externalId: `repo-call-1-${runId}` }, direction: "inbound", transcript: "hello" }),
    );
    expect(first.alreadyExisted).toBe(false);
    const second = await withTenant(TENANT_ID, (db) =>
      persistCall(db, { tenantId: TENANT_ID, provenance: { sourceSystem: "test", externalId: `repo-call-1-${runId}` }, direction: "inbound", transcript: "hello again" }),
    );
    expect(second.alreadyExisted).toBe(true);
    expect(second.callId).toBe(first.callId);
    expect(second.conversationId).toBe(first.conversationId);

    const msg = await withTenant(TENANT_ID, (db) =>
      persistMessage(db, { tenantId: TENANT_ID, conversationId: first.conversationId, direction: "outbound", channel: "sms", content: "confirmed" }),
    );
    expect(await eventCountFor("message", msg.messageId)).toBe(1);
  });

  it("persistMessage never moves conversation activity backwards for delayed provider events", async () => {
    const runId = randomUUID();
    const call = await withTenant(TENANT_ID, (db) =>
      persistCall(db, { tenantId: TENANT_ID, provenance: { sourceSystem: "test", externalId: `repo-call-monotonic-activity-${runId}` }, direction: "inbound" }),
    );
    const newest = new Date("2099-01-02T12:00:00.000Z");
    const delayed = new Date("2099-01-01T12:00:00.000Z");
    await withTenant(TENANT_ID, (db) => persistMessage(db, {
      tenantId: TENANT_ID,
      conversationId: call.conversationId,
      direction: "inbound",
      channel: "sms",
      content: "newest provider event",
      sentAt: newest,
      provenance: { sourceSystem: "provider-monotonic", externalId: `newest-${runId}` },
    }));
    const afterNewest = (await withTenant(TENANT_ID, (db) => db
      .select({ lastActivityAt: conversations.lastActivityAt })
      .from(conversations)
      .where(eq(conversations.id, call.conversationId))))[0]!.lastActivityAt;
    await withTenant(TENANT_ID, (db) => persistMessage(db, {
      tenantId: TENANT_ID,
      conversationId: call.conversationId,
      direction: "inbound",
      channel: "sms",
      content: "delayed provider event",
      sentAt: delayed,
      provenance: { sourceSystem: "provider-monotonic", externalId: `delayed-${runId}` },
    }));
    const afterDelayed = (await withTenant(TENANT_ID, (db) => db
      .select({ lastActivityAt: conversations.lastActivityAt })
      .from(conversations)
      .where(eq(conversations.id, call.conversationId))))[0]!.lastActivityAt;
    expect(afterNewest?.toISOString()).toBe(newest.toISOString());
    expect(afterDelayed?.toISOString()).toBe(newest.toISOString());
  });

  it("atomically claims message provenance under concurrent retries", async () => {
    const runId = randomUUID();
    const call = await withTenant(TENANT_ID, (db) =>
      persistCall(db, { tenantId: TENANT_ID, provenance: { sourceSystem: "test", externalId: `repo-call-message-race-${runId}` }, direction: "inbound" }),
    );
    const results = await Promise.all(Array.from({ length: 6 }, () => withTenant(TENANT_ID, (db) =>
      persistMessage(db, {
        tenantId: TENANT_ID,
        conversationId: call.conversationId,
        direction: "outbound",
        channel: "sms",
        content: "one canonical fact",
        provenance: { sourceSystem: "provider-retry-test", externalId: `same-provider-message-${runId}` },
      }),
    )));
    expect(new Set(results.map((result) => result.messageId)).size).toBe(1);
    expect(results.filter((result) => !result.alreadyExisted)).toHaveLength(1);
    expect(await eventCountFor("message", results[0]!.messageId)).toBe(1);
  });

  it("createContact + addContactMethod is idempotent by (contact, method type, value)", async () => {
    const contact = await withTenant(TENANT_ID, (db) => createContact(db, { tenantId: TENANT_ID, name: "Repo Test Contact" }));
    const first = await withTenant(TENANT_ID, (db) =>
      addContactMethod(db, { tenantId: TENANT_ID, contactId: contact.contactId, methodType: "phone", value: "+13195558899" }),
    );
    const second = await withTenant(TENANT_ID, (db) =>
      addContactMethod(db, { tenantId: TENANT_ID, contactId: contact.contactId, methodType: "phone", value: "+13195558899" }),
    );
    expect(second.contactMethodId).toBe(first.contactMethodId);
  });

  it("createDocument records the entity + one business event", async () => {
    const doc = await withTenant(TENANT_ID, (db) => createDocument(db, { tenantId: TENANT_ID, kind: "test_doc", title: "Repo Test Document" }));
    expect(await eventCountFor("document", doc.documentId)).toBe(1);
  });
});
