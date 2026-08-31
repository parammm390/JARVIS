import type {
  OperationalProgram,
  ProgramEffectSummary,
} from "@finnor/operational-ir";
import type {
  CpSatConstraint,
  CpSatHardConstraint,
  CpSatModel,
  DependencyRelation,
  PartialOrderPlan,
  SearchCapability,
  SmtExpression,
  SmtHardConstraint,
  SmtValue,
  SolverProofRecord,
} from "./contracts";

type TriState = true | false | null;

export interface CandidateSolverContext {
  program: OperationalProgram;
  effects: ProgramEffectSummary;
  dependencies: PartialOrderPlan;
  capabilities: readonly SearchCapability[];
  facts: Readonly<Record<string, SmtValue>>;
}

function compare(left: SmtValue, operator: "EQ" | "NEQ" | "GTE" | "LTE", right: SmtValue): TriState {
  if (operator === "EQ") return left === right;
  if (operator === "NEQ") return left !== right;
  if (typeof left !== "number" || typeof right !== "number") return null;
  return operator === "GTE" ? left >= right : left <= right;
}

function relationExists(relations: DependencyRelation[], input: {
  from: string;
  to: string;
  relation: DependencyRelation["relation"];
}): boolean {
  return relations.some((relation) => relation.from === input.from
    && relation.to === input.to
    && relation.relation === input.relation);
}

function evaluateSmt(
  expression: SmtExpression,
  context: CandidateSolverContext,
  counter: { atoms: number; limit: number; exhausted: boolean },
): TriState {
  if (expression.kind === "ATOM") {
    if (counter.atoms >= counter.limit) {
      counter.exhausted = true;
      return null;
    }
    counter.atoms += 1;
    const atom = expression.atom;
    if (atom.kind === "CAPABILITY_AVAILABLE") {
      const capability = context.capabilities.find((candidate) => candidate.capability === atom.capability);
      return capability?.available === "UNKNOWN" || capability === undefined ? null : capability.available;
    }
    if (atom.kind === "AUTHORITY_DECLARED") {
      return context.effects.authorityRequirements.some((requirement) =>
        requirement.kind === atom.requirementKind
        && (atom.capability === undefined
          || (requirement.kind === "REQUIRES_CAPABILITY" && requirement.capability === atom.capability)));
    }
    if (atom.kind === "NODE_PRESENT") return context.dependencies.nodeIds.includes(atom.nodeId);
    if (atom.kind === "PROGRAM_CONSTRAINT_SATISFIED") {
      const solved = context.facts[`constraint.${atom.constraintId}`];
      if (typeof solved === "boolean") return solved;
      const constraint = context.program.constraints.find((candidate) => candidate.semanticId === atom.constraintId);
      if (!constraint || constraint.evaluation === "UNKNOWN") return null;
      return constraint.evaluation === "SATISFIED";
    }
    if (atom.kind === "DEPENDENCY_RELATION") return relationExists(context.dependencies.relations, atom);
    const value = context.facts[atom.fact];
    return value === undefined ? null : compare(value, atom.operator, atom.value);
  }
  if (expression.kind === "NOT") {
    const result = evaluateSmt(expression.expression, context, counter);
    return result === null ? null : !result;
  }
  if (expression.kind === "IMPLIES") {
    const antecedent = evaluateSmt(expression.if, context, counter);
    if (antecedent === false) return true;
    const consequent = evaluateSmt(expression.then, context, counter);
    if (consequent === true) return true;
    if (antecedent === true && consequent === false) return false;
    return null;
  }
  if (expression.kind === "ALL") {
    let unknown = false;
    for (const child of expression.expressions) {
      const value = evaluateSmt(child, context, counter);
      if (value === false) return false;
      if (value === null) unknown = true;
    }
    return unknown ? null : true;
  }
  let unknown = false;
  for (const child of expression.expressions) {
    const value = evaluateSmt(child, context, counter);
    if (value === true) return true;
    if (value === null) unknown = true;
  }
  return unknown ? null : false;
}

/** Typed deterministic SMT boundary for logical, equality, numeric, capability,
 * authorization, temporal/dependency, and mutual-exclusion formulae. */
