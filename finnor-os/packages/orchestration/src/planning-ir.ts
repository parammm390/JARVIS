import { randomUUID } from "node:crypto";
import {
  PLANNING_IR_COMPILER_VERSION,
  comparePlanningSemantics,
  createPlanningIrArtifact,
  type CanonicalEntityRef,
  type ConstraintSpec,
  type ObservationKind,
  type PlanningExecutionModel,
  type PlanningIrCandidate,
  type PlanningIrArtifact,
  type PlanningSemanticDiff,
  type PlanningSemanticSnapshot,
} from "@finnor/planning-ir";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type PlanningIrMode = "legacy" | "shadow-native-ir" | "native-ir";

export function planningIrMode(env = process.env): PlanningIrMode {
  const configured = env.FINNOR_PLANNING_IR_MODE?.trim().toLowerCase();
  if (!configured) return "native-ir";
  if (configured === "legacy" || configured === "shadow-native-ir" || configured === "native-ir") return configured;
  // Temporary deployment aliases preserve the bounded rollback seam while all
  // persisted/reporting semantics use the canonical mode names above.
  if (configured === "shadow") return "shadow-native-ir";
  if (configured === "cutover") return "native-ir";
  throw new Error(`FINNOR_PLANNING_IR_MODE must be legacy, shadow-native-ir, or native-ir; received ${configured}`);
}

export interface CompatibilityActionCandidate {
  actionType: string;
  payload: Record<string, unknown>;
  reasoning?: string;
  dependsOn: number[];
  requiredCapability?: string;
  risk?: "low" | "medium" | "high";
}

export interface NativePlanningActionCandidate extends CompatibilityActionCandidate {
  effectId: string;
  effectNodeId: string;
}

export interface RuntimeConstraintDeclarationInput {
  effects: import("@finnor/planning-ir").EffectSpec[];
  observations: import("@finnor/planning-ir").ObservationSpec[];
  trustedExcluded: CanonicalEntityRef[];
  approvalRequired(actionType: string): boolean;
  maxAmountForAction?(actionType: string): number | undefined;
  maxRiskForAction?(actionType: string): "low" | "medium" | "high" | undefined;
}

/** Runtime-owned declarations are deterministic predicates, not truth claims.
 * Their `status` field remains compatibility metadata; admissibility independently
 * evaluates every declaration and persists the result/evidence. */
export function deriveRuntimeHardConstraintDeclarations(input: RuntimeConstraintDeclarationInput): ConstraintSpec[] {
  const rows: ConstraintSpec[] = [];
  for (const [effectIndex, effect] of input.effects.entries()) {
    rows.push({
      id: `runtime:capability:${effectIndex}`,
      strength: "HARD",
      kind: "capability",
      description: `${effect.requiredCapability} must be available at planning time`,
      status: "unresolved",
      subjectRefs: effect.targetRefs,
      values: { capability: effect.requiredCapability, effectId: effect.id },
    });
    if (effect.targetRefs.length > 0) rows.push({
      id: `runtime:existence:${effectIndex}`,
      strength: "HARD",
      kind: "precondition",
      description: "Every consequential target must exist in the trusted tenant",
      status: "unresolved",
      subjectRefs: effect.targetRefs,
      values: { exists: true, tenantOwned: true, effectId: effect.id },
    });
    rows.push({
      id: `runtime:authority:${effectIndex}`,
      strength: "HARD",
      kind: "policy_authority",
      description: "The declared approval floor must match current fixed and tenant policy truth",
      status: "unresolved",
      subjectRefs: effect.targetRefs,
      values: { actionType: effect.actionType, requiresApproval: input.approvalRequired(effect.actionType), effectId: effect.id },
    });
    const maxAmount = input.maxAmountForAction?.(effect.actionType);
    const maxRisk = input.maxRiskForAction?.(effect.actionType);
    if (maxAmount !== undefined || maxRisk !== undefined) rows.push({
      id: `runtime:exposure:${effectIndex}`,
      strength: "HARD",
      kind: "cost_risk_exposure",
      description: "Effect exposure and risk must remain within the current trusted policy bounds",
      status: "unresolved",
      subjectRefs: effect.targetRefs,
      values: { ...(maxAmount === undefined ? {} : { maxAmount }), ...(maxRisk === undefined ? {} : { maxRisk }), effectId: effect.id },
    });
    rows.push({
      id: `runtime:observation:${effectIndex}`,
      strength: "HARD",
      kind: "observation_verifiability",
      description: "Completion evidence must preserve or strengthen existing BusinessEffect verification truth",
      status: "unresolved",
      subjectRefs: effect.targetRefs,
      values: { effectId: effect.id },
    });
    const property = effect.targetRefs.find((ref) => ref.kind === "property" || ref.entityType === "property");
    const asset = effect.targetRefs.find((ref) => ref.kind === "asset" || ref.entityType === "equipment");
    if (property && asset) rows.push({
      id: `runtime:relationship:${effectIndex}:installed_at`,
      strength: "HARD",
      kind: "entity_relationship",
      description: "The target asset must be installed at the target property",
      status: "unresolved",
      subjectRefs: [property, asset],
      values: { relationship: "installed_at", effectId: effect.id },
    });
  }
  if (input.trustedExcluded.length > 0) rows.push({
    id: "runtime:user-exclusions",
    strength: "HARD",
    kind: "user_restriction",
    description: "No effect may target an entity explicitly excluded by trusted operating context",
    status: "unresolved",
    subjectRefs: input.trustedExcluded,
    values: { source: "trusted_operating_context" },
  });
  return rows;
}

