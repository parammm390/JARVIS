import {
  appendEvidenceAndRecompute,
  canonicalOperationalQueryEvidence,
  createEpistemicState,
  decisionContextEpistemicSummary,
  epistemicTraceToCausalReplayNodes,
  EXISTING_TRUTH_PRECEDENCE,
  propositionById,
  runEpistemicShadow,
  type DecisionRequirement,
  type EpistemicBehaviorSummary,
  type RedactedEpistemicTrace,
} from "@finnor/epistemic-runtime";
import {
  P2_ZERO_SHADOW_MUTATIONS,
  canonicalizeIrFragment,
  canonicalSerialize,
  runP2EffectShadow,
  type StaticResolutionProvider,
} from "@finnor/operational-ir";
import type { CausalReplayNode, OperatingContext } from "@finnor/shared-types";
import { logWithTrace } from "@finnor/tools";
import type { OperationalQueryExecution } from "./fast-read-lane";
import { finnorStaticResolutionProvider } from "./operational-ir-effect-resolution";
import {
  operationalQueryShadowProgram,
  type OperationalQueryShadowInput,
} from "./operational-ir-shadow";

const RESULT_PROPOSITION = "operational_query.result_sufficient";
export const OPERATIONAL_QUERY_RESULT_PROPOSITION = RESULT_PROPOSITION;

export interface OperationalQueryP3EpistemicShadowInput extends OperationalQueryShadowInput {
  /** The result already produced by the authoritative Operational Query Plane. */
  execution: OperationalQueryExecution;
  /** Existing assembled context is observed but never modified or reloaded. */
  context: Pick<OperatingContext, "tenant" | "employee">;
}

export interface OperationalQueryP3EpistemicShadowSummary {
  event: "epistemic_runtime_p3_shadow";
  version: 1;
  mode: "PURE_SHADOW";
  status: "OBSERVED" | "FAILED";
  authoritativePath: "EXISTING";
  authoritativeBehaviorChanged: false;
  executionModel: "QUERY";
  queryIntent: string;
  queryResultStatus: string;
  p2Admissibility: "ADMISSIBLE" | "REJECTED" | "UNRESOLVED" | "NOT_EVALUATED";
  p2ReasonCodes: string[];
  consequentialDecisionAllowed: boolean;
  semanticDiff: "EQUIVALENT" | "STRICTER_SAFE" | "BETTER_INFORMATION" | "REGRESSION" | "UNSUPPORTED" | "FIXTURE_INVALID";
  semanticDiffReasonCodes: string[];
  epistemicTrace: RedactedEpistemicTrace | null;
  decisionContext: Record<string, unknown> | null;
  causalReplay: Array<{ id: string; stage: CausalReplayNode["stage"]; status: string }>;
  failureReasonCodes: string[];
  plannerCallsAdded: 0;
  consequentialMutations: 0;
  persistenceWrites: 0;
  authorityDecisions: 0;
  approvalRequests: 0;
  providerCalls: 0;
  computerRuns: 0;
  workTransitions: 0;
}

export type OperationalQueryP3EpistemicShadowRecorder = (summary: OperationalQueryP3EpistemicShadowSummary) => void;

export interface OperationalQueryP3EpistemicShadowResult {
  /** Exact identity pass-through proving the authoritative result was untouched. */
  authoritativeExecution: OperationalQueryExecution;
  summary: OperationalQueryP3EpistemicShadowSummary;
  trace: RedactedEpistemicTrace | null;
  causalReplayNodes: CausalReplayNode[];
  recording: "RECORDED" | "RECORDER_FAILED";
}

function validateAuthoritativeBoundary(input: OperationalQueryP3EpistemicShadowInput, trustedTenantId: string): void {
  if (input.context.tenant.id !== trustedTenantId) throw new Error("TRUSTED_TENANT_CONTEXT_MISMATCH");
  if (!input.context.employee.userId) throw new Error("MISSING_TRUSTED_PRINCIPAL");
  const requested = canonicalSerialize(canonicalizeIrFragment(input.readDecision.request));
  const executed = canonicalSerialize(canonicalizeIrFragment(input.execution.request));
  if (requested !== executed) throw new Error("AUTHORITATIVE_QUERY_REQUEST_MISMATCH");
  if (input.execution.result.intent !== input.readDecision.request.intent) throw new Error("AUTHORITATIVE_QUERY_INTENT_MISMATCH");
  if (input.execution.result.source.kind !== "canonical_postgres") throw new Error("NON_CANONICAL_QUERY_SOURCE");
  if (!Number.isFinite(Date.parse(input.execution.metadata.completedAt))) throw new Error("INVALID_QUERY_COMPLETION_TIME");
}

