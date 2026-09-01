import type {
  P5SemanticDiff,
  P5SemanticExpectation,
  SimulationResult,
} from "./contracts";

function set(values: readonly string[]): Set<string> {
  return new Set(values);
}

function missing(expected: readonly string[], actual: Set<string>): string[] {
  return expected.filter((value) => !actual.has(value)).sort();
}

function anyRealSideEffect(result: SimulationResult): boolean {
  return Object.values(result.sideEffects).some((value) => value !== 0);
}

export function compareSimulationSemantics(input: {
  expected: P5SemanticExpectation;
  actual: SimulationResult;
}): P5SemanticDiff {
  if (!input.expected.fixtureValid) return { classification: "FIXTURE_INVALID", reasonCodes: ["FIXTURE_INVALID"] };
  if (!input.expected.supported || input.actual.status === "UNSUPPORTED") return { classification: "UNSUPPORTED", reasonCodes: ["SIMULATION_UNSUPPORTED"] };
  const effectRefs = set(input.actual.branches.flatMap((branch) => branch.effectOverlay.map((effect) => effect.planningEffect.semanticId)));
  const failureCodes = set(input.actual.branches.flatMap((branch) => branch.failureModes.map((failure) => failure.code)));
  const recoveryKinds = set(input.actual.branches.flatMap((branch) => branch.recoveryPath.map((recovery) => recovery.kind)));
  const missingEffects = missing(input.expected.consequentialEffectRefs, effectRefs);
  const hiddenFailures = missing(input.expected.failureModeCodes, failureCodes);
  const weakerRecovery = missing(input.expected.minimumRecoveryKinds, recoveryKinds);
  const falseVerified = input.actual.branches.some((branch) => branch.simulatedObservations.some((observation) =>
    (observation as unknown as { verification: string }).verification === "VERIFIED"));
  const ownershipViolation = input.actual.ownership.selectsPrograms !== "P4"
    || input.actual.ownership.staticAdmissibilityOwner !== "P2"
    || input.actual.ownership.epistemicOwner !== "P3";
  const regressionCodes = [
    ...(input.actual.status !== "COMPLETE" ? [`SIMULATION_NOT_COMPLETE:${input.actual.status}`] : []),
    ...(input.actual.stats.requiredBranches < 1
      || input.actual.stats.simulatedBranches !== input.actual.stats.requiredBranches
      || input.actual.branches.length !== input.actual.stats.requiredBranches ? ["BRANCH_COVERAGE_INCOMPLETE"] : []),
    ...(input.actual.branches.length === 0 ? ["NO_BRANCH_OUTCOMES"] : []),
    ...missingEffects.map((effect) => `LOST_CONSEQUENTIAL_EFFECT:${effect}`),
    ...hiddenFailures.map((failure) => `HIDDEN_FAILURE_BRANCH:${failure}`),
    ...weakerRecovery.map((recovery) => `WEAKER_RECOVERY:${recovery}`),
    ...(falseVerified ? ["FALSE_VERIFIED_COMPLETION"] : []),
    ...(anyRealSideEffect(input.actual) ? ["REAL_SIDE_EFFECT_ESCAPE"] : []),
    ...(ownershipViolation ? ["OWNERSHIP_BOUNDARY_VIOLATION"] : []),
    ...(input.actual.stats.highRiskBranchesDiscarded !== 0 ? ["HIGH_RISK_BRANCH_DISCARDED"] : []),
    ...(input.actual.branches.some((branch) => branch.outcome?.hardConstraintStatus === "VIOLATED") ? ["HARD_CONSTRAINT_VIOLATION"] : []),
  ];
  if (regressionCodes.length > 0) return { classification: "REGRESSION", reasonCodes: regressionCodes.sort() };
  const actualOutcomes = set(input.actual.branchOutcomes.map((outcome) => outcome.outcome));
  if (input.expected.expectedOutcome && !actualOutcomes.has(input.expected.expectedOutcome)) {
    const safer = actualOutcomes.has("UNKNOWN") || actualOutcomes.has("PREDICTED_PARTIAL") || actualOutcomes.has("PREDICTED_FAILURE");
    return safer
      ? { classification: "STRICTER_SAFE", reasonCodes: ["SIMULATION_MORE_CONSERVATIVE_THAN_EXPECTATION"] }
      : { classification: "REGRESSION", reasonCodes: ["EXPECTED_OUTCOME_LOST"] };
  }
  const extraFailure = [...failureCodes].some((code) => !input.expected.failureModeCodes.includes(code));
  const extraRecovery = [...recoveryKinds].some((kind) => !input.expected.minimumRecoveryKinds.includes(kind as never));
  if (extraFailure || extraRecovery) return { classification: "BETTER_PREDICTION", reasonCodes: [extraFailure ? "ADDITIONAL_FAILURE_BRANCH_EXPOSED" : "ADDITIONAL_RECOVERY_EVIDENCE"] };
  return { classification: "EQUIVALENT", reasonCodes: ["STRUCTURED_WORLD_SEMANTICS_EQUIVALENT"] };
}
