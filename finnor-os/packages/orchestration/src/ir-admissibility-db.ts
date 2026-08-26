import { domainPolicyRevisions, equipment, planningIrArtifacts, propertyPartyRelationships, works, type Db } from "@finnor/db";
import type { ConstraintSpec, ConstraintTruthEvaluation, PlanningIrArtifact, PlanningSemanticDiff, SemanticDiffClassification } from "@finnor/planning-ir";
import { and, desc, eq, isNull, lte } from "drizzle-orm";
import { businessEffectApprovalRequired, businessEffectObservationForAction, groundCanonicalRefWithDb, groundEntitiesWithDb } from "./compiler";
import { IrAdmissibilityCompiler } from "./ir-admissibility";
import type { PluginRegistry } from "./plugin-registry";

const evaluation = (
  truth: ConstraintTruthEvaluation["truth"],
  source: ConstraintTruthEvaluation["source"],
  reason: string,
  evidence: string[] = [],
  sourceVersions: Record<string, string> = { evaluator: "phase1-constraint-evaluator-v2" },
): Omit<ConstraintTruthEvaluation, "constraintId" | "evaluatedAt"> => ({ truth, source, reason, evidence, sourceVersions });

/** DB-aware adapter above @finnor/planning-ir. It reuses compiler.ts grounding and
 * the existing canonical tenant resolver; the foundation package remains DB-free. */
