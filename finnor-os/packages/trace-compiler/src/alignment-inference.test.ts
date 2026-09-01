import { describe, expect, it } from "vitest";
import { compileProcedureCandidate } from "./compiler";
import { P6_OPTIONS, reminderBundle, reminderTrace } from "../fixtures/locked-corpus";
import { normalizeExecutionTrace } from "./normalize";

describe("semantic alignment and conservative inference", () => {
  it("aligns reordered independent operations and provider implementations without array position", () => {
    const result = compileProcedureCandidate([
      reminderTrace({ suffix: "align-a", reorderIndependent: true, provider: "provider-a" }),
      reminderTrace({ suffix: "align-b", reorderIndependent: true, provider: "provider-b" }),
    ], P6_OPTIONS);
    expect(result.alignment.groups.find((group) => group.operation === "read.risk_flag")?.supportingTraceCount).toBe(2);
    expect(result.alignment.groups.find((group) => group.operation === "communicate.reminder")?.supportingTraceCount).toBe(2);
  });

  it("does not turn opposite incidental timestamps on independent steps into a procedure cycle", () => {
    const bundleA = reminderBundle({ suffix: "temporal-order-a", reorderIndependent: true });
    const bundleB = reminderBundle({ suffix: "temporal-order-b", reorderIndependent: true });
    const riskA = bundleA.events.find((event) => event.operation.equivalenceClass === "read.risk_flag")!;
    const historyA = bundleA.events.find((event) => event.operation.equivalenceClass === "read.contact_history")!;
    const riskB = bundleB.events.find((event) => event.operation.equivalenceClass === "read.risk_flag")!;
    const historyB = bundleB.events.find((event) => event.operation.equivalenceClass === "read.contact_history")!;
    riskA.occurredAt = "2026-08-01T10:02:30.000Z";
    historyA.occurredAt = "2026-08-01T10:02:45.000Z";
    historyB.occurredAt = "2026-08-01T10:02:30.000Z";
    riskB.occurredAt = "2026-08-01T10:02:45.000Z";
    const result = compileProcedureCandidate([
      normalizeExecutionTrace(bundleA, P6_OPTIONS),
      normalizeExecutionTrace(bundleB, P6_OPTIONS),
    ], P6_OPTIONS);
    const steps = new Map(result.candidate.programStructure.steps.map((step) => [step.operation, step.stepId]));
    const risk = steps.get("read.risk_flag")!;
    const history = steps.get("read.contact_history")!;
    expect(result.candidate.programStructure.edges).not.toContainEqual(expect.objectContaining({ from: risk, to: history, kind: "TEMPORAL" }));
    expect(result.candidate.programStructure.edges).not.toContainEqual(expect.objectContaining({ from: history, to: risk, kind: "TEMPORAL" }));
  });

  it("distinguishes constants, parameters, and derived parameters with evidence", () => {
    const result = compileProcedureCandidate([
      reminderTrace({ suffix: "values-a", amount: 2480, channel: "SMS", derived: true }),
      reminderTrace({ suffix: "values-b", amount: 910, channel: "SMS", derived: true }),
    ], P6_OPTIONS);
    expect(result.candidate.constants.some((constant) => constant.semanticType === "Channel" && constant.support.realExecution.supporting === 2)).toBe(true);
    expect(result.candidate.parameters.some((parameter) => parameter.semanticType === "Amount" && parameter.classification === "PARAMETER")).toBe(true);
    expect(result.candidate.derivedValues.some((value) => value.provenanceComplete)).toBe(true);
  });

  it("infers only observed branches and bounded multi-trace loops", () => {
    const branch = compileProcedureCandidate([
      reminderTrace({ suffix: "branch-a", branchArm: "EMAIL", branchState: "TRUE", channel: "EMAIL" }),
      reminderTrace({ suffix: "branch-b", branchArm: "SMS", branchState: "FALSE", channel: "SMS" }),
    ], P6_OPTIONS);
    expect(branch.candidate.branches[0]?.arms.map((arm) => arm.label).sort()).toEqual(["EMAIL", "SMS"]);
    expect(branch.candidate.branches[0]?.unseenArmsInvented).toBe(0);
    const oneArm = compileProcedureCandidate([
      reminderTrace({ suffix: "one-arm-a", branchArm: "EMAIL" }),
      reminderTrace({ suffix: "one-arm-b", branchArm: "EMAIL" }),
    ], P6_OPTIONS);
    expect(oneArm.candidate.branches).toEqual([]);
    const loop = compileProcedureCandidate([reminderTrace({ suffix: "loop-a", loop: true }), reminderTrace({ suffix: "loop-b", loop: true })], P6_OPTIONS);
    expect(loop.candidate.loops).toHaveLength(1);
    const repeated = compileProcedureCandidate([reminderTrace({ suffix: "repeat", repeatedWithoutLoop: true })], P6_OPTIONS);
    expect(repeated.candidate.loops).toHaveLength(0);
  });

  it("separates safe, reconcile-before, human/unknown retry authority", () => {
    const safe = compileProcedureCandidate([reminderTrace({ suffix: "safe", retry: "SAFE", recovered: true })], P6_OPTIONS);
    const reconcile = compileProcedureCandidate([reminderTrace({ suffix: "reconcile", retry: "RECONCILE", recovered: true })], P6_OPTIONS);
    const human = compileProcedureCandidate([reminderTrace({ suffix: "human", retry: "HUMAN", recovered: true })], P6_OPTIONS);
    const unknown = compileProcedureCandidate([reminderTrace({ suffix: "unknown", retry: "UNKNOWN", recovered: true })], P6_OPTIONS);
    expect(safe.candidate.retries[0]).toMatchObject({ classification: "SAFE_RETRY", automatic: true });
    expect(reconcile.candidate.retries[0]).toMatchObject({ classification: "RECONCILIATION_BEFORE_RETRY", automatic: true });
    expect(human.candidate.retries[0]).toMatchObject({ classification: "HUMAN_RETRY", automatic: false });
    expect(unknown.candidate.retries[0]).toMatchObject({ classification: "UNKNOWN", automatic: false });
  });

  it("distinguishes deadline, polling, and unknown waits without inventing sleeps", () => {
    const deadline = compileProcedureCandidate([reminderTrace({ suffix: "deadline-a", wait: "DEADLINE" }), reminderTrace({ suffix: "deadline-b", wait: "DEADLINE" })], P6_OPTIONS);
    const polling = compileProcedureCandidate([reminderTrace({ suffix: "polling-a", wait: "POLLING" }), reminderTrace({ suffix: "polling-b", wait: "POLLING" })], P6_OPTIONS);
    const unknown = compileProcedureCandidate([reminderTrace({ suffix: "wait-unknown-a", wait: "UNKNOWN" }), reminderTrace({ suffix: "wait-unknown-b", wait: "UNKNOWN" })], P6_OPTIONS);
    expect(deadline.candidate.waits[0]).toMatchObject({ kind: "DEADLINE", durationsMs: [] });
    expect(polling.candidate.waits[0]).toMatchObject({ kind: "POLLING", pollIntervalsMs: [60_000], durationsMs: [] });
    expect(unknown.candidate.waits[0]).toMatchObject({ kind: "UNKNOWN", durationsMs: [] });
  });

  it("preserves event waits, approval gates, observations, model roles, and compensation", () => {
    const result = compileProcedureCandidate([
      reminderTrace({ suffix: "control-a", approval: true, modelDecision: true, compensation: true, recovered: true }),
      reminderTrace({ suffix: "control-b", approval: true, modelDecision: true, compensation: true, recovered: true }),
    ], P6_OPTIONS);
    expect(result.candidate.waits.some((wait) => wait.kind === "EVENT_DRIVEN" && wait.durationsMs.length === 0)).toBe(true);
    expect(result.candidate.authorityRequirements.some((requirement) => requirement.approvalRequired && requirement.grantsAuthority === false)).toBe(true);
    expect(result.candidate.observations.some((observation) => observation.externalRealityRequired)).toBe(true);
    expect(result.candidate.modelDecisions.every((decision) => !decision.promptTranscriptPersisted && !decision.chainOfThoughtPersisted)).toBe(true);
    expect(result.candidate.compensation.length).toBeGreaterThan(0);
  });

  it("keeps negative evidence separate from the positive procedure body", () => {
    const result = compileProcedureCandidate([
      reminderTrace({ suffix: "positive-body" }),
      reminderTrace({ suffix: "negative-body", failure: true, failureOnlyAction: true }),
    ], P6_OPTIONS);
    expect(result.candidate.programStructure.steps.some((step) => step.operation === "mutate.failure_only")).toBe(false);
    expect(result.candidate.evidence.negativeOnlyExcludedOperations).toContainEqual(expect.objectContaining({
      operation: "mutate.failure_only",
      reason: "NEGATIVE_ONLY_NOT_POSITIVE_PROCEDURE_BODY",
    }));
    expect(result.semanticDiff.classification).not.toBe("OVER_GENERALIZED");
  });
});
