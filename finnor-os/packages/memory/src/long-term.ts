// Long-term memory: the existing two-year household model in Postgres (§10).
// Read-only aggregation of a household's profile, equipment, visits, and agreements.

import {
  withTenant,
  households,
  equipment,
  serviceVisits,
  maintenanceAgreements,
  communicationsLog,
  leads,
  quotes,
  invoices,
  workOrders,
  tasks,
} from "@finnor/db";
import { eq, and, inArray, sql, desc } from "drizzle-orm";

export interface HouseholdMemory {
  household: Record<string, unknown>;
  equipment: Array<Record<string, unknown>>;
  recentVisits: Array<Record<string, unknown>>;
  agreements: Array<Record<string, unknown>>;
  recentCommunications: Array<Record<string, unknown>>;
  // Phase 11 (docs/jarvis-99-phase-10-16-execution-plan.md §PHASE 11 step 3): a
  // compact, bounded summary of the canonical layer readHouseholdMemory otherwise
  // never touches (ground-truth §14). Counts and most-recent-status only — never the
  // full household360 traversal — so this stays cheap even though it is NOT yet
  // serialized into the planner prompt (that remains a named non-goal this phase;
  // the field just makes a future, deliberate decision to serialize it cheap when
  // it happens).
  canonicalSummary: {
    openLeads: number;
    openQuotes: number;
    unpaidInvoicesUsd: number;
    lastWorkOrder: { type: string; status: string } | null;
    openTasks: number;
  };
}

export async function readHouseholdMemory(
  tenantId: string,
  householdId: string,
): Promise<HouseholdMemory | null> {
  return withTenant(tenantId, async (db) => {
    const [hh] = await db.select().from(households).where(eq(households.id, householdId));
    if (!hh) return null;
    const [eq_, visits, agmts, comms, openLeadsRow, openQuotesRow, unpaidRow, lastWorkOrderRow, openTasksRow] = await Promise.all([
      db.select().from(equipment).where(eq(equipment.householdId, householdId)),
      db
        .select()
        .from(serviceVisits)
        .where(eq(serviceVisits.householdId, householdId))
        .orderBy(desc(serviceVisits.scheduledAt))
        .limit(10),
      db
        .select()
        .from(maintenanceAgreements)
        .where(eq(maintenanceAgreements.householdId, householdId)),
      db
        .select()
        .from(communicationsLog)
        .where(eq(communicationsLog.householdId, householdId))
        .orderBy(desc(communicationsLog.timestamp))
        .limit(20),
      db
        .select({ count: sql<number>`count(*)::int` })
        .from(leads)
        .where(and(eq(leads.tenantId, tenantId), eq(leads.householdId, householdId), inArray(leads.status, ["new", "contacted", "qualified"]))),
      db
        .select({ count: sql<number>`count(*)::int` })
        .from(quotes)
        .where(and(eq(quotes.tenantId, tenantId), eq(quotes.householdId, householdId), eq(quotes.status, "sent"))),
      db
        .select({ total: sql<number>`coalesce(sum(${invoices.amountUsd}), 0)::float` })
        .from(invoices)
        .where(and(eq(invoices.tenantId, tenantId), eq(invoices.householdId, householdId), inArray(invoices.status, ["sent", "overdue"]))),
      db
        .select({ type: workOrders.type, status: workOrders.status })
        .from(workOrders)
        .where(and(eq(workOrders.tenantId, tenantId), eq(workOrders.householdId, householdId)))
        .orderBy(desc(workOrders.createdAt))
        .limit(1),
      // tasks is polymorphic (subjectType/subjectId, no householdId) — this counts
      // only tasks whose subject IS the household directly, not the full
      // household360-style traversal through its leads/work orders/etc. Honest,
      // bounded scope; a task hung off a lead won't be counted here.
      db
        .select({ count: sql<number>`count(*)::int` })
        .from(tasks)
        .where(and(eq(tasks.tenantId, tenantId), eq(tasks.subjectType, "household"), eq(tasks.subjectId, householdId), eq(tasks.status, "open"))),
    ]);
    return {
      household: hh as Record<string, unknown>,
      equipment: eq_ as Array<Record<string, unknown>>,
      recentVisits: visits as Array<Record<string, unknown>>,
      agreements: agmts as Array<Record<string, unknown>>,
      recentCommunications: comms as Array<Record<string, unknown>>,
      canonicalSummary: {
        openLeads: openLeadsRow[0]?.count ?? 0,
        openQuotes: openQuotesRow[0]?.count ?? 0,
        unpaidInvoicesUsd: unpaidRow[0]?.total ?? 0,
        lastWorkOrder: lastWorkOrderRow[0] ? { type: lastWorkOrderRow[0].type, status: lastWorkOrderRow[0].status } : null,
        openTasks: openTasksRow[0]?.count ?? 0,
      },
    };
  });
}
