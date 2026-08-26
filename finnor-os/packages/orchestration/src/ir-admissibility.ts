import { parsePlanningIrArtifact, type CanonicalEntityRef, type ObservationKind, type PlanningIrArtifact } from "@finnor/planning-ir";

export type IrAdmissibilityErrorCode =
  | "IR_SCHEMA_INVALID"
  | "IR_HASH_INVALID"
  | "UNRESOLVED_AMBIGUITY"
  | "TARGET_NOT_GROUNDED"
  | "HARD_CONSTRAINT_VIOLATED"
  | "TEMPORAL_INCONSISTENT"
  | "CAPABILITY_UNAVAILABLE"
  | "DEPENDENCY_INVALID"
  | "CAUSAL_PREREQUISITE_MISSING"
  | "LOWERING_UNSUPPORTED"
  | "EFFECT_INVALID"
  | "OBSERVATION_INVALID"
  | "VERIFICATION_WEAKENED"
  | "EXPOSURE_EXCEEDED";

export interface IrAdmissibilityIssue {
  code: IrAdmissibilityErrorCode;
  path: string;
  message: string;
}

export interface IrAdmissibilityDependencies {
  groundPayload(payload: Record<string, unknown>): Promise<Array<{ field: string; status: "verified" | "not_found" | "unverifiable" }>>;
  groundRef(ref: CanonicalEntityRef): Promise<"verified" | "not_found" | "unverifiable">;
  hasCapability(capability: string): boolean;
  hasActionType(actionType: string): boolean;
  requiredObservation(actionType: string): ObservationKind;
  now(): Date;
}

export interface AdmittedPlanningIr {
  artifact: PlanningIrArtifact;
  admittedAt: string;
  issues: [];
}

export type IrAdmissibilityResult = { admissible: true; admitted: AdmittedPlanningIr } | { admissible: false; issues: IrAdmissibilityIssue[] };

const issue = (code: IrAdmissibilityErrorCode, path: string, message: string): IrAdmissibilityIssue => ({ code, path, message });

function graphIssues(artifact: PlanningIrArtifact): IrAdmissibilityIssue[] {
  const issues: IrAdmissibilityIssue[] = [];
  const ids = artifact.plan.nodes.map(({ id }) => id);
  if (new Set(ids).size !== ids.length) issues.push(issue("DEPENDENCY_INVALID", "plan.nodes", "PlanGraph node ids must be unique"));
  const known = new Set(ids);
  const byId = new Map(artifact.plan.nodes.map((node) => [node.id, node]));
  for (const [index, node] of artifact.plan.nodes.entries()) {
    if (new Set(node.dependsOn).size !== node.dependsOn.length || new Set(node.causalPrerequisites).size !== node.causalPrerequisites.length) {
      issues.push(issue("DEPENDENCY_INVALID", `plan.nodes.${index}`, "dependencies and causal prerequisites cannot contain duplicates"));
    }
    for (const dependency of [...node.dependsOn, ...node.causalPrerequisites]) {
      if (!known.has(dependency)) issues.push(issue("DEPENDENCY_INVALID", `plan.nodes.${index}`, `PlanGraph references missing node ${dependency}`));
      if (dependency === node.id) issues.push(issue("DEPENDENCY_INVALID", `plan.nodes.${index}`, "PlanGraph node cannot depend on itself"));
    }
    for (const prerequisite of node.causalPrerequisites) {
      if (!node.dependsOn.includes(prerequisite)) issues.push(issue("CAUSAL_PREREQUISITE_MISSING", `plan.nodes.${index}.causalPrerequisites`, `${prerequisite} is causal but is not an explicit dependency`));
    }
  }
  const visiting = new Set<string>();
  const visited = new Set<string>();
  const visit = (id: string): boolean => {
    if (visiting.has(id)) return true;
    if (visited.has(id)) return false;
    visiting.add(id);
    for (const dependency of byId.get(id)?.dependsOn ?? []) if (known.has(dependency) && visit(dependency)) return true;
    visiting.delete(id);
    visited.add(id);
    return false;
  };
  if (ids.some(visit)) issues.push(issue("DEPENDENCY_INVALID", "plan.nodes", "PlanGraph contains a forbidden dependency cycle"));
  return issues;
}

