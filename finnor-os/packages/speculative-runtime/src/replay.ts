import type { CausalReplayNode } from "@finnor/shared-types";
import type { SimulationResult } from "./contracts";
import { p5Hash } from "./identity";

export interface SpeculativeReplaySummary {
  version: 1;
  replayIdentity: string;
  traceId: string;
  snapshotId: string;
  programIrSemanticHash: string;
  p4CandidateHash: string;
  status: SimulationResult["status"];
  snapshotProvenance: {
    asOf: string;
    sourceId: string;
    sourceRefs: string[];
    materializationHash: string;
  };
  program: {
    semanticId: string;
    irSemanticHash: string;
    executionModel: string;
    nodes: Array<{ semanticId: string; kind: string; operation: string | null; requiredCapability: string | null }>;
  };
  branches: Array<{
    branchId: string;
    assumptionRefs: Array<{ variableId: string; outcomeId: string }>;
    hypotheticalEffectIds: string[];
    observationRefs: string[];
    outcome: string | null;
    failureCodes: string[];
    recoveryKinds: string[];
    hypotheticalEffects: Array<{
      hypotheticalEffectId: string;
      planningEffectRef: string;
      adapterClass: string;
      outcome: string;
      reversibility: string;
      changes: Array<{ target: { kind: string; type: string; id: string }; path: Array<string | number> }>;
    }>;
    predictedObservations: Array<{
      observationRef: string;
      status: string;
      evidenceClass: string;
      verification: string;
      strength: string;
      reasonCodes: string[];
    }>;
    branchOutcome: null | {
      outcome: string;
      goalSatisfaction: string;
      goalSatisfactionOrdinal: number;
      hardConstraintStatus: string;
      verificationStrength: string;
      recoveryBurden: string;
      irreversibility: string;
      uncertaintyRemaining: string[];
      residualDamage: string[];
    };
    recoveryPath: Array<{ kind: string; status: string; effectRef: string | null; reasonCodes: string[] }>;
  }>;
  issues: Array<{ code: string; nodeRef: string | null }>;
  redaction: "STRUCTURED_SIMULATOR_EVIDENCE_ONLY";
}

/** Structured simulator evidence only: no prompts, model rationale, raw values, credentials, or chain-of-thought. */
export function speculativeReplaySummary(result: SimulationResult): SpeculativeReplaySummary {
  return {
    version: 1,
    replayIdentity: result.replayIdentity,
    traceId: result.traceId,
    snapshotId: result.snapshotId,
    programIrSemanticHash: result.programIrSemanticHash,
    p4CandidateHash: result.p4CandidateHash,
    status: result.status,
    snapshotProvenance: {
      asOf: result.snapshotProvenance.asOf,
      sourceId: result.snapshotProvenance.sourceId,
      sourceRefs: [...result.snapshotProvenance.sourceRefs],
      materializationHash: result.snapshotProvenance.materializationHash,
    },
    program: {
      semanticId: result.programEvidence.semanticId,
      irSemanticHash: result.programIrSemanticHash,
      executionModel: result.programEvidence.executionModel,
      nodes: result.programEvidence.nodes.map((node) => ({ ...node })),
    },
    branches: result.branches.map((branch) => ({
      branchId: branch.branchId,
      assumptionRefs: branch.assumptions.map((assumption) => ({ variableId: assumption.variableId, outcomeId: assumption.outcomeId })),
      hypotheticalEffectIds: branch.effectOverlay.map((effect) => effect.hypotheticalEffectId),
      observationRefs: branch.simulatedObservations.map((observation) => observation.observationRef),
      outcome: branch.outcome?.outcome ?? null,
      failureCodes: branch.failureModes.map((failure) => failure.code),
      recoveryKinds: branch.recoveryPath.map((step) => step.kind),
      hypotheticalEffects: branch.effectOverlay.map((effect) => ({
        hypotheticalEffectId: effect.hypotheticalEffectId,
        planningEffectRef: effect.planningEffect.semanticId,
        adapterClass: effect.adapterClass,
        outcome: effect.outcome,
        reversibility: effect.reversibility,
        changes: effect.changes.map((change) => ({ target: { ...change.target }, path: [...change.path] })),
      })),
      predictedObservations: branch.simulatedObservations.map((observation) => ({
        observationRef: observation.observationRef,
        status: observation.status,
        evidenceClass: observation.evidenceClass,
        verification: observation.verification,
        strength: observation.strength,
        reasonCodes: [...observation.reasonCodes],
      })),
      branchOutcome: branch.outcome ? {
        outcome: branch.outcome.outcome,
        goalSatisfaction: branch.outcome.goalSatisfaction.status,
        goalSatisfactionOrdinal: branch.outcome.goalSatisfaction.ordinal,
        hardConstraintStatus: branch.outcome.hardConstraintStatus,
        verificationStrength: branch.outcome.verificationStrength,
        recoveryBurden: branch.outcome.recoveryBurden,
        irreversibility: branch.outcome.irreversibility,
        uncertaintyRemaining: [...branch.outcome.uncertaintyRemaining],
        residualDamage: [...branch.outcome.residualDamage],
      } : null,
      recoveryPath: branch.recoveryPath.map((step) => ({
        kind: step.kind,
        status: step.status,
        effectRef: step.effectRef,
        reasonCodes: [...step.reasonCodes],
      })),
    })),
    issues: result.issues.map((issue) => ({ code: issue.code, nodeRef: issue.nodeRef })),
    redaction: "STRUCTURED_SIMULATOR_EVIDENCE_ONLY",
  };
}

