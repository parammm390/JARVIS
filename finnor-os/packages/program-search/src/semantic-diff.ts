import {
  canonicalSerialize,
  canonicalizeIrFragment,
  semanticSnapshotFromOperationalProgram,
  type OperationalProgram,
  type ProgramEffectSummary,
} from "@finnor/operational-ir";
import { effectiveEstimate } from "./cost-model";
import type { CandidateRecord, ProgramCostEstimate } from "./contracts";
import { derivePartialOrder } from "./dependencies";

export type ProgramSemanticDiffClassification =
  | "EQUIVALENT"
  | "STRICTER_SAFE"
  | "BETTER_PROGRAM"
  | "REGRESSION"
  | "UNSUPPORTED"
  | "FIXTURE_INVALID";

export interface ProgramSemanticSnapshot {
  goal: string;
  targets: string[];
  hardConstraints: string[];
  dependencies: string[];
  effects: string[];
  authorityRequirements: string[];
  observations: string[];
  successConditions: string[];
  reversibilityRank: number;
  humanInterruptions: number;
  latencyMs: number;
  financialAndProviderCost: number;
  modelAndTokenCost: number;
  unknownCostFields: string[];
}

export interface ProgramSemanticFieldDiff {
  field: keyof ProgramSemanticSnapshot;
  relation: "SAME" | "STRICTER" | "BETTER" | "WORSE" | "DIFFERENT" | "UNKNOWN";
}

export interface ProgramSemanticDiffResult {
  classification: ProgramSemanticDiffClassification;
  reasonCodes: string[];
  differences: ProgramSemanticFieldDiff[];
}

function stable(value: unknown): string {
  return canonicalSerialize(canonicalizeIrFragment(value));
}

function sorted(values: unknown[]): string[] {
  return [...new Set(values.map(stable))].sort();
}

function stripRuntimeIdentity(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stripRuntimeIdentity);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(Object.entries(value as Record<string, unknown>)
    .filter(([key]) => !["effectId", "nodeId"].includes(key))
    .map(([key, child]) => [key, stripRuntimeIdentity(child)]));
}

function reversalRank(summary: ProgramEffectSummary): number {
  const rank = { READ_ONLY: 5, REVERSIBLE: 4, COMPENSATABLE: 3, UNKNOWN: 1, IRREVERSIBLE: 0 } as const;
  const values = summary.possible.flatMap(({ effect }) => effect.dimension === "REVERSIBILITY" ? [rank[effect.classification]] : []);
  return values.length === 0 ? 5 : Math.min(...values);
}

export function programSemanticSnapshot(input: {
  program: OperationalProgram;
  effects: ProgramEffectSummary;
  cost: ProgramCostEstimate;
}): ProgramSemanticSnapshot {
  const ir = semanticSnapshotFromOperationalProgram(input.program);
  const partialOrder = derivePartialOrder(input.program, input.effects);
  const costEntries = Object.entries(input.cost) as Array<[keyof ProgramCostEstimate, ProgramCostEstimate[keyof ProgramCostEstimate]]>;
  return {
    goal: ir.goal,
    targets: ir.canonicalTargets,
    hardConstraints: ir.hardConstraints,
    dependencies: sorted(partialOrder.relations
      .filter((relation) => ["MUST_PRECEDE", "ENABLES", "COMPENSATES", "CONFLICTS", "OBSERVES"].includes(relation.relation))
      .map((relation) => ({ from: relation.from, to: relation.to, relation: relation.relation }))),
    effects: sorted(input.effects.possible.map(({ effect, compensationForEffectId }) => ({
      effect: stripRuntimeIdentity(effect),
      compensationForEffectId: compensationForEffectId ?? null,
    }))),
    authorityRequirements: sorted(input.effects.authorityRequirements),
    observations: ir.expectedObservations,
    successConditions: [ir.successCondition],
    reversibilityRank: reversalRank(input.effects),
    humanInterruptions: effectiveEstimate(input.cost.humanInterruptions),
    latencyMs: effectiveEstimate(input.cost.expectedLatencyMs) + effectiveEstimate(input.cost.computerUseMs),
    financialAndProviderCost: effectiveEstimate(input.cost.financialSpend) + effectiveEstimate(input.cost.providerCalls),
    modelAndTokenCost: effectiveEstimate(input.cost.tokens) + effectiveEstimate(input.cost.modelCalls) * 1_000,
    unknownCostFields: costEntries.filter(([, estimate]) => estimate.value === null).map(([key]) => key).sort(),
  };
}

function setRelation(baseline: string[], optimized: string[]): "SAME" | "STRICTER" | "WORSE" | "DIFFERENT" {
  if (stable(baseline) === stable(optimized)) return "SAME";
  const left = new Set(baseline);
  const right = new Set(optimized);
  const retains = baseline.every((value) => right.has(value));
  const subset = optimized.every((value) => left.has(value));
  return retains ? "STRICTER" : subset ? "WORSE" : "DIFFERENT";
}

