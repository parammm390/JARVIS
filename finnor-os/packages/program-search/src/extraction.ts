import {
  canonicalSerialize,
  canonicalizeIrFragment,
  type Goal,
  type ProgramEffectSummary,
} from "@finnor/operational-ir";
import { effectiveEstimate } from "./cost-model";
import type {
  CandidateRecord,
  ExtractionScoreVector,
  SearchSoftObjective,
} from "./contracts";

function stable(value: unknown): string {
  return canonicalSerialize(canonicalizeIrFragment(value));
}

function goalSatisfaction(goal: Goal, candidate: CandidateRecord): number {
  if (stable(goal) === stable(candidate.program.goal)) return 1_000;
  if (stable(goal.predicate) === stable(candidate.program.goal.predicate)) return 900;
  if (goal.statement.trim().toLowerCase() === candidate.program.goal.statement.trim().toLowerCase()) return 700;
  return 0;
}

function verificationStrength(candidate: CandidateRecord): number {
  const evidenceRank = {
    canonical_query: 6,
    canonical_state: 6,
    effect_verification: 5,
    objective_success: 6,
    matched_event: 4,
    delegation_state: 4,
    computer_state: 4,
    workflow_completion: 3,
    recorded_result: 3,
  } as const;
  const required = candidate.program.observations.filter((observation) => observation.strength === "REQUIRED");
  const supplemental = candidate.program.observations.length - required.length;
  const evidence = required.reduce((total, observation) => total + evidenceRank[observation.evidence.kind], 0);
  return Math.min(1_000, required.length * 50 + supplemental * 5 + evidence * 10 + candidate.program.successCondition.criteria.length * 20);
}

function reversibility(summary: ProgramEffectSummary | undefined): number {
  if (!summary) return 0;
  const ranks = {
    READ_ONLY: 1_000,
    REVERSIBLE: 850,
    COMPENSATABLE: 650,
    UNKNOWN: 200,
    IRREVERSIBLE: 0,
  } as const;
  const values = summary.possible.flatMap(({ effect }) => effect.dimension === "REVERSIBILITY" ? [ranks[effect.classification]] : []);
  const base = values.length ? Math.min(...values) : 0;
  return Math.min(1_000, base + Math.min(100, summary.compensationLinks.length * 25));
}

function requiredCapabilities(candidate: CandidateRecord): Set<string> {
  return new Set(candidate.effects?.authorityRequirements.flatMap((requirement) =>
    requirement.kind === "REQUIRES_CAPABILITY" ? [requirement.capability] : []) ?? []);
}