export function createDbIrAdmissibilityCompiler(input: {
  db: Db;
  tenantId: string;
  plugins: PluginRegistry;
  now?: () => Date;
  capabilities?: ReadonlySet<string>;
}): IrAdmissibilityCompiler {
  const actionTypes = new Set(input.plugins.actionTypes());
  const hasCapability = (capability: string): boolean => {
    if (input.capabilities?.has(capability)) return true;
    const actionType = capability.startsWith("action:") ? capability.slice("action:".length) : capability;
    return actionTypes.has(actionType);
  };
  const groundRef = (ref: import("@finnor/planning-ir").CanonicalEntityRef) => groundCanonicalRefWithDb(input.db, input.tenantId, ref);
  const evaluateConstraint = async (constraint: ConstraintSpec, artifact: PlanningIrArtifact): Promise<Omit<ConstraintTruthEvaluation, "constraintId" | "evaluatedAt">> => {
    switch (constraint.kind) {
      case "capability": {
        const capability = typeof constraint.values.capability === "string" ? constraint.values.capability : null;
        if (!capability) return evaluation("unresolved", "capability_registry", "capability is missing", []);
        return hasCapability(capability)
          ? evaluation("satisfied", "capability_registry", `${capability} is registered`, [`capability:${capability}`])
          : evaluation("violated", "capability_registry", `${capability} is unavailable`, [`capability:${capability}`]);
      }
      case "temporal": {
        const notBefore = typeof constraint.values.notBefore === "string" ? Date.parse(constraint.values.notBefore) : null;
        const notAfter = typeof constraint.values.notAfter === "string" ? Date.parse(constraint.values.notAfter) : null;
        if (notBefore === null && notAfter === null) return evaluation("unresolved", "clock", "no temporal bounds were supplied");
        if ((notBefore !== null && !Number.isFinite(notBefore)) || (notAfter !== null && !Number.isFinite(notAfter))) return evaluation("violated", "clock", "temporal bound is invalid");
        if (notBefore !== null && notAfter !== null && notBefore > notAfter) return evaluation("violated", "clock", "temporal interval is impossible");
        const now = (input.now ?? (() => new Date()))().getTime();
        if (notAfter !== null && now > notAfter) return evaluation("violated", "clock", "temporal deadline has expired", [`clock:${new Date(now).toISOString()}`]);
        if (notBefore !== null && now < notBefore) return evaluation("unresolved", "clock", "temporal precondition is not yet true", [`clock:${new Date(now).toISOString()}`]);
        return evaluation("satisfied", "clock", "temporal interval is internally consistent and not expired", [`clock:${new Date(now).toISOString()}`]);
      }
      case "entity_relationship": {
        const relationship = typeof constraint.values.relationship === "string" ? constraint.values.relationship : null;
        const propertyRef = constraint.subjectRefs.find((ref) => ref.kind === "property" || ref.entityType === "property");
        const partyRef = constraint.subjectRefs.find((ref) => ref.kind === "party");
        const assetRef = constraint.subjectRefs.find((ref) => ref.kind === "asset" || ref.entityType === "equipment");
        if (!relationship || !propertyRef || (!partyRef && !assetRef)) return evaluation("unresolved", "canonical_relationship", "relationship requires a property plus a party or asset reference");
        if (partyRef) {
          const rows = await input.db.select({ id: propertyPartyRelationships.id }).from(propertyPartyRelationships).where(and(
            eq(propertyPartyRelationships.tenantId, input.tenantId),
            eq(propertyPartyRelationships.propertyId, propertyRef.entityId),
            eq(propertyPartyRelationships.partyType, partyRef.entityType as typeof propertyPartyRelationships.partyType.enumValues[number]),
            eq(propertyPartyRelationships.partyId, partyRef.entityId),
            eq(propertyPartyRelationships.relationship, relationship as typeof propertyPartyRelationships.relationship.enumValues[number]),
            isNull(propertyPartyRelationships.validTo),
          )).limit(1);
          return rows.length === 1
            ? evaluation("satisfied", "canonical_relationship", "active Party↔Property relationship exists", [`property_party_relationship:${rows[0]!.id}`])
            : evaluation("violated", "canonical_relationship", "required active Party↔Property relationship does not exist");
        }
        if (relationship !== "installed_at") return evaluation("unresolved", "canonical_relationship", `asset relationship ${relationship} is unsupported`);
        const rows = await input.db.select({ id: equipment.id }).from(equipment).where(and(eq(equipment.tenantId, input.tenantId), eq(equipment.id, assetRef!.entityId), eq(equipment.propertyId, propertyRef.entityId))).limit(1);
        return rows.length === 1
          ? evaluation("satisfied", "canonical_relationship", "asset is linked to the canonical property", [`equipment:${rows[0]!.id}`])
          : evaluation("violated", "canonical_relationship", "asset is not linked to the required property");
      }
      case "cost_risk_exposure": {
        const maxAmount = typeof constraint.values.maxAmount === "number" ? constraint.values.maxAmount : null;
        const maxRisk = typeof constraint.values.maxRisk === "string" ? constraint.values.maxRisk : null;
        if (maxAmount === null && maxRisk === null) return evaluation("unresolved", "canonical_state", "no exposure or risk bound was supplied");
        if (maxAmount !== null && artifact.effects.some((effect) => effect.exposure && effect.exposure.amount > maxAmount)) return evaluation("violated", "canonical_state", `an effect exceeds ${maxAmount}`);
        const rank = { low: 0, medium: 1, high: 2 } as const;
        if (maxRisk && !(maxRisk in rank)) return evaluation("unresolved", "canonical_state", `unknown risk bound ${maxRisk}`);
        if (maxRisk && artifact.effects.some((effect) => rank[effect.risk] > rank[maxRisk as keyof typeof rank])) return evaluation("violated", "canonical_state", `an effect exceeds ${maxRisk} risk`);
        return evaluation("satisfied", "canonical_state", "effect exposure and risk are within the declared hard bounds", artifact.effects.map((effect) => `effect:${effect.id}`));
      }
      case "policy_authority": {
        const requiresApproval = typeof constraint.values.requiresApproval === "boolean" ? constraint.values.requiresApproval : null;
        if (requiresApproval === null) return evaluation("unresolved", "policy_authority", "requiresApproval must be a boolean");
        const declaredActionType = typeof constraint.values.actionType === "string" ? constraint.values.actionType : null;
        const actionTypesToCheck = declaredActionType ? [declaredActionType] : [...new Set(artifact.effects.map((effect) => effect.actionType))];
        if (declaredActionType && !artifact.effects.some((effect) => effect.actionType === declaredActionType)) {
          return evaluation("violated", "policy_authority", `constraint action ${declaredActionType} is not present in EffectSpec`);
        }
        const policyRows = actionTypesToCheck.length ? await input.db.select().from(domainPolicyRevisions).where(and(
          eq(domainPolicyRevisions.tenantId, input.tenantId),
          lte(domainPolicyRevisions.effectiveFrom, input.now?.() ?? new Date()),
        )).orderBy(desc(domainPolicyRevisions.effectiveFrom)) : [];
        const policyByType = new Map(policyRows.filter((row, index, all) => all.findIndex((candidate) => candidate.actionType === row.actionType) === index).map((row) => [row.actionType, row]));
        const actual = actionTypesToCheck.map((actionType) => {
          return businessEffectApprovalRequired(actionType, policyByType.get(actionType)?.requiresConfirmation ?? true);
        });
        const matches = requiresApproval ? actual.every(Boolean) : actual.every((value) => !value);
        return evaluation(
          matches ? "satisfied" : "violated",
          "policy_authority",
          matches ? "current fixed/policy approval truth matches the constraint" : "current fixed/policy approval truth conflicts with the constraint",
          actionTypesToCheck.map((actionType) => `authority:${actionType}`),
          Object.fromEntries(actionTypesToCheck.map((actionType) => [actionType, String(policyByType.get(actionType)?.version ?? 0)])),
        );
      }
      case "user_restriction": {
        const prohibited = Array.isArray(constraint.values.prohibitedActionTypes) && constraint.values.prohibitedActionTypes.every((value) => typeof value === "string")
          ? constraint.values.prohibitedActionTypes as string[]
          : null;
        if (prohibited) {
          const conflict = artifact.effects.find((effect) => prohibited.includes(effect.actionType));
          return evaluation(conflict ? "violated" : "satisfied", "runtime_scope", conflict ? `${conflict.actionType} is prohibited` : "no effect uses a prohibited action type", prohibited.map((actionType) => `prohibited:${actionType}`));
        }
        const trustedExcluded = artifact.intent.scope.excluded.filter((ref) => ref.provenance === "trusted_interaction_exclusion" || ref.provenance === "trusted_operating_context");
        if (artifact.intent.scope.excluded.length !== trustedExcluded.length) return evaluation("unresolved", "runtime_scope", "one or more exclusions lack trusted runtime provenance");
        const excludedKeys = new Set(trustedExcluded.map((ref) => `${ref.kind}:${ref.entityType}:${ref.entityId}`));
        if (constraint.subjectRefs.length > 0) {
          const conflicts = artifact.effects.flatMap((effect) => effect.targetRefs).filter((ref) => excludedKeys.has(`${ref.kind}:${ref.entityType}:${ref.entityId}`));
          return evaluation(conflicts.length ? "violated" : "satisfied", "runtime_scope", conflicts.length ? "an effect targets an explicitly excluded entity" : "effect targets respect explicit exclusions", conflicts.map((ref) => `excluded:${ref.entityType}:${ref.entityId}`));
        }
        return evaluation("unresolved", "runtime_scope", "restriction is not tied to a trusted executable predicate");
      }
      case "precondition": {
        if (constraint.values.workNotTerminal === true) {
          const workRef = constraint.subjectRefs.find((ref) => ref.kind === "work" || ref.entityType === "work");
          if (!workRef) return evaluation("unresolved", "canonical_state", "workNotTerminal requires a canonical Work reference");
          const [work] = await input.db.select({ id: works.id, status: works.status, updatedAt: works.updatedAt }).from(works).where(and(
            eq(works.tenantId, input.tenantId),
            eq(works.id, workRef.entityId),
          )).limit(1);
          if (!work) return evaluation("violated", "canonical_state", "required Work does not exist in this tenant");
          const terminal = work.status === "cancelled" || work.status === "failed" || work.status === "completed";
          return evaluation(
            terminal ? "violated" : "satisfied",
            "canonical_state",
            terminal ? `Work is terminal (${work.status})` : `Work remains executable (${work.status})`,
            [`work:${work.id}:status:${work.status}`],
            { work: work.updatedAt.toISOString() },
          );
        }
        if (constraint.values.exists !== true || constraint.subjectRefs.length === 0) return evaluation("unresolved", "canonical_state", "precondition has no supported canonical existence predicate");
        const grounded = await Promise.all(constraint.subjectRefs.map(groundRef));
        return grounded.every((status) => status === "verified")
          ? evaluation("satisfied", "canonical_state", "all required canonical entities exist in this tenant", constraint.subjectRefs.map((ref) => `${ref.entityType}:${ref.entityId}`))
          : evaluation(grounded.some((status) => status === "not_found") ? "violated" : "unresolved", "canonical_state", "one or more required canonical entities could not be verified");
      }
      case "observation_verifiability": {
        const effectId = typeof constraint.values.effectId === "string" ? constraint.values.effectId : null;
        const effect = effectId ? artifact.effects.find((candidate) => candidate.id === effectId) : null;
        if (!effect) return evaluation("violated", "canonical_state", "observation constraint references no existing EffectSpec");
        const observation = artifact.observations.find((candidate) => candidate.effectId === effect.id);
        if (!observation) return evaluation("violated", "canonical_state", `EffectSpec ${effect.id} has no ObservationSpec`);
        const required = businessEffectObservationForAction(effect.actionType);
        const strength = { recorded_result: 0, provider_delivery: 1, canonical_state: 2, workflow_completion: 2, computer_state: 2, canonical_query: 3 } as const;
        const valid = strength[observation.kind] >= strength[required]
          && observation.acknowledgementSufficient === false
          && observation.verificationFloor === "at_least_existing"
          && observation.requiredEvidence.length > 0;
        return evaluation(
          valid ? "satisfied" : "violated",
          "canonical_state",
          valid ? "ObservationSpec preserves the existing BusinessEffect verification floor" : `ObservationSpec does not preserve ${required} verification truth`,
          [`effect:${effect.id}`, `observation:${observation.id}`, `existing_floor:${required}`],
        );
      }
      case "preference":
        return evaluation("unresolved", "unsupported", "a HARD preference has no independently verifiable truth predicate");
    }
  };
  return new IrAdmissibilityCompiler({
    groundPayload: (payload) => groundEntitiesWithDb(input.db, input.tenantId, payload),
    groundRef,
    hasCapability,
    hasActionType: (actionType) => actionTypes.has(actionType),
    requiredObservation: businessEffectObservationForAction,
    evaluateConstraint,
    now: input.now ?? (() => new Date()),
  });
}