const kindForField = (field: string): CanonicalEntityRef["kind"] => field === "householdId" || field === "customerId" ? "party"
  : field === "propertyId" ? "property"
    : field === "equipmentId" || field === "assetId" || field === "assetMeasurementId" ? "asset"
      : field === "workId" ? "work"
        : "entity";

const typeForField = (field: string): string => {
  const known: Record<string, string> = {
    householdId: "household", customerId: "household", propertyId: "property", equipmentId: "equipment", assetId: "equipment",
    assetMeasurementId: "asset_measurement",
    visitId: "service_visit", serviceVisitId: "service_visit", workOrderId: "work_order", technicianId: "technician",
    invoiceId: "invoice", paymentId: "payment", quoteId: "quote", proposalId: "proposal", leadId: "lead",
    appointmentId: "appointment", taskId: "task", workId: "work", documentId: "document", locationId: "tenant_location",
    delegationId: "delegation", internalEventId: "internal_event", objectiveLoopId: "objective_loop",
    communicationIdentityId: "communication_identity", applicationAccountId: "application_account", authProfileId: "auth_profile",
    agreementId: "maintenance_agreement", maintenanceAgreementId: "maintenance_agreement",
  };
  return known[field] ?? field.replace(/Id$/, "").replace(/[A-Z]/g, (letter) => `_${letter.toLowerCase()}`);
};

export function collectCanonicalRefs(value: unknown, path = ""): CanonicalEntityRef[] {
  if (Array.isArray(value)) return value.flatMap((entry, index) => collectCanonicalRefs(entry, `${path}[${index}]`));
  if (!value || typeof value !== "object") return [];
  const row = value as Record<string, unknown>;
  const refs: CanonicalEntityRef[] = [];
  const consumed = new Set<string>();
  if (typeof row.partyType === "string" && typeof row.partyId === "string" && UUID_RE.test(row.partyId)) {
    refs.push({ kind: "party", entityType: row.partyType, entityId: row.partyId, field: path ? `${path}.partyId` : "partyId", provenance: "typed_payload_ref" });
    consumed.add("partyId");
  }
  if (typeof row.entityType === "string" && typeof row.entityId === "string" && UUID_RE.test(row.entityId)) {
    refs.push({ kind: "entity", entityType: row.entityType, entityId: row.entityId, field: path ? `${path}.entityId` : "entityId", provenance: "typed_payload_ref" });
    consumed.add("entityId");
  }
  if (row.target && typeof row.target === "object" && !Array.isArray(row.target)) {
    const target = row.target as Record<string, unknown>;
    if (typeof target.kind === "string" && typeof target.identifier === "string") {
      refs.push({ kind: "resource", entityType: target.kind, entityId: target.identifier, field: path ? `${path}.target.identifier` : "target.identifier", provenance: "bounded_target" });
    }
  }
  for (const [key, child] of Object.entries(row)) {
    if (consumed.has(key) || key === "target") continue;
    const childPath = path ? `${path}.${key}` : key;
    if (["phone", "phoneNumber", "toNumber", "contactPhone"].includes(key) && typeof child === "string" && child.trim()) {
      refs.push({ kind: "resource", entityType: "phone_endpoint", entityId: child.trim(), field: childPath, provenance: "payload_ref" });
    } else if (["email", "contactEmail"].includes(key) && typeof child === "string" && child.trim()) {
      refs.push({ kind: "resource", entityType: "email_endpoint", entityId: child.trim(), field: childPath, provenance: "payload_ref" });
    } else if (key.endsWith("Id") && typeof child === "string" && UUID_RE.test(child)) {
      refs.push({ kind: kindForField(key), entityType: typeForField(key), entityId: child, field: childPath, provenance: "payload_ref" });
    } else {
      refs.push(...collectCanonicalRefs(child, childPath));
    }
  }
  return [...new Map(refs.map((ref) => [`${ref.kind}:${ref.entityType}:${ref.entityId}:${ref.field ?? ""}`, ref])).values()];
}

