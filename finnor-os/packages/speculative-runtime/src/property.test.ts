import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { internalCanonicalWriteProgram } from "../../operational-ir/fixtures/p2-programs";
import { expandWorldBranches } from "./branches";
import { simulateOperationalProgram } from "./interpreter";
import { DEFAULT_SIMULATION_BOUNDS, P5_TEST_NOW, P5_TEST_TENANT, outcome, simulationInput, snapshotForProgram } from "./test-support";

describe("P5 deterministic world properties", () => {
  it("expands every modeled outcome exactly once without mutating the snapshot", async () => {
    await fc.assert(fc.asyncProperty(fc.integer({ min: 1, max: 8 }), async (count) => {
      const program = internalCanonicalWriteProgram();
      const variable = {
        id: "world-variable:property",
        tenantId: P5_TEST_TENANT,
        sourcePropositionId: "p3:property",
        binding: { kind: "EFFECT_OUTCOME" as const, effectRef: "effect.create-task" },
        possibleOutcomes: Array.from({ length: count }, (_, index) => outcome(`outcome-${index}`, index % 2 ? "FAILURE" : "SUCCESS")),
        evidence: ["evidence:property"],
        confidenceQuality: "LOW" as const,
        provenance: { owner: "P3" as const, propositionId: "p3:property", evidenceRefs: ["evidence:property"], asOf: P5_TEST_NOW },
      };
      const snapshot = await snapshotForProgram({ program, variables: [variable] });
      const before = JSON.stringify(snapshot);
      const expansion = expandWorldBranches({ snapshot, variables: [variable], bounds: DEFAULT_SIMULATION_BOUNDS });
      expect(expansion.status).toBe("EXPANDED");
      expect(expansion.branches).toHaveLength(count);
      expect(new Set(expansion.branches.map((branch) => branch.branchId)).size).toBe(count);
      expect(JSON.stringify(snapshot)).toBe(before);
    }), { seed: 2_026_090_1, numRuns: 40 });
  });

  it("produces byte-identical replay artifacts for bounded canonical input variants", async () => {
    await fc.assert(fc.asyncProperty(fc.boolean(), async (initiallyExists) => {
      const program = internalCanonicalWriteProgram();
      const snapshot = await snapshotForProgram({
        program,
        stateOverrides: { "40000000-0000-4000-8000-000000000001": { status: "active", tasks: { confirmationFollowup: { exists: initiallyExists } } } },
      });
      const input = simulationInput({ program, snapshot });
      const first = await simulateOperationalProgram(input);
      const second = await simulateOperationalProgram(structuredClone(input));
      expect(second).toEqual(first);
      expect(first.sideEffects.realDbMutations).toBe(0);
    }), { seed: 2_026_090_1, numRuns: 30 });
  });

  it("keeps replay and branch identities stable when equivalent variables arrive in a different order", async () => {
    const program = internalCanonicalWriteProgram();
    if (program.body.kind !== "effect") throw new Error("fixture drift");
    const effectVariable = {
      id: "world-variable:effect-order",
      tenantId: P5_TEST_TENANT,
      sourcePropositionId: "p3:effect-order",
      binding: { kind: "EFFECT_OUTCOME" as const, effectRef: program.body.semanticId },
      possibleOutcomes: [outcome("success", "SUCCESS")],
      evidence: ["p3:effect-order"],
      confidenceQuality: "LOW" as const,
      provenance: { owner: "P3" as const, propositionId: "p3:effect-order", evidenceRefs: ["p3:effect-order"], asOf: P5_TEST_NOW },
    };
    const routeVariable = {
      id: "world-variable:route-order",
      tenantId: P5_TEST_TENANT,
      sourcePropositionId: "p3:route-order",
      binding: { kind: "PREDICATE" as const, subjectRef: "unused.route", path: ["value"] },
      possibleOutcomes: [outcome("route", "SUCCESS", { value: true })],
      evidence: ["p3:route-order"],
      confidenceQuality: "LOW" as const,
      provenance: { owner: "P3" as const, propositionId: "p3:route-order", evidenceRefs: ["p3:route-order"], asOf: P5_TEST_NOW },
    };
    const snapshot = await snapshotForProgram({ program, variables: [effectVariable, routeVariable] });
    const first = await simulateOperationalProgram(simulationInput({ program, snapshot, variables: [effectVariable, routeVariable] }));
    const second = await simulateOperationalProgram(simulationInput({ program, snapshot, variables: [routeVariable, effectVariable] }));
    expect(second.replayIdentity).toBe(first.replayIdentity);
    expect(second.branches.map((branch) => branch.branchId)).toEqual(first.branches.map((branch) => branch.branchId));
  });
});
