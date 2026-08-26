import { canonicalSerialize } from "./canonical";
import type { PlanningSemanticDiff, PlanningSemanticSnapshot } from "./types";

const sortSemantic = <T>(values: T[]): T[] => [...values].sort((a, b) => canonicalSerialize(a).localeCompare(canonicalSerialize(b)));
const targetSemantics = (values: PlanningSemanticSnapshot["groundedTargets"]) => sortSemantic(values.map(({ field: _field, provenance: _provenance, ...semantic }) => semantic));

function normalize(snapshot: PlanningSemanticSnapshot): Record<string, unknown> {
  return {
    executionModel: snapshot.executionModel,
    groundedTargets: targetSemantics(snapshot.groundedTargets),
    scope: {
      included: targetSemantics(snapshot.scope.included),
      excluded: targetSemantics(snapshot.scope.excluded),
      textExclusions: [...snapshot.scope.textExclusions].sort(),
    },
    intendedOutcome: snapshot.intendedOutcome,
    effects: snapshot.effects.map((effect) => ({ ...effect, dependsOn: [...effect.dependsOn].sort() })),
    hardConstraints: sortSemantic(snapshot.hardConstraints),
    completionPredicates: sortSemantic(snapshot.completionPredicates),
  };
}

export function comparePlanningSemantics(legacy: PlanningSemanticSnapshot, ir: PlanningSemanticSnapshot): PlanningSemanticDiff {
  const comparedFields = ["executionModel", "groundedTargets", "scope", "intendedOutcome", "effects", "hardConstraints", "completionPredicates"];
  if (!legacy.valid || !ir.valid) return { classification: "FIXTURE_INVALID", differences: [], comparedFields };
  if (!legacy.supported) return { classification: "LEGACY_UNSUPPORTED", differences: [], comparedFields };
  if (!ir.supported) return { classification: "IR_UNSUPPORTED", differences: [], comparedFields };
  const left = normalize(legacy);
  const right = normalize(ir);
  const differences = comparedFields.filter((field) => canonicalSerialize(left[field]) !== canonicalSerialize(right[field]))
    .map((field) => ({ field, legacy: left[field], ir: right[field] }));
  if (differences.length === 0) return { classification: "EQUIVALENT", differences, comparedFields };

  const nonStrengthening = differences.filter(({ field }) => !["hardConstraints", "completionPredicates"].includes(field));
  // "More rows" is not proof of strengthening: replacing a legacy hard bound or
  // completion predicate with a different one of equal cardinality is a regression.
  // Expected improvements must retain the complete normalized legacy set and add
  // only verification-floor-respecting semantics.
  const irHard = new Set(ir.hardConstraints.map(canonicalSerialize));
  const hardStrengthened = legacy.hardConstraints.every((constraint) => irHard.has(canonicalSerialize(constraint)));
  const irObservations = new Set(ir.completionPredicates.map(canonicalSerialize));
  const observationStrengthened = legacy.completionPredicates.every((observation) => irObservations.has(canonicalSerialize(observation)))
    && ir.completionPredicates.every((observation) => observation.acknowledgementSufficient === false && observation.verificationFloor === "at_least_existing");
  return {
    classification: nonStrengthening.length === 0 && hardStrengthened && observationStrengthened ? "EXPECTED_IMPROVEMENT" : "REGRESSION",
    differences,
    comparedFields,
  };
}
