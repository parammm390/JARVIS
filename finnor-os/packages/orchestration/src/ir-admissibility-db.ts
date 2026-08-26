import { planningIrArtifacts, type Db } from "@finnor/db";
import type { PlanningIrArtifact, PlanningSemanticDiff, SemanticDiffClassification } from "@finnor/planning-ir";
import { businessEffectObservationForAction, groundCanonicalRefWithDb, groundEntitiesWithDb } from "./compiler";
import { IrAdmissibilityCompiler } from "./ir-admissibility";
import type { PluginRegistry } from "./plugin-registry";

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
  return new IrAdmissibilityCompiler({
    groundPayload: (payload) => groundEntitiesWithDb(input.db, input.tenantId, payload),
    groundRef: (ref) => groundCanonicalRefWithDb(input.db, input.tenantId, ref),
    hasCapability,
    hasActionType: (actionType) => actionTypes.has(actionType),
    requiredObservation: businessEffectObservationForAction,
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
}): Promise<string> {
  const [row] = await input.db.insert(planningIrArtifacts).values({
    tenantId: input.tenantId,
    domainActionId: input.domainActionId ?? null,
    workId: input.workId ?? null,
    objectiveStepId: input.objectiveStepId ?? null,
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