function exposure(payload: Record<string, unknown>): { amount: number; currency: string } | null {
  const amounts: number[] = [];
  const walk = (value: unknown): void => {
    if (Array.isArray(value)) { value.forEach(walk); return; }
    if (!value || typeof value !== "object") return;
    for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
      if (/(?:amount|total|price|spend|budget|cost)(?:Usd)?$/i.test(key)) {
        const amount = typeof child === "number" ? child : typeof child === "string" ? Number(child) : NaN;
        if (Number.isFinite(amount) && amount >= 0) amounts.push(amount);
      }
      walk(child);
    }
  };
  walk(payload);
  return amounts.length ? { amount: Math.max(...amounts), currency: typeof payload.currency === "string" ? payload.currency.toUpperCase() : "USD" } : null;
}

const evidenceFor = (kind: ObservationKind): string[] => kind === "canonical_state" ? ["canonical_read_back"]
  : kind === "provider_delivery" ? ["external_observation_or_reconciliation"]
    : kind === "computer_state" ? ["computer_terminal_state", "computer_evidence"]
      : kind === "workflow_completion" ? ["workflow_terminal_state"]
        : kind === "canonical_query" ? ["canonical_query_result"]
          : ["recorded_result"];

/** Extracts executable action proposals from a native PlanGraph without erasing
 * its dependency semantics. Non-effect prerequisites remain in the IR and will
 * fail closed at the compatibility lowerer until that runtime supports them. */
export function actionsFromNativePlanningIr(candidate: PlanningIrCandidate): NativePlanningActionCandidate[] {
  const effects = new Map(candidate.effects.map((effect) => [effect.id, effect]));
  if (effects.size !== candidate.effects.length) throw new Error("Native Planning IR contains duplicate EffectSpec ids");
  const effectNodes = candidate.plan.nodes.filter((node): node is Extract<typeof node, { kind: "effect" }> => node.kind === "effect");
  const indexByNode = new Map(effectNodes.map((node, index) => [node.id, index]));
  return effectNodes.map((node) => {
    const effect = effects.get(node.effectId);
    if (!effect) throw new Error(`Native Planning IR effect node references missing effect ${node.effectId}`);
    const dependsOn = node.dependsOn.map((dependency) => {
      const index = indexByNode.get(dependency);
      if (index === undefined) throw new Error(`Native Planning IR effect ${effect.id} has non-effect prerequisite ${dependency}`);
      return index;
    });
    return {
      effectId: effect.id,
      effectNodeId: node.id,
      actionType: effect.actionType,
      payload: effect.payload,
      reasoning: effect.effectIntent,
      dependsOn,
      requiredCapability: effect.requiredCapability,
      risk: effect.risk,
    };
  });
}

/** Materializes native planner semantics with trusted runtime provenance and the
 * final schema/health-adjusted action payloads. This is distinct from the legacy
 * compatibility wrapper: GoalSpec, ConstraintSet, PlanGraph, and observations
 * originate natively from the planner candidate. */
