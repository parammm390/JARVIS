import { describe, expect, it } from "vitest";
import { reseal, waitProgram } from "../../operational-ir/fixtures/programs";
import type { WorldVariable } from "./contracts";
import { simulateOperationalProgram } from "./interpreter";
import { P5_TEST_NOW, P5_TEST_TENANT, outcome, simulationInput, snapshotForProgram } from "./test-support";

function waitVariable(waitRef: string, status: "SUCCESS" | "TIMEOUT" | "UNKNOWN"): WorldVariable {
  const propositionId = `p3:wait:${waitRef}`;
  return {
    id: `world-variable:${waitRef}`,
    tenantId: P5_TEST_TENANT,
    sourcePropositionId: propositionId,
    binding: { kind: "WAIT_EVENT", waitRef },
    possibleOutcomes: [outcome(status.toLowerCase(), status)],
    evidence: [propositionId],
    confidenceQuality: "LOW",
    provenance: { owner: "P3", propositionId, evidenceRefs: [propositionId], asOf: P5_TEST_NOW },
  };
}

describe("P5 Wait and matched-event semantics", () => {
  it("predicts only the exact wait event and keeps verification predicted-only", async () => {
    const program = waitProgram();
    if (program.body.kind !== "wait") throw new Error("fixture drift");
    const variable = waitVariable(program.body.semanticId, "SUCCESS");
    const snapshot = await snapshotForProgram({ program, variables: [variable] });
    const result = await simulateOperationalProgram(simulationInput({ program, snapshot, variables: [variable] }));
    expect(result.branches[0]?.simulatedObservations[0]).toMatchObject({
      status: "SATISFIED",
      evidenceClass: "PREDICTED_EXTERNAL",
      verification: "PREDICTED_ONLY",
      reasonCodes: ["EVENT_MATCH_PREDICTED_ONLY"],
    });
  });

  it("does not let an unrelated successful wait satisfy a different event observation", async () => {
    const base = waitProgram();
    const program = reseal(base, (draft) => {
      draft.observations[0]!.evidence = { kind: "matched_event", eventType: "different.event", subjectRefs: [] };
    });
    if (program.body.kind !== "wait") throw new Error("fixture drift");
    const variable = waitVariable(program.body.semanticId, "SUCCESS");
    const snapshot = await snapshotForProgram({ program, variables: [variable] });
    const result = await simulateOperationalProgram(simulationInput({ program, snapshot, variables: [variable] }));
    expect(result.branches[0]?.simulatedObservations[0]).toMatchObject({ status: "UNKNOWN", verification: "UNKNOWN" });
  });

  it("exposes a deterministic deadline timeout without inventing an event", async () => {
    const program = waitProgram();
    const snapshot = await snapshotForProgram({ program });
    const result = await simulateOperationalProgram(simulationInput({ program, snapshot }));
    expect(result.branches[0]?.failureModes).toEqual(expect.arrayContaining([expect.objectContaining({ code: "WAIT_TIMEOUT" })]));
    expect(result.branches[0]?.simulatedObservations[0]?.status).toBe("UNKNOWN");
  });
});
