// Phase 3.3: the life simulator's APPLY half — job handler `simulator_tick`, scheduled
// daily (apps/worker/src/index.ts's PROACTIVE_SCANS, day-bucketed idempotency key, same
// convention as every other scan so this runs at most once per calendar day per
// tenant). No-ops for any tenant whose tenant_settings.simulator_enabled isn't true —
// today that's Dealer Zero only, but the check is real DB state, not a hardcoded tenant
// id, so it stays correct if a second simulated tenant is ever added.
//
// Applies plan.ts's deterministic DailyPlan through the SAME real machinery any other
// caller uses — createLead (data-platform), draftKnownAction (orchestration, the exact
// function scan-low-inventory.ts and friends already use for system-drafted actions).
// Nothing here bypasses a policy's requiresConfirmation gate: a gated action lands in
// the real approval queue exactly like a real dealer/customer-triggered one would.

import { withTenant, tenantSettings, households, technicians, maintenanceAgreements, invoices, serviceVisits, communicationsLog } from "@finnor/db";
import { and, eq, inArray, sql } from "drizzle-orm";
import { createLead } from "@finnor/data-platform";
import { FinnorOrchestrator } from "@finnor/orchestration";
import { planDailyEvents, type DailySimulationContext } from "../simulator/plan";

let orchestrator: FinnorOrchestrator | null = null;

async function loadContext(tenantId: string): Promise<DailySimulationContext> {
  return withTenant(tenantId, async (db) => {
    const hh = await db
      .select({ id: households.id, key: households.contactInfo })
      .from(households)
      .where(and(eq(households.tenantId, tenantId), sql`${households.contactInfo}->>'dealerZeroKey' LIKE 'hh-%'`));
    const establishedHouseholdIds = hh.map((h) => h.id).sort(); // stable order — required for reproducible index-based picks
    const amcRows = establishedHouseholdIds.length
      ? await db
          .select({ householdId: maintenanceAgreements.householdId })
          .from(maintenanceAgreements)
          .where(and(inArray(maintenanceAgreements.householdId, establishedHouseholdIds), eq(maintenanceAgreements.status, "active")))
      : [];
    const techRows = await db.select({ id: technicians.id }).from(technicians).where(eq(technicians.tenantId, tenantId));
    const openInvoiceRows = await db
      .select({ id: invoices.id, dueDate: invoices.dueDate })
      .from(invoices)
      .where(and(eq(invoices.tenantId, tenantId), eq(invoices.status, "sent")));
    return {
      establishedHouseholdIds,
      amcHouseholdIds: amcRows.map((r) => r.householdId),
      technicianIds: techRows.map((r) => r.id),
      openInvoices: openInvoiceRows.map((r) => ({ id: r.id, dueDate: r.dueDate ? r.dueDate.toISOString() : null })),
    };
  });
}

export interface SimulatorTickResult {
  ran: boolean;
  dateSeed?: string;
  leadsCreated?: number;
  visitsLogged?: number;
  complaintLogged?: boolean;
  invoicesDrafted?: number;
  paymentsDrafted?: number;
}

export async function runSimulatorTick(tenantId: string, dateSeed: string): Promise<SimulatorTickResult> {
  const [settings] = await withTenant(tenantId, (db) => db.select().from(tenantSettings).where(eq(tenantSettings.tenantId, tenantId)));
  if (!settings?.simulatorEnabled) return { ran: false };

  orchestrator ??= new FinnorOrchestrator();
  const ctx = await loadContext(tenantId);
  const plan = planDailyEvents(dateSeed, ctx);

  for (const lead of plan.newLeads) {
    await withTenant(tenantId, (db) =>
      createLead(db, {
        tenantId,
        name: lead.name,
        phone: lead.phone,
        email: lead.email,
        address: lead.address,
        source: "voice",
        provenance: { sourceSystem: "dealer_zero_simulator", externalId: lead.key },
      }),
    );
  }

  const technicianById = new Map(ctx.technicianIds.map((id) => [id, id]));
  for (const visit of plan.visitOutcomes) {
    const scheduledAt = new Date();
    await withTenant(tenantId, (db) =>
      db.insert(serviceVisits).values({
        householdId: visit.householdId,
        technicianId: technicianById.get(visit.technicianId),
        type: "maintenance",
        scheduledAt,
        completedAt: visit.outcome === "completed" ? scheduledAt : null,
        notes: visit.outcome === "completed" ? "Routine maintenance visit completed — filters/salt checked." : "Customer no-show — visit not completed, rescheduling needed.",
      }),
    );
    if (visit.outcome === "completed") {
      await orchestrator.draftKnownAction(
        "log_visit_report",
        { householdId: visit.householdId, report: "Completed scheduled maintenance visit. System checked, readings within normal range, no issues found.", markCompleted: true },
        tenantId,
        { source: "dealer_zero_simulator" },
      );
      await orchestrator.draftKnownAction(
        "log_stock_used_on_visit",
        { name: "Water Softener Salt (40lb bag)", quantity: 1 },
        tenantId,
        { source: "dealer_zero_simulator" },
      );
    }
  }

  if (plan.complaintHouseholdId) {
    await withTenant(tenantId, (db) =>
      db.insert(communicationsLog).values({
        householdId: plan.complaintHouseholdId!,
        channel: "sms",
        direction: "inbound",
        content: "Hi, our water has had a strange taste the last couple days, can someone take a look?",
      }),
    );
    await orchestrator.draftKnownAction(
      "flag_visit_issue",
      { issue: "Customer reported an unusual water taste via SMS — needs a follow-up visit or diagnostic call." },
      tenantId,
      { source: "dealer_zero_simulator" },
    );
  }

  for (const inv of plan.invoicesToCreate) {
    await orchestrator.draftKnownAction(
      "create_invoice",
      { householdId: inv.householdId, amountUsd: inv.amountUsd, memo: "Routine maintenance visit" },
      tenantId,
      { source: "dealer_zero_simulator" },
    );
  }

  for (const payment of plan.paymentsToRecord) {
    await orchestrator.draftKnownAction("record_payment", { invoiceId: payment.invoiceId }, tenantId, { source: "dealer_zero_simulator" });
  }

  return {
    ran: true,
    dateSeed,
    leadsCreated: plan.newLeads.length,
    visitsLogged: plan.visitOutcomes.length,
    complaintLogged: plan.complaintHouseholdId !== null,
    invoicesDrafted: plan.invoicesToCreate.length,
    paymentsDrafted: plan.paymentsToRecord.length,
  };
}

export const simulatorTick = async (payload: Record<string, unknown>): Promise<void> => {
  const tenantId = String(payload.tenantId ?? "");
  if (!tenantId) throw new Error("simulator_tick requires tenantId");
  const dateSeed = typeof payload.dateSeed === "string" ? payload.dateSeed : new Date().toISOString().slice(0, 10);
  await runSimulatorTick(tenantId, dateSeed);
};