export function buildNativePlanningIr(input: {
  candidate: PlanningIrCandidate;
  executionModel: PlanningExecutionModel;
  requestedOutcome: string;
  actions: CompatibilityActionCandidate[];
  observationForAction(actionType: string): ObservationKind;
  provenance: PlanningIrArtifact["metadata"]["provenance"];
  included?: CanonicalEntityRef[];
  excluded?: CanonicalEntityRef[];
  textExclusions?: string[];
  compileEffect?: (action: CompatibilityActionCandidate, effectId: string, index: number) => import("@finnor/planning-ir").EffectSpec | undefined;
  defineObservation?: (action: CompatibilityActionCandidate, effect: import("@finnor/planning-ir").EffectSpec, observationId: string, index: number) => import("@finnor/planning-ir").ObservationSpec | undefined;
  deriveHardConstraints?: (effects: import("@finnor/planning-ir").EffectSpec[], observations: import("@finnor/planning-ir").ObservationSpec[]) => ConstraintSpec[];
}): PlanningIrArtifact {
  const nativeActions = actionsFromNativePlanningIr(input.candidate);
  if (nativeActions.length !== input.actions.length) throw new Error(`Native Planning IR has ${nativeActions.length} effects but runtime produced ${input.actions.length} candidates`);
  const originalEffects = new Map(input.candidate.effects.map((effect) => [effect.id, effect]));
  const effects = nativeActions.map((native, index) => {
    const action = input.actions[index]!;
    const compiled = input.compileEffect?.(action, native.effectId, index);
    if (compiled) return compiled;
    const original = originalEffects.get(native.effectId)!;
    const targetRefs = [...new Map([...original.targetRefs, ...collectCanonicalRefs(action.payload)]
      .map((ref) => [`${ref.kind}:${ref.entityType}:${ref.entityId}:${ref.field ?? ""}`, ref])).values()];
    return {
      ...original,
      actionType: action.actionType,
      effectIntent: action.reasoning?.trim() || original.effectIntent,
      payload: action.payload,
      targetRefs,
      requiredCapability: action.requiredCapability ?? `action:${action.actionType}`,
      risk: action.risk ?? original.risk,
      exposure: exposure(action.payload),
      proposalOnly: true as const,
    };
  });
  const effectById = new Map(effects.map((effect) => [effect.id, effect]));
  const observations = input.candidate.observations.map((observation) => {
    if (!observation.effectId) return observation;
    const effect = effectById.get(observation.effectId);
    if (!effect) return observation;
    const index = effects.findIndex((candidateEffect) => candidateEffect.id === effect.id);
    const action = input.actions[index]!;
    return input.defineObservation?.(action, effect, observation.id, index) ?? (effect.actionType === originalEffects.get(effect.id)?.actionType
      ? observation
      : {
          ...observation,
          kind: input.observationForAction(effect.actionType),
          predicate: { intendedOutcome: input.requestedOutcome, actionType: effect.actionType },
          requiredEvidence: evidenceFor(input.observationForAction(effect.actionType)),
          acknowledgementSufficient: false as const,
          verificationFloor: "at_least_existing" as const,
        });
  });
  const effectRefs = effects.flatMap((effect) => effect.targetRefs);
  const groundedEntities = [...new Map([...input.candidate.intent.groundedEntities, ...effectRefs, ...(input.included ?? [])]
    .map((ref) => [`${ref.kind}:${ref.entityType}:${ref.entityId}:${ref.field ?? ""}`, ref])).values()];
  const included = [...new Map([...input.candidate.intent.scope.included, ...effectRefs, ...(input.included ?? [])]
    .map((ref) => [`${ref.kind}:${ref.entityType}:${ref.entityId}:${ref.field ?? ""}`, ref])).values()];
  // Exclusion authority comes only from trusted runtime context. Planner-authored
  // exclusions are not discarded semantically: they remain declarations only when
  // the runtime also provides them, never self-authenticating restrictions.
  const excluded = [...new Map([...(input.excluded ?? [])]
    .map((ref) => [`${ref.kind}:${ref.entityType}:${ref.entityId}:${ref.field ?? ""}`, ref])).values()];
  const derivedHard = input.deriveHardConstraints?.(effects, observations) ?? [];
  const hardById = new Map(input.candidate.constraints.hard.map((constraint) => [constraint.id, constraint]));
  for (const constraint of derivedHard) hardById.set(constraint.id, constraint);
  const finalPlan = {
    ...input.candidate.plan,
    nodes: input.candidate.plan.nodes.map((node) => {
      if (node.kind !== "effect") return node;
      const effect = effectById.get(node.effectId);
      return effect ? { ...node, requiredCapabilities: [effect.requiredCapability] } : node;
    }),
  };
  return createPlanningIrArtifact({
    intent: {
      ...input.candidate.intent,
      requestedOutcome: input.requestedOutcome,
      executionModel: input.executionModel,
      groundedEntities,
      scope: {
        included,
        excluded,
        textExclusions: [...new Set(input.textExclusions ?? [])],
      },
      provenance: input.provenance,
    },
    goal: input.candidate.goal,
    constraints: { hard: [...hardById.values()], soft: input.candidate.constraints.soft },
    plan: finalPlan,
    effects,
    observations,
  }, { compilerVersion: PLANNING_IR_COMPILER_VERSION, provenance: input.provenance });
}

