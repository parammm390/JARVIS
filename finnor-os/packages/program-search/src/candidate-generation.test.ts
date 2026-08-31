import { describe, expect, it } from "vitest";
import { queryProgram } from "../fixtures/programs";
import { generateBoundedInitialCandidates } from "./candidate-generation";

describe("bounded candidate generation", () => {
  it("uses the simple fast path without expensive fan-out", () => {
    const result = generateBoundedInitialCandidates({
      requestComplexity: "SIMPLE",
      maxInitialCandidates: 8,
      sources: [
        { origin: "MODEL_CANDIDATE", originRef: "model", programs: [{ candidateId: "model", program: queryProgram("work_list", { variant: "model" }) }] },
        { origin: "PROCEDURE_TEMPLATE", originRef: "template", programs: [{ candidateId: "template", program: queryProgram("money_summary", { variant: "template" }) }] },
      ],
    });
    expect(result.candidates.map((candidate) => candidate.candidateId)).toEqual(["template"]);
    expect(result.omitted).toContainEqual({ candidateId: "model", origin: "MODEL_CANDIDATE", reasonCode: "SIMPLE_FAST_PATH" });
    expect(result.stats).toMatchObject({ mode: "SIMPLE_FAST_PATH", emitted: 1, bounded: true });
  });

  it("accepts every declared origin, deduplicates canonical programs, and enforces maxInitialCandidates", () => {
    const same = queryProgram();
    const origins = ["MODEL_CANDIDATE", "CAPABILITY_ALTERNATIVE", "RECOVERY_ALTERNATIVE", "PROCEDURE_TEMPLATE", "DETERMINISTIC_REWRITE"] as const;
    const result = generateBoundedInitialCandidates({
      requestComplexity: "COMPLEX",
      maxInitialCandidates: 3,
      sources: origins.map((origin, index) => ({
        origin,
        originRef: `${origin.toLowerCase()}-v1`,
        programs: [{ candidateId: `candidate-${index}`, program: index === 1 || index === 4 ? same : queryProgram(index % 2 ? "money_summary" : "work_list", { variant: index === 0 ? "zero" : `variant-${index}` }) }],
      })),
    });
    expect(result.stats.received).toBe(5);
    expect(result.candidates).toHaveLength(3);
    expect(result.candidates.every((candidate) => origins.includes(candidate.origin))).toBe(true);
    expect(result.stats.duplicates).toBe(1);
    expect(result.omitted.some((candidate) => candidate.reasonCode === "MAX_INITIAL_CANDIDATES")).toBe(true);
  });
});
