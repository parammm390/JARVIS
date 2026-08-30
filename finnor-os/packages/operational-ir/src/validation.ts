import { canonicalSerialize, hasValidIrSemanticHash } from "./canonical";
import type {
  Constraint,
  Effect,
  EntityRef,
  Observation,
  OperationalProgram,
  Predicate,
  ProgramNode,
} from "./contracts";
import { analyzeProgramGraph, graphCycles } from "./graph";
import { OperationalProgramSchema } from "./schema";

export type IrValidationIssueSeverity = "ERROR" | "WARNING";

export interface IrValidationIssue {
  code: string;
  severity: IrValidationIssueSeverity;
  path: string;
  message: string;
}

export interface IrValidationResult {
  valid: boolean;
  errors: IrValidationIssue[];
  warnings: IrValidationIssue[];
  program?: OperationalProgram;
}

function identityKey(entity: { kind: string; type: string; id: string }): string {
  return `${entity.kind}:${entity.type}:${entity.id}`;
}

function duplicateValues(values: string[]): string[] {
  const seen = new Set<string>();
  const duplicate = new Set<string>();
  for (const value of values) (seen.has(value) ? duplicate : seen).add(value);
  return [...duplicate].sort();
}

function payloadValueAtPath(payload: Record<string, unknown>, path: string): unknown {
  let current: unknown = payload;
  for (const segment of path.split(".").filter(Boolean)) {
    if (!current || typeof current !== "object" || Array.isArray(current)) return undefined;
    current = (current as Record<string, unknown>)[segment];
  }
  return current;
}

function walkObject(value: unknown, visit: (key: string, path: string) => void, path = "$", seen = new Set<object>()): void {
  if (!value || typeof value !== "object") return;
  if (seen.has(value)) return;
  seen.add(value);
  if (Array.isArray(value)) {
    value.forEach((entry, index) => walkObject(entry, visit, `${path}[${index}]`, seen));
  } else {
    for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
      visit(key, `${path}.${key}`);
      walkObject(entry, visit, `${path}.${key}`, seen);
    }
  }
}

function visitPredicates(node: ProgramNode, visit: (predicate: Predicate, path: string) => void, path = "body"): void {
  if (node.kind === "effect") visit(node.intendedState, `${path}.intendedState`);
  else if (node.kind === "wait") visit(node.condition, `${path}.condition`);
  else if (node.kind === "sequence") node.steps.forEach((step, index) => visitPredicates(step, visit, `${path}.steps[${index}]`));
  else if (node.kind === "parallel") node.branches.forEach((branch, index) => visitPredicates(branch, visit, `${path}.branches[${index}]`));
  else if (node.kind === "branch") {
    node.cases.forEach((branchCase, index) => {
      visit(branchCase.when, `${path}.cases[${index}].when`);
      visitPredicates(branchCase.then, visit, `${path}.cases[${index}].then`);
    });
    if (node.otherwise) visitPredicates(node.otherwise, visit, `${path}.otherwise`);
  } else if (node.kind === "compensation") visit(node.effect.intendedState, `${path}.effect.intendedState`);
}

function allNodes(root: ProgramNode): ProgramNode[] {
  const result: ProgramNode[] = [];
  const walk = (node: ProgramNode) => {
    result.push(node);
    if (node.kind === "sequence") node.steps.forEach(walk);
    else if (node.kind === "parallel") node.branches.forEach(walk);
    else if (node.kind === "branch") {
      node.cases.forEach((branchCase) => walk(branchCase.then));
      if (node.otherwise) walk(node.otherwise);
    } else if (node.kind === "compensation") result.push(node.effect);
  };
  walk(root);
  return result;
}

