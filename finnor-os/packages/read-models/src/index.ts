// Cross-entity read-models (Phase 6, docs/jarvis-90-execution-blueprint.md §6). Plain
// typed queries over business_events/data_quality_findings/existing domain tables — no
// LLM involved. Each function answers one operational question a dealer owner (or
// workflow 6's daily digest) actually asks, grounded in tables that already exist.

import {
  withTenant,
  type Db,
  leads,
  quotes,
  proposals,
  technicians,
  appointments,
  workOrders,
  invoices,
  payments,
  inventoryItems,
  warehouseStock,
  procurementOrders,
  maintenanceAgreements,
  households,
  conversations,
  workflowRuns,
  workflowSteps,
  reconciliationCases,
  dataQualityFindings,
  contacts,
  contactMethods,
  opportunities,
  serviceVisits,
  messages,
  documents,
  communicationsLog,
  businessEvents,
  equipment,
  domainActions,
  decisionReceipts,
  deadLetters,
} from "@finnor/db";
import { and, eq, gte, inArray, isNull, lt, or, sql } from "drizzle-orm";
import { performance } from "node:perf_hooks";

export interface PipelineHealth {
  leadsByStatus: Array<{ status: string; count: number }>;
  quotesByStatus: Array<{ status: string; count: number }>;
  proposalsByStatus: Array<{ status: string; count: number }>;
}

export async function pipelineHealth(tenantId: string): Promise<PipelineHealth> {
  return withTenant(tenantId, async (db) => {
    const leadsByStatus = await db
      .select({ status: leads.status, count: sql<number>`count(*)::int` })
      .from(leads)
      .where(eq(leads.tenantId, tenantId))
      .groupBy(leads.status);
    const quotesByStatus = await db
      .select({ status: quotes.status, count: sql<number>`count(*)::int` })
      .from(quotes)
      .where(eq(quotes.tenantId, tenantId))
      .groupBy(quotes.status);
    // proposals has no tenant_id column of its own — scope through the household it belongs to.
    const proposalsByStatus = await db
      .select({ status: proposals.status, count: sql<number>`count(*)::int` })
      .from(proposals)
      .innerJoin(households, eq(households.id, proposals.householdId))
      .where(eq(households.tenantId, tenantId))
      .groupBy(proposals.status);
    return { leadsByStatus, quotesByStatus, proposalsByStatus };
  });
}

export interface TechnicianLoad {
  technicianId: string;
  name: string;
  upcomingAppointments: number;
  openWorkOrders: number;
}

export async function technicianLoad(tenantId: string): Promise<TechnicianLoad[]> {
  return withTenant(tenantId, async (db) => {
    const techs = await db.select({ id: technicians.id, name: technicians.name }).from(technicians).where(eq(technicians.tenantId, tenantId));
    const results: TechnicianLoad[] = [];
    for (const t of techs) {
      const [apptRow] = await db
        .select({ count: sql<number>`count(*)::int` })
        .from(appointments)
        .where(and(eq(appointments.technicianId, t.id), inArray(appointments.status, ["hold", "confirmed"])));
      const [woRow] = await db
        .select({ count: sql<number>`count(*)::int` })
        .from(workOrders)
        .where(and(eq(workOrders.technicianId, t.id), inArray(workOrders.status, ["draft", "scheduled", "in_progress"])));
      results.push({ technicianId: t.id, name: t.name, upcomingAppointments: apptRow!.count, openWorkOrders: woRow!.count });
    }
    return results;
  });
}

export interface StockRiskItem {
  sku: string;
  name: string | null;
  quantity: number;
  reorderThreshold: number;
  source: "inventory_items" | "warehouse_stock";
}

export interface StockRisk {
  belowThreshold: StockRiskItem[];
  openProcurementOrders: number;
}

