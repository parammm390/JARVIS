import type { ConstraintSpec, ObservationSpec, PlanningIrArtifact } from "@finnor/planning-ir";
import type { AdmittedPlanningIr } from "./ir-admissibility";

export interface LoweredDomainActionCandidate {
  actionType: string;
  payload: Record<string, unknown>;
  reasoning: string;
  dependsOn: number[];
  requiredCapability: string;
  hardConstraints: ConstraintSpec[];
  observation: ObservationSpec;
  planning: PlanningIrArtifact["metadata"] & {
    effectId: string;
    effectNodeId: string;
    provenance: PlanningIrArtifact["intent"]["provenance"];
    intent: PlanningIrArtifact["intent"];
    goal: PlanningIrArtifact["goal"];
    constraints: PlanningIrArtifact["constraints"];
    completion: PlanningIrArtifact["plan"]["completion"];
  };
}

/** Deterministic compatibility lowerer. It emits existing DomainAction candidate
 * fields plus a sidecar; it never compiles, authorizes, persists, or executes a
 * BusinessEffectSet. */
export function lowerAdmittedPlanningIr(admitted: AdmittedPlanningIr): LoweredDomainActionCandidate[] {
  const artifact = admitted.artifact;
  const effectById = new Map(artifact.effects.map((effect) => [effect.id, effect]));
  const observationByEffect = new Map(artifact.observations.filter((observation) => observation.effectId).map((observation) => [observation.effectId!, observation]));
  const effectNodes = artifact.plan.nodes.filter((node): node is Extract<typeof node, { kind: "effect" }> => node.kind === "effect");
  const indexByNodeId = new Map(effectNodes.map((node, index) => [node.id, index]));
  return effectNodes.map((node) => {
    const effect = effectById.get(node.effectId);
    if (!effect) throw new Error(`Compatibility lowerer received an admitted graph without effect ${node.effectId}`);
    const observation = observationByEffect.get(effect.id);
    if (!observation) throw new Error(`Compatibility lowerer received an admitted effect without completion observation ${effect.id}`);
    const nonEffectDependency = node.dependsOn.find((dependency) => !indexByNodeId.has(dependency));
    if (nonEffectDependency) throw new Error(`Compatibility lowerer cannot erase non-effect prerequisite ${nonEffectDependency}`);
    return {
      actionType: effect.actionType,
      payload: effect.payload,
      reasoning: effect.effectIntent,
      dependsOn: node.dependsOn.map((dependency) => indexByNodeId.get(dependency)!),
      requiredCapability: effect.requiredCapability,
      hardConstraints: artifact.constraints.hard,
      observation,
      planning: {
        ...artifact.metadata,
        effectId: effect.id,
        effectNodeId: node.id,
        provenance: artifact.intent.provenance,
        intent: artifact.intent,
        goal: artifact.goal,
        constraints: artifact.constraints,
        completion: artifact.plan.completion,
      },
    };
  });
}
