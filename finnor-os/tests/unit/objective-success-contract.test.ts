import { describe, expect, it } from "vitest";
import {
  defaultObjectiveSuccessCondition,
  evaluateObjectiveAssertion,
  parseObjectiveCompletionEvidence,
  parseObjectiveSuccessCondition,
} from "@finnor/orchestration";

describe("Objective business-success contract", () => {
  it("evaluates bounded canonical assertions without a model judge", () => {
    const state = { operations: { tasks: [{ status: "open", count: 2 }, { status: "done", count: 1 }] } };
    expect(evaluateObjectiveAssertion(state, {
      path: ["operations", "tasks"],
      operator: "array_contains",
      expected: { status: "done", count: 1 },
    })).toMatchObject({ satisfied: true });
    expect(evaluateObjectiveAssertion(state, {
      path: ["operations", "tasks", 0, "count"],
      operator: "lte",
      expected: 1,
    })).toMatchObject({ satisfied: false, actual: 2 });
  });

  it("persists validated OQP requests and rejects model-invented query shapes", () => {
    expect(() => parseObjectiveSuccessCondition({
      version: 1,
      statement: "Task must be done",
      mode: "all",
      source: "explicit",
      criteria: [{ kind: "canonical_query", request: { intent: "invented_query" }, assertion: { path: ["done"], operator: "eq", expected: true } }],
    })).toThrow(/Invalid objective success query/);
    expect(() => parseObjectiveCompletionEvidence([{
      kind: "canonical_query",
      request: { intent: "invented_query" },
      assertion: { path: ["done"], operator: "eq", expected: true },
    }])).toThrow(/Invalid objective completion query evidence/);
  });

  it("does not let a generic outcome use a message or workflow receipt as sufficient completion evidence", () => {
    const condition = defaultObjectiveSuccessCondition("Get Peterson's installation unstuck and operational");
    const evidence = condition.criteria.find((criterion) => criterion.kind === "decision_evidence");
    expect(evidence).toMatchObject({ accepted: ["canonical_query"] });
  });
});