export async function stockRisk(tenantId: string): Promise<StockRisk> {
  return withTenant(tenantId, async (db) => {
    const items = await db
      .select({ sku: inventoryItems.sku, name: inventoryItems.name, quantity: inventoryItems.quantity, reorderThreshold: inventoryItems.reorderThreshold })
      .from(inventoryItems)
      .where(and(eq(inventoryItems.tenantId, tenantId), sql`${inventoryItems.quantity} <= ${inventoryItems.reorderThreshold}`));
    const stock = await db
      .select({ sku: warehouseStock.sku, quantity: warehouseStock.quantity, reorderThreshold: warehouseStock.reorderThreshold })
      .from(warehouseStock)
      .where(and(eq(warehouseStock.tenantId, tenantId), sql`${warehouseStock.quantity} <= ${warehouseStock.reorderThreshold}`));
    const [procRow] = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(procurementOrders)
      .where(and(eq(procurementOrders.tenantId, tenantId), inArray(procurementOrders.status, ["draft", "ordered"])));
    return {
      belowThreshold: [
        ...items.map((i) => ({ ...i, source: "inventory_items" as const })),
        ...stock.map((s) => ({ ...s, name: null, source: "warehouse_stock" as const })),
      ],
      openProcurementOrders: procRow!.count,
    };
  });
}

export interface CashCollections {
  invoicesByStatus: Array<{ status: string; count: number; totalUsd: number }>;
  totalCollected: number;
  paymentLinksAwaitingPayment: number;
}

export async function cashCollections(tenantId: string): Promise<CashCollections> {
  return withTenant(tenantId, async (db) => {
    const invoicesByStatus = await db
      .select({ status: invoices.status, count: sql<number>`count(*)::int`, totalUsd: sql<number>`coalesce(sum(${invoices.amountUsd}), 0)::float` })
      .from(invoices)
      .where(eq(invoices.tenantId, tenantId))
      .groupBy(invoices.status);
    const [collectedRow] = await db
      .select({ totalCollected: sql<number>`coalesce(sum(${payments.amountUsd}), 0)::float` })
      .from(payments)
      .where(and(eq(payments.tenantId, tenantId), eq(payments.status, "succeeded")));
    const [linksRow] = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(workflowSteps)
      .where(and(eq(workflowSteps.tenantId, tenantId), eq(workflowSteps.stepType, "create_payment_link"), inArray(workflowSteps.status, ["pending", "leased", "completed"])));
    return { invoicesByStatus, totalCollected: collectedRow!.totalCollected, paymentLinksAwaitingPayment: linksRow!.count };
  });
}

export interface ServiceDueAgreement {
  agreementId: string;
  householdId: string;
  cadence: string;
  status: string;
  renewalDate: string | null;
}

export async function serviceDue(tenantId: string, windowDays = 30): Promise<ServiceDueAgreement[]> {
  const cutoff = new Date(Date.now() + windowDays * 86_400_000);
  return withTenant(tenantId, async (db) => {
    const rows = await db
      .select({
        agreementId: maintenanceAgreements.id,
        householdId: maintenanceAgreements.householdId,
        cadence: maintenanceAgreements.cadence,
        status: maintenanceAgreements.status,
        renewalDate: maintenanceAgreements.renewalDate,
      })
      .from(maintenanceAgreements)
      .innerJoin(households, eq(households.id, maintenanceAgreements.householdId))
      .where(
        and(
          eq(households.tenantId, tenantId),
          inArray(maintenanceAgreements.status, ["active", "renewal_window", "renewal_sent"]),
          lt(maintenanceAgreements.renewalDate, cutoff),
        ),
      );
    return rows.map((r) => ({ ...r, renewalDate: r.renewalDate?.toISOString() ?? null }));
  });
}

export interface SlaBreaches {
  stuckWorkflowRuns: number;
  openReconciliationCases: number;
}

/** "Stuck" means still `running` and not updated in the last STALL_HOURS — a real
 *  workflow either advances a step or terminates; sitting untouched this long means
 *  something silently died without failing the run itself (a worker crash between
 *  advanceWorkflow's own updates, or a step whose lease was never reclaimed). */
export async function slaBreaches(tenantId: string, stallHours = 24): Promise<SlaBreaches> {
  const cutoff = new Date(Date.now() - stallHours * 3600_000);
  return withTenant(tenantId, async (db) => {
    const [runsRow] = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(workflowRuns)
      .where(and(eq(workflowRuns.tenantId, tenantId), eq(workflowRuns.status, "running"), lt(workflowRuns.updatedAt, cutoff)));
    const [casesRow] = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(reconciliationCases)
      .where(and(eq(reconciliationCases.tenantId, tenantId), eq(reconciliationCases.status, "open")));
    return { stuckWorkflowRuns: runsRow!.count, openReconciliationCases: casesRow!.count };
  });
}