export function solveSmtConstraint(
  constraint: SmtHardConstraint,
  context: CandidateSolverContext,
  solverVersion: string,
  maxDeterministicTimeUnits = Number.MAX_SAFE_INTEGER,
): SolverProofRecord {
  const counter = { atoms: 0, limit: Math.max(1, Math.floor(maxDeterministicTimeUnits)), exhausted: false };
  const result = evaluateSmt(constraint.expression, context, counter);
  return {
    constraintId: constraint.id,
    solver: "SMT",
    solverVersion,
    status: counter.exhausted ? "UNKNOWN" : result === true ? "SAT" : result === false ? "UNSAT" : "UNKNOWN",
    reasonCodes: counter.exhausted ? ["SMT_DETERMINISTIC_TIME_BOUND_EXHAUSTED"]
      : result === true ? ["SMT_FORMULA_SATISFIED"]
      : result === false ? ["SMT_FORMULA_UNSATISFIED"]
        : ["SMT_FORMULA_CONTAINS_UNKNOWN_FACT"],
    exploredNodes: counter.atoms,
    deterministicTimeUnits: Math.max(1, counter.atoms),
  };
}

function modelError(model: CpSatModel): string | null {
  const ids = model.variables.map((variable) => variable.id);
  if (ids.length === 0 || new Set(ids).size !== ids.length) return "CP_SAT_VARIABLES_INVALID";
  const known = new Set(ids);
  for (const variable of model.variables) {
    if (variable.domain.length === 0 || variable.domain.some((value) => !Number.isSafeInteger(value))) return `CP_SAT_DOMAIN_INVALID:${variable.id}`;
  }
  for (const constraint of model.constraints) {
    const references = constraint.kind === "LINEAR" ? constraint.terms.map((term) => term.variable) : constraint.variables;
    if (references.some((id) => !known.has(id))) return "CP_SAT_UNKNOWN_VARIABLE";
    if (constraint.kind === "ALLOWED_ASSIGNMENTS"
        && constraint.tuples.some((tuple) => tuple.length !== constraint.variables.length || tuple.some((value) => !Number.isSafeInteger(value)))) {
      return "CP_SAT_ALLOWED_TUPLE_INVALID";
    }
  }
  if (model.objective?.terms.some((term) => !known.has(term.variable) || !Number.isSafeInteger(term.coefficient))) return "CP_SAT_OBJECTIVE_INVALID";
  return null;
}

function linearRange(
  constraint: Extract<CpSatConstraint, { kind: "LINEAR" }>,
  assignment: Readonly<Record<string, number>>,
  domains: ReadonlyMap<string, number[]>,
): { min: number; max: number } {
  let min = 0;
  let max = 0;
  for (const term of constraint.terms) {
    const assigned = assignment[term.variable];
    const values = assigned === undefined ? domains.get(term.variable)! : [assigned];
    const contributions = values.map((value) => value * term.coefficient);
    min += Math.min(...contributions);
    max += Math.max(...contributions);
  }
  return { min, max };
}

function constraintCanStillHold(
  constraint: CpSatConstraint,
  assignment: Readonly<Record<string, number>>,
  domains: ReadonlyMap<string, number[]>,
  complete: boolean,
): boolean {
  if (constraint.kind === "ALL_DIFFERENT") {
    const values = constraint.variables.flatMap((variable) => assignment[variable] === undefined ? [] : [assignment[variable]!]);
    return new Set(values).size === values.length;
  }
  if (constraint.kind === "ALLOWED_ASSIGNMENTS") {
    return constraint.tuples.some((tuple) => constraint.variables.every((variable, index) =>
      assignment[variable] === undefined || assignment[variable] === tuple[index]));
  }
  const range = linearRange(constraint, assignment, domains);
  if (constraint.operator === "EQ") return complete ? range.min === constraint.bound : range.min <= constraint.bound && range.max >= constraint.bound;
  if (constraint.operator === "GTE") return range.max >= constraint.bound;
  return range.min <= constraint.bound;
}

function objectiveValue(model: CpSatModel, assignment: Readonly<Record<string, number>>): number {
  return model.objective?.terms.reduce((total, term) => total + assignment[term.variable]! * term.coefficient, 0) ?? 0;
}

function assignmentKey(assignment: Readonly<Record<string, number>>): string {
  return Object.keys(assignment).sort().map((key) => `${key}=${assignment[key]}`).join("|");
}

