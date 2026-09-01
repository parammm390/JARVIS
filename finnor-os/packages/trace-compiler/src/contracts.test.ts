import { describe, expect, it } from "vitest";
import { compileProcedureCandidate } from "./compiler";
import { normalizedTraceBytes } from "./normalize";
import { P6_OPTIONS, reminderTrace } from "../fixtures/locked-corpus";

describe("P6 trace and candidate contracts", () => {
  it("keeps TraceCompiler, Work, BusinessEffect, provider, idempotency, IR, P5, and candidate identities distinct", () => {
    const trace = reminderTrace({ suffix: "identity" });
    const result = compileProcedureCandidate([trace], P6_OPTIONS);
    const source = trace.provenance.sourceIdentities;
    const authoritative = [
      ...source.workIds,
      ...source.businessEffectIds,
      ...source.businessEffectSemanticHashes,
      ...source.providerOperationIds,
      ...source.idempotencyKeys,
      ...source.operationalIrSemanticHashes,
      ...source.p5SimulationTraceIds,
    ];
    expect(trace.traceId).toMatch(/^p6:trace:sha256:/);
    expect(result.candidate.candidateId).toMatch(/^p6:candidate:sha256:/);
    expect(authoritative).not.toContain(trace.traceId);
    expect(authoritative).not.toContain(result.candidate.candidateId);
    expect(result.candidate.candidateId).not.toBe(trace.traceId);
  });

  it("emits a frozen non-executable, uncertified hypothesis with no planner cutover", () => {
    const result = compileProcedureCandidate([reminderTrace({ suffix: "non-executable" })], P6_OPTIONS);
    expect(result.candidate.executionStatus).toBe("NON_EXECUTABLE_HYPOTHESIS");
    expect(result.candidate.certificationStatus).toBe("UNCERTIFIED_P6_HYPOTHESIS");
    expect(result.candidate.operationalIrCompatibility.automaticPlannerInput).toBe(false);
    expect(Object.isFrozen(result)).toBe(true);
    expect(Object.isFrozen(result.candidate.programStructure.steps)).toBe(true);
    expect("execute" in result.candidate).toBe(false);
    expect("authorize" in result.candidate).toBe(false);
  });

  it("is byte-semantically deterministic for identical normalized evidence and compiler inputs", () => {
    const first = reminderTrace({ suffix: "deterministic", amount: 910 });
    const second = reminderTrace({ suffix: "deterministic", amount: 910 });
    expect(normalizedTraceBytes(second)).toBe(normalizedTraceBytes(first));
    const candidateA = compileProcedureCandidate([first], P6_OPTIONS);
    const candidateB = compileProcedureCandidate([second], P6_OPTIONS);
    expect(JSON.stringify(candidateB)).toBe(JSON.stringify(candidateA));
  });
});
