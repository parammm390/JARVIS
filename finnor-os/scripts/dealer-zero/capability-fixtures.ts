// Minimal evolving fixtures that make standalone founder commands concrete. This is
// not the static reconciler: it only creates missing facts through canonical data-
// platform boundaries and never resets a status, balance, message or stock quantity.

import {
  documents,
  invoices,
  proposals,
  quotes,
  serviceVisits,
  tasks,
  withTenant,
} from "@finnor/db";
import {
  createDocument,
  createInvoice,
  createProposal,
  createQuote,
  createServiceVisit,
  createTask,
  setQuoteStatus,
} from "@finnor/data-platform";
import { and, eq, sql } from "drizzle-orm";
import { DEALER_ZERO_TENANT_ID } from "@finnor/shared-types";

const SOURCE = "dealer_zero_capability_fixture";
const QUOTE_KEY = "accepted-install-quote";
const PROPOSAL_KEY = "signature-proposal";
const INVOICE_MEMO = "Dealer Zero capability fixture — overdue annual service";
const DOCUMENT_KEY = "shareable-service-report";
const TASK_TITLE = "Dealer Zero capability fixture — confirm next service date";

export interface DealerZeroCapabilityFixtureResult {
  quoteId: string;
  proposalId: string;
  invoiceId: string;
  documentId: string;
  taskId: string;
  visitId: string;
}

export async function ensureDealerZeroCapabilityFixtures(
  householdId: string,
  technicianId: string,
): Promise<DealerZeroCapabilityFixtureResult> {
  return withTenant(DEALER_ZERO_TENANT_ID, async (db) => {
    await db.execute(sql`select pg_advisory_xact_lock(hashtextextended(${`${SOURCE}:${DEALER_ZERO_TENANT_ID}`}, 0))`);

    let [quote] = await db.select().from(quotes).where(and(
      eq(quotes.tenantId, DEALER_ZERO_TENANT_ID), eq(quotes.sourceSystem, SOURCE), eq(quotes.externalId, QUOTE_KEY),
    )).limit(1);
    if (!quote) {
      const created = await createQuote(db, {
        tenantId: DEALER_ZERO_TENANT_ID,
        householdId,
        lineItems: [{ sku: "FILT-WH-CARB", label: "Whole-House Carbon Filtration System", unitPriceUsd: 649 }],
        validUntil: new Date(Date.now() + 365 * 86_400_000),
        provenance: { sourceSystem: SOURCE, externalId: QUOTE_KEY },
      });
      await setQuoteStatus(db, { tenantId: DEALER_ZERO_TENANT_ID, quoteId: created.quoteId, status: "accepted", eventPayload: { fixture: true } });
      [quote] = await db.select().from(quotes).where(eq(quotes.id, created.quoteId)).limit(1);
    }

    let [proposal] = await db.select().from(proposals).where(and(
      eq(proposals.tenantId, DEALER_ZERO_TENANT_ID),
      sql`${proposals.content}->>'dealerZeroFixture' = ${PROPOSAL_KEY}`,
    )).limit(1);
    if (!proposal) proposal = await createProposal(db, {
      tenantId: DEALER_ZERO_TENANT_ID,
      householdId,
      quoteId: quote!.id,
      content: { dealerZeroFixture: PROPOSAL_KEY, title: "Whole-house filtration proposal", totalUsd: 649 },
      eventPayload: { fixture: true },
    });

    let [invoice] = await db.select().from(invoices).where(and(
      eq(invoices.tenantId, DEALER_ZERO_TENANT_ID), eq(invoices.memo, INVOICE_MEMO),
    )).limit(1);
    if (!invoice) invoice = await createInvoice(db, {
      tenantId: DEALER_ZERO_TENANT_ID,
      householdId,
      amountUsd: 249,
      status: "overdue",
      memo: INVOICE_MEMO,
      dueDate: new Date(Date.now() - 30 * 86_400_000),
      eventPayload: { fixture: true },
    });

    let [document] = await db.select().from(documents).where(and(
      eq(documents.tenantId, DEALER_ZERO_TENANT_ID), eq(documents.sourceSystem, SOURCE), eq(documents.externalId, DOCUMENT_KEY),
    )).limit(1);
    if (!document) {
      const created = await createDocument(db, {
        tenantId: DEALER_ZERO_TENANT_ID,
        householdId,
        kind: "service_report",
        title: "Dealer Zero shareable service report",
        provenance: { sourceSystem: SOURCE, externalId: DOCUMENT_KEY },
      });
      [document] = await db.select().from(documents).where(eq(documents.id, created.documentId)).limit(1);
    }

    let [task] = await db.select().from(tasks).where(and(
      eq(tasks.tenantId, DEALER_ZERO_TENANT_ID), eq(tasks.title, TASK_TITLE),
    )).limit(1);
    if (!task) {
      const created = await createTask(db, {
        tenantId: DEALER_ZERO_TENANT_ID,
        subjectType: "household",
        subjectId: householdId,
        title: TASK_TITLE,
        assigneeType: "technician",
        assigneeId: technicianId,
        eventPayload: { fixture: true },
        eventSource: SOURCE,
      });
      task = created.task;
    }

    let [visit] = await db.select().from(serviceVisits).where(and(
      eq(serviceVisits.tenantId, DEALER_ZERO_TENANT_ID), eq(serviceVisits.householdId, householdId), eq(serviceVisits.type, SOURCE),
    )).limit(1);
    if (!visit) visit = await createServiceVisit(db, {
      tenantId: DEALER_ZERO_TENANT_ID,
      householdId,
      technicianId,
      type: SOURCE,
      scheduledAt: new Date(Date.now() + 90 * 86_400_000),
      eventType: "service_visit_fixture_created",
      eventPayload: { fixture: true },
    });

    return {
      quoteId: quote!.id,
      proposalId: proposal.id,
      invoiceId: invoice.id,
      documentId: document!.id,
      taskId: task.id,
      visitId: visit.id,
    };
  });
}