/**
 * Exact finite-domain CP-SAT boundary for bounded assignment, ordering, capacity,
 * and integer resource models. It uses deterministic branch-and-bound and returns
 * UNKNOWN rather than a partial answer when its logical time bound is exhausted.
 */
export function solveCpSatConstraint(
  constraint: CpSatHardConstraint,
  facts: Readonly<Record<string, SmtValue>>,
  solverVersion: string,
  maxDeterministicTimeUnits: number,
): SolverProofRecord {
  const invalid = modelError(constraint.model);
  if (invalid) return {
    constraintId: constraint.id,
    solver: "CP_SAT",
    solverVersion,
    status: "UNKNOWN",
    reasonCodes: [invalid],
    exploredNodes: 0,
    deterministicTimeUnits: 0,
  };

  const variables = [...constraint.model.variables].sort((left, right) => left.id.localeCompare(right.id));
  const domains = new Map<string, number[]>();
  for (const variable of variables) {
    const fact = facts[`${constraint.candidateFactPrefix}${variable.id}`];
    if (fact !== undefined && typeof fact !== "number") return {
      constraintId: constraint.id,
      solver: "CP_SAT",
      solverVersion,
      status: "INFEASIBLE",
      reasonCodes: [`CP_SAT_FIXED_VALUE_NOT_INTEGER:${variable.id}`],
      exploredNodes: 0,
      deterministicTimeUnits: 0,
    };
    const domain = [...new Set(variable.domain)].sort((left, right) => left - right);
    domains.set(variable.id, fact === undefined ? domain : domain.includes(fact) ? [fact] : []);
  }
  if ([...domains.values()].some((domain) => domain.length === 0)) return {
    constraintId: constraint.id,
    solver: "CP_SAT",
    solverVersion,
    status: "INFEASIBLE",
    reasonCodes: ["CP_SAT_FIXED_VALUE_OUTSIDE_DOMAIN"],
    exploredNodes: 0,
    deterministicTimeUnits: 0,
  };

  const bound = Math.max(1, Math.floor(maxDeterministicTimeUnits));
  let explored = 0;
  let exhausted = false;
  let best: Record<string, number> | null = null;
  let bestObjective: number | null = null;
  const assignment: Record<string, number> = {};
  const visit = (index: number): void => {
    if (exhausted) return;
    if (explored >= bound) { exhausted = true; return; }
    explored += 1;
    const complete = index === variables.length;
    if (!constraint.model.constraints.every((candidate) => constraintCanStillHold(candidate, assignment, domains, complete))) return;
    if (complete) {
      const objective = objectiveValue(constraint.model, assignment);
      const better = best === null || bestObjective === null
        || (constraint.model.objective?.direction === "MAXIMIZE" ? objective > bestObjective : objective < bestObjective)
        || (objective === bestObjective && assignmentKey(assignment).localeCompare(assignmentKey(best)) < 0);
      if (better) { best = { ...assignment }; bestObjective = objective; }
      return;
    }
    const variable = variables[index]!;
    for (const value of domains.get(variable.id)!) {
      assignment[variable.id] = value;
      visit(index + 1);
      delete assignment[variable.id];
      if (exhausted) return;
    }
  };
  visit(0);

  if (exhausted) return {
    constraintId: constraint.id,
    solver: "CP_SAT",
    solverVersion,
    status: "UNKNOWN",
    reasonCodes: ["CP_SAT_DETERMINISTIC_TIME_BOUND_EXHAUSTED"],
    exploredNodes: explored,
    deterministicTimeUnits: explored,
  };
  if (!best) return {
    constraintId: constraint.id,
    solver: "CP_SAT",
    solverVersion,
    status: "INFEASIBLE",
    reasonCodes: ["CP_SAT_MODEL_INFEASIBLE"],
    exploredNodes: explored,
    deterministicTimeUnits: explored,
  };
  return {
    constraintId: constraint.id,
    solver: "CP_SAT",
    solverVersion,
    status: constraint.model.objective ? "OPTIMAL" : "FEASIBLE",
    reasonCodes: [constraint.model.objective ? "CP_SAT_OPTIMUM_PROVEN" : "CP_SAT_FEASIBLE_ASSIGNMENT_PROVEN"],
    assignment: best,
    ...(bestObjective === null ? {} : { objectiveValue: bestObjective }),
    exploredNodes: explored,
    deterministicTimeUnits: explored,
  };
}