export async function persistPlanningIrArtifactTx(input: {
  db: Db;
  tenantId: string;
  artifact: PlanningIrArtifact;
  status: "shadow" | "accepted" | "rejected" | "lowered";
  diff: PlanningSemanticDiff;
  domainActionId?: string;
  workId?: string;
  objectiveStepId?: string;
  effectId?: string;
  constraintEvaluations: ConstraintTruthEvaluation[];
}): Promise<string> {
  const [row] = await input.db.insert(planningIrArtifacts).values({
    tenantId: input.tenantId,
    domainActionId: input.domainActionId ?? null,
    workId: input.workId ?? null,
    objectiveStepId: input.objectiveStepId ?? null,
    effectId: input.effectId ?? null,
    constraintEvaluations: input.constraintEvaluations,
    irSchemaVersion: input.artifact.metadata.irSchemaVersion,
    compilerVersion: input.artifact.metadata.compilerVersion,
    irSemanticHash: input.artifact.metadata.irSemanticHash,
    provenance: input.artifact.metadata.provenance,
    artifact: input.artifact,
    status: input.status,
    comparisonClassification: input.diff.classification as SemanticDiffClassification,
    semanticDiff: input.diff,
  }).returning({ id: planningIrArtifacts.id });
  return row!.id;
}
