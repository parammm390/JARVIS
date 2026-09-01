import { describe, expect, it } from "vitest";
import {
  financialWriteProgram,
  internalCanonicalWriteProgram,
} from "../../operational-ir/fixtures/p2-programs";
import { simulateOperationalProgram, ZERO_REAL_SIDE_EFFECTS } from "./interpreter";
import { effectWorldVariable, outcome, simulationInput, snapshotForProgram } from "./test-support";

describe("P5 speculative OperationalProgram interpreter", () => {
  it("applies a canonical write only as an isolated hypothetical overlay", async () => {
    const program = internalCanonicalWriteProgram();
    const snapshot = await snapshotForProgram({ program });
    const before = structuredClone(snapshot);
    const result = await simulateOperationalProgram(simulationInput({ program, snapshot }));
    expect(result.status).toBe("COMPLETE");
    expect(result.sideEffects).toEqual(ZERO_REAL_SIDE_EFFECTS);
    expect(result.branches).toHaveLength(1);
    expect(result.branches[0]!.effectOverlay[0]).toMatchObject({
      kind: "hypothetical_effect",
      adapterClass: "CANONICAL_WRITE",
      outcome: "SUCCESS",
      authoritative: false,
      realBusinessEffectId: null,
      identityDomain: "P5_HYPOTHETICAL",
    });
    expect(result.branches[0]!.effectOverlay[0]!.changes[0]!.after).toBe(true);
    expect(snapshot).toEqual(before);
  });

  it("expands provider success, failure, and ambiguous outcomes without claiming real verification", async () => {
    const program = financialWriteProgram();
    if (program.body.kind !== "effect") throw new Error("fixture drift");
    const variable = effectWorldVariable({
      effectRef: program.body.semanticId,
      outcomes: [
        outcome("success", "SUCCESS"),
        outcome("failure", "FAILURE"),
        outcome("ambiguous", "AMBIGUOUS", { recovery: { kind: "RECONCILIATION", reasonCode: "provider-result-ambiguous" } }),
      ],
    });
    const snapshot = await snapshotForProgram({ program, variables: [variable] });
    const result = await simulateOperationalProgram(simulationInput({ program, snapshot, variables: [variable] }));
    expect(result.status).toBe("COMPLETE");
    expect(result.branches).toHaveLength(3);
    expect(result.branchOutcomes.map((branch) => branch.outcome).sort()).toEqual(["PREDICTED_FAILURE", "UNKNOWN", "UNKNOWN"]);
    expect(result.branches.flatMap((branch) => branch.simulatedObservations).every((observation) => observation.verification !== ("VERIFIED" as never))).toBe(true);
    expect(result.branches.find((branch) => branch.assumptions[0]?.outcomeId === "ambiguous")?.recoveryPath).toEqual(expect.arrayContaining([expect.objectContaining({ kind: "RECONCILIATION", status: "REQUIRED" })]));
  });

  it("never overrides P2 rejection or a P3 mandatory unknown", async () => {
    const program = internalCanonicalWriteProgram();
    const snapshot = await snapshotForProgram({ program });
    const p2 = await simulateOperationalProgram(simulationInput({ program, snapshot, p2Status: "REJECTED" }));
    const p3 = await simulateOperationalProgram(simulationInput({ program, snapshot, p3Status: "UNRESOLVED" }));
    expect(p2).toMatchObject({ status: "P2_BLOCKED", branches: [], sideEffects: ZERO_REAL_SIDE_EFFECTS });
    expect(p3).toMatchObject({ status: "P3_BLOCKED", branches: [], sideEffects: ZERO_REAL_SIDE_EFFECTS });
  });

  it("revalidates replayed snapshots and rejects forged cross-tenant rows", async () => {
    const program = internalCanonicalWriteProgram();
    const snapshot = await snapshotForProgram({ program });
    const forged = structuredClone(snapshot) as typeof snapshot;
    (forged.canonicalState[0] as { tenantId: string }).tenantId = "different-tenant";
    const result = await simulateOperationalProgram(simulationInput({ program, snapshot: forged }));
    expect(result).toMatchObject({
      status: "FAILED",
      branches: [],
      issues: [expect.objectContaining({ code: "CROSS_TENANT_WORLD_ACCESS" })],
      sideEffects: ZERO_REAL_SIDE_EFFECTS,
    });
  });
});