function lowerIsBetter(baseline: number, optimized: number): "SAME" | "BETTER" | "WORSE" {
  return baseline === optimized ? "SAME" : optimized < baseline ? "BETTER" : "WORSE";
}

export function compareProgramSemantics(input: {
  fixtureValid?: boolean;
  authoritativeStatus?: "SUPPORTED" | "UNSUPPORTED";
  p4Status?: "SUPPORTED" | "UNSUPPORTED";
  authoritative?: ProgramSemanticSnapshot;
  optimized?: ProgramSemanticSnapshot;
}): ProgramSemanticDiffResult {
  if (input.fixtureValid === false) return { classification: "FIXTURE_INVALID", reasonCodes: ["FIXTURE_INVALID"], differences: [] };
  if (input.authoritativeStatus === "UNSUPPORTED" || input.p4Status === "UNSUPPORTED") {
    return { classification: "UNSUPPORTED", reasonCodes: [input.authoritativeStatus === "UNSUPPORTED" ? "AUTHORITATIVE_PROGRAM_UNSUPPORTED" : "P4_PROGRAM_UNSUPPORTED"], differences: [] };
  }
  if (!input.authoritative || !input.optimized) return { classification: "FIXTURE_INVALID", reasonCodes: ["SEMANTIC_SNAPSHOT_MISSING"], differences: [] };
  const baseline = input.authoritative;
  const optimized = input.optimized;
  const differences: ProgramSemanticFieldDiff[] = [];
  const exact = (["goal", "targets", "effects", "successConditions"] as const);
  for (const field of exact) if (stable(baseline[field]) !== stable(optimized[field])) differences.push({ field, relation: "DIFFERENT" });
  for (const field of ["hardConstraints", "dependencies", "authorityRequirements", "observations"] as const) {
    const relation = setRelation(baseline[field], optimized[field]);
    if (relation !== "SAME") differences.push({ field, relation });
  }
  if (baseline.reversibilityRank !== optimized.reversibilityRank) differences.push({
    field: "reversibilityRank",
    relation: optimized.reversibilityRank > baseline.reversibilityRank ? "STRICTER" : "WORSE",
  });
  for (const field of ["humanInterruptions", "latencyMs", "financialAndProviderCost", "modelAndTokenCost"] as const) {
    const relation = lowerIsBetter(baseline[field], optimized[field]);
    if (relation !== "SAME") differences.push({ field, relation });
  }
  if (stable(baseline.unknownCostFields) !== stable(optimized.unknownCostFields)) differences.push({ field: "unknownCostFields", relation: "UNKNOWN" });

  const safetyFields = new Set<keyof ProgramSemanticSnapshot>([
    "goal", "targets", "hardConstraints", "dependencies", "effects", "authorityRequirements", "observations", "successConditions", "reversibilityRank",
  ]);
  const unsafe = differences.some((difference) => safetyFields.has(difference.field)
    && ["WORSE", "DIFFERENT", "UNKNOWN"].includes(difference.relation));
  if (unsafe) return {
    classification: "REGRESSION",
    reasonCodes: differences.filter((difference) => safetyFields.has(difference.field) && ["WORSE", "DIFFERENT", "UNKNOWN"].includes(difference.relation)).map((difference) => `SAFETY_OR_SEMANTIC_WEAKENING:${difference.field}`),
    differences,
  };
  const performanceWorse = differences.some((difference) => !safetyFields.has(difference.field) && difference.relation === "WORSE");
  if (performanceWorse) return { classification: "REGRESSION", reasonCodes: ["OBJECTIVE_REGRESSION"], differences };
  if (differences.length === 0) return { classification: "EQUIVALENT", reasonCodes: ["NORMALIZED_PROGRAM_SEMANTICS_EQUAL"], differences };
  const improvement = differences.some((difference) => difference.relation === "BETTER");
  if (improvement) return { classification: "BETTER_PROGRAM", reasonCodes: ["LEGAL_LEXICOGRAPHIC_OBJECTIVE_IMPROVEMENT"], differences };
  const stricterSafety = differences.some((difference) => safetyFields.has(difference.field) && difference.relation === "STRICTER");
  if (stricterSafety && differences.every((difference) => safetyFields.has(difference.field) && difference.relation === "STRICTER")) {
    return { classification: "STRICTER_SAFE", reasonCodes: ["SAFETY_OR_VERIFICATION_STRENGTHENED"], differences };
  }
  return { classification: "UNSUPPORTED", reasonCodes: ["DIFFERENCE_NOT_PROVEN_SAFE_OR_BETTER"], differences };
}

export function candidateSemanticSnapshot(candidate: CandidateRecord): ProgramSemanticSnapshot | null {
  return candidate.effects ? programSemanticSnapshot({ program: candidate.program, effects: candidate.effects, cost: candidate.costEstimate }) : null;
}
