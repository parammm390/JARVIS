import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { IR_SCHEMA_VERSION, OPERATIONAL_IR_ADAPTER_MATRIX } from "../../packages/operational-ir/src/index";

const root = resolve(import.meta.dirname, "../..");
const contract = JSON.parse(readFileSync(resolve(root, "architecture/p1/operational-ir-contract.json"), "utf8")) as Record<string, unknown>;
const gates = JSON.parse(readFileSync(resolve(root, "architecture/p1/hard-gates.json"), "utf8")) as {
  gates: Array<{ id: string; expected: number; evidence: Array<{ file: string; title: string }> }>;
};

describe("P1 Operational IR architecture contract", () => {
  it("locks the smallest complete language and explicit existing-substrate boundaries", () => {
    const language = contract.language as { root: string; artifacts: string[]; executionModels: string[] };
    expect((contract.package as { irSchemaVersion: string }).irSchemaVersion).toBe(IR_SCHEMA_VERSION);
    expect(language.root).toBe("OperationalProgram");
    expect(language.artifacts).toEqual([
      "Goal", "Constraint", "EntityRef", "Query", "Effect", "Observation", "Sequence", "Parallel",
      "Branch", "Wait", "Compensation", "SuccessCondition", "Budget", "Provenance",
    ]);
    expect(language.executionModels).toEqual(["QUERY", "CONVERSATION", "ATOMIC_EFFECT", "OBJECTIVE", "KNOWN_ACTION_COMPATIBILITY"]);
    expect(contract.semanticBoundaries).toEqual(expect.arrayContaining([
      "Operational IR Effect is planning intent, not BusinessEffectSet",
      "Authority remains runtime authority",
      "Work and Objective remain durable lifecycle truth",
    ]));
  });

  it("locks the audited adapter matrix, lowerer non-authority guarantees, and no-cutover shadow scope", () => {
    expect(contract.adapters).toEqual(OPERATIONAL_IR_ADAPTER_MATRIX.map(({ representation, actualAtBaseline, toIr, fromIr }) => ({ representation, actualAtBaseline, toIr, fromIr })));
    expect((contract.compatibilityLowerer as { guarantees: Record<string, boolean> }).guarantees).toEqual({
      authorizes: false,
      executes: false,
      persists: false,
      selectsProvider: false,
      compilesBusinessEffect: false,
      derivesIdempotencyKey: false,
      bypassesGrounding: false,
      weakensVerification: false,
    });
    expect(contract.shadow).toMatchObject({
      authoritativePath: "EXISTING",
      productionEligibleExecutionModels: ["QUERY"],
      secondLlmCall: false,
      businessPersistence: false,
      consequentialExecution: false,
    });
    expect(contract.supportedScope).toMatchObject({ productionCutoverPerformed: false });
  });

  it("records every required zero-tolerance P1 hard gate with executable evidence", () => {
    expect(gates.gates).toHaveLength(16);
    expect(new Set(gates.gates.map((gate) => gate.id)).size).toBe(16);
    for (const gate of gates.gates) {
      expect(gate.expected, gate.id).toBe(0);
      expect(gate.evidence.length, gate.id).toBeGreaterThan(0);
      for (const evidence of gate.evidence) {
        expect(readFileSync(resolve(root, evidence.file), "utf8"), `${gate.id}:${evidence.file}`).toContain(evidence.title);
      }
    }
  });
});
