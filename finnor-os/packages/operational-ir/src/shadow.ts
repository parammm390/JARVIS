import type { OperationalProgram } from "./contracts";
import {
  adaptExistingPlanningCandidateToProgram,
  type ExistingPlanningCandidate,
  type OperationalProgramSemanticEnvelope,
} from "./adapters";
import { lowerOperationalProgram, type CompatibilityLoweringResult, type TrustedLoweringContext } from "./lowerer";
import {
  compareSemanticSnapshots,
  semanticSnapshotFromOperationalProgram,
  type SemanticDiffResult,
  type SemanticSnapshot,
} from "./semantic-diff";
import { validateOperationalProgram, type IrValidationResult } from "./validation";

export interface ShadowMutationCounters {
  consequentialMutations: 0;
  persistenceWrites: 0;
  authorityDecisions: 0;
  approvalRequests: 0;
  providerCalls: 0;
  computerRuns: 0;
  workTransitions: 0;
}

export const ZERO_SHADOW_MUTATIONS: ShadowMutationCounters = Object.freeze({
  consequentialMutations: 0,
  persistenceWrites: 0,
  authorityDecisions: 0,
  approvalRequests: 0,
  providerCalls: 0,
  computerRuns: 0,
  workTransitions: 0,
});

export interface PureShadowCompilationInput {
  /** Fingerprint of the already parsed/planned candidate. No callable/model seam is
   * accepted, which makes a second stochastic LLM call structurally impossible. */
  sourceCandidateFingerprint: string;
  sameCandidateUsed: true;
  program: unknown;
  legacySnapshot?: SemanticSnapshot;
  legacyStatus?: "SUPPORTED" | "UNSUPPORTED";
  loweringContext?: TrustedLoweringContext;
}

export interface PureShadowCompilationRecord {
  mode: "PURE_SHADOW";
  authoritativePath: "EXISTING";
  sourceCandidateFingerprint: string;
  sameCandidateUsed: true;
  irSemanticHash: OperationalProgram["irSemanticHash"] | null;
  validation: IrValidationResult;
  lowering: CompatibilityLoweringResult;
  semanticDiff: SemanticDiffResult;
  mutations: ShadowMutationCounters;
}

/** In-memory comparison only. The function has no DB, authority, orchestration,
 * runtime, provider, computer, tool, API, or frontend dependency. */
export function runPureShadowCompilation(input: PureShadowCompilationInput): PureShadowCompilationRecord {
  const validation = validateOperationalProgram(input.program);
  const lowering = lowerOperationalProgram(input.program, input.loweringContext);
  const semanticDiff = !validation.valid || !validation.program
    ? compareSemanticSnapshots({ fixtureValid: false })
    : lowering.status !== "LOWERED"
      ? compareSemanticSnapshots({
          fixtureValid: true,
          legacyStatus: input.legacyStatus ?? (input.legacySnapshot ? "SUPPORTED" : "UNSUPPORTED"),
          irStatus: "UNSUPPORTED",
          legacy: input.legacySnapshot,
        })
      : compareSemanticSnapshots({
          fixtureValid: true,
          legacyStatus: input.legacyStatus ?? (input.legacySnapshot ? "SUPPORTED" : "UNSUPPORTED"),
          irStatus: "SUPPORTED",
          legacy: input.legacySnapshot,
          ir: semanticSnapshotFromOperationalProgram(validation.program),
        });
  return {
    mode: "PURE_SHADOW",
    authoritativePath: "EXISTING",
    sourceCandidateFingerprint: input.sourceCandidateFingerprint,
    sameCandidateUsed: true,
    irSemanticHash: validation.program?.irSemanticHash ?? null,
    validation,
    lowering,
    semanticDiff,
    mutations: ZERO_SHADOW_MUTATIONS,
  };
}

export interface PureShadowCandidateCompilationInput {
  /** Fingerprint of the exact route/planner/controller candidate already produced
   * by the existing path. */
  sourceCandidateFingerprint: string;
  sameCandidateUsed: true;
  candidate: ExistingPlanningCandidate;
  envelope: OperationalProgramSemanticEnvelope;
  legacySnapshot?: SemanticSnapshot;
  legacyStatus?: "SUPPORTED" | "UNSUPPORTED";
  loweringContext?: TrustedLoweringContext;
}

export type PureShadowCandidateCompilationRecord =
  | {
      status: "COMPILED";
      mode: "PURE_SHADOW";
      authoritativePath: "EXISTING";
      sameCandidateUsed: true;
      adaptation: ReturnType<typeof adaptExistingPlanningCandidateToProgram>;
      shadow: PureShadowCompilationRecord;
      mutations: ShadowMutationCounters;
    }
  | {
      status: "UNSUPPORTED" | "NOT_APPLICABLE";
      mode: "PURE_SHADOW";
      authoritativePath: "EXISTING";
      sameCandidateUsed: true;
      adaptation: ReturnType<typeof adaptExistingPlanningCandidateToProgram>;
      semanticDiff: SemanticDiffResult;
      mutations: ShadowMutationCounters;
    };

/** Candidate-level shadow entrypoint. It accepts the exact already-produced
 * representation plus explicit semantic envelope; there is no parser/model/tool
 * callback and no mutation interface. */
export function runPureShadowCandidateCompilation(input: PureShadowCandidateCompilationInput): PureShadowCandidateCompilationRecord {
  const adaptation = adaptExistingPlanningCandidateToProgram({ candidate: input.candidate, envelope: input.envelope });
  if (!adaptation.value) {
    return {
      status: adaptation.classification === "NOT_APPLICABLE" ? "NOT_APPLICABLE" : "UNSUPPORTED",
      mode: "PURE_SHADOW",
      authoritativePath: "EXISTING",
      sameCandidateUsed: true,
      adaptation,
      semanticDiff: compareSemanticSnapshots({
        fixtureValid: true,
        legacyStatus: input.legacyStatus ?? (input.legacySnapshot ? "SUPPORTED" : "UNSUPPORTED"),
        irStatus: "UNSUPPORTED",
        legacy: input.legacySnapshot,
      }),
      mutations: ZERO_SHADOW_MUTATIONS,
    };
  }
  const shadow = runPureShadowCompilation({
    sourceCandidateFingerprint: input.sourceCandidateFingerprint,
    sameCandidateUsed: true,
    program: adaptation.value,
    legacySnapshot: input.legacySnapshot,
    legacyStatus: input.legacyStatus,
    loweringContext: input.loweringContext,
  });
  return {
    status: "COMPILED",
    mode: "PURE_SHADOW",
    authoritativePath: "EXISTING",
    sameCandidateUsed: true,
    adaptation,
    shadow,
    mutations: ZERO_SHADOW_MUTATIONS,
  };
}