export interface FollowUpDebtItem {
  entityType: "lead" | "quote";
  entityId: string;
  householdId: string | null;
  status: string;
  lastActivityAt: string | null;
}

/** A lead/quote whose household has no conversation activity in `staleDays` — or none
 *  at all — is follow-up debt: something the pipeline is quietly not chasing. */
export async function followUpDebt(tenantId: string, staleDays = 7): Promise<FollowUpDebtItem[]> {
  const cutoff = new Date(Date.now() - staleDays * 86_400_000);
  return withTenant(tenantId, async (db) => {
    const openLeads = await db
      .select({ id: leads.id, householdId: leads.householdId, status: leads.status })
      .from(leads)
      .where(and(eq(leads.tenantId, tenantId), inArray(leads.status, ["new", "contacted", "qualified"])));
    const openQuotes = await db
      .select({ id: quotes.id, householdId: quotes.householdId, status: quotes.status })
      .from(quotes)
      .where(and(eq(quotes.tenantId, tenantId), eq(quotes.status, "sent")));

    const results: FollowUpDebtItem[] = [];
    for (const l of openLeads) {
      const stale = await isHouseholdStale(db, tenantId, l.householdId, cutoff);
      if (stale.stale) results.push({ entityType: "lead", entityId: l.id, householdId: l.householdId, status: l.status, lastActivityAt: stale.lastActivityAt });
    }
    for (const q of openQuotes) {
      const stale = await isHouseholdStale(db, tenantId, q.householdId, cutoff);
      if (stale.stale) results.push({ entityType: "quote", entityId: q.id, householdId: q.householdId, status: q.status, lastActivityAt: stale.lastActivityAt });
    }
    return results;
  });
}

async function isHouseholdStale(
  db: Db,
  tenantId: string,
  householdId: string | null,
  cutoff: Date,
): Promise<{ stale: boolean; lastActivityAt: string | null }> {
  if (!householdId) return { stale: true, lastActivityAt: null };
  const [convo] = await db
    .select({ lastActivityAt: conversations.lastActivityAt })
    .from(conversations)
    .where(and(eq(conversations.tenantId, tenantId), eq(conversations.householdId, householdId)))
    .orderBy(sql`${conversations.lastActivityAt} desc`)
    .limit(1);
  if (!convo) return { stale: true, lastActivityAt: null };
  return { stale: convo.lastActivityAt < cutoff, lastActivityAt: convo.lastActivityAt.toISOString() };
}

export interface DataQualitySummary {
  byTypeAndSeverity: Array<{ findingType: string; severity: string; count: number }>;
  totalUnresolved: number;
}

export async function dataQuality(tenantId: string): Promise<DataQualitySummary> {
  return withTenant(tenantId, async (db) => {
    const rows = await db
      .select({ findingType: dataQualityFindings.findingType, severity: dataQualityFindings.severity, count: sql<number>`count(*)::int` })
      .from(dataQualityFindings)
      .where(and(eq(dataQualityFindings.tenantId, tenantId), isNull(dataQualityFindings.resolvedAt)))
      .groupBy(dataQualityFindings.findingType, dataQualityFindings.severity);
    return { byTypeAndSeverity: rows, totalUnresolved: rows.reduce((s, r) => s + r.count, 0) };
  });
}

// ---------------------------------------------------------------------------
// Household 360 (Phase 11, docs/jarvis-99-phase-10-16-execution-plan.md §PHASE 11).
// Traverses BOTH table generations linked to a household: pre-canonical (equipment,
// service_visits, maintenance_agreements via serviceDue above, communications_log)
// and canonical (contacts+contact_methods, leads, opportunities, quotes,
// invoices+payments, work_orders, appointments, conversations+messages, documents),
// plus the business_events timeline. This is a read-model + API + console surface —
// deliberately NOT wired into the planner prompt (ground-truth §14: longTerm already
// isn't serialized into the LLM prompt; extending that is a named non-goal here to
// keep the token-budget blast radius at zero for this phase).
// ---------------------------------------------------------------------------