export function simulationToCausalReplayNodes(
  result: SimulationResult,
  provenance: { recordedAt: string; source?: string; ref?: string },
): CausalReplayNode[] {
  const summary = speculativeReplaySummary(result);
  const source = provenance.source ?? `decision_context_snapshot.speculation.${result.replayIdentity}`;
  const ref = provenance.ref ?? result.replayIdentity;
  const evidence = [{
    source,
    ref,
    recordedAt: provenance.recordedAt,
    availability: "available" as const,
    integrityHash: p5Hash(summary),
  }];
  const nodes: CausalReplayNode[] = [{
    id: `${result.replayIdentity}:snapshot`,
    stage: "context",
    title: "Immutable business world snapshot",
    summary: `${result.branches.length} speculative branch${result.branches.length === 1 ? "" : "es"} from a bounded canonical snapshot`,
    status: result.status.toLowerCase(),
    occurredAt: provenance.recordedAt,
    sourceRefs: [source],
    evidence,
    facts: {
      snapshotId: result.snapshotId,
      programIrSemanticHash: result.programIrSemanticHash,
      p4CandidateHash: result.p4CandidateHash,
      bounds: result.bounds,
      sideEffects: result.sideEffects,
      ownership: result.ownership,
      snapshotProvenance: summary.snapshotProvenance,
      program: summary.program,
    },
    entityRefs: [],
  }];
  for (const branch of summary.branches) {
    nodes.push({
      id: `${branch.branchId}:prediction`,
      stage: "planning",
      title: "Speculative world branch",
      summary: `${branch.hypotheticalEffectIds.length} hypothetical effects · ${branch.outcome ?? "unknown"}`,
      status: branch.outcome?.toLowerCase() ?? "unknown",
      occurredAt: provenance.recordedAt,
      sourceRefs: [source],
      evidence,
      facts: {
        branchId: branch.branchId,
        assumptions: branch.assumptionRefs,
        hypotheticalEffects: branch.hypotheticalEffects,
        predictedObservations: branch.predictedObservations,
        branchOutcome: branch.branchOutcome,
        failureCodes: branch.failureCodes,
      },
      entityRefs: [],
    });
    if (branch.recoveryKinds.length > 0) nodes.push({
      id: `${branch.branchId}:recovery`,
      stage: "recovery",
      title: "Predicted recovery path",
      summary: `${branch.recoveryKinds.length} recovery step${branch.recoveryKinds.length === 1 ? "" : "s"}`,
      status: "predicted_only",
      occurredAt: provenance.recordedAt,
      sourceRefs: [source],
      evidence,
      facts: { branchId: branch.branchId, recoveryPath: branch.recoveryPath },
      entityRefs: [],
    });
  }
  return nodes;
}