export function validateOperationalProgram(input: unknown): IrValidationResult {
  const errors: IrValidationIssue[] = [];
  const warnings: IrValidationIssue[] = [];
  const issue = (severity: IrValidationIssueSeverity, code: string, path: string, message: string) => {
    (severity === "ERROR" ? errors : warnings).push({ severity, code, path, message });
  };

  const parsed = OperationalProgramSchema.safeParse(input);
  if (!parsed.success) {
    for (const schemaIssue of parsed.error.issues) {
      issue("ERROR", "SCHEMA_INVALID", schemaIssue.path.length ? schemaIssue.path.join(".") : "$", schemaIssue.message);
    }
    return { valid: false, errors, warnings };
  }
  const program = parsed.data;

  if (!hasValidIrSemanticHash(program)) {
    issue("ERROR", "SEMANTIC_HASH_MISMATCH", "irSemanticHash", "irSemanticHash does not match the canonical semantic projection");
  }

  walkObject(program, (key, path) => {
    const normalized = key.replaceAll("_", "").toLowerCase();
    if (normalized.includes("tenant")) {
      issue("ERROR", "TENANT_IDENTITY_FORBIDDEN", path, "tenant ownership is supplied only by trusted runtime context and cannot appear in IR");
    }
  });

  const nodes = allNodes(program.body);
  const graph = analyzeProgramGraph(program.body);
  const entities = new Map(program.entities.map((entity) => [entity.semanticId, entity]));
  const effects = new Map<string, Effect>();
  const queries = new Set<string>();
  const waits = new Set<string>();
  for (const node of graph.nodes.values()) {
    if (node.kind === "effect") effects.set(node.semanticId, node.node as Effect);
    else if (node.kind === "query") queries.add(node.semanticId);
    else waits.add(node.semanticId);
  }
  const observations = new Map(program.observations.map((observation) => [observation.semanticId, observation]));

  const semanticIds = [
    program.semanticId,
    program.goal.semanticId,
    program.scope.semanticId,
    program.successCondition.semanticId,
    ...(program.budget ? [program.budget.semanticId] : []),
    ...program.constraints.map((constraint) => constraint.semanticId),
    ...program.entities.map((entity) => entity.semanticId),
    ...program.observations.map((observation) => observation.semanticId),
    ...nodes.map((node) => node.semanticId),
  ];
  for (const duplicate of duplicateValues(semanticIds)) {
    issue("ERROR", "DUPLICATE_SEMANTIC_ID", "$", `semanticId ${duplicate} is declared more than once`);
  }

  const checkEntityRef = (ref: string, path: string) => {
    if (!entities.has(ref)) issue("ERROR", "INVALID_ENTITY_REFERENCE", path, `entity reference ${ref} does not exist`);
  };
  const checkPredicate = (predicate: Predicate, path: string): void => {
    if (predicate.kind === "assertion") {
      const ref = predicate.subject.ref;
      if (predicate.subject.kind === "entity" && ref) checkEntityRef(ref, `${path}.subject.ref`);
      else if (predicate.subject.kind === "query" && ref && !queries.has(ref)) issue("ERROR", "INVALID_QUERY_REFERENCE", `${path}.subject.ref`, `query reference ${ref} does not exist`);
      else if (predicate.subject.kind === "effect" && ref && !effects.has(ref)) issue("ERROR", "INVALID_EFFECT_REFERENCE", `${path}.subject.ref`, `effect reference ${ref} does not exist`);
      else if (predicate.subject.kind === "observation" && ref && !observations.has(ref)) issue("ERROR", "INVALID_OBSERVATION_REFERENCE", `${path}.subject.ref`, `observation reference ${ref} does not exist`);
    } else if (predicate.kind === "not") {
      checkPredicate(predicate.predicate, `${path}.predicate`);
    } else {
      predicate.predicates.forEach((child, index) => checkPredicate(child, `${path}.predicates[${index}]`));
    }
  };

  checkPredicate(program.goal.predicate, "goal.predicate");
  program.goal.subjectRefs.forEach((ref, index) => checkEntityRef(ref, `goal.subjectRefs[${index}]`));
  program.constraints.forEach((constraint, index) => {
    checkPredicate(constraint.predicate, `constraints[${index}].predicate`);
    constraint.entityRefs.forEach((ref, refIndex) => checkEntityRef(ref, `constraints[${index}].entityRefs[${refIndex}]`));
    if (constraint.severity === "HARD" && constraint.evaluation === "VIOLATED") {
      issue("ERROR", "HARD_CONSTRAINT_VIOLATED", `constraints[${index}]`, `known HARD constraint ${constraint.semanticId} is violated; program must be rejected`);
    } else if (constraint.severity === "SOFT" && constraint.evaluation === "VIOLATED") {
      issue("WARNING", "SOFT_CONSTRAINT_VIOLATED", `constraints[${index}]`, `SOFT constraint ${constraint.semanticId} is currently violated`);
    }
  });
  visitPredicates(program.body, checkPredicate);

  for (const [index, entity] of program.entities.entries()) {
    const tenantShapedType = entity.entityType.replaceAll("_", "").toLowerCase().includes("tenant")
      || (entity.resolution.status === "resolved" && entity.resolution.canonical.type.replaceAll("_", "").toLowerCase().includes("tenant"));
    if (tenantShapedType) {
      issue("ERROR", "TENANT_IDENTITY_FORBIDDEN", `entities[${index}]`, "tenant ownership cannot be represented as a model-authored EntityRef");
    }
    if (entity.resolution.status === "resolved") {
      if (entity.entityType !== entity.resolution.canonical.type) issue("ERROR", "ENTITY_TYPE_MISMATCH", `entities[${index}]`, "entityType must equal the resolved canonical type");
    } else if (entity.resolution.status === "ambiguous") {
      const duplicates = duplicateValues(entity.resolution.candidates.map(identityKey));
      if (duplicates.length) issue("ERROR", "DUPLICATE_ENTITY_CANDIDATE", `entities[${index}].resolution.candidates`, `ambiguous candidates repeat ${duplicates.join(", ")}`);
      issue("WARNING", "AMBIGUOUS_ENTITY_REFERENCE", `entities[${index}]`, `${entity.semanticId} remains explicitly ambiguous`);
    } else {
      issue("WARNING", "UNRESOLVED_ENTITY_REFERENCE", `entities[${index}]`, `${entity.semanticId} remains explicitly unresolved`);
    }
  }

  program.scope.includeEntityRefs.forEach((ref, index) => checkEntityRef(ref, `scope.includeEntityRefs[${index}]`));
  program.scope.excludeEntityRefs.forEach((ref, index) => checkEntityRef(ref, `scope.excludeEntityRefs[${index}]`));
  const scopeOverlap = program.scope.includeEntityRefs.filter((ref) => program.scope.excludeEntityRefs.includes(ref));
  if (scopeOverlap.length) issue("ERROR", "SCOPE_INCLUDE_EXCLUDE_CONFLICT", "scope", `entities cannot be both included and excluded: ${[...new Set(scopeOverlap)].sort().join(", ")}`);
  if (program.scope.cohortQueryRef && !queries.has(program.scope.cohortQueryRef)) issue("ERROR", "INVALID_COHORT_QUERY_REFERENCE", "scope.cohortQueryRef", `query ${program.scope.cohortQueryRef} does not exist`);
  for (const duplicate of duplicateValues(program.scope.includeEntityRefs)) issue("ERROR", "DUPLICATE_SCOPE_REFERENCE", "scope.includeEntityRefs", `duplicate include ref ${duplicate}`);
  for (const duplicate of duplicateValues(program.scope.excludeEntityRefs)) issue("ERROR", "DUPLICATE_SCOPE_REFERENCE", "scope.excludeEntityRefs", `duplicate exclude ref ${duplicate}`);

  const executableIds = new Set(graph.nodes.keys());
  for (const edge of graph.edges) {
    if (!executableIds.has(edge.from)) issue("ERROR", "MALFORMED_DEPENDENCY", "body", `dependency source ${edge.from} is not an executable Query, Effect, or Wait`);
    if (!executableIds.has(edge.to)) issue("ERROR", "MALFORMED_DEPENDENCY", "body", `dependency target ${edge.to} is not executable`);
    if (edge.from === edge.to) issue("ERROR", "SELF_DEPENDENCY", "body", `${edge.to} depends on itself`);
  }
  for (const node of graph.nodes.values()) {
    for (const duplicate of duplicateValues(node.node.dependsOn)) issue("ERROR", "DUPLICATE_DEPENDENCY", `body.${node.semanticId}.dependsOn`, `dependency ${duplicate} is repeated`);
  }
  for (const cycle of graphCycles(graph)) issue("ERROR", "DEPENDENCY_CYCLE", "body", `forbidden dependency cycle: ${cycle.join(" -> ")}`);

  for (const [effectId, effect] of effects) {
    for (const [targetIndex, target] of effect.targets.entries()) {
      const entity = entities.get(target.entityRef);
      if (!entity) {
        issue("ERROR", "INVALID_EFFECT_TARGET", `body.${effectId}.targets[${targetIndex}]`, `entity ${target.entityRef} does not exist`);
        continue;
      }
      if (entity.resolution.status !== "resolved") {
        issue("ERROR", "UNRESOLVED_EFFECT_TARGET", `body.${effectId}.targets[${targetIndex}]`, "effects may target only resolved canonical identities");
        continue;
      }
      const payloadValue = payloadValueAtPath(effect.arguments, target.payloadPath);
      if (payloadValue !== entity.resolution.canonical.id) {
        issue("ERROR", "GROUNDED_TARGET_MISMATCH", `body.${effectId}.targets[${targetIndex}]`, `arguments.${target.payloadPath} does not equal canonical id ${entity.resolution.canonical.id}`);
      }
    }
    for (const [observationIndex, observationRef] of effect.expectedObservationRefs.entries()) {
      const observation = observations.get(observationRef);
      if (!observation) issue("ERROR", "INVALID_EXPECTED_OBSERVATION", `body.${effectId}.expectedObservationRefs[${observationIndex}]`, `observation ${observationRef} does not exist`);
      else if (observation.strength !== "REQUIRED") {
        issue("ERROR", "EXPECTED_OBSERVATION_NOT_REQUIRED", `body.${effectId}.expectedObservationRefs[${observationIndex}]`, `${observationRef} is expected by an Effect and must be REQUIRED`);
      }
      else if (!((observation.subject.kind === "effect" && observation.subject.ref === effectId) || (observation.subject.kind === "goal" && observation.subject.ref === program.goal.semanticId))) {
        issue("ERROR", "OBSERVATION_SUBJECT_MISMATCH", `body.${effectId}.expectedObservationRefs[${observationIndex}]`, `${observationRef} proves neither effect ${effectId} nor goal ${program.goal.semanticId}`);
      }
    }
  }

  const successObservationRefs = new Set(program.successCondition.criteria.flatMap((criterion) => criterion.kind === "observation" ? [criterion.observationRef] : []));
  program.observations.forEach((observation, index) => {
    const path = `observations[${index}]`;
    if (observation.subject.kind === "goal" && observation.subject.ref !== program.goal.semanticId) issue("ERROR", "INVALID_OBSERVATION_SUBJECT", `${path}.subject`, `goal ${observation.subject.ref} does not exist`);
    if (observation.subject.kind === "effect" && !effects.has(observation.subject.ref)) issue("ERROR", "INVALID_OBSERVATION_SUBJECT", `${path}.subject`, `effect ${observation.subject.ref} does not exist`);
    const evidence = observation.evidence;
    if (evidence.kind === "canonical_query" && !queries.has(evidence.queryRef)) issue("ERROR", "INVALID_QUERY_REFERENCE", `${path}.evidence.queryRef`, `query ${evidence.queryRef} does not exist`);
    if (evidence.kind === "canonical_query") checkPredicate(evidence.assertion, `${path}.evidence.assertion`);
    if (evidence.kind === "canonical_state") {
      checkEntityRef(evidence.entityRef, `${path}.evidence.entityRef`);
      checkPredicate(evidence.assertion, `${path}.evidence.assertion`);
    }
    if (["effect_verification", "computer_state", "workflow_completion", "recorded_result"].includes(evidence.kind)) {
      const effectRef = (evidence as { effectRef: string }).effectRef;
      if (!effects.has(effectRef)) issue("ERROR", "INVALID_EFFECT_REFERENCE", `${path}.evidence.effectRef`, `effect ${effectRef} does not exist`);
    }
    if (evidence.kind === "delegation_state") checkEntityRef(evidence.entityRef, `${path}.evidence.entityRef`);
    if (evidence.kind === "matched_event") evidence.subjectRefs.forEach((ref, refIndex) => checkEntityRef(ref, `${path}.evidence.subjectRefs[${refIndex}]`));
    if (observation.strength === "REQUIRED" && observation.subject.kind === "goal" && !successObservationRefs.has(observation.semanticId)) {
      issue("ERROR", "REQUIRED_GOAL_OBSERVATION_OMITTED", path, "a REQUIRED goal observation must participate in the success condition");
    }
  });

  program.successCondition.criteria.forEach((criterion, index) => {
    if (criterion.kind === "predicate") checkPredicate(criterion.predicate, `successCondition.criteria[${index}].predicate`);
    if (criterion.kind === "observation" && !observations.has(criterion.observationRef)) issue("ERROR", "INVALID_OBSERVATION_REFERENCE", `successCondition.criteria[${index}].observationRef`, `observation ${criterion.observationRef} does not exist`);
  });

  const branchNodes = nodes.filter((node): node is Extract<ProgramNode, { kind: "branch" }> => node.kind === "branch");
  for (const branch of branchNodes) {
    for (const duplicate of duplicateValues(branch.cases.map((branchCase) => branchCase.caseId))) issue("ERROR", "DUPLICATE_BRANCH_CASE", `body.${branch.semanticId}.cases`, `caseId ${duplicate} is repeated`);
    const conditions = branch.cases.map((branchCase) => canonicalSerialize(branchCase.when));
    for (const duplicate of duplicateValues(conditions)) issue("ERROR", "DUPLICATE_BRANCH_CONDITION", `body.${branch.semanticId}.cases`, `FIRST_MATCH branch repeats condition ${duplicate}`);
  }

  const compensationNodes = nodes.filter((node): node is Extract<ProgramNode, { kind: "compensation" }> => node.kind === "compensation");
  for (const compensation of compensationNodes) {
    const original = graph.nodes.get(compensation.forEffectId);
    const compensating = graph.nodes.get(compensation.effect.semanticId);
    if (!original || original.kind !== "effect") issue("ERROR", "INVALID_COMPENSATION_LINK", `body.${compensation.semanticId}.forEffectId`, `${compensation.forEffectId} is not an Effect`);
    else if (original.semanticId === compensation.effect.semanticId) issue("ERROR", "SELF_COMPENSATION", `body.${compensation.semanticId}`, "an effect cannot compensate itself");
    else if (compensating && original.ordinal >= compensating.ordinal) issue("ERROR", "IMPOSSIBLE_COMPENSATION_ORDER", `body.${compensation.semanticId}`, "compensation must be declared after the effect it compensates");
  }

  const ordinaryEffects = [...graph.nodes.values()].filter((node) => node.kind === "effect" && !node.compensationForEffectId);
  const queryCount = queries.size;
  const waitCount = waits.size;
  const compensationCount = compensationNodes.length;
  if (program.executionModel === "QUERY" && (queryCount !== 1 || ordinaryEffects.length !== 0 || waitCount !== 0 || compensationCount !== 0)) {
    issue("ERROR", "QUERY_MODEL_STRUCTURE_INVALID", "body", "QUERY requires exactly one Query and no Effect, Wait, or Compensation");
  }
  if ((program.executionModel === "ATOMIC_EFFECT" || program.executionModel === "KNOWN_ACTION_COMPATIBILITY")
      && (ordinaryEffects.length !== 1 || queryCount !== 0 || waitCount !== 0 || compensationCount !== 0 || graph.nodes.size !== 1)) {
    issue("ERROR", "ATOMIC_MODEL_STRUCTURE_INVALID", "body", `${program.executionModel} requires exactly one independent Effect`);
  }
  if (program.executionModel === "CONVERSATION") {
    issue("ERROR", "CONVERSATION_IR_NOT_APPLICABLE", "executionModel", "CONVERSATION has no operational computation and does not produce Operational IR");
  }

  if (program.budget) {
    const counts = { steps: graph.nodes.size, effects: effects.size, queries: queryCount, waits: waitCount };
    if (program.budget.maxSteps !== undefined && counts.steps > program.budget.maxSteps) issue("ERROR", "BUDGET_EXCEEDED", "budget.maxSteps", `${counts.steps} steps exceed maxSteps ${program.budget.maxSteps}`);
    if (program.budget.maxEffects !== undefined && counts.effects > program.budget.maxEffects) issue("ERROR", "BUDGET_EXCEEDED", "budget.maxEffects", `${counts.effects} effects exceed maxEffects ${program.budget.maxEffects}`);
    if (program.budget.maxQueries !== undefined && counts.queries > program.budget.maxQueries) issue("ERROR", "BUDGET_EXCEEDED", "budget.maxQueries", `${counts.queries} queries exceed maxQueries ${program.budget.maxQueries}`);
    if (program.budget.maxWaits !== undefined && counts.waits > program.budget.maxWaits) issue("ERROR", "BUDGET_EXCEEDED", "budget.maxWaits", `${counts.waits} waits exceed maxWaits ${program.budget.maxWaits}`);
  }

  errors.sort((left, right) => `${left.path}\u0000${left.code}\u0000${left.message}`.localeCompare(`${right.path}\u0000${right.code}\u0000${right.message}`));
  warnings.sort((left, right) => `${left.path}\u0000${left.code}\u0000${left.message}`.localeCompare(`${right.path}\u0000${right.code}\u0000${right.message}`));
  return { valid: errors.length === 0, errors, warnings, program };
}

export function assertValidOperationalProgram(input: unknown): OperationalProgram {
  const result = validateOperationalProgram(input);
  if (!result.valid || !result.program) {
    throw new Error(`Operational IR validation failed: ${result.errors.map((entry) => `${entry.code}@${entry.path}: ${entry.message}`).join("; ")}`);
  }
  return result.program;
}
