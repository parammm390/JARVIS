import { describe, expect, it } from "vitest";
import { internalCanonicalWriteProgram } from "../../operational-ir/fixtures/p2-programs";
import { parallelProgram, sequenceProgram } from "../../operational-ir/fixtures/programs";
import { simulateOperationalProgram } from "./interpreter";
import { effectWorldVariable, outcome, simulationInput, snapshotForProgram } from "./test-support";

describe("P5 simulation budgets", () => {
  it.each([
    ["maxSimulationSteps", { maxSimulationSteps: 1 }, "MAX_SIMULATION_STEPS_EXCEEDED"],
    ["maxSimulationMs", { maxSimulationMs: 1 }, "MAX_SIMULATION_MS_EXCEEDED"],
    ["maxMemory", { maxMemory: 1 }, "MAX_MEMORY_EXCEEDED"],
  ])("fails boundedly at %s", async (_name, bounds, reasonCode) => {
    const program = internalCanonicalWriteProgram();
    const snapshot = await snapshotForProgram({ program });
    const result = await simulateOperationalProgram(simulationInput({ program, snapshot, bounds }));
    expect(result.status).toBe("BOUNDED_INCOMPLETE");
    expect(result.stats.budgetExhausted).toBe(true);
    expect(result.stats.budgetReasonCodes).toContain(reasonCode);
  });

  it("enforces maxDepth on nested program nodes", async () => {
    const program = sequenceProgram();
    if (program.body.kind !== "sequence" || program.body.steps[0]?.kind !== "effect") throw new Error("fixture drift");
    const variable = effectWorldVariable({ effectRef: program.body.steps[0].semanticId, outcomes: [outcome("success", "SUCCESS")] });
    const snapshot = await snapshotForProgram({ program, variables: [variable] });
    const result = await simulateOperationalProgram(simulationInput({ program, snapshot, variables: [variable], bounds: { maxDepth: 1 } }));
    expect(result).toMatchObject({ status: "BOUNDED_INCOMPLETE", stats: { budgetReasonCodes: ["MAX_DEPTH_EXCEEDED"] } });
  });

  it("enforces maxEffects across parallel branches", async () => {
    const program = parallelProgram();
    if (program.body.kind !== "parallel" || program.body.branches[0]?.kind !== "effect") throw new Error("fixture drift");
    const variable = effectWorldVariable({ effectRef: program.body.branches[0].semanticId, outcomes: [outcome("success", "SUCCESS")] });
    const snapshot = await snapshotForProgram({ program, variables: [variable] });
    const result = await simulateOperationalProgram(simulationInput({ program, snapshot, variables: [variable], bounds: { maxEffects: 1 } }));
    expect(result.status).toBe("BOUNDED_INCOMPLETE");
    expect(result.stats.budgetReasonCodes).toContain("MAX_EFFECTS_EXCEEDED");
  });

  it("marks a final-branch memory stop as an exhausted bounded result", async () => {
    const program = internalCanonicalWriteProgram();
    const snapshot = await snapshotForProgram({ program });
    const complete = await simulateOperationalProgram(simulationInput({ program, snapshot }));
    const preflight = await simulateOperationalProgram(simulationInput({ program, snapshot, bounds: { maxMemory: 1 } }));
    const limit = preflight.stats.estimatedMemoryBytes
      + Math.max(1, Math.floor((complete.stats.estimatedMemoryBytes - preflight.stats.estimatedMemoryBytes) / 2));
    const result = await simulateOperationalProgram(simulationInput({
      program,
      snapshot,
      bounds: { maxMemory: limit },
    }));
    expect(result).toMatchObject({
      status: "BOUNDED_INCOMPLETE",
      stats: { budgetExhausted: true, budgetReasonCodes: ["MAX_MEMORY_EXCEEDED"] },
    });
  });
});
