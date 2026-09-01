import type {
  ProgramSimulationEvidence,
  SearchRejectionReasonCode,
} from "./contracts";

export interface ProgramSimulationEvidenceValidation {
  valid: boolean;
  reasonCode: Extract<SearchRejectionReasonCode,
    | "P5_SIMULATION_INCOMPLETE"
    | "P5_SIMULATION_UNSUPPORTED"
    | "P5_SIMULATION_SIDE_EFFECT_ESCAPE"
    | "P5_SIMULATION_BRANCH_COVERAGE_INCOMPLETE"
    | "P5_SIMULATION_HARD_CONSTRAINT_VIOLATION"
    | "P5_SIMULATION_OWNERSHIP_VIOLATION"
    | "P5_SIMULATION_EVIDENCE_INVALID"> | null;
  detailCodes: string[];
}

function invalid(detailCodes: string[]): ProgramSimulationEvidenceValidation {
  return { valid: false, reasonCode: "P5_SIMULATION_EVIDENCE_INVALID", detailCodes: [...new Set(detailCodes)].sort() };
}

function safeCount(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}

function exactHashIdentity(value: unknown, prefix: string): boolean {
  return typeof value === "string" && value.startsWith(prefix)
    && /^[0-9a-f]{64}$/.test(value.slice(prefix.length));
}

