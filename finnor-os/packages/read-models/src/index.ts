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
} from "@finnor/db";
import { and, eq, inArray, isNull, lt, sql } from "drizzle-orm";

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
