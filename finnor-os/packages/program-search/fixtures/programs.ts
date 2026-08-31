import { createEpistemicState, type DecisionRequirement, type EpistemicState } from "@finnor/epistemic-runtime";
import {
  IR_SCHEMA_VERSION,
  checkOperationalProgramAdmissibility,
  sealOperationalProgram,
  type OperationalProgram,
  type StaticResolutionContext,
} from "@finnor/operational-ir";
import type { OperationalQueryRequest } from "@finnor/shared-types";
import {
  PROGRAM_SEARCH_COST_MODEL_VERSION,
  PROGRAM_SEARCH_CP_SAT_SOLVER_VERSION,
  PROGRAM_SEARCH_REWRITE_SET_VERSION,
  PROGRAM_SEARCH_SMT_SOLVER_VERSION,
  type NumericEstimate,
  type SearchCapability,
  type SearchProblem,
} from "../src/index";

export const P4_FIXED_NOW = "2026-08-31T00:00:00.000Z";
export const P4_FIXED_SEED = 4_004_004;

export function queryProgram(
  intent: OperationalQueryRequest["intent"] = "money_summary",
  options: { variant?: string; hardConstraint?: "SATISFIED" | "UNKNOWN" | "VIOLATED" } = {},
): OperationalProgram {
  const variant = options.variant ?? intent;
  const queryRef = `query.${variant}`;
  const goalPredicate = {
    kind: "assertion" as const,
    subject: { kind: "query" as const, ref: queryRef },
    path: ["result"],
    operator: "exists" as const,
  };
  return sealOperationalProgram({
    kind: "operational_program",
    semanticId: `program.${variant}`,
    irSchemaVersion: IR_SCHEMA_VERSION,
    compilerVersion: "p4-locked-fixture-v1",
    provenance: {
      representation: "deterministic_fixture",
      sourceRefs: [{ kind: "fixture", id: `p4:${variant}` }],
      compiledAt: P4_FIXED_NOW,
    },
    executionModel: "QUERY",
    goal: {
      kind: "goal",
      semanticId: "goal.requested-information",
      statement: "The requested bounded business information is available.",
      predicate: {
        kind: "assertion",
        subject: { kind: "program" },
        path: ["informationAvailable"],
        operator: "eq",
        expected: true,
      },
      subjectRefs: [],
    },
    constraints: [{
      kind: "constraint",
      semanticId: `constraint.${variant}`,
      severity: "HARD",
      category: "completion_requirement",
      description: "The bounded canonical query must complete.",
      predicate: goalPredicate,
      evaluation: options.hardConstraint ?? "SATISFIED",
      entityRefs: [],
    }],
    entities: [],
    scope: {
      kind: "scope",
      semanticId: "scope.bounded-query",
      includeEntityRefs: [],
      excludeEntityRefs: [],
      bounded: true,
    },
    body: {
      kind: "query",
      semanticId: queryRef,
      request: { intent } as OperationalQueryRequest,
      purpose: "Read bounded canonical business information.",
      entityRefs: [],
      dependsOn: [],
    },
    observations: [{
      kind: "observation",
      semanticId: `observation.${variant}`,
      subject: { kind: "goal", ref: "goal.requested-information" },
      description: "Canonical query result exists.",
      strength: "REQUIRED",
      verificationFloor: "EXISTING_OR_STRONGER",
      evidence: { kind: "canonical_query", queryRef, assertion: goalPredicate },
    }],
    successCondition: {
      kind: "success_condition",
      semanticId: "success.requested-information",
      statement: "The requested bounded business information is available.",
      mode: "ALL",
      criteria: [{ kind: "observation", observationRef: `observation.${variant}` }],
    },
    budget: { kind: "budget", semanticId: "budget.query", maxSteps: 1, maxEffects: 0, maxQueries: 1, maxWaits: 0 },
  });
}

export function estimate(value: number | null, unit: string, fallback = 100): NumericEstimate {
  return {
    value,
    unit,
    source: value === null ? "locked fixture explicit unknown" : "locked fixture configured estimate",
    version: PROGRAM_SEARCH_COST_MODEL_VERSION,
    quality: value === null ? "UNKNOWN" : "CONFIGURED",
    confidence: value === null ? "UNKNOWN" : "HIGH",
    fallbackAssumption: { value: value ?? fallback, rationale: "Locked conservative fallback; unknown is never scored as zero." },
  };
}