export interface Household360 {
  household: { id: string; address: string; contactInfo: Record<string, unknown>; marketingConsent: boolean; createdAt: string };
  contacts: Array<{ id: string; name: string; role: string | null; methods: Array<{ methodType: string; value: string; consent: boolean }> }>;
  equipment: Array<{ id: string; type: string; model: string | null; installDate: string | null; source: string }>;
  leads: Array<{ id: string; name: string; status: string; source: string | null; createdAt: string }>;
  opportunities: Array<{ id: string; pipelineStage: string; expectedValueUsd: number | null; createdAt: string }>;
  quotes: Array<{ id: string; status: string; totalUsd: number | null; createdAt: string }>;
  invoices: Array<{ id: string; status: string; amountUsd: number; dueDate: string | null; payments: Array<{ amountUsd: number; method: string; status: string; receivedAt: string }> }>;
  workOrders: Array<{ id: string; type: string; status: string; technicianId: string | null; scheduledAt: string | null; completedAt: string | null }>;
  serviceVisits: Array<{ id: string; type: string; technicianId: string | null; scheduledAt: string | null; completedAt: string | null }>;
  appointments: Array<{ id: string; subjectType: string; status: string; scheduledAt: string; technicianId: string | null }>;
  conversations: Array<{ id: string; channel: string; status: string; lastActivityAt: string; messageCount: number }>;
  documents: Array<{ id: string; kind: string; title: string; createdAt: string }>;
  // communications_log (pre-canonical) is linked to a household by nothing but
  // householdId — it is NOT unified with canonical `conversations` (no shared key,
  // no migration path). Surfaced honestly as its own array rather than folded into
  // `conversations`, which would misrepresent two unrelated systems as one.
  legacyCommunications: Array<{ id: string; channel: string; direction: string; content: string; timestamp: string }>;
  timeline: Array<{ entityType: string; entityId: string; eventType: string; occurredAt: string; payload: Record<string, unknown> }>;
  queryMs: number;
}

const toNum = (v: string | null): number | null => (v === null ? null : Number(v));

