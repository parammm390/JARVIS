import type { ProgramSimulationEvidence, ProgramSimulationRequest } from "@finnor/program-search";
import {
  createInMemoryWorldSnapshotSource,
  materializeWorldSnapshot,
  simulateOperationalProgram,
  type SimulationBounds,
  type SimulationResult,
  type SnapshotObservationInput,
} from "@finnor/speculative-runtime";
import type { OperationalQueryP3EpistemicShadowInput } from "./epistemic-runtime-shadow";
import { validateOperationalQueryP3AuthoritativeBoundary } from "./epistemic-runtime-shadow";

export const OPERATIONAL_QUERY_P5_BOUNDS: SimulationBounds = Object.freeze({
  maxBranches: 8,
  maxDepth: 16,
  maxEffects: 32,
  maxSimulationSteps: 128,
  maxSimulationMs: 250,
  maxMemory: 2 * 1024 * 1024,
});

/** Maps P5's rich branch result into the narrow evidence-only P4 seam. */
export function programSimulationEvidence(result: SimulationResult): ProgramSimulationEvidence {
  return {
    version: 1,
    source: "P5",
    status: result.status,
    tenantId: result.tenantId,
    programIrSemanticHash: result.programIrSemanticHash,
    p4CandidateHash: result.p4CandidateHash,
    snapshotId: result.snapshotId,
    replayIdentity: result.replayIdentity,
    traceId: result.traceId,
    requiredBranches: result.stats.requiredBranches,
    simulatedBranches: result.stats.simulatedBranches,
    budgetExhausted: result.stats.budgetExhausted,
    highRiskBranchesDiscarded: result.stats.highRiskBranchesDiscarded,
    realSideEffects: {
      dbMutations: result.sideEffects.realDbMutations,
      providerCalls: result.sideEffects.realProviderCalls,
      computerMutations: result.sideEffects.realComputerMutations,
      authorityDecisions: result.sideEffects.realAuthorityDecisions,
      approvalRequests: result.sideEffects.realApprovalRequests,
      workTransitions: result.sideEffects.realWorkTransitions,
      outboxWrites: result.sideEffects.realOutboxWrites,
      externalWebhooks: result.sideEffects.realExternalWebhooks,
      paymentMutations: result.sideEffects.realPaymentMutations,
    },
    ownership: { ...result.ownership },
    branches: result.branches.map((branch) => ({
      branchId: branch.branchId,
      outcome: branch.outcome?.outcome ?? "UNKNOWN",
      goalSatisfactionOrdinal: branch.outcome?.goalSatisfaction.ordinal ?? 250,
      hardConstraintStatus: branch.outcome?.hardConstraintStatus ?? "UNKNOWN",
      verificationStrength: branch.outcome?.verificationStrength ?? "UNKNOWN",
      recoveryBurden: branch.outcome?.recoveryBurden ?? "UNKNOWN",
      irreversibility: branch.outcome?.irreversibility ?? "UNKNOWN",
      humanInterruptionsUpperBound: branch.outcome?.humanInterruption.upperBound ?? 0,
      latencyMs: branch.outcome?.latencyEstimate.valueMs ?? null,
      financialCost: branch.outcome?.costEstimate.amount ?? null,
      financialCurrency: branch.outcome?.costEstimate.currency ?? null,
      failureModeCodes: branch.failureModes.map((failure) => failure.code).sort(),
      consequentialFailure: branch.failureModes.some((failure) => failure.consequential),
      uncertaintyRemaining: [...(branch.outcome?.uncertaintyRemaining ?? [])].sort(),
    })),
    issueCodes: result.issues.map((issue) => issue.code).sort(),
  };
}

/**
 * Creates a P5 callback over an already-completed canonical query. Only a bounded,
 * redacted observation is materialized; no DB, provider, computer, Authority,
 * approval, Work, outbox, webhook, or payment interface is reachable.
 */
export function createOperationalQueryP5Simulator(
  input: OperationalQueryP3EpistemicShadowInput,
  trustedTenantId: string,
  onResult?: (result: SimulationResult) => void,
): (request: ProgramSimulationRequest) => Promise<ProgramSimulationEvidence> {
  validateOperationalQueryP3AuthoritativeBoundary(input, trustedTenantId);
  return async (request) => {
    if (request.p2Status !== "ADMISSIBLE") throw new Error("P5_CANNOT_OVERRIDE_P2");
    if (request.fixedNow !== input.execution.metadata.completedAt) throw new Error("P5_SHADOW_CLOCK_MISMATCH");
    const queryRef = request.program.body.kind === "query" ? request.program.body.semanticId : "query.authoritative-request";
    const observation: SnapshotObservationInput = {
      id: queryRef,
      tenantId: trustedTenantId,
      subject: { kind: "query", ref: queryRef },
      state: input.execution.result.status === "ok" ? "OBSERVED" : "UNKNOWN",
      value: {
        status: input.execution.result.status,
        result: {
          available: input.execution.result.status === "ok",
          intent: input.readDecision.request.intent,
        },
      },
      observedAt: request.fixedNow,
      evidenceRefs: [input.execution.metadata.queryId],
      provenance: { owner: "existing-operational-query-plane", sourceRef: input.execution.metadata.queryId },
    };
    const source = createInMemoryWorldSnapshotSource({
      tenantId: trustedTenantId,
      canonicalState: [],
      workState: [],
      relevantObservations: [observation],
      epistemicInputs: [],
      sourceRefs: [input.execution.metadata.queryId],
      sourceId: "p5:shadow:existing-operational-query",
    });
    const snapshot = await materializeWorldSnapshot({
      tenantId: trustedTenantId,
      asOf: request.fixedNow,
      program: request.program,
      source,
      epistemicState: request.epistemicState,
    });
    const result = await simulateOperationalProgram({
      snapshot,
      program: request.program,
      worldVariables: [],
      bounds: OPERATIONAL_QUERY_P5_BOUNDS,
      gates: {
        p2Status: "ADMISSIBLE",
        p3Status: "RESOLVED",
        p4CandidateHash: request.programHash,
        p4SelectionAuthority: "P4",
      },
    });
    onResult?.(result);
    return programSimulationEvidence(result);
  };
}