function buildState(input: OperationalQueryP3EpistemicShadowInput, trustedTenantId: string) {
  const completedAt = input.execution.metadata.completedAt;
  const state = createEpistemicState({
    scope: {
      tenantId: trustedTenantId,
      principalId: input.context.employee.userId,
      workId: input.workId,
      decisionId: `p3-shadow:${input.instructionId}`,
    },
    asOf: completedAt,
    propositions: [{
      id: RESULT_PROPOSITION,
      subject: { kind: "system", type: "operational_query", id: input.execution.result.intent },
      predicate: { name: "result_sufficient", operator: "available" },
    }],
  });
  if (input.execution.result.status !== "ok") return state;
  const evidence = canonicalOperationalQueryEvidence({
    state,
    propositionId: RESULT_PROPOSITION,
    value: true,
    intent: input.execution.result.intent,
    tables: input.execution.result.source.tables,
    executionRef: input.execution.metadata.queryId,
    observedAt: input.execution.result.asOf,
    validAt: input.execution.result.asOf,
    ingestedAt: completedAt,
    sensitivity: "TENANT_INTERNAL",
  });
  return appendEvidenceAndRecompute(state, [evidence], completedAt);
}

function requirement(decisionId: string): DecisionRequirement {
  return {
    propositionId: RESULT_PROPOSITION,
    decisionId,
    description: "The authoritative canonical query produced a sufficient result.",
    criticality: "INFORMATIONAL",
    mandatory: true,
    acceptableStatuses: ["KNOWN"],
    minimumAuthority: ["CANONICAL_OWNER"],
    minimumConfidence: "VERIFIED",
    consequenceIfUnresolved: "The shadow records uncertainty and cannot authorize consequential use.",
    // The canonical query has already run. Re-reading it in this observation
    // would be redundant and asking the user is outside this shadow seam.
    acquisitionOptions: [],
  };
}

/** Read-only P4 reuse seam: exposes the exact already-certified P3 projection
 * without introducing a second epistemic-state builder. */
export function validateOperationalQueryP3AuthoritativeBoundary(
  input: OperationalQueryP3EpistemicShadowInput,
  trustedTenantId: string,
): void {
  validateAuthoritativeBoundary(input, trustedTenantId);
}

export function buildOperationalQueryP3DecisionState(
  input: OperationalQueryP3EpistemicShadowInput,
  trustedTenantId: string,
) {
  return buildState(input, trustedTenantId);
}

export function operationalQueryP3DecisionRequirement(decisionId: string): DecisionRequirement {
  return requirement(decisionId);
}

function existingBehavior(
  state: ReturnType<typeof buildState>,
  decisionRequirement: DecisionRequirement,
  p2Status: "ADMISSIBLE" | "REJECTED" | "UNRESOLVED",
): EpistemicBehaviorSummary {
  const proposition = propositionById(state, RESULT_PROPOSITION);
  const resolved = proposition?.status === "KNOWN";
  return {
    requiredFacts: [RESULT_PROPOSITION],
    factsAvailable: resolved ? [RESULT_PROPOSITION] : [],
    canonicalFactsAvailable: resolved ? [RESULT_PROPOSITION] : [],
    missingFacts: resolved ? [] : [RESULT_PROPOSITION],
    sourcePrecedence: [...EXISTING_TRUTH_PRECEDENCE],
    clarificationNecessary: false,
    selectedSource: resolved ? proposition?.source ?? null : null,
    freshness: resolved ? proposition?.freshness.status ?? "UNKNOWN" : "UNKNOWN",
    conflicts: [],
    decisionCriticalUncertainty: resolved ? [] : [decisionRequirement.propositionId],
    stopCondition: resolved ? "DECISION_CRITICAL_RESOLVED" : "NO_LEGAL_ACTION",
    consequentialDecisionAllowed: resolved && p2Status === "ADMISSIBLE",
    p2Status,
  };
}