export async function household360(tenantId: string, householdId: string): Promise<Household360 | null> {
  const start = performance.now();
  const result = await withTenant(tenantId, async (db) => {
    const [hh] = await db
      .select()
      .from(households)
      .where(and(eq(households.id, householdId), eq(households.tenantId, tenantId)));
    if (!hh) return null;

    // Stage 1: direct children of the household — 11 parallel indexed selects.
    const [contactRows, equipmentRows, leadRows, opportunityRows, quoteRows, invoiceRows, workOrderRows, serviceVisitRows, conversationRows, documentRows, legacyCommsRows] =
      await Promise.all([
        db.select().from(contacts).where(and(eq(contacts.tenantId, tenantId), eq(contacts.householdId, householdId))),
        db.select().from(equipment).where(eq(equipment.householdId, householdId)),
        db.select().from(leads).where(and(eq(leads.tenantId, tenantId), eq(leads.householdId, householdId))),
        db.select().from(opportunities).where(and(eq(opportunities.tenantId, tenantId), eq(opportunities.householdId, householdId))),
        db.select().from(quotes).where(and(eq(quotes.tenantId, tenantId), eq(quotes.householdId, householdId))),
        db.select().from(invoices).where(and(eq(invoices.tenantId, tenantId), eq(invoices.householdId, householdId))),
        db.select().from(workOrders).where(and(eq(workOrders.tenantId, tenantId), eq(workOrders.householdId, householdId))),
        db.select().from(serviceVisits).where(eq(serviceVisits.householdId, householdId)),
        db.select().from(conversations).where(and(eq(conversations.tenantId, tenantId), eq(conversations.householdId, householdId))),
        db.select().from(documents).where(and(eq(documents.tenantId, tenantId), eq(documents.householdId, householdId))),
        db.select().from(communicationsLog).where(eq(communicationsLog.householdId, householdId)),
      ]);

    const contactIds = contactRows.map((c) => c.id);
    const invoiceIds = invoiceRows.map((i) => i.id);
    const conversationIds = conversationRows.map((c) => c.id);
    const leadIds = leadRows.map((l) => l.id);
    const workOrderIds = workOrderRows.map((w) => w.id);

    // Stage 2: children-of-children. Appointments are polymorphic (subjectType/
    // subjectId, no householdId) — match direct household holds, plus holds whose
    // subject is one of this household's leads or work orders (the two-stage hop).
    const subjectConditions = [and(eq(appointments.subjectType, "household"), eq(appointments.subjectId, householdId))];
    if (leadIds.length > 0) subjectConditions.push(and(eq(appointments.subjectType, "lead"), inArray(appointments.subjectId, leadIds)));
    if (workOrderIds.length > 0) subjectConditions.push(and(eq(appointments.subjectType, "work_order"), inArray(appointments.subjectId, workOrderIds)));

    const [methodRows, paymentRows, messageRows, appointmentRows] = await Promise.all([
      contactIds.length > 0 ? db.select().from(contactMethods).where(inArray(contactMethods.contactId, contactIds)) : Promise.resolve([]),
      invoiceIds.length > 0 ? db.select().from(payments).where(inArray(payments.invoiceId, invoiceIds)) : Promise.resolve([]),
      conversationIds.length > 0 ? db.select().from(messages).where(inArray(messages.conversationId, conversationIds)) : Promise.resolve([]),
      db.select().from(appointments).where(and(eq(appointments.tenantId, tenantId), or(...subjectConditions))),
    ]);

    // Timeline: business_events for the union of every entity collected above,
    // batched per entityType so each batch hits business_events_entity_idx.
    const entityBatches: Array<[string, string[]]> = [
      ["household", [householdId]],
      ["contact", contactIds],
      ["lead", leadIds],
      ["opportunity", opportunityRows.map((o) => o.id)],
      ["quote", quoteRows.map((q) => q.id)],
      ["invoice", invoiceIds],
      ["work_order", workOrderIds],
      ["appointment", appointmentRows.map((a) => a.id)],
    ].filter(([, ids]) => (ids?.length ?? 0) > 0) as Array<[string, string[]]>;

    const eventBatches = await Promise.all(
      entityBatches.map(([entityType, ids]) =>
        db
          .select()
          .from(businessEvents)
          .where(and(eq(businessEvents.tenantId, tenantId), eq(businessEvents.entityType, entityType), inArray(businessEvents.entityId, ids))),
      ),
    );
    const timeline = eventBatches
      .flat()
      .sort((a, b) => b.occurredAt.getTime() - a.occurredAt.getTime())
      .slice(0, 100)
      .map((e) => ({
        entityType: e.entityType,
        entityId: e.entityId,
        eventType: e.eventType,
        occurredAt: e.occurredAt.toISOString(),
        payload: e.payload as Record<string, unknown>,
      }));

    const methodsByContact = new Map<string, typeof methodRows>();
    for (const m of methodRows) {
      const list = methodsByContact.get(m.contactId) ?? [];
      list.push(m);
      methodsByContact.set(m.contactId, list);
    }
    const paymentsByInvoice = new Map<string, typeof paymentRows>();
    for (const p of paymentRows) {
      const list = paymentsByInvoice.get(p.invoiceId) ?? [];
      list.push(p);
      paymentsByInvoice.set(p.invoiceId, list);
    }
    const messageCountByConversation = new Map<string, number>();
    for (const m of messageRows) {
      messageCountByConversation.set(m.conversationId!, (messageCountByConversation.get(m.conversationId!) ?? 0) + 1);
    }

    const household360Result: Household360 = {
      household: {
        id: hh.id,
        address: hh.address,
        contactInfo: hh.contactInfo as Record<string, unknown>,
        marketingConsent: hh.marketingConsent,
        createdAt: hh.createdAt.toISOString(),
      },
      contacts: contactRows.map((c) => ({
        id: c.id,
        name: c.name,
        role: c.role,
        methods: (methodsByContact.get(c.id) ?? []).map((m) => ({ methodType: m.methodType, value: m.value, consent: m.consent })),
      })),
      equipment: equipmentRows.map((e) => ({
        id: e.id,
        type: e.type,
        model: e.model,
        installDate: e.installDate ? e.installDate.toISOString() : null,
        source: e.source,
      })),
      leads: leadRows.map((l) => ({ id: l.id, name: l.name, status: l.status, source: l.source, createdAt: l.createdAt.toISOString() })),
      opportunities: opportunityRows.map((o) => ({
        id: o.id,
        pipelineStage: o.pipelineStage,
        expectedValueUsd: toNum(o.expectedValueUsd),
        createdAt: o.createdAt.toISOString(),
      })),
      quotes: quoteRows.map((q) => ({ id: q.id, status: q.status, totalUsd: toNum(q.totalUsd), createdAt: q.createdAt.toISOString() })),
      invoices: invoiceRows.map((i) => ({
        id: i.id,
        status: i.status,
        amountUsd: Number(i.amountUsd),
        dueDate: i.dueDate ? i.dueDate.toISOString() : null,
        payments: (paymentsByInvoice.get(i.id) ?? []).map((p) => ({
          amountUsd: Number(p.amountUsd),
          method: p.method,
          status: p.status,
          receivedAt: p.receivedAt.toISOString(),
        })),
      })),
      workOrders: workOrderRows.map((w) => ({
        id: w.id,
        type: w.type,
        status: w.status,
        technicianId: w.technicianId,
        scheduledAt: w.scheduledAt ? w.scheduledAt.toISOString() : null,
        completedAt: w.completedAt ? w.completedAt.toISOString() : null,
      })),
      serviceVisits: serviceVisitRows.map((v) => ({
        id: v.id,
        type: v.type,
        technicianId: v.technicianId,
        scheduledAt: v.scheduledAt ? v.scheduledAt.toISOString() : null,
        completedAt: v.completedAt ? v.completedAt.toISOString() : null,
      })),
      appointments: appointmentRows.map((a) => ({
        id: a.id,
        subjectType: a.subjectType,
        status: a.status,
        scheduledAt: a.scheduledAt.toISOString(),
        technicianId: a.technicianId,
      })),
      conversations: conversationRows.map((c) => ({
        id: c.id,
        channel: c.channel,
        status: c.status,
        lastActivityAt: c.lastActivityAt.toISOString(),
        messageCount: messageCountByConversation.get(c.id) ?? 0,
      })),
      documents: documentRows.map((d) => ({ id: d.id, kind: d.kind, title: d.title, createdAt: d.createdAt.toISOString() })),
      legacyCommunications: legacyCommsRows.map((c) => ({
        id: c.id,
        channel: c.channel,
        direction: c.direction,
        content: c.content,
        timestamp: c.timestamp.toISOString(),
      })),
      timeline,
      queryMs: 0, // set below, outside withTenant, so it reflects the whole call
    };
    return household360Result;
  });

  if (result === null) return null;
  const queryMs = performance.now() - start;
  if (queryMs > 500) {
    // eslint-disable-next-line no-console
    console.warn(`[household360] slow traversal for tenant ${tenantId}, household ${householdId}: ${queryMs.toFixed(1)}ms`);
  }
  return { ...result, queryMs };
}

