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

import { withTenant, tenantSettings, households, technicians, maintenanceAgreements, invoices, serviceVisits, workflowSteps } from "@finnor/db";
import { and, asc, eq, inArray, sql } from "drizzle-orm";
import { createLead, createServiceVisit, recordCustomerMessage } from "@finnor/data-platform";
import { FinnorOrchestrator, recordDealerZeroDay } from "@finnor/orchestration";
import { planDailyEvents, type DailySimulationContext } from "../simulator/plan";
import { isScenarioPack, type ScenarioPack } from "../simulator/scenarios";
import { runWorkflowStep } from "./run-workflow-step";

let orchestrator: FinnorOrchestrator | null = null;

/**
 * The simulator is a worker-owned scheduled job, so a queued Business Effect must
 * be driven by the same durable step handler as production. Drafting an action is
 * deliberately not treated as execution: approval-gated actions remain pending,
 * while policy-authorized internal writes produce their real receipt/effect state.
 */
async function drainQueuedAction(tenantId: string, domainActionId: string): Promise<void> {
  for (let pass = 0; pass < 32; pass += 1) {
    const pending = await withTenant(tenantId, (db) => db
      .select({ id: workflowSteps.id })
      .from(workflowSteps)
      .where(and(
        eq(workflowSteps.tenantId, tenantId),
        eq(workflowSteps.domainActionId, domainActionId),
        eq(workflowSteps.status, "pending"),
      ))
      .orderBy(asc(workflowSteps.createdAt), asc(workflowSteps.sequence)));
    if (pending.length === 0) return;
    for (const step of pending) {
      await runWorkflowStep({ tenantId, workflowStepId: step.id });
    }
  }
  throw new Error(`Simulator durable action did not settle within its bounded step budget: ${domainActionId}`);
}

async function draftAndDrain(
  actionType: string,
  payload: Record<string, unknown>,
  tenantId: string,
): Promise<void> {
  const result = await orchestrator!.draftKnownAction(actionType, payload, tenantId, { source: "dealer_zero_simulator" });
  await drainQueuedAction(tenantId, result.action.id);
}

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
  recallActionsDrafted?: number;
  scenario?: ScenarioPack;
  faultHints?: readonly string[];
}

export async function runSimulatorTick(tenantId: string, dateSeed: string, scenario: ScenarioPack = "normal_day"): Promise<SimulatorTickResult> {
  const [settings] = await withTenant(tenantId, (db) => db.select().from(tenantSettings).where(eq(tenantSettings.tenantId, tenantId)));
  if (!settings?.simulatorEnabled) return { ran: false };

  orchestrator ??= new FinnorOrchestrator();
  const startedAt = new Date();
  const ctx = await loadContext(tenantId);
  const plan = planDailyEvents(dateSeed, ctx, scenario);

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
      createServiceVisit(db, {
        tenantId,
        householdId: visit.householdId,
        technicianId: technicianById.get(visit.technicianId),
        type: "maintenance",
        scheduledAt,
        completedAt: visit.outcome === "completed" ? scheduledAt : null,
        notes: visit.outcome === "completed" ? "Routine maintenance visit completed — filters/salt checked." : "Customer no-show — visit not completed, rescheduling needed.",
        eventType: visit.outcome === "completed" ? "simulated_service_visit_completed" : "simulated_service_visit_no_show",
        eventPayload: { dateSeed, scenario },
      }),
    );
    if (visit.outcome === "completed") {
      await draftAndDrain(
        "log_visit_report",
        { householdId: visit.householdId, report: "Completed scheduled maintenance visit. System checked, readings within normal range, no issues found.", markCompleted: true },
        tenantId,
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
      recordCustomerMessage(db, {
        tenantId,
        householdId: plan.complaintHouseholdId!,
        channel: "sms",
        direction: "inbound",
        content: "Hi, our water has had a strange taste the last couple days, can someone take a look?",
        provenance: {
          sourceSystem: "dealer_zero_simulator",
          externalId: `${dateSeed}:${scenario}:complaint:${plan.complaintHouseholdId}`,
        },
      }),
    );
    await draftAndDrain(
      "flag_visit_issue",
      { issue: "Customer reported an unusual water taste via SMS — needs a follow-up visit or diagnostic call." },
      tenantId,
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
  for (const householdId of plan.recallHouseholdIds) {
    await draftAndDrain(
      "flag_visit_issue",
      { issue: "DEMO equipment-recall scenario: inspect installed equipment and contact the household.", householdId },
      tenantId,
    );
  }
  await recordDealerZeroDay(tenantId, dateSeed, scenario, plan, startedAt);

  return {
    ran: true,
    dateSeed,
    leadsCreated: plan.newLeads.length,
    visitsLogged: plan.visitOutcomes.length,
    complaintLogged: plan.complaintHouseholdId !== null,
    invoicesDrafted: plan.invoicesToCreate.length,
    paymentsDrafted: plan.paymentsToRecord.length,
    recallActionsDrafted: plan.recallHouseholdIds.length,
    scenario,
    faultHints: plan.faultHints,
  };
}

export const simulatorTick = async (payload: Record<string, unknown>): Promise<void> => {
  const tenantId = String(payload.tenantId ?? "");
  if (!tenantId) throw new Error("simulator_tick requires tenantId");
  const dateSeed = typeof payload.dateSeed === "string" ? payload.dateSeed : new Date().toISOString().slice(0, 10);
  const scenario = isScenarioPack(payload.scenario) ? payload.scenario : "normal_day";
  await runSimulatorTick(tenantId, dateSeed, scenario);
};