function failureSummary(input: OperationalQueryP3EpistemicShadowInput, reasonCode: string): OperationalQueryP3EpistemicShadowSummary {
  return {
    event: "epistemic_runtime_p3_shadow",
    version: 1,
    mode: "PURE_SHADOW",
    status: "FAILED",
    authoritativePath: "EXISTING",
    authoritativeBehaviorChanged: false,
    executionModel: "QUERY",
    queryIntent: input.readDecision.request.intent,
    queryResultStatus: typeof input.execution.result.status === "string" ? input.execution.result.status : "unknown",
    p2Admissibility: "NOT_EVALUATED",
    p2ReasonCodes: [],
    consequentialDecisionAllowed: false,
    semanticDiff: "FIXTURE_INVALID",
    semanticDiffReasonCodes: ["P3_SHADOW_NOT_EVALUATED"],
    epistemicTrace: null,
    decisionContext: null,
    causalReplay: [],
    failureReasonCodes: [reasonCode],
    plannerCallsAdded: 0,
    ...P2_ZERO_SHADOW_MUTATIONS,
  };
}

/**
 * Best-effort production P3 observation over the already assembled context and
 * already completed deterministic query. It has no planner, execution, write,
 * authority, approval, provider-operation, computer, or Work mutation callback.
 */
export async function observeOperationalQueryP3EpistemicShadow(
  input: OperationalQueryP3EpistemicShadowInput,
  trustedTenantId: string,
  provider: StaticResolutionProvider = finnorStaticResolutionProvider,
  recorder?: OperationalQueryP3EpistemicShadowRecorder,
): Promise<OperationalQueryP3EpistemicShadowResult> {
  let summary: OperationalQueryP3EpistemicShadowSummary;
  let trace: RedactedEpistemicTrace | null = null;
  let causalReplayNodes: CausalReplayNode[] = [];
  try {
    validateAuthoritativeBoundary(input, trustedTenantId);
    const p2Record = await runP2EffectShadow({
      program: operationalQueryShadowProgram(input),
      options: { resolution: { tenantId: trustedTenantId, provider } },
    });
    const state = buildState(input, trustedTenantId);
    const decisionRequirement = requirement(state.scope.decisionId);
    const fixedNow = input.execution.metadata.completedAt;
    const shadow = await runEpistemicShadow({
      authoritativePlannerResult: input.execution,
      state,
      requirements: [decisionRequirement],
      budget: {
        maxActions: 1,
        maxUserInterruptions: 0,
        maxLatencyMs: 0,
        maxCostUnits: 0,
        deadline: new Date(Date.parse(fixedNow) + 1).toISOString(),
      },
      existingBehavior: existingBehavior(state, decisionRequirement, p2Record.admissibility.status),
      allowedAdapters: [],
      clock: { now: () => fixedNow },
      p2: p2Record.admissibility,
    });
    if (shadow.authoritativePlannerResult !== input.execution) throw new Error("AUTHORITATIVE_RESULT_IDENTITY_CHANGED");
    trace = shadow.trace;
    causalReplayNodes = epistemicTraceToCausalReplayNodes(trace, {
      source: "operational_query_p3_shadow",
      ref: input.execution.metadata.queryId,
      recordedAt: fixedNow,
    });
    summary = {
      event: "epistemic_runtime_p3_shadow",
      version: 1,
      mode: "PURE_SHADOW",
      status: "OBSERVED",
      authoritativePath: "EXISTING",
      authoritativeBehaviorChanged: false,
      executionModel: "QUERY",
      queryIntent: input.readDecision.request.intent,
      queryResultStatus: input.execution.result.status,
      p2Admissibility: p2Record.admissibility.status,
      p2ReasonCodes: [...p2Record.admissibility.reasonCodes],
      consequentialDecisionAllowed: shadow.proposedBehavior.consequentialDecisionAllowed,
      semanticDiff: shadow.semanticDiff.classification,
      semanticDiffReasonCodes: [...shadow.semanticDiff.reasonCodes],
      epistemicTrace: trace,
      decisionContext: decisionContextEpistemicSummary(trace),
      causalReplay: causalReplayNodes.map((node) => ({ id: node.id, stage: node.stage, status: node.status })),
      failureReasonCodes: [],
      plannerCallsAdded: shadow.plannerCallsAdded,
      ...P2_ZERO_SHADOW_MUTATIONS,
    };
  } catch {
    summary = failureSummary(input, "P3_SHADOW_INTERNAL_FAILURE");
  }

  const effectiveRecorder = recorder ?? ((record: OperationalQueryP3EpistemicShadowSummary) => {
    logWithTrace({ workId: input.workId, instructionId: input.instructionId }).info(
      record,
      "P3 epistemic runtime shadow",
    );
  });
  try {
    effectiveRecorder(summary);
    return { authoritativeExecution: input.execution, summary, trace, causalReplayNodes, recording: "RECORDED" };
  } catch {
    return { authoritativeExecution: input.execution, summary, trace, causalReplayNodes, recording: "RECORDER_FAILED" };
  }
}