// ---------------------------------------------------------------------------
// Reliability (Phase 6, JARVIS 95% MAESTRO PACK §6.6): per-tenant operational
// health, grounded entirely in tables the durable runtime (Phase 2) and receipt
// pipeline already write for real — no metric here is invented or sampled.
// windowDays scopes the THROUGHPUT metrics (success rate, latency, retry rate,
// human-intervention rate, receipt completeness) to recent activity; the two
// backlog gauges (reconciliationBacklog, dlqDepth) are deliberately NOT windowed
// — a backlog is a current-state count, not a rate, and windowing it would hide
// an old unresolved case sitting past the window boundary.
// ---------------------------------------------------------------------------

export interface ReliabilityMetrics {
  tenantId: string;
  windowDays: number;
  workflowSuccessRate: number | null;
  stepLatencyMs: { p50: number | null; p95: number | null; sampleSize: number };
  retryRate: number | null;
  humanInterventionRate: number | null;
  reconciliationBacklog: number;
  dlqDepth: number;
  receiptCompleteness: number | null;
  asOf: string;
}

function percentile(sorted: number[], p: number): number | null {
  if (sorted.length === 0) return null;
  const idx = Math.min(sorted.length - 1, Math.floor(p * sorted.length));
  return sorted[idx]!;
}