export interface ActionDecisionPlanningIrInput {
  executionModel: PlanningExecutionModel;
  requestedOutcome: string;
  actions: CompatibilityActionCandidate[];
  observationForAction(actionType: string): ObservationKind;
  provenance: PlanningIrArtifact["metadata"]["provenance"];
  included?: CanonicalEntityRef[];
  excluded?: CanonicalEntityRef[];
  textExclusions?: string[];
  unresolvedAmbiguity?: PlanningIrArtifact["intent"]["unresolvedAmbiguity"];
  hardConstraints?: ConstraintSpec[];
  softConstraints?: ConstraintSpec[];
  compileEffect?: (action: CompatibilityActionCandidate, effectId: string, index: number) => import("@finnor/planning-ir").EffectSpec | undefined;
  defineObservation?: (action: CompatibilityActionCandidate, effect: import("@finnor/planning-ir").EffectSpec, observationId: string, index: number) => import("@finnor/planning-ir").ObservationSpec | undefined;
  deriveHardConstraints?: (effects: import("@finnor/planning-ir").EffectSpec[], observations: import("@finnor/planning-ir").ObservationSpec[]) => ConstraintSpec[];
}

function buildTypedActionDecisionPlanningIr(input: ActionDecisionPlanningIrInput): PlanningIrArtifact {
  const effects = input.actions.map((action, index) => {
    const effectId = `effect:${index}:${randomUUID()}`;
    const compiled = input.compileEffect?.(action, effectId, index);
    if (compiled) return compiled;
    const targetRefs = collectCanonicalRefs(action.payload);
    return {
      id: effectId,
      actionType: action.actionType,
      effectIntent: action.reasoning?.trim() || `${action.actionType} proposed to achieve the requested outcome`,
      payload: action.payload,
      targetRefs,
      requiredCapability: action.requiredCapability ?? `action:${action.actionType}`,
      risk: action.risk ?? "high",
      exposure: exposure(action.payload),
      proposalOnly: true as const,
    };
  });
  const effectNodes = effects.map((effect, index) => ({
    id: `node:effect:${index}:${randomUUID()}`,
    kind: "effect" as const,
    effectId: effect.id,
    dependsOn: input.actions[index]!.dependsOn.map((dependency) => `node:effect:${dependency}:placeholder`),
    causalPrerequisites: input.actions[index]!.dependsOn.map((dependency) => `node:effect:${dependency}:placeholder`),
    requiredCapabilities: [effect.requiredCapability],
  }));
  // Replace placeholder references after every generated id is known. IDs are
  // provenance-only labels; the semantic hash canonicalizes the graph topology.
  for (let index = 0; index < effectNodes.length; index += 1) {
    effectNodes[index]!.dependsOn = input.actions[index]!.dependsOn.map((dependency) => effectNodes[dependency]!.id);
    effectNodes[index]!.causalPrerequisites = [...effectNodes[index]!.dependsOn];
  }
  const observations = effects.map((effect, index) => {
    const kind = input.observationForAction(effect.actionType);
    const observationId = `observation:${index}:${randomUUID()}`;
    const defined = input.defineObservation?.(input.actions[index]!, effect, observationId, index);
    if (defined) return defined;
    return {
      id: observationId,
      effectId: effect.id,
      kind,
      predicate: { intendedOutcome: input.requestedOutcome, actionType: effect.actionType },
      requiredEvidence: evidenceFor(kind),
      acknowledgementSufficient: false as const,
      verificationFloor: "at_least_existing" as const,
    };
  });
  const observeNodes = observations.map((observation, index) => ({
    id: `node:observe:${index}:${randomUUID()}`,
    kind: "observe" as const,
    observationId: observation.id,
    dependsOn: [effectNodes[index]!.id],
    causalPrerequisites: [effectNodes[index]!.id],
    requiredCapabilities: [],
  }));
  const refs = [...new Map([...effects.flatMap((effect) => effect.targetRefs), ...(input.included ?? [])]
    .map((ref) => [`${ref.kind}:${ref.entityType}:${ref.entityId}:${ref.field ?? ""}`, ref])).values()];
  const desiredSubject = refs[0] ?? { kind: "business_state" as const, key: effects[0]?.actionType ?? "objective" };
  return createPlanningIrArtifact({
    intent: {
      requestedOutcome: input.requestedOutcome,
      executionModel: input.executionModel,
      groundedEntities: refs,
      scope: { included: refs, excluded: input.excluded ?? [], textExclusions: input.textExclusions ?? [] },
      unresolvedAmbiguity: input.unresolvedAmbiguity ?? [],
      provenance: input.provenance,
    },
    goal: {
      statement: input.requestedOutcome,
      desiredState: [{ subject: desiredSubject, path: [], operator: "completed" }],
      completionMode: "all",
      objectiveCompatibility: "reuse_existing_objective_semantics",
    },
    constraints: { hard: [...(input.hardConstraints ?? []), ...(input.deriveHardConstraints?.(effects, observations) ?? [])], soft: input.softConstraints ?? [] },
    plan: { nodes: [...effectNodes, ...observeNodes], completion: { mode: "all", observationIds: observations.map(({ id }) => id) } },
    effects,
    observations,
  }, { compilerVersion: PLANNING_IR_COMPILER_VERSION, provenance: input.provenance });
}