const OBSERVATION_STRENGTH: Record<ObservationKind, number> = {
  recorded_result: 0,
  provider_delivery: 1,
  canonical_state: 2,
  workflow_completion: 2,
  computer_state: 2,
  canonical_query: 3,
};

export class IrAdmissibilityCompiler {
  constructor(private readonly dependencies: IrAdmissibilityDependencies) {}

  async admit(value: unknown): Promise<IrAdmissibilityResult> {
    let artifact: PlanningIrArtifact;
    try {
      artifact = parsePlanningIrArtifact(value);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Planning IR schema is invalid";
      return { admissible: false, issues: [issue(message.includes("semantic hash") ? "IR_HASH_INVALID" : "IR_SCHEMA_INVALID", "artifact", message)] };
    }
    const issues = graphIssues(artifact);
    if (artifact.intent.unresolvedAmbiguity.length > 0) {
      issues.push(issue("UNRESOLVED_AMBIGUITY", "intent.unresolvedAmbiguity", "Unresolved consequential ambiguity cannot be lowered"));
    }
    for (const [index, constraint] of artifact.constraints.hard.entries()) {
      if (constraint.status === "violated") issues.push(issue("HARD_CONSTRAINT_VIOLATED", `constraints.hard.${index}`, constraint.description));
      if (constraint.kind === "temporal") {
        const notBefore = typeof constraint.values.notBefore === "string" ? Date.parse(constraint.values.notBefore) : null;
        const notAfter = typeof constraint.values.notAfter === "string" ? Date.parse(constraint.values.notAfter) : null;
        if ((notBefore !== null && !Number.isFinite(notBefore)) || (notAfter !== null && !Number.isFinite(notAfter)) || (notBefore !== null && notAfter !== null && notBefore > notAfter)) {
          issues.push(issue("TEMPORAL_INCONSISTENT", `constraints.hard.${index}`, "Temporal hard constraint has an impossible interval"));
        }
      }
      if (constraint.kind === "capability" && typeof constraint.values.capability === "string" && !this.dependencies.hasCapability(constraint.values.capability)) {
        issues.push(issue("CAPABILITY_UNAVAILABLE", `constraints.hard.${index}`, `Required capability ${constraint.values.capability} is unavailable`));
      }
    }
    const referencedEntities: Array<{ ref: CanonicalEntityRef; path: string }> = [
      ...artifact.intent.groundedEntities.map((ref, index) => ({ ref, path: `intent.groundedEntities.${index}` })),
      ...artifact.intent.scope.included.map((ref, index) => ({ ref, path: `intent.scope.included.${index}` })),
      ...artifact.intent.scope.excluded.map((ref, index) => ({ ref, path: `intent.scope.excluded.${index}` })),
      ...artifact.goal.desiredState.flatMap((predicate, index) => predicate.subject.kind === "business_state" ? [] : [{ ref: predicate.subject, path: `goal.desiredState.${index}.subject` }]),
      ...artifact.constraints.hard.flatMap((constraint, constraintIndex) => constraint.subjectRefs.map((ref, refIndex) => ({ ref, path: `constraints.hard.${constraintIndex}.subjectRefs.${refIndex}` }))),
      ...artifact.constraints.soft.flatMap((constraint, constraintIndex) => constraint.subjectRefs.map((ref, refIndex) => ({ ref, path: `constraints.soft.${constraintIndex}.subjectRefs.${refIndex}` }))),
      ...artifact.effects.flatMap((effect, effectIndex) => effect.targetRefs.map((ref, refIndex) => ({ ref, path: `effects.${effectIndex}.targetRefs.${refIndex}` }))),
    ];
    const uniqueRefs = [...new Map(referencedEntities.map((entry) => [`${entry.ref.kind}:${entry.ref.entityType}:${entry.ref.entityId}`, entry])).values()];
    const grounded = await Promise.all(uniqueRefs.map(async (entry) => ({ ...entry, status: await this.dependencies.groundRef(entry.ref) })));
    for (const result of grounded) {
      if (result.status !== "verified") issues.push(issue("TARGET_NOT_GROUNDED", result.path, `${result.ref.entityType} ${result.ref.entityId} is ${result.status}`));
    }
    const effects = new Map(artifact.effects.map((effect) => [effect.id, effect]));
    const observations = new Map(artifact.observations.map((observation) => [observation.id, observation]));
    const refKey = (ref: CanonicalEntityRef) => `${ref.kind}:${ref.entityType}:${ref.entityId}`;
    const declaredTargets = new Set(artifact.intent.groundedEntities.map(refKey));
    const includedTargets = new Set(artifact.intent.scope.included.map(refKey));
    const excludedTargets = new Set(artifact.intent.scope.excluded.map(refKey));
    if (effects.size !== artifact.effects.length) issues.push(issue("EFFECT_INVALID", "effects", "EffectSpec ids must be unique"));
    if (observations.size !== artifact.observations.length) issues.push(issue("OBSERVATION_INVALID", "observations", "ObservationSpec ids must be unique"));
    for (const [index, effect] of artifact.effects.entries()) {
      if (!this.dependencies.hasActionType(effect.actionType)) issues.push(issue("EFFECT_INVALID", `effects.${index}.actionType`, `Unregistered action type ${effect.actionType}`));
      if (!this.dependencies.hasCapability(effect.requiredCapability)) issues.push(issue("CAPABILITY_UNAVAILABLE", `effects.${index}.requiredCapability`, `Required capability ${effect.requiredCapability} is unavailable`));
      for (const [refIndex, ref] of effect.targetRefs.entries()) {
        const key = refKey(ref);
        if (!declaredTargets.has(key) || !includedTargets.has(key)) issues.push(issue("EFFECT_INVALID", `effects.${index}.targetRefs.${refIndex}`, "Effect target is not declared in the grounded included intent scope"));
        if (excludedTargets.has(key)) issues.push(issue("HARD_CONSTRAINT_VIOLATED", `effects.${index}.targetRefs.${refIndex}`, "Effect target is explicitly excluded from intent scope"));
      }
      const fields = await this.dependencies.groundPayload(effect.payload);
      for (const field of fields) if (field.status === "not_found") issues.push(issue("TARGET_NOT_GROUNDED", `effects.${index}.payload.${field.field}`, `${field.field} does not exist in the trusted tenant context`));
      const maxConstraint = artifact.constraints.hard.find((constraint) => constraint.kind === "cost_risk_exposure" && typeof constraint.values.maxAmount === "number");
      if (effect.exposure && maxConstraint && effect.exposure.amount > Number(maxConstraint.values.maxAmount)) {
        issues.push(issue("EXPOSURE_EXCEEDED", `effects.${index}.exposure`, `Effect exposure ${effect.exposure.amount} exceeds hard maximum ${maxConstraint.values.maxAmount}`));
      }
    }
    for (const [index, node] of artifact.plan.nodes.entries()) {
      for (const capability of node.requiredCapabilities) if (!this.dependencies.hasCapability(capability)) issues.push(issue("CAPABILITY_UNAVAILABLE", `plan.nodes.${index}.requiredCapabilities`, `Required capability ${capability} is unavailable`));
      if (node.kind === "effect" && !effects.has(node.effectId)) issues.push(issue("EFFECT_INVALID", `plan.nodes.${index}.effectId`, `Effect node references missing effect ${node.effectId}`));
      if (node.kind === "observe" && !observations.has(node.observationId)) issues.push(issue("OBSERVATION_INVALID", `plan.nodes.${index}.observationId`, `Observe node references missing observation ${node.observationId}`));
      if (node.kind === "wait" && node.deadlineAt && Date.parse(node.deadlineAt) <= this.dependencies.now().getTime()) issues.push(issue("TEMPORAL_INCONSISTENT", `plan.nodes.${index}.deadlineAt`, "Wait deadline is not in the future at admissibility time"));
      if (node.kind === "effect") {
        const nonEffectDependency = node.dependsOn.find((dependency) => artifact.plan.nodes.find((candidate) => candidate.id === dependency)?.kind !== "effect");
        if (nonEffectDependency) issues.push(issue("LOWERING_UNSUPPORTED", `plan.nodes.${index}.dependsOn`, `Compatibility lowering cannot erase non-effect prerequisite ${nonEffectDependency}`));
      }
    }
    for (const observationId of artifact.plan.completion.observationIds) if (!observations.has(observationId)) issues.push(issue("OBSERVATION_INVALID", "plan.completion.observationIds", `Completion references missing observation ${observationId}`));
    for (const [index, observation] of artifact.observations.entries()) {
      if (observation.effectId && !effects.has(observation.effectId)) issues.push(issue("OBSERVATION_INVALID", `observations.${index}.effectId`, `Observation references missing effect ${observation.effectId}`));
      if (observation.requiredEvidence.every((evidence) => /^(?:provider_)?acknowledg(?:e)?ment$/i.test(evidence))) issues.push(issue("VERIFICATION_WEAKENED", `observations.${index}.requiredEvidence`, "Provider acknowledgement alone cannot verify external truth"));
      if (observation.effectId) {
        const effect = effects.get(observation.effectId)!;
        const required = this.dependencies.requiredObservation(effect.actionType);
        if (OBSERVATION_STRENGTH[observation.kind] < OBSERVATION_STRENGTH[required]) issues.push(issue("VERIFICATION_WEAKENED", `observations.${index}.kind`, `${observation.kind} is weaker than existing ${required} verification semantics`));
      }
    }
    for (const effect of artifact.effects) {
      const effectNodes = artifact.plan.nodes.filter((node) => node.kind === "effect" && node.effectId === effect.id);
      if (effectNodes.length !== 1) issues.push(issue("EFFECT_INVALID", "plan.nodes", `Effect ${effect.id} must have exactly one effect node`));
      const effectObservations = artifact.observations.filter((observation) => observation.effectId === effect.id);
      if (effectObservations.length !== 1) issues.push(issue("OBSERVATION_INVALID", "observations", `Effect ${effect.id} must have exactly one completion observation`));
      const observation = effectObservations[0];
      if (!observation) continue;
      const observeNodes = artifact.plan.nodes.filter((node) => node.kind === "observe" && node.observationId === observation.id);
      if (observeNodes.length !== 1) issues.push(issue("OBSERVATION_INVALID", "plan.nodes", `Observation ${observation.id} must have exactly one observe node`));
      const effectNode = effectNodes[0];
      const observeNode = observeNodes[0];
      if (effectNode && observeNode && (!observeNode.dependsOn.includes(effectNode.id) || !observeNode.causalPrerequisites.includes(effectNode.id))) {
        issues.push(issue("CAUSAL_PREREQUISITE_MISSING", "plan.nodes", `Observation ${observation.id} must causally depend on effect ${effect.id}`));
      }
      if (!artifact.plan.completion.observationIds.includes(observation.id)) issues.push(issue("OBSERVATION_INVALID", "plan.completion.observationIds", `Effect observation ${observation.id} is not required for completion`));
    }
    return issues.length ? { admissible: false, issues } : { admissible: true, admitted: { artifact, admittedAt: this.dependencies.now().toISOString(), issues: [] } };
  }
}

export class IrAdmissibilityRejectedError extends Error {
  constructor(readonly issues: IrAdmissibilityIssue[]) {
    super(`Planning IR rejected: ${issues.map(({ code, path }) => `${code}@${path}`).join(", ")}`);
    this.name = "IrAdmissibilityRejectedError";
  }
}