export async function reliability(tenantId: string, windowDays = 1): Promise<ReliabilityMetrics> {
  const cutoff = new Date(Date.now() - windowDays * 86_400_000);
  return withTenant(tenantId, async (db) => {
    const runRows = await db
      .select({ status: workflowRuns.status, count: sql<number>`count(*)::int` })
      .from(workflowRuns)
      .where(and(eq(workflowRuns.tenantId, tenantId), gte(workflowRuns.createdAt, cutoff)))
      .groupBy(workflowRuns.status);
    const byStatus = Object.fromEntries(runRows.map((r) => [r.status, r.count]));
    // "Terminal" excludes still-running/paused/escalated runs — those haven't
    // resolved yet, so counting them as failures (or successes) would be a guess.
    const terminal = (byStatus.completed ?? 0) + (byStatus.failed ?? 0) + (byStatus.compensated ?? 0) + (byStatus.cancelled ?? 0);
    const workflowSuccessRate = terminal > 0 ? (byStatus.completed ?? 0) / terminal : null;

    const completedSteps = await db
      .select({ createdAt: workflowSteps.createdAt, updatedAt: workflowSteps.updatedAt })
      .from(workflowSteps)
      .where(and(eq(workflowSteps.tenantId, tenantId), eq(workflowSteps.status, "completed"), gte(workflowSteps.createdAt, cutoff)));
    // Proxy for step latency: createdAt (queued) -> updatedAt (last write, which for a
    // completed step is its completion). Not a dedicated "started executing" timestamp
    // (none exists on this table) — stated honestly rather than fabricating one.
    const latencies = completedSteps.map((s) => s.updatedAt.getTime() - s.createdAt.getTime()).sort((a, b) => a - b);

    const [retryRow] = await db
      .select({
        total: sql<number>`count(*)::int`,
        retried: sql<number>`count(*) filter (where ${workflowSteps.attempts} > 1)::int`,
      })
      .from(workflowSteps)
      .where(and(eq(workflowSteps.tenantId, tenantId), inArray(workflowSteps.status, ["completed", "failed"]), gte(workflowSteps.createdAt, cutoff)));
    const retryRate = retryRow!.total > 0 ? retryRow!.retried / retryRow!.total : null;

    const [humanRow] = await db
      .select({
        total: sql<number>`count(*)::int`,
        needsHuman: sql<number>`count(*) filter (where ${domainActions.status} = 'needs_human_review')::int`,
      })
      .from(domainActions)
      .where(and(eq(domainActions.tenantId, tenantId), gte(domainActions.createdAt, cutoff)));
    const humanInterventionRate = humanRow!.total > 0 ? humanRow!.needsHuman / humanRow!.total : null;

    const [reconRow] = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(reconciliationCases)
      .where(and(eq(reconciliationCases.tenantId, tenantId), eq(reconciliationCases.status, "open")));

    const [dlqRow] = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(deadLetters)
      .where(and(eq(deadLetters.tenantId, tenantId), eq(deadLetters.status, "open")));

    const [receiptRow] = await db
      .select({
        total: sql<number>`count(*)::int`,
        finalized: sql<number>`count(*) filter (where ${decisionReceipts.finalizedAt} is not null)::int`,
      })
      .from(decisionReceipts)
      .where(and(eq(decisionReceipts.tenantId, tenantId), gte(decisionReceipts.createdAt, cutoff)));
    const receiptCompleteness = receiptRow!.total > 0 ? receiptRow!.finalized / receiptRow!.total : null;

    return {
      tenantId,
      windowDays,
      workflowSuccessRate,
      stepLatencyMs: { p50: percentile(latencies, 0.5), p95: percentile(latencies, 0.95), sampleSize: latencies.length },
      retryRate,
      humanInterventionRate,
      reconciliationBacklog: reconRow!.count,
      dlqDepth: dlqRow!.count,
      receiptCompleteness,
      asOf: new Date().toISOString(),
    };
  });
}