/** Legacy action candidates enter Planning IR only through this bounded adapter. */
export function buildCompatibilityPlanningIr(input: ActionDecisionPlanningIrInput): PlanningIrArtifact {
  return buildTypedActionDecisionPlanningIr(input);
}

/** The durable Objective controller already owns a typed decision. This emits the
 * canonical native Goal/Plan/Effect/Observation artifact directly, without an
 * actions[] model envelope or compatibility fallback. */
export function buildNativeControllerPlanningIr(input: ActionDecisionPlanningIrInput): PlanningIrArtifact {
  if (input.provenance.source !== "objective_controller") {
    throw new Error("Native controller Planning IR requires objective_controller provenance");
  }
  return buildTypedActionDecisionPlanningIr(input);
}

/** The Objective route has a meaningful typed goal before its controller selects
 * the first effect. Persist that goal/observation contract immediately; later
 * objective action decisions each receive their own effect-bearing IR artifact. */
export function buildObjectiveGoalPlanningIr(input: {
  requestedOutcome: string;
  successCondition: Record<string, unknown>;
  provenance: PlanningIrArtifact["metadata"]["provenance"];
  included?: CanonicalEntityRef[];
  excluded?: CanonicalEntityRef[];
  textExclusions?: string[];
}): PlanningIrArtifact {
  const observationId = `observation:objective:${randomUUID()}`;
  const included = input.included ?? [];
  const excluded = input.excluded ?? [];
  const subject = included[0] ?? { kind: "business_state" as const, key: "objective" };
  return createPlanningIrArtifact({
    intent: {
      requestedOutcome: input.requestedOutcome,
      executionModel: "OBJECTIVE",
      groundedEntities: included,
      scope: { included, excluded, textExclusions: input.textExclusions ?? [] },
      unresolvedAmbiguity: [],
      provenance: input.provenance,
    },
    goal: {
      statement: input.requestedOutcome,
      desiredState: [{ subject, path: [], operator: "completed", expected: input.successCondition }],
      completionMode: "all",
      objectiveCompatibility: "reuse_existing_objective_semantics",
    },
    constraints: { hard: [], soft: [] },
    plan: {
      nodes: [{
        id: `node:observe:objective:${randomUUID()}`,
        kind: "observe",
        observationId,
        dependsOn: [],
        causalPrerequisites: [],
        requiredCapabilities: [],
      }],
      completion: { mode: "all", observationIds: [observationId] },
    },
    effects: [],
    observations: [{
      id: observationId,
      kind: "canonical_query",
      predicate: { objectiveSuccessCondition: input.successCondition },
      requiredEvidence: ["objective_success_condition_evidence", "canonical_query_result"],
      acknowledgementSufficient: false,
      verificationFloor: "at_least_existing",
    }],
  }, { compilerVersion: PLANNING_IR_COMPILER_VERSION, provenance: input.provenance });
}

