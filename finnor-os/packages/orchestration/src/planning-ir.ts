import { randomUUID } from "node:crypto";
import {
  PLANNING_IR_COMPILER_VERSION,
  comparePlanningSemantics,
  createPlanningIrArtifact,
  type CanonicalEntityRef,
  type ConstraintSpec,
  type ObservationKind,
  type PlanningExecutionModel,
  type PlanningIrArtifact,
  type PlanningSemanticDiff,
  type PlanningSemanticSnapshot,
} from "@finnor/planning-ir";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type PlanningIrMode = "legacy" | "shadow" | "cutover";

export function planningIrMode(env = process.env): PlanningIrMode {
  const configured = env.FINNOR_PLANNING_IR_MODE?.trim().toLowerCase();
  if (!configured) return "cutover";
  if (configured === "legacy" || configured === "shadow" || configured === "cutover") return configured;
  throw new Error(`FINNOR_PLANNING_IR_MODE must be legacy, shadow, or cutover; received ${configured}`);
}

export interface CompatibilityActionCandidate {
  actionType: string;
  payload: Record<string, unknown>;
  reasoning?: string;
  dependsOn: number[];
  requiredCapability?: string;
  risk?: "low" | "medium" | "high";
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

export function buildCompatibilityPlanningIr(input: {
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
}): PlanningIrArtifact {
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
    constraints: { hard: input.hardConstraints ?? [], soft: input.softConstraints ?? [] },
    plan: { nodes: [...effectNodes, ...observeNodes], completion: { mode: "all", observationIds: observations.map(({ id }) => id) } },
    effects,
    observations,
  }, { compilerVersion: PLANNING_IR_COMPILER_VERSION, provenance: input.provenance });
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
