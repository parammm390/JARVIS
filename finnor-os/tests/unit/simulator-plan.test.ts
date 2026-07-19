// Phase 3.3: planDailyEvents is a pure function — the determinism test the pack's task
// text explicitly calls for ("same date-seed twice -> identical event set"). No DB, no
// real time — the same (dateSeed, context) must always produce the byte-identical plan.

import { describe, it, expect } from "vitest";
import { planDailyEvents, type DailySimulationContext } from "../../apps/worker/src/simulator/plan";

const CTX: DailySimulationContext = {
  amcHouseholdIds: ["hh-1", "hh-2", "hh-3"],
  establishedHouseholdIds: ["hh-1", "hh-2", "hh-3", "hh-4", "hh-5", "hh-6", "hh-7", "hh-8"],
  technicianIds: ["tech-1", "tech-2", "tech-3"],
  openInvoices: [
    { id: "inv-1", dueDate: "2026-07-01" },
    { id: "inv-2", dueDate: "2026-07-10" },
    { id: "inv-3", dueDate: null },
  ],
};

describe("planDailyEvents (§3.3 determinism)", () => {
  it("same date-seed + same context -> byte-identical plan, called twice", () => {
    const plan1 = planDailyEvents("2026-07-19", CTX);
    const plan2 = planDailyEvents("2026-07-19", CTX);
    expect(plan2).toEqual(plan1);
  });

  it("different date-seeds produce different plans (not a constant)", () => {
    const plan1 = planDailyEvents("2026-07-19", CTX);
    const plan2 = planDailyEvents("2026-07-20", CTX);
    expect(plan2).not.toEqual(plan1);
  });

  it("new leads: 1-3 per day, each a full synthetic household with a stable per-day key", () => {
    const plan = planDailyEvents("2026-08-01", CTX);
    expect(plan.newLeads.length).toBeGreaterThanOrEqual(1);
    expect(plan.newLeads.length).toBeLessThanOrEqual(3);
    for (const lead of plan.newLeads) {
      expect(lead.key).toContain("2026-08-01");
      expect(lead.phone).toMatch(/^\+1319555\d{4}$/);
      expect(lead.email).toContain("@dealerzero.finnorai.com");
    }
  });

  it("visit outcomes: only draws from establishedHouseholdIds/technicianIds, ~90% completed", () => {
    const householdSet = new Set(CTX.establishedHouseholdIds);
    const techSet = new Set(CTX.technicianIds);
    let completed = 0;
    let total = 0;
    for (let d = 0; d < 60; d++) {
      const plan = planDailyEvents(`2026-09-${String(1 + (d % 28)).padStart(2, "0")}`, CTX);
      for (const v of plan.visitOutcomes) {
        expect(householdSet.has(v.householdId)).toBe(true);
        expect(techSet.has(v.technicianId)).toBe(true);
        total++;
        if (v.outcome === "completed") completed++;
      }
    }
    expect(total).toBeGreaterThan(0);
    const rate = completed / total;
    expect(rate).toBeGreaterThan(0.75); // ~90% target, loose bound over a real random sample
    expect(rate).toBeLessThan(1);
  });

  it("invoices are created only for completed visits, priced by AMC membership", () => {
    const plan = planDailyEvents("2026-07-19", CTX);
    expect(plan.invoicesToCreate.length).toBe(plan.visitOutcomes.filter((v) => v.outcome === "completed").length);
    for (const inv of plan.invoicesToCreate) {
      const visit = plan.visitOutcomes.find((v) => v.outcome === "completed" && v.householdId === inv.householdId)!;
      expect(inv.amountUsd).toBe(visit.hasAmc ? 249 : 129);
    }
  });

  it("payments only ever reference invoices actually passed in as open", () => {
    const plan = planDailyEvents("2026-07-19", CTX);
    const openIds = new Set(CTX.openInvoices.map((i) => i.id));
    for (const p of plan.paymentsToRecord) expect(openIds.has(p.invoiceId)).toBe(true);
  });

  it("empty context (no households/invoices yet) produces a safe empty-ish plan, never throws", () => {
    const plan = planDailyEvents("2026-07-19", { amcHouseholdIds: [], establishedHouseholdIds: [], technicianIds: [], openInvoices: [] });
    expect(plan.visitOutcomes).toEqual([]);
    expect(plan.invoicesToCreate).toEqual([]);
    expect(plan.paymentsToRecord).toEqual([]);
    expect(plan.complaintHouseholdId).toBeNull();
  });
});
