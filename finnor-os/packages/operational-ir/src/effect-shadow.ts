import type { BusinessEffectSet, ComputerAuthorizedEffect, DomainAction } from "@finnor/shared-types";
import {
  checkOperationalProgramAdmissibility,
  type StaticAdmissibilityOptions,
  type StaticAdmissibilityResult,
} from "./admissibility";
import type { OperationalProgram } from "./contracts";
import {
  compareP2EffectsToExistingRuntime,
  type P2SemanticDiffResult,
} from "./runtime-mapping";

export const P2_ZERO_SHADOW_MUTATIONS = Object.freeze({
  consequentialMutations: 0 as const,
  persistenceWrites: 0 as const,
  authorityDecisions: 0 as const,
  approvalRequests: 0 as const,
  providerCalls: 0 as const,
  computerRuns: 0 as const,
  workTransitions: 0 as const,
});

export interface P2EffectShadowRecord {
  version: 1;
  mode: "P2_EFFECT_SHADOW";
  authoritativePath: "EXISTING";
  behaviorChanged: false;
  programSemanticId: string;
  admissibility: StaticAdmissibilityResult;
  semanticDiff: P2SemanticDiffResult;
  disagreement: "NONE" | "P2_STRICTER" | "REGRESSION" | "RUNTIME_ONLY" | "IR_UNSUPPORTED" | "FIXTURE_INVALID";
  mutations: typeof P2_ZERO_SHADOW_MUTATIONS;
}

function disagreement(diff: P2SemanticDiffResult, result: StaticAdmissibilityResult): P2EffectShadowRecord["disagreement"] {
  if (diff.classification === "REGRESSION") return "REGRESSION";
  if (diff.classification === "STRICTER_SAFE" || result.status === "REJECTED") return "P2_STRICTER";
  if (diff.classification === "RUNTIME_ONLY") return "RUNTIME_ONLY";
  if (diff.classification === "IR_UNSUPPORTED") return "IR_UNSUPPORTED";
  if (diff.classification === "FIXTURE_INVALID") return "FIXTURE_INVALID";
  return "NONE";
}

/** Shadow-only comparison. It has no execution, persistence, approval, or authority seam. */
export async function runP2EffectShadow(input: {
  program: OperationalProgram;
  options?: StaticAdmissibilityOptions;
  nodeId?: string;
  domainAction?: DomainAction;
  businessEffect?: BusinessEffectSet;
  computerAuthorizedEffect?: ComputerAuthorizedEffect;
}): Promise<P2EffectShadowRecord> {
  const admissibility = await checkOperationalProgramAdmissibility(input.program, input.options);
  const nodeId = input.nodeId ?? admissibility.summary?.possible[0]?.effect.nodeId;
  const semanticDiff = compareP2EffectsToExistingRuntime({
    summary: admissibility.summary,
    nodeId,
    domainAction: input.domainAction,
    businessEffect: input.businessEffect,
    computerAuthorizedEffect: input.computerAuthorizedEffect,
    fixtureValid: true,
    irSupported: !admissibility.summary?.unsupportedNodeIds.length,
  });
  return {
    version: 1,
    mode: "P2_EFFECT_SHADOW",
    authoritativePath: "EXISTING",
    behaviorChanged: false,
    programSemanticId: input.program.semanticId,
    admissibility,
    semanticDiff,
    disagreement: disagreement(semanticDiff, admissibility),
    mutations: P2_ZERO_SHADOW_MUTATIONS,
  };
}

export type P2ProposalEnforcementDecision =
  | { decision: "SHADOW_ONLY"; reason: "OPERATION_OUTSIDE_ENFORCED_SCOPE" }
  | { decision: "REJECT_PROPOSAL"; reason: "PROVEN_STATICALLY_ILLEGAL" }
  | { decision: "DEFER_PROPOSAL"; reason: "STATIC_ADMISSIBILITY_UNRESOLVED" }
  | {
      decision: "CONTINUE_TO_EXISTING_RUNTIME";
      reason: "STATICALLY_ADMISSIBLE_NOT_AUTHORIZED";
      runtimeAuthorityReevaluationRequired: true;
      businessEffectCompilationRequired: true;
    };

/** Fail-closed only for the explicitly enabled representative operation set. */
export function decideP2ProposalEnforcement(input: {
  operation: string;
  enforcedOperations: readonly string[];
  admissibility: StaticAdmissibilityResult;
}): P2ProposalEnforcementDecision {
  if (!input.enforcedOperations.includes(input.operation)) {
    return { decision: "SHADOW_ONLY", reason: "OPERATION_OUTSIDE_ENFORCED_SCOPE" };
  }
  if (input.admissibility.status === "REJECTED") {
    return { decision: "REJECT_PROPOSAL", reason: "PROVEN_STATICALLY_ILLEGAL" };
  }
  if (input.admissibility.status === "UNRESOLVED") {
    return { decision: "DEFER_PROPOSAL", reason: "STATIC_ADMISSIBILITY_UNRESOLVED" };
  }
  return {
    decision: "CONTINUE_TO_EXISTING_RUNTIME",
    reason: "STATICALLY_ADMISSIBLE_NOT_AUTHORIZED",
    runtimeAuthorityReevaluationRequired: true,
    businessEffectCompilationRequired: true,
  };
}