export function semanticSnapshotFromArtifact(artifact: PlanningIrArtifact): PlanningSemanticSnapshot {
  const nodeByEffect = new Map(artifact.plan.nodes.filter((node): node is Extract<typeof node, { kind: "effect" }> => node.kind === "effect").map((node) => [node.effectId, node]));
  const observationByEffect = new Map(artifact.observations.filter((observation) => observation.effectId).map((observation) => [observation.effectId!, observation]));
  const effectByNode = new Map([...nodeByEffect.entries()].map(([effectId, node]) => [node.id, effectId]));
  return {
    executionModel: artifact.intent.executionModel,
    groundedTargets: artifact.intent.groundedEntities,
    scope: artifact.intent.scope,
    intendedOutcome: artifact.goal.statement,
    effects: artifact.effects.map((effect) => {
      const node = nodeByEffect.get(effect.id);
      return {
        actionType: effect.actionType,
        payload: effect.payload,
        requiredCapability: effect.requiredCapability,
        dependsOn: (node?.dependsOn ?? []).map((id) => effectByNode.get(id) ?? id),
        observation: observationByEffect.get(effect.id)?.kind ?? "recorded_result",
        authorityRisk: effect.risk,
      };
    }),
    hardConstraints: artifact.constraints.hard,
    completionPredicates: artifact.observations,
    supported: true,
    valid: true,
  };
}

export function compareLegacyCandidateToIr(input: {
  artifact: PlanningIrArtifact;
  executionModel: PlanningExecutionModel;
  requestedOutcome: string;
  actions: CompatibilityActionCandidate[];
  observationForAction(actionType: string): ObservationKind;
  included?: CanonicalEntityRef[];
  excluded?: CanonicalEntityRef[];
  textExclusions?: string[];
}): PlanningSemanticDiff {
  const refs = [...new Map([...input.actions.flatMap((action) => collectCanonicalRefs(action.payload)), ...(input.included ?? [])]
    .map((ref) => [`${ref.kind}:${ref.entityType}:${ref.entityId}:${ref.field ?? ""}`, ref])).values()];
  const legacy: PlanningSemanticSnapshot = {
    executionModel: input.executionModel,
    groundedTargets: refs,
    scope: { included: refs, excluded: input.excluded ?? [], textExclusions: input.textExclusions ?? [] },
    intendedOutcome: input.requestedOutcome,
    effects: input.actions.map((action) => ({
      actionType: action.actionType,
      payload: action.payload,
      requiredCapability: action.requiredCapability ?? `action:${action.actionType}`,
      dependsOn: action.dependsOn.map((dependency) => input.artifact.effects[dependency]?.id ?? `missing:${dependency}`),
      observation: input.observationForAction(action.actionType),
      authorityRisk: action.risk ?? "high",
    })),
    hardConstraints: [],
    completionPredicates: input.artifact.observations,
    supported: true,
    valid: true,
  };
  return comparePlanningSemantics(legacy, semanticSnapshotFromArtifact(input.artifact));
}

export function compareExistingObjectiveGoalToIr(input: {
  artifact: PlanningIrArtifact;
  requestedOutcome: string;
  included: CanonicalEntityRef[];
  excluded: CanonicalEntityRef[];
}): PlanningSemanticDiff {
  const legacy: PlanningSemanticSnapshot = {
    executionModel: "OBJECTIVE",
    groundedTargets: input.included,
    scope: { included: input.included, excluded: input.excluded, textExclusions: [] },
    intendedOutcome: input.requestedOutcome,
    effects: [],
    hardConstraints: [],
    // Existing ObjectiveSuccessCondition remains the completion truth. The IR
    // points at that same predicate and can only add evidence, never replace it.
    completionPredicates: input.artifact.observations,
    supported: true,
    valid: true,
  };
  return comparePlanningSemantics(legacy, semanticSnapshotFromArtifact(input.artifact));
}
