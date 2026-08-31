import { describe, expect, it } from "vitest";
import { composeOperationalProgramEffects } from "@finnor/operational-ir";
import { capability, queryProgram } from "../fixtures/programs";
import { derivePartialOrder } from "./dependencies";
import { solveCpSatConstraint, solveSmtConstraint } from "./solvers";

function context() {
  const program = queryProgram();
  return {
    program,
    effects: composeOperationalProgramEffects(program),
    dependencies: derivePartialOrder(program),
    capabilities: [capability("money_summary")],
    facts: { authorized: true, capacity: 3 },
  };
}

describe("deterministic hard-constraint solvers", () => {
  it("solves typed logical, equality, numeric, capability, and dependency SMT atoms", () => {
    const result = solveSmtConstraint({
      id: "logical",
      kind: "SMT",
      description: "All static facts must hold.",
      expression: {
        kind: "ALL",
        expressions: [
          { kind: "ATOM", atom: { kind: "CAPABILITY_AVAILABLE", capability: "query:money_summary" } },
          { kind: "ATOM", atom: { kind: "FACT_COMPARE", fact: "authorized", operator: "EQ", value: true } },
          { kind: "ATOM", atom: { kind: "FACT_COMPARE", fact: "capacity", operator: "GTE", value: 2 } },
          { kind: "NOT", expression: { kind: "ATOM", atom: { kind: "FACT_COMPARE", fact: "capacity", operator: "LTE", value: 1 } } },
        ],
      },
    }, context(), "test-smt-v1", 20);
    expect(result).toMatchObject({ status: "SAT", exploredNodes: 4 });
  });

  it("fails closed on unknown facts and on a deterministic SMT time bound", () => {
    const unknown = solveSmtConstraint({
      id: "unknown",
      kind: "SMT",
      description: "Unknown must not pass.",
      expression: { kind: "ATOM", atom: { kind: "FACT_COMPARE", fact: "missing", operator: "EQ", value: true } },
    }, context(), "test-smt-v1", 20);
    expect(unknown).toMatchObject({ status: "UNKNOWN", reasonCodes: ["SMT_FORMULA_CONTAINS_UNKNOWN_FACT"] });

    const exhausted = solveSmtConstraint({
      id: "bounded",
      kind: "SMT",
      description: "Bounded formula.",
      expression: { kind: "ALL", expressions: Array.from({ length: 4 }, () => ({ kind: "ATOM" as const, atom: { kind: "FACT_COMPARE" as const, fact: "authorized", operator: "EQ" as const, value: true } })) },
    }, context(), "test-smt-v1", 2);
    expect(exhausted).toMatchObject({ status: "UNKNOWN", reasonCodes: ["SMT_DETERMINISTIC_TIME_BOUND_EXHAUSTED"], exploredNodes: 2 });
  });

  it("short-circuits decisive SMT branches without consuming irrelevant bounded work", () => {
    const result = solveSmtConstraint({
      id: "short-circuit",
      kind: "SMT",
      description: "A false antecedent proves the implication.",
      expression: {
        kind: "IMPLIES",
        if: { kind: "ATOM", atom: { kind: "FACT_COMPARE", fact: "authorized", operator: "EQ", value: false } },
        then: {
          kind: "ALL",
          expressions: Array.from({ length: 20 }, () => ({ kind: "ATOM" as const, atom: { kind: "FACT_COMPARE" as const, fact: "missing", operator: "EQ" as const, value: true } })),
        },
      },
    }, context(), "test-smt-v1", 1);
    expect(result).toMatchObject({ status: "SAT", exploredNodes: 1, deterministicTimeUnits: 1 });
  });

  it("solves a bounded assignment/capacity CP-SAT model with deterministic tie-breaking", () => {
    const result = solveCpSatConstraint({
      id: "assignment",
      kind: "CP_SAT",
      description: "Assign two jobs to distinct slots under capacity.",
      candidateFactPrefix: "assignment.",
      model: {
        variables: [{ id: "jobA", domain: [0, 1, 2] }, { id: "jobB", domain: [0, 1, 2] }],
        constraints: [
          { kind: "ALL_DIFFERENT", variables: ["jobA", "jobB"] },
          { kind: "LINEAR", terms: [{ variable: "jobA", coefficient: 1 }, { variable: "jobB", coefficient: 1 }], operator: "LTE", bound: 3 },
        ],
        objective: { direction: "MINIMIZE", terms: [{ variable: "jobA", coefficient: 1 }, { variable: "jobB", coefficient: 1 }] },
      },
    }, {}, "test-cp-sat-v1", 100);
    expect(result).toMatchObject({ status: "OPTIMAL", objectiveValue: 1, assignment: { jobA: 0, jobB: 1 } });
  });

  it("returns INFEASIBLE or UNKNOWN rather than a partial assignment", () => {
    const constraint = {
      id: "impossible",
      kind: "CP_SAT" as const,
      description: "Impossible all-different singleton domains.",
      candidateFactPrefix: "x.",
      model: {
        variables: [{ id: "a", domain: [1] }, { id: "b", domain: [1] }],
        constraints: [{ kind: "ALL_DIFFERENT" as const, variables: ["a", "b"] }],
      },
    };
    const infeasible = solveCpSatConstraint(constraint, {}, "test-cp-sat-v1", 100);
    expect(infeasible).toMatchObject({ status: "INFEASIBLE" });
    expect(infeasible).not.toHaveProperty("assignment");
    expect(solveCpSatConstraint({ ...constraint, id: "bounded" }, {}, "test-cp-sat-v1", 1)).toMatchObject({
      status: "UNKNOWN",
      reasonCodes: ["CP_SAT_DETERMINISTIC_TIME_BOUND_EXHAUSTED"],
      exploredNodes: 1,
      deterministicTimeUnits: 1,
    });
  });
});
