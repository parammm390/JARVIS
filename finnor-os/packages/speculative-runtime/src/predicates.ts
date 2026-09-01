import { analyzeProgramGraph, canonicalSerialize, type JsonValue, type Predicate } from "@finnor/operational-ir";
import type {
  BranchAssumption,
  HypotheticalEffect,
  PredictedObservation,
  PredicateEvaluation,
  PredicateEvaluationInput,
  SimulatedQueryResult,
  WorldEntityRef,
  WorldSnapshot,
  WorldVariable,
} from "./contracts";

export interface PredicateRuntimeState {
  snapshot: WorldSnapshot;
  program: PredicateEvaluationInput["view"]["program"];
  variables: readonly WorldVariable[];
  assumptions: readonly BranchAssumption[];
  effects: readonly HypotheticalEffect[];
  queryResults: readonly SimulatedQueryResult[];
  observations: readonly PredictedObservation[];
}

function key(ref: WorldEntityRef): string {
  return `${ref.kind}:${ref.type}:${ref.id}`;
}

function pathEqual(left: Array<string | number>, right: Array<string | number>): boolean {
  return canonicalSerialize(left) === canonicalSerialize(right);
}

export function valueAtPath(value: unknown, path: Array<string | number>): { exists: boolean; value?: unknown } {
  let current = value;
  for (const segment of path) {
    if (typeof segment === "number") {
      if (!Array.isArray(current) || segment < 0 || segment >= current.length) return { exists: false };
      current = current[segment];
    } else {
      if (!current || typeof current !== "object" || Array.isArray(current) || !Object.prototype.hasOwnProperty.call(current, segment)) return { exists: false };
      current = (current as Record<string, unknown>)[segment];
    }
  }
  return { exists: true, value: current };
}

function setAtPath(root: Record<string, unknown>, path: Array<string | number>, value: JsonValue): void {
  if (path.length === 0) return;
  let current: Record<string, unknown> | unknown[] = root;
  path.forEach((segment, index) => {
    const last = index === path.length - 1;
    if (last) {
      if (Array.isArray(current) && typeof segment === "number") current[segment] = structuredClone(value);
      else if (!Array.isArray(current) && typeof segment === "string") current[segment] = structuredClone(value);
      return;
    }
    const nextSegment = path[index + 1]!;
    if (Array.isArray(current)) {
      if (typeof segment !== "number") return;
      const existing = current[segment];
      if (!existing || typeof existing !== "object") current[segment] = typeof nextSegment === "number" ? [] : {};
      current = current[segment] as Record<string, unknown> | unknown[];
    } else {
      if (typeof segment !== "string") return;
      const existing = current[segment];
      if (!existing || typeof existing !== "object") current[segment] = typeof nextSegment === "number" ? [] : {};
      current = current[segment] as Record<string, unknown> | unknown[];
    }
  });
}

export function resolvedWorldRef(state: PredicateRuntimeState, semanticRef: string): WorldEntityRef | null {
  const entity = state.program.entities.find((candidate) => candidate.semanticId === semanticRef);
  if (!entity || entity.resolution.status !== "resolved") return null;
  return { kind: entity.resolution.canonical.kind, type: entity.resolution.canonical.type, id: entity.resolution.canonical.id };
}

export function entityValues(state: PredicateRuntimeState, ref: WorldEntityRef): Record<string, unknown> | null {
  const base = [...state.snapshot.canonicalState, ...state.snapshot.workState].find((record) => key(record.ref) === key(ref));
  const values: Record<string, unknown> = base ? structuredClone(base.values) : {};
  let touched = Boolean(base);
  for (const effect of state.effects) for (const change of effect.changes) if (key(change.target) === key(ref)) {
    setAtPath(values, change.path, change.after);
    touched = true;
  }
  for (const variable of state.variables) {
    if (variable.binding.kind !== "EXTERNAL_STATE" || key(variable.binding.ref) !== key(ref)) continue;
    const assumption = state.assumptions.find((candidate) => candidate.variableId === variable.id);
    if (assumption) {
      setAtPath(values, variable.binding.path, assumption.value);
      touched = true;
    }
  }
  return touched ? values : null;
}

function directAssumption(state: PredicateRuntimeState, subjectRef: string, path: Array<string | number>): BranchAssumption | null {
  for (const variable of state.variables) {
    if (variable.binding.kind !== "PREDICATE" || variable.binding.subjectRef !== subjectRef || !pathEqual(variable.binding.path, path)) continue;
    return state.assumptions.find((assumption) => assumption.variableId === variable.id) ?? null;
  }
  return null;
}

function subjectValue(state: PredicateRuntimeState, predicate: Extract<Predicate, { kind: "assertion" }>): { exists: boolean; value?: unknown } {
  const direct = predicate.subject.ref ? directAssumption(state, predicate.subject.ref, predicate.path) : null;
  if (direct) return { exists: true, value: direct.value };
  if (predicate.subject.kind === "program") {
    const requiredCapabilities = [...new Set([...analyzeProgramGraph(state.program.body).nodes.values()].flatMap(({ node }) =>
      node.kind === "effect" ? [node.requiredCapability] : node.kind === "query" ? [`query:${node.request.intent}`] : []))].sort();
    return valueAtPath({ requiredCapabilities, executionModel: state.program.executionModel }, predicate.path);
  }
  if (!predicate.subject.ref) return { exists: false };
  if (predicate.subject.kind === "entity") {
    const ref = resolvedWorldRef(state, predicate.subject.ref);
    if (!ref) return { exists: false };
    const values = entityValues(state, ref);
    return values ? valueAtPath(values, predicate.path) : { exists: false };
  }
  if (predicate.subject.kind === "query") {
    const result = [...state.queryResults].reverse().find((candidate) => candidate.queryRef === predicate.subject.ref);
    return result ? valueAtPath(result.values, predicate.path) : { exists: false };
  }
  if (predicate.subject.kind === "effect") {
    const effect = [...state.effects].reverse().find((candidate) => candidate.planningEffect.semanticId === predicate.subject.ref);
    return effect ? valueAtPath({ status: effect.outcome, predicted: true, changes: effect.changes }, predicate.path) : { exists: false };
  }
  const observation = state.observations.find((candidate) => candidate.observationRef === predicate.subject.ref);
  return observation ? valueAtPath(observation, predicate.path) : { exists: false };
}

