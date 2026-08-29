import { describe, expect, it } from "vitest";
import {
  createDefaultPluginRegistry,
  createHumanOperabilityMatrix,
  createUserCapabilityRegistry,
  validateHumanOperabilityMatrix,
} from "@finnor/orchestration";

describe("P5 Human Operability Matrix contract", () => {
  const registry = createUserCapabilityRegistry(createDefaultPluginRegistry());
  const matrix = createHumanOperabilityMatrix(registry);

  it("is generated from every user capability and all 13 canonical queries", () => {
    expect(matrix.capabilityCoverage).toHaveLength(72);
    expect(matrix.capabilityCoverage.filter((row) => row.capabilityKind === "ACTION")).toHaveLength(59);
    expect(matrix.capabilityCoverage.filter((row) => row.capabilityKind === "QUERY")).toHaveLength(13);
    expect(matrix.executableScenarios.filter((row) => row.category === "canonical_query")).toHaveLength(13);
    expect(() => validateHumanOperabilityMatrix(matrix, registry)).not.toThrow();
  });

  it("contains objective, ambiguity/reference/date, surface, recovery, and held-out founder certification rows", () => {
    expect(new Set(matrix.executableScenarios.map((row) => row.category))).toEqual(new Set([
      "canonical_query", "objective_pattern", "ambiguity_reference_date", "operating_surface", "failure_recovery", "held_out_founder",
    ]));
    expect(matrix.executableScenarios.filter((row) => row.heldOut).length).toBeGreaterThanOrEqual(8);
    expect(matrix.executableScenarios.some((row) => row.surfaceJourney === "thread_customer_money_work_schedule_thread")).toBe(true);
  });

  it("binds every capability to usable Dealer Zero preconditions and natural English", () => {
    for (const row of matrix.capabilityCoverage) {
      expect(row.instruction.length).toBeGreaterThan(12);
      expect(row.precondition.requiredFacts.length).toBeGreaterThan(0);
      expect(row.sourceOwner.length).toBeGreaterThan(0);
    }
  });
});
