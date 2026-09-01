import { describe, expect, it } from "vitest";
import { compileProcedureCandidate } from "./compiler";
import { compareCandidateToTraces } from "./semantic-diff";
import { P6_OPTIONS, reminderTrace } from "../fixtures/locked-corpus";

describe("procedure semantic differential", () => {
  it("reports faithful generalization when consequential structure is preserved", () => {
    const traces = [reminderTrace({ suffix: "diff-a", approval: true }), reminderTrace({ suffix: "diff-b", approval: true })];
    const result = compileProcedureCandidate(traces, P6_OPTIONS);
    expect(result.semanticDiff.classification).toBe("FAITHFUL_GENERALIZATION");
    expect(result.semanticDiff.consequentialGateRemovals).toBe(0);
    expect(result.semanticDiff.authorityRequirementRemovals).toBe(0);
    expect(result.semanticDiff.observationRequirementRemovals).toBe(0);
  });

  it("classifies removal of authority, observation, or consequential effects as OVER_GENERALIZED", () => {
    const traces = [reminderTrace({ suffix: "unsafe-diff", approval: true })];
    const result = compileProcedureCandidate(traces, P6_OPTIONS);
    const candidate = structuredClone(result.candidate);
    candidate.authorityRequirements = [];
    candidate.observations = [];
    candidate.programStructure.steps = candidate.programStructure.steps.map((step) => ({ ...step, consequential: false }));
    const diff = compareCandidateToTraces(candidate, traces, result.alignment);
    expect(diff.classification).toBe("OVER_GENERALIZED");
    expect(diff.authorityRequirementRemovals).toBeGreaterThan(0);
    expect(diff.observationRequirementRemovals).toBeGreaterThan(0);
    expect(diff.consequentialGateRemovals).toBeGreaterThan(0);
  });

  it("classifies removal of verified success conditions as OVER_GENERALIZED", () => {
    const traces = [reminderTrace({ suffix: "verification-a" }), reminderTrace({ suffix: "verification-b" })];
    const result = compileProcedureCandidate(traces, P6_OPTIONS);
    const candidate = structuredClone(result.candidate);
    candidate.successConditions = [];
    const diff = compareCandidateToTraces(candidate, traces, result.alignment);
    expect(diff.classification).toBe("OVER_GENERALIZED");
    expect(diff.verificationRequirementRemovals).toBeGreaterThan(0);
  });
});
