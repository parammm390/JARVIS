// Phase 3.3: Dealer Zero's life simulator — the deterministic PLANNING half. Pure
// function of (dateSeed, real current state snapshot) -> a list of events for that
// calendar day. No I/O, no Date.now(), no Math.random() — every random draw comes from
// scripts/seed-dealer-zero.ts's rngFor(), keyed by (dateSeed, event kind, slot), so the
// exact same inputs always produce the exact same plan (the determinism test asserts
// this directly). The separate apply step (simulator-tick.ts) is what actually writes
// to the database, through the SAME real machinery (createLead, draftKnownAction) any
// other caller uses — never a shadow write path — and only ever runs once per calendar
// day per tenant, because the worker enqueues it with a day-bucketed idempotency key
// (the same pattern every other proactive scan already uses), so this module doesn't
// need its own per-event dedup on top of that.

import { rngFor, pick, intBetween, generateHousehold, type SyntheticHousehold } from "@finnor/shared-types";

export interface DailySimulationContext {
  /** Household ids with an active maintenance agreement — those visits price at the
   *  AMC rate; everything else prices at the flat visit fee. */
  amcHouseholdIds: string[];
  /** Every established (non-lead) household id, in a STABLE order (callers must sort —
   *  e.g. by id — so index-based picks are reproducible run to run). */
  establishedHouseholdIds: string[];
  technicianIds: string[];
  /** Sent (not yet paid) invoices open right now, for the payment event to consider. */
  openInvoices: Array<{ id: string; dueDate: string | null }>;
}

export interface VisitOutcome {
  householdId: string;
  technicianId: string;
  outcome: "completed" | "no_show";
  hasAmc: boolean;
}

export interface DailyPlan {
  dateSeed: string;
  newLeads: SyntheticHousehold[];
  visitOutcomes: VisitOutcome[];
  complaintHouseholdId: string | null;
  invoicesToCreate: Array<{ householdId: string; amountUsd: number }>;
  paymentsToRecord: Array<{ invoiceId: string }>;
}

const AMC_VISIT_PRICE_USD = 249; // matches policy-matrix.md's renew_maintenance_agreement.price_usd
const FLAT_VISIT_FEE_USD = 129; // one-time service visit for a non-AMC household — a real, plausible mid-market price, not a guess tied to any policy row

export function planDailyEvents(dateSeed: string, ctx: DailySimulationContext): DailyPlan {
  const newLeadCount = intBetween(rngFor("simulator", dateSeed, "lead-count"), 1, 3);
  const newLeads: SyntheticHousehold[] = Array.from({ length: newLeadCount }, (_, i) => generateHousehold(`sim-lead-${dateSeed}`, i));

  const visitCount = ctx.establishedHouseholdIds.length === 0 ? 0 : intBetween(rngFor("simulator", dateSeed, "visit-count"), 2, 5);
  const amcSet = new Set(ctx.amcHouseholdIds);
  const visitOutcomes: VisitOutcome[] = [];
  for (let i = 0; i < visitCount; i++) {
    const householdIdx = Math.floor(rngFor("simulator", dateSeed, "visit-household", i)() * ctx.establishedHouseholdIds.length);
    const householdId = ctx.establishedHouseholdIds[householdIdx]!;
    const technicianId = pick(rngFor("simulator", dateSeed, "visit-tech", i), ctx.technicianIds);
    const outcome = rngFor("simulator", dateSeed, "visit-outcome", i)() < 0.9 ? "completed" : "no_show";
    visitOutcomes.push({ householdId, technicianId, outcome, hasAmc: amcSet.has(householdId) });
  }

  let complaintHouseholdId: string | null = null;
  if (ctx.establishedHouseholdIds.length > 0 && rngFor("simulator", dateSeed, "complaint-chance")() < 0.08) {
    const idx = Math.floor(rngFor("simulator", dateSeed, "complaint-household")() * ctx.establishedHouseholdIds.length);
    complaintHouseholdId = ctx.establishedHouseholdIds[idx]!;
  }

  const invoicesToCreate = visitOutcomes
    .filter((v) => v.outcome === "completed")
    .map((v) => ({ householdId: v.householdId, amountUsd: v.hasAmc ? AMC_VISIT_PRICE_USD : FLAT_VISIT_FEE_USD }));

  const paymentsToRecord = ctx.openInvoices.filter((inv) => rngFor("simulator", dateSeed, "payment", inv.id)() < 0.8).map((inv) => ({ invoiceId: inv.id }));

  return { dateSeed, newLeads, visitOutcomes, complaintHouseholdId, invoicesToCreate, paymentsToRecord };
}