export function extractionVector(input: {
  goal: Goal;
  candidate: CandidateRecord;
  softObjectives: readonly SearchSoftObjective[];
}): ExtractionScoreVector {
  const candidate = input.candidate;
  const capabilities = requiredCapabilities(candidate);
  const preferredCapabilityBonus = input.softObjectives.filter((objective) =>
    objective.kind === "PREFER_CAPABILITY" && objective.capability && capabilities.has(objective.capability)).length;
  const success = candidate.successEstimate.ordinal ?? candidate.successEstimate.fallbackAssumption.ordinal;
  const staticGoal = goalSatisfaction(input.goal, candidate);
  const staticVerification = verificationStrength(candidate);
  const staticReversibility = reversibility(candidate.effects);
  const staticHumanInterruptions = effectiveEstimate(candidate.costEstimate.humanInterruptions);
  const staticLatency = effectiveEstimate(candidate.costEstimate.expectedLatencyMs) + effectiveEstimate(candidate.costEstimate.computerUseMs);
  const staticFinancialCost = effectiveEstimate(candidate.costEstimate.financialSpend) + effectiveEstimate(candidate.costEstimate.providerCalls);
  const simulation = candidate.simulationEvidence;
  const simulationGoal = simulation?.branches.length ? Math.min(...simulation.branches.map((branch) => branch.goalSatisfactionOrdinal)) : null;
  const verificationRanks = { CANONICAL_PREDICTED: 1_000, HYPOTHETICAL_PREDICTED: 700, WEAK_PREDICTED: 400, UNKNOWN: 0 } as const;
  const irreversibilityRanks = { READ_ONLY: 1_000, REVERSIBLE: 850, COMPENSATABLE: 650, UNKNOWN: 200, IRREVERSIBLE: 0 } as const;
  const recoveryRanks = { NONE: 1_000, LOW: 850, MEDIUM: 650, HIGH: 200, UNKNOWN: 0 } as const;
  const outcomeRanks = { PREDICTED_SUCCESS: 1_000, PREDICTED_PARTIAL: 500, UNKNOWN: 250, PREDICTED_FAILURE: 0 } as const;
  const simulationVerification = simulation?.branches.length ? Math.min(...simulation.branches.map((branch) => verificationRanks[branch.verificationStrength])) : null;
  const simulationRecoverability = simulation?.branches.length ? Math.min(...simulation.branches.map((branch) =>
    Math.min(irreversibilityRanks[branch.irreversibility], recoveryRanks[branch.recoveryBurden]))) : null;
  const simulationSuccess = simulation?.branches.length ? Math.min(...simulation.branches.map((branch) => outcomeRanks[branch.outcome])) : null;
  const simulationHumanInterruptions = simulation?.branches.length ? Math.max(...simulation.branches.map((branch) => branch.humanInterruptionsUpperBound)) : null;
  const knownLatencies = simulation?.branches.map((branch) => branch.latencyMs).filter((value): value is number => value !== null) ?? [];
  const simulationLatency = simulation && knownLatencies.length === simulation.branches.length ? Math.max(...knownLatencies) : null;
  const knownFinancialCosts = simulation?.branches.filter((branch) => branch.financialCost !== null
    && branch.financialCurrency === candidate.costEstimate.financialSpend.unit).map((branch) => branch.financialCost!) ?? [];
  const simulationFinancialCost = simulation && knownFinancialCosts.length === simulation.branches.length ? Math.max(...knownFinancialCosts) : null;
  return {
    safetyLegality: 1_000,
    goalSatisfaction: simulationGoal === null ? staticGoal : Math.min(staticGoal, simulationGoal),
    verificationStrength: simulationVerification === null ? staticVerification : Math.min(staticVerification, simulationVerification),
    reversibilityRecoverability: simulationRecoverability === null ? staticReversibility : Math.min(staticReversibility, simulationRecoverability),
    successOrdinal: Math.min(1_000, success + preferredCapabilityBonus, simulationSuccess ?? 1_000),
    humanInterruptions: simulationHumanInterruptions === null ? staticHumanInterruptions : Math.max(staticHumanInterruptions, simulationHumanInterruptions),
    latencyMs: simulationLatency === null ? staticLatency : Math.max(staticLatency, simulationLatency),
    financialCost: simulationFinancialCost === null ? staticFinancialCost : Math.max(staticFinancialCost, simulationFinancialCost),
    modelTokenCost: effectiveEstimate(candidate.costEstimate.tokens) + effectiveEstimate(candidate.costEstimate.modelCalls) * 1_000,
    tieBreak: candidate.programHash,
  };
}

/** Required lexicographic objective. Hard violations never reach this comparator. */
export function compareExtractionVectors(left: ExtractionScoreVector, right: ExtractionScoreVector): number {
  const descending: Array<keyof Pick<ExtractionScoreVector,
    "safetyLegality" | "goalSatisfaction" | "verificationStrength" | "reversibilityRecoverability" | "successOrdinal">> = [
      "safetyLegality",
      "goalSatisfaction",
      "verificationStrength",
      "reversibilityRecoverability",
      "successOrdinal",
    ];
  for (const key of descending) if (left[key] !== right[key]) return right[key] - left[key];
  const ascending: Array<keyof Pick<ExtractionScoreVector,
    "humanInterruptions" | "latencyMs" | "financialCost" | "modelTokenCost">> = [
      "humanInterruptions",
      "latencyMs",
      "financialCost",
      "modelTokenCost",
    ];
  for (const key of ascending) if (left[key] !== right[key]) return left[key] - right[key];
  return left.tieBreak.localeCompare(right.tieBreak);
}

export function rankCandidates(input: {
  goal: Goal;
  candidates: CandidateRecord[];
  softObjectives: readonly SearchSoftObjective[];
}): CandidateRecord[] {
  for (const candidate of input.candidates) {
    candidate.extractionScore = extractionVector({ goal: input.goal, candidate, softObjectives: input.softObjectives });
  }
  return [...input.candidates].sort((left, right) => compareExtractionVectors(left.extractionScore!, right.extractionScore!));
}
