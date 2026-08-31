import { describe, expect, it } from "vitest";
import fc from "fast-check";
import { capability, checkP2Resolved, queryProgram, searchProblem } from "../fixtures/programs";
import { compareExtractionVectors } from "./extraction";
import { searchOperationalPrograms } from "./search";
import type { ExtractionScoreVector } from "./contracts";

const hash = (value: number): ExtractionScoreVector["tieBreak"] => `p4:program:sha256:${value.toString(16).padStart(64, "0")}`;

describe("P4 deterministic properties", () => {
  it("keeps the lexicographic comparator antisymmetric and tie-stable", () => {
    const vector = fc.record({
      safetyLegality: fc.integer({ min: 0, max: 1_000 }),
      goalSatisfaction: fc.integer({ min: 0, max: 1_000 }),
      verificationStrength: fc.integer({ min: 0, max: 1_000 }),
      reversibilityRecoverability: fc.integer({ min: 0, max: 1_000 }),
      successOrdinal: fc.integer({ min: 0, max: 1_000 }),
      humanInterruptions: fc.integer({ min: 0, max: 100 }),
      latencyMs: fc.integer({ min: 0, max: 100_000 }),
      financialCost: fc.integer({ min: 0, max: 100_000 }),
      modelTokenCost: fc.integer({ min: 0, max: 100_000 }),
      tie: fc.integer({ min: 0, max: 1_000_000 }),
    }).map(({ tie, ...rest }) => ({ ...rest, tieBreak: hash(tie) }));
    fc.assert(fc.property(vector, vector, (left, right) => {
      expect(Math.sign(compareExtractionVectors(left, right))).toBe(-Math.sign(compareExtractionVectors(right, left)));
      expect(compareExtractionVectors(left, left)).toBe(0);
    }), { seed: 20260831, numRuns: 256 });
  });

  it("is invariant to initial candidate permutation", async () => {
    const candidates = [
      { candidateId: "a", origin: "PROCEDURE_TEMPLATE" as const, originRef: "a", program: queryProgram("money_summary", { variant: "a" }) },
      { candidateId: "b", origin: "CAPABILITY_ALTERNATIVE" as const, originRef: "b", program: queryProgram("work_list", { variant: "b" }) },
    ];
    const capabilities = [capability("money_summary", { latency: 20 }), capability("work_list", { latency: 10 })];
    const first = await searchOperationalPrograms(searchProblem({ programs: candidates, capabilities }), { checkP2: checkP2Resolved });
    const second = await searchOperationalPrograms(searchProblem({ programs: [...candidates].reverse(), capabilities: [...capabilities].reverse() }), { checkP2: checkP2Resolved });
    expect(second.selectedProgramHash).toBe(first.selectedProgramHash);
    expect(second.deterministicReplayKey).toBe(first.deterministicReplayKey);
    expect(second.proofRecords).toEqual(first.proofRecords);
  });
});