function equal(left: unknown, right: unknown): boolean {
  try { return canonicalSerialize(left) === canonicalSerialize(right); }
  catch { return false; }
}

function assertion(state: PredicateRuntimeState, predicate: Extract<Predicate, { kind: "assertion" }>): PredicateEvaluation {
  const observed = subjectValue(state, predicate);
  if (predicate.operator === "exists") return { state: observed.exists ? "TRUE" : "FALSE", reasonCodes: [observed.exists ? "VALUE_EXISTS" : "VALUE_MISSING"] };
  if (predicate.operator === "not_exists") return { state: observed.exists ? "FALSE" : "TRUE", reasonCodes: [observed.exists ? "VALUE_EXISTS" : "VALUE_MISSING"] };
  if (!observed.exists) return { state: "UNKNOWN", reasonCodes: ["PREDICATE_SUBJECT_VALUE_UNAVAILABLE"] };
  const expected = predicate.expected;
  if (predicate.operator === "eq") return { state: equal(observed.value, expected) ? "TRUE" : "FALSE", reasonCodes: [equal(observed.value, expected) ? "EQUAL" : "NOT_EQUAL"] };
  if (predicate.operator === "not_eq") return { state: equal(observed.value, expected) ? "FALSE" : "TRUE", reasonCodes: [equal(observed.value, expected) ? "EQUAL" : "NOT_EQUAL"] };
  if (predicate.operator === "gte" || predicate.operator === "lte") {
    if (typeof observed.value !== "number" || typeof expected !== "number") return { state: "UNKNOWN", reasonCodes: ["NON_NUMERIC_COMPARISON"] };
    const result = predicate.operator === "gte" ? observed.value >= expected : observed.value <= expected;
    return { state: result ? "TRUE" : "FALSE", reasonCodes: [result ? "NUMERIC_BOUND_SATISFIED" : "NUMERIC_BOUND_VIOLATED"] };
  }
  if (predicate.operator === "contains") {
    const result = typeof observed.value === "string" && typeof expected === "string"
      ? observed.value.includes(expected)
      : Array.isArray(observed.value) && observed.value.some((value) => equal(value, expected));
    return { state: result ? "TRUE" : "FALSE", reasonCodes: [result ? "CONTAINS" : "DOES_NOT_CONTAIN"] };
  }
  const result = Array.isArray(observed.value) && observed.value.some((value) => equal(value, expected));
  return { state: result ? "TRUE" : "FALSE", reasonCodes: [result ? "ARRAY_CONTAINS" : "ARRAY_DOES_NOT_CONTAIN"] };
}

export function evaluatePredicateState(predicate: Predicate, state: PredicateRuntimeState): PredicateEvaluation {
  if (predicate.kind === "assertion") return assertion(state, predicate);
  if (predicate.kind === "not") {
    const nested = evaluatePredicateState(predicate.predicate, state);
    return { state: nested.state === "TRUE" ? "FALSE" : nested.state === "FALSE" ? "TRUE" : "UNKNOWN", reasonCodes: nested.reasonCodes };
  }
  const results = predicate.predicates.map((child) => evaluatePredicateState(child, state));
  if (predicate.kind === "all") {
    if (results.some((result) => result.state === "FALSE")) return { state: "FALSE", reasonCodes: [...new Set(results.flatMap((result) => result.reasonCodes))].sort() };
    if (results.every((result) => result.state === "TRUE")) return { state: "TRUE", reasonCodes: [...new Set(results.flatMap((result) => result.reasonCodes))].sort() };
    return { state: "UNKNOWN", reasonCodes: [...new Set(results.flatMap((result) => result.reasonCodes))].sort() };
  }
  if (results.some((result) => result.state === "TRUE")) return { state: "TRUE", reasonCodes: [...new Set(results.flatMap((result) => result.reasonCodes))].sort() };
  if (results.every((result) => result.state === "FALSE")) return { state: "FALSE", reasonCodes: [...new Set(results.flatMap((result) => result.reasonCodes))].sort() };
  return { state: "UNKNOWN", reasonCodes: [...new Set(results.flatMap((result) => result.reasonCodes))].sort() };
}

export function evaluatePredicate(input: PredicateEvaluationInput): PredicateEvaluation {
  return evaluatePredicateState(input.predicate, {
    snapshot: input.view.snapshot,
    program: input.view.program,
    variables: input.view.branch.uncertainVariables,
    assumptions: input.view.branch.assumptions,
    effects: input.view.branch.effectOverlay,
    queryResults: input.view.branch.queryResults,
    observations: input.view.branch.simulatedObservations,
  });
}