/** Fixed, fail-closed P5 evidence gates. Callers cannot soften these into scores. */
export function validateProgramSimulationEvidence(
  evidence: ProgramSimulationEvidence,
  expected?: { tenantId: string; programIrSemanticHash: string; p4CandidateHash: string },
): ProgramSimulationEvidenceValidation {
  if (!evidence || evidence.version !== 1 || evidence.source !== "P5") return invalid(["P5_EVIDENCE_SCHEMA_INVALID"]);
  if (!evidence.tenantId?.trim()
    || !evidence.programIrSemanticHash?.startsWith("ir:sha256:")
    || !evidence.p4CandidateHash?.startsWith("p4:program:sha256:")) return invalid(["P5_EVIDENCE_BINDING_MISSING"]);
  if (expected && (evidence.tenantId !== expected.tenantId
    || evidence.programIrSemanticHash !== expected.programIrSemanticHash
    || evidence.p4CandidateHash !== expected.p4CandidateHash)) return invalid(["P5_EVIDENCE_PROGRAM_OR_TENANT_BINDING_MISMATCH"]);
  if (!exactHashIdentity(evidence.snapshotId, "p5:snapshot:sha256:")
    || !exactHashIdentity(evidence.replayIdentity, "p5:replay:sha256:")
    || !exactHashIdentity(evidence.traceId, "p5:trace:sha256:")) return invalid(["P5_EVIDENCE_IDENTITY_DOMAIN_INVALID"]);
  if (![evidence.requiredBranches, evidence.simulatedBranches, evidence.highRiskBranchesDiscarded].every(safeCount)
    || !Array.isArray(evidence.branches)
    || !Array.isArray(evidence.issueCodes)
    || evidence.issueCodes.some((code) => typeof code !== "string" || !code.trim())) return invalid(["P5_EVIDENCE_COUNTS_INVALID"]);
  if (!evidence.ownership || evidence.ownership.predictsWorlds !== "P5"
    || evidence.ownership.selectsPrograms !== "P4"
    || evidence.ownership.epistemicOwner !== "P3"
    || evidence.ownership.staticAdmissibilityOwner !== "P2"
    || evidence.ownership.authoritativeExecution !== "EXISTING_GOVERNED_RUNTIME") {
    return { valid: false, reasonCode: "P5_SIMULATION_OWNERSHIP_VIOLATION", detailCodes: ["P4_SELECTION_OR_GOVERNED_EXECUTION_OWNERSHIP_CHANGED"] };
  }
  if (!evidence.realSideEffects || typeof evidence.realSideEffects !== "object") return invalid(["P5_SIDE_EFFECT_COUNTERS_MISSING"]);
  const requiredSideEffectCounters = [
    "dbMutations", "providerCalls", "computerMutations", "authorityDecisions", "approvalRequests",
    "workTransitions", "outboxWrites", "externalWebhooks", "paymentMutations",
  ];
  if (requiredSideEffectCounters.some((name) => !Object.prototype.hasOwnProperty.call(evidence.realSideEffects, name))
    || Object.keys(evidence.realSideEffects).some((name) => !requiredSideEffectCounters.includes(name))) return invalid(["P5_SIDE_EFFECT_COUNTERS_INCOMPLETE"]);
  const sideEffectEscapes = Object.entries(evidence.realSideEffects)
    .filter(([, count]) => !safeCount(count) || count !== 0)
    .map(([name]) => name);
  if (sideEffectEscapes.length > 0) {
    return { valid: false, reasonCode: "P5_SIMULATION_SIDE_EFFECT_ESCAPE", detailCodes: sideEffectEscapes.sort() };
  }
  if (evidence.status === "UNSUPPORTED") {
    return { valid: false, reasonCode: "P5_SIMULATION_UNSUPPORTED", detailCodes: [...new Set(evidence.issueCodes)].sort() };
  }
  if (evidence.status !== "COMPLETE" || evidence.budgetExhausted) {
    return { valid: false, reasonCode: "P5_SIMULATION_INCOMPLETE", detailCodes: [...new Set([evidence.status, ...evidence.issueCodes])].sort() };
  }
  if (evidence.requiredBranches < 1
    || evidence.simulatedBranches !== evidence.requiredBranches
    || evidence.branches.length !== evidence.requiredBranches
    || evidence.highRiskBranchesDiscarded !== 0) {
    return {
      valid: false,
      reasonCode: "P5_SIMULATION_BRANCH_COVERAGE_INCOMPLETE",
      detailCodes: [
        ...(evidence.requiredBranches < 1 ? ["NO_REQUIRED_BRANCHES"] : []),
        ...(evidence.simulatedBranches !== evidence.requiredBranches ? ["SIMULATED_BRANCH_COUNT_MISMATCH"] : []),
        ...(evidence.branches.length !== evidence.requiredBranches ? ["BRANCH_EVIDENCE_COUNT_MISMATCH"] : []),
        ...(evidence.highRiskBranchesDiscarded !== 0 ? ["HIGH_RISK_BRANCH_DISCARDED"] : []),
      ],
    };
  }
  const ids = new Set<string>();
  for (const branch of evidence.branches) {
    if (!exactHashIdentity(branch.branchId, "p5:branch:sha256:") || ids.has(branch.branchId)) return invalid(["P5_BRANCH_IDENTITY_INVALID_OR_DUPLICATE"]);
    ids.add(branch.branchId);
    if (![0, 250, 500, 750, 1_000].includes(branch.goalSatisfactionOrdinal)
      || !safeCount(branch.humanInterruptionsUpperBound)
      || (branch.latencyMs !== null && !safeCount(branch.latencyMs))
      || (branch.financialCost !== null && (typeof branch.financialCost !== "number" || !Number.isFinite(branch.financialCost) || branch.financialCost < 0))
      || !Array.isArray(branch.failureModeCodes)
      || branch.failureModeCodes.some((code) => typeof code !== "string" || !code.trim())
      || !Array.isArray(branch.uncertaintyRemaining)
      || branch.uncertaintyRemaining.some((variable) => typeof variable !== "string" || !variable.trim())
      || (branch.financialCost === null) !== (branch.financialCurrency === null)
      || (branch.financialCurrency !== null && !branch.financialCurrency.trim())
      || (branch.consequentialFailure && branch.failureModeCodes.length === 0)
      || (branch.outcome === "PREDICTED_SUCCESS" && branch.consequentialFailure && branch.recoveryBurden === "NONE")) return invalid(["P5_BRANCH_EVIDENCE_INVALID"]);
    if (!["PREDICTED_SUCCESS", "PREDICTED_FAILURE", "PREDICTED_PARTIAL", "UNKNOWN"].includes(branch.outcome)
      || !["SATISFIED", "VIOLATED", "UNKNOWN"].includes(branch.hardConstraintStatus)
      || !["CANONICAL_PREDICTED", "HYPOTHETICAL_PREDICTED", "WEAK_PREDICTED", "UNKNOWN"].includes(branch.verificationStrength)
      || !["NONE", "LOW", "MEDIUM", "HIGH", "UNKNOWN"].includes(branch.recoveryBurden)
      || !["READ_ONLY", "REVERSIBLE", "COMPENSATABLE", "IRREVERSIBLE", "UNKNOWN"].includes(branch.irreversibility)) return invalid(["P5_BRANCH_ENUM_INVALID"]);
  }
  const violated = evidence.branches.filter((branch) => branch.hardConstraintStatus === "VIOLATED").map((branch) => branch.branchId);
  if (violated.length > 0) {
    return { valid: false, reasonCode: "P5_SIMULATION_HARD_CONSTRAINT_VIOLATION", detailCodes: violated.sort() };
  }
  return { valid: true, reasonCode: null, detailCodes: [] };
}
