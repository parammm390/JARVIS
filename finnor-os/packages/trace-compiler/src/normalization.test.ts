import { describe, expect, it } from "vitest";
import { P6_OPTIONS, reminderBundle, reminderTrace } from "../fixtures/locked-corpus";
import { normalizeExecutionTrace } from "./normalize";
import { isPositiveRealTrace } from "./support";

describe("trace normalization and validity", () => {
  it("preserves gates, dataflow, observations, temporal order, and success verification", () => {
    const trace = reminderTrace({ suffix: "normalized", approval: true });
    expect(trace.outcome).toBe("SUCCESS");
    expect(new Set(trace.edges.map((edge) => edge.kind))).toEqual(expect.objectContaining(new Set(["AUTHORITY", "DATA", "OBSERVATION", "TEMPORAL"])));
    expect(trace.nodes.some((node) => node.semanticKind === "APPROVAL_GATE")).toBe(true);
    expect(trace.nodes.some((node) => node.semanticKind === "SUCCESS_CONDITION" && node.outcome.verified)).toBe(true);
    expect(trace.nodes.some((node) => node.observations.some((observation) => observation.externalRealityRequired))).toBe(true);
  });

  it("never treats provider acknowledgement as verified success", () => {
    const trace = reminderTrace({ suffix: "ack-only", ambiguous: true });
    expect(trace.outcome).toBe("AMBIGUOUS");
    expect(trace.nodes.find((node) => node.operation.equivalenceClass === "communicate.reminder")?.outcome.verified).toBe(false);
  });

  it("classifies verified recovery, terminal failure, incomplete, and corrupt evidence separately", () => {
    expect(reminderTrace({ suffix: "recovered", retry: "SAFE", recovered: true }).outcome).toBe("RECOVERED_SUCCESS");
    expect(reminderTrace({ suffix: "failed", failure: true }).outcome).toBe("FAILURE");
    expect(reminderTrace({ suffix: "incomplete", incomplete: true }).outcome).toBe("INCOMPLETE");
    expect(reminderTrace({ suffix: "corrupt", corrupt: true }).outcome).toBe("CORRUPT");
  });

  it("classifies mixed or partially verified completion as PARTIAL_SUCCESS", () => {
    const bundle = reminderBundle({ suffix: "partial" });
    const trace = normalizeExecutionTrace({
      ...bundle,
      completion: { ...bundle.completion, effectVerifications: ["PARTIALLY_VERIFIED"] },
    }, P6_OPTIONS);
    expect(trace.outcome).toBe("PARTIAL_SUCCESS");
    expect(isPositiveRealTrace(trace)).toBe(false);
  });

  it("retains REAL, SIMULATED, and REPLAY provenance as distinct classes", () => {
    const real = reminderTrace({ suffix: "real" });
    const simulated = reminderTrace({ suffix: "simulated", evidenceClass: "SIMULATED_EXECUTION" });
    const replay = reminderTrace({ suffix: "replay", evidenceClass: "REPLAY_FIXTURE" });
    expect(real.provenance.evidenceClasses).toEqual(["REAL_EXECUTION"]);
    expect(simulated.provenance.evidenceClasses).toEqual(["SIMULATED_EXECUTION"]);
    expect(replay.provenance.evidenceClasses).toEqual(["REPLAY_FIXTURE"]);
  });
});