export function capability(intent: OperationalQueryRequest["intent"], options: {
  available?: boolean | "UNKNOWN";
  latency?: number | null;
  financial?: number | null;
  interruptions?: number | null;
  success?: number | null;
} = {}): SearchCapability {
  const latency = options.latency === undefined ? 10 : options.latency;
  const financial = options.financial === undefined ? 0 : options.financial;
  const interruptions = options.interruptions === undefined ? 0 : options.interruptions;
  return {
    capability: `query:${intent}`,
    available: options.available ?? true,
    version: "locked-query-capability-v1",
    cost: {
      modelCalls: estimate(0, "calls", 1),
      tokens: estimate(0, "tokens", 2_000),
      providerCalls: estimate(0, "calls", 1),
      financialSpend: estimate(financial, "currency_units", 100),
      expectedLatencyMs: estimate(latency, "ms", 30_000),
      humanInterruptions: estimate(interruptions, "interruptions", 1),
      computerUseMs: estimate(0, "ms", 60_000),
      failureRecoveryBurden: estimate(1, "ordinal_units", 10),
    },
    success: {
      ordinal: options.success === undefined ? 800 : options.success,
      source: options.success === null ? "locked explicit unknown success" : "locked conservative success heuristic",
      version: "p4-success-heuristic-v1",
      quality: options.success === null ? "UNKNOWN" : "CONSERVATIVE_HEURISTIC",
      confidence: "LOW",
      calibratedProbability: false,
      fallbackAssumption: { ordinal: 300, rationale: "Ordinal only; never a calibrated probability." },
    },
  };
}

export function emptyEpistemicState(propositionIds: string[] = []): EpistemicState {
  return createEpistemicState({
    scope: { tenantId: "tenant-p4", principalId: "principal-p4", decisionId: "decision-p4" },
    asOf: P4_FIXED_NOW,
    propositions: propositionIds.map((id) => ({
      id,
      subject: { kind: "system", type: "locked_fixture" },
      predicate: { name: "known", operator: "available" },
    })),
  });
}

export function unresolvedRequirement(propositionId: string): DecisionRequirement {
  return {
    propositionId,
    decisionId: "decision-p4",
    description: "Locked mandatory proposition.",
    criticality: "SAFETY_LEGAL",
    mandatory: true,
    acceptableStatuses: ["KNOWN"],
    consequenceIfUnresolved: "P4 selection must stop.",
    acquisitionOptions: [],
  };
}

export const RESOLVED_STATIC_CONTEXT: StaticResolutionContext = {
  tenantId: "tenant-p4",
  provider: {
    async resolveEntity(request) { return { status: "EXISTS", tenantId: request.trustedTenantId, type: request.type }; },
    async resolveCapability(request) { return { status: "EXISTS", supportedDimensions: request.requiredDimensions, configured: request.requiresConfiguredBinding ? true : "NOT_REQUIRED" }; },
  },
};

export async function checkP2Resolved(program: OperationalProgram) {
  return checkOperationalProgramAdmissibility(program, { resolution: RESOLVED_STATIC_CONTEXT });
}

export function searchProblem(input: Partial<SearchProblem> & {
  programs?: SearchProblem["initialPrograms"];
} = {}): SearchProblem {
  const { programs, ...overrides } = input;
  const initialPrograms = programs ?? input.initialPrograms ?? [{ candidateId: "candidate-1", origin: "PROCEDURE_TEMPLATE" as const, originRef: "locked", program: queryProgram() }];
  const program = initialPrograms[0]?.program ?? queryProgram();
  const capabilities = input.capabilities ?? [capability((program.body.kind === "query" ? program.body.request.intent : "money_summary"))];
  const defaults: SearchProblem = {
    version: 1,
    goal: program.goal,
    epistemicState: emptyEpistemicState(),
    epistemicRequirements: [],
    initialPrograms,
    hardConstraints: [],
    softObjectives: [],
    capabilities,
    budgets: {},
    searchBounds: {
      maxInitialCandidates: 8,
      maxRewriteIterations: 2,
      maxSearchNodes: 32,
      maxSolverTimeMs: 1_000,
      maxTotalSearchMs: 10_000,
      maxMemoryBytes: 8_000_000,
    },
    fixedNow: P4_FIXED_NOW,
    seed: P4_FIXED_SEED,
    solverVersions: { smt: PROGRAM_SEARCH_SMT_SOLVER_VERSION, cpSat: PROGRAM_SEARCH_CP_SAT_SOLVER_VERSION },
    costModelVersion: PROGRAM_SEARCH_COST_MODEL_VERSION,
    rewriteSetVersion: PROGRAM_SEARCH_REWRITE_SET_VERSION,
  };
  return { ...defaults, ...overrides, initialPrograms, capabilities };
}
