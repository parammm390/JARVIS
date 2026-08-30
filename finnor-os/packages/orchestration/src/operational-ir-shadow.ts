import { createHash } from "node:crypto";
import type { OperationalQueryRequest } from "@finnor/shared-types";
import {
  IR_SCHEMA_VERSION,
  canonicalizeIrFragment,
  canonicalSerialize,
  runPureShadowCandidateCompilation,
  sealOperationalProgram,
  semanticSnapshotFromOperationalProgram,
  ZERO_SHADOW_MUTATIONS,
  type EntityRef,
  type OperationalProgram,
  type OperationalProgramSemanticEnvelope,
  type PureShadowCandidateCompilationRecord,
  type SemanticDiffClassification,
} from "@finnor/operational-ir";
import { logWithTrace } from "@finnor/tools";
import type { OperationalQueryInterpretation } from "./fast-read-lane";
import type { InstructionRouteDecision } from "./instruction-routing";

export const OPERATIONAL_IR_SHADOW_COMPILER_VERSION = "finnor-query-shadow/1.0.0" as const;

export interface OperationalQueryShadowInput {
  /** Exact deterministic decisions already produced by the authoritative path. */
  routeDecision: InstructionRouteDecision;
  readDecision: OperationalQueryInterpretation;
  instructionId: string;
  workId: string;
  workInputId: string;
  /** Supplied by orchestration and excluded from the semantic hash. */
  compiledAt: string;
}

export interface OperationalIrShadowSummary {
  event: "operational_ir_shadow_compilation";
  version: 1;
  mode: "PURE_SHADOW";
  authoritativePath: "EXISTING";
  executionModel: "QUERY";
  queryIntent: OperationalQueryRequest["intent"];
  candidateFingerprint: string;
  sameCandidateUsed: true;
  irSemanticHash: OperationalProgram["irSemanticHash"] | null;
  validationValid: boolean;
  validationErrorCodes: string[];
  validationWarningCodes: string[];
  loweringStatus: "LOWERED" | "INVALID" | "UNSUPPORTED";
  loweringTarget: "operational_query" | null;
  loweringClassification: "LOSSLESS" | "LOSSY" | "UNSUPPORTED" | "NOT_APPLICABLE";
  loweredRequestMatches: boolean;
  semanticDiff: SemanticDiffClassification;
  semanticDiffReasonCodes: string[];
  consequentialMutations: 0;
  persistenceWrites: 0;
  authorityDecisions: 0;
  approvalRequests: 0;
  providerCalls: 0;
  computerRuns: 0;
  workTransitions: 0;
}

export type OperationalIrShadowRecorder = (summary: OperationalIrShadowSummary) => void;

export interface OperationalQueryShadowResult {
  summary: OperationalIrShadowSummary;
  recording: "RECORDED" | "RECORDER_FAILED";
  /** Available to deterministic tests and diagnostics; never written to logs. */
  record: PureShadowCandidateCompilationRecord | null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function resolvedEntity(
  semanticId: string,
  kind: "entity" | "party",
  type: string,
  id: string,
): EntityRef {
  return {
    kind: "entity_ref",
    semanticId,
    entityType: type,
    resolution: { status: "resolved", canonical: { kind, type, id }, source: "canonical" },
  };
}

/** Projects only explicit identifiers already accepted by the Operational Query
 * request. Text selectors remain unresolved; tenant ownership is never copied. */
export function queryEntityRefs(request: OperationalQueryRequest): EntityRef[] {
  const row = request as unknown as Record<string, unknown>;
  const entities: EntityRef[] = [];
  const addResolved = (semanticId: string, kind: "entity" | "party", type: string, id: unknown) => {
    if (typeof id === "string" && id.trim()) entities.push(resolvedEntity(semanticId, kind, type, id));
  };
  addResolved("entity.query-household", "entity", "household", row.householdId);
  if (isRecord(row.params)) addResolved("entity.query-household", "entity", "household", row.params.householdId);

  const addStructuredRef = (semanticId: string, value: unknown) => {
    if (!isRecord(value)) return;
    if (typeof value.partyType === "string" && typeof value.partyId === "string") {
      addResolved(semanticId, "party", value.partyType, value.partyId);
    } else if (typeof value.entityType === "string" && typeof value.entityId === "string") {
      addResolved(semanticId, "entity", value.entityType, value.entityId);
    }
  };
  addStructuredRef("entity.query-party", row.ref);
  addStructuredRef("entity.query-team", row.teamRef);
  addStructuredRef("entity.query-anchor", row.anchor);

  const unique = new Map<string, EntityRef>();
  for (const entity of entities) unique.set(entity.semanticId, entity);
  const entitySeekingIntent = new Set([
    "customer_lookup",
    "company_context",
    "party_lookup",
    "party_context",
    "team_roster",
    "party_availability",
  ]).has(request.intent);
  if (unique.size === 0 && entitySeekingIntent && typeof row.query === "string" && row.query.trim()) {
    unique.set("entity.query-expression", {
      kind: "entity_ref",
      semanticId: "entity.query-expression",
      entityType: "unknown",
      resolution: {
        status: "unresolved",
        expression: row.query,
        reason: "The existing Operational Query Plane must resolve this expression inside trusted runtime context.",
      },
    });
  }
  return [...unique.values()].sort((left, right) => left.semanticId.localeCompare(right.semanticId));
}

/** Same-candidate query IR used by both the certified P1 semantic shadow and the
 * additive P2 effect shadow. It contains no trusted tenant identity. */
export function operationalQueryShadowProgram(input: OperationalQueryShadowInput): OperationalProgram {
  const request = input.readDecision.request;
  const entities = queryEntityRefs(request);
  const queryRef = "query.authoritative-request";
  const goalRef = "goal.requested-information-acquired";
  const observationRef = "observation.authoritative-query-result";
  const goalPredicate = {
    kind: "assertion" as const,
    subject: { kind: "query" as const, ref: queryRef },
    path: ["result"],
    operator: "exists" as const,
  };
  const statement = `The existing Operational Query Plane has acquired the requested ${request.intent} business information.`;
  const sourceRefs = [
    { kind: "instruction" as const, id: input.instructionId },
    { kind: "work" as const, id: input.workId },
    { kind: "work_input" as const, id: input.workInputId },
    { kind: "query" as const, id: `${input.instructionId}:authoritative-query` },
  ];
  return sealOperationalProgram({
    kind: "operational_program",
    semanticId: "program.routed-operational-query",
    irSchemaVersion: IR_SCHEMA_VERSION,
    compilerVersion: OPERATIONAL_IR_SHADOW_COMPILER_VERSION,
    provenance: {
      representation: "instruction_route_decision",
      sourceRefs,
      compiledAt: input.compiledAt,
      notes: input.routeDecision.reasonCodes,
    },
    nonSemantic: {
      artifactId: `shadow-ir:${input.instructionId}`,
      runtimeTimestamp: input.compiledAt,
      traceIds: [input.workId, input.workInputId],
    },
    executionModel: "QUERY",
    goal: {
      kind: "goal",
      semanticId: goalRef,
      statement,
      predicate: goalPredicate,
      subjectRefs: entities.map((entity) => entity.semanticId),
    },
    constraints: [{
      kind: "constraint",
      semanticId: "constraint.query-completion",
      severity: "HARD",
      category: "completion_requirement",
      description: "The existing Operational Query Plane must return the requested bounded result.",
      predicate: goalPredicate,
      evaluation: "UNKNOWN",
      entityRefs: entities.map((entity) => entity.semanticId),
    }],
    entities,
    scope: {
      kind: "scope",
      semanticId: "scope.authoritative-query",
      includeEntityRefs: entities.map((entity) => entity.semanticId),
      excludeEntityRefs: [],
      bounded: true,
      ...(["customer_cohort", "inactivity_cohort"].includes(request.intent) ? { cohortQueryRef: queryRef } : {}),
    },
    body: {
      kind: "query",
      semanticId: queryRef,
      request,
      purpose: statement,
      entityRefs: entities.map((entity) => entity.semanticId),
      dependsOn: [],
    },
    observations: [{
      kind: "observation",
      semanticId: observationRef,
      subject: { kind: "goal", ref: goalRef },
      description: "The canonical read substrate returned evidence for the requested information.",
      strength: "REQUIRED",
      verificationFloor: "EXISTING_OR_STRONGER",
      evidence: { kind: "canonical_query", queryRef, assertion: goalPredicate },
    }],
    successCondition: {
      kind: "success_condition",
      semanticId: "success.authoritative-query",
      statement,
      mode: "ALL",
      criteria: [{ kind: "observation", observationRef }],
    },
    budget: {
      kind: "budget",
      semanticId: "budget.authoritative-query",
      maxSteps: 1,
      maxEffects: 0,
      maxQueries: 1,
      maxWaits: 0,
    },
  });
}

function envelopeOf(program: OperationalProgram): OperationalProgramSemanticEnvelope {
  const { irSemanticHash: _hash, executionModel: _executionModel, body: _body, ...envelope } = program;
  return envelope;
}

function candidateFingerprint(input: OperationalQueryShadowInput): string {
  const normalizedCandidate = canonicalizeIrFragment({
    routeDecision: {
      version: input.routeDecision.version,
      route: input.routeDecision.route,
      reasonCodes: input.routeDecision.reasonCodes,
    },
    readDecision: input.readDecision,
  });
  const hash = createHash("sha256").update(canonicalSerialize(normalizedCandidate), "utf8").digest("hex");
  return `candidate:sha256:${hash}`;
}

function compile(input: OperationalQueryShadowInput): { summary: OperationalIrShadowSummary; record: PureShadowCandidateCompilationRecord } {
  const baselineProgram = operationalQueryShadowProgram(input);
  const fingerprint = candidateFingerprint(input);
  const record = runPureShadowCandidateCompilation({
    sourceCandidateFingerprint: fingerprint,
    sameCandidateUsed: true,
    candidate: {
      kind: "instruction_route",
      decision: {
        version: input.routeDecision.version,
        route: "QUERY",
        reasonCodes: [...input.routeDecision.reasonCodes],
        queryDecision: input.readDecision,
      },
      query: {
        request: input.readDecision.request,
        semanticId: "query.authoritative-request",
        purpose: baselineProgram.goal.statement,
        entityRefs: baselineProgram.entities.map((entity) => entity.semanticId),
        dependsOn: [],
      },
    },
    envelope: envelopeOf(baselineProgram),
    legacySnapshot: semanticSnapshotFromOperationalProgram(baselineProgram),
  });

  const shadow = record.status === "COMPILED" ? record.shadow : null;
  const lowering = shadow?.lowering;
  const loweredRequestMatches = lowering?.status === "LOWERED"
    && lowering.value.kind === "operational_query"
    && canonicalSerialize(canonicalizeIrFragment(lowering.value.request))
      === canonicalSerialize(canonicalizeIrFragment(input.readDecision.request));
  const baseDiff = record.status === "COMPILED" ? record.shadow.semanticDiff : record.semanticDiff;
  const loweredQueryMismatch = lowering?.status === "LOWERED"
    && lowering.value.kind === "operational_query"
    && !loweredRequestMatches;
  const semanticDiff = loweredQueryMismatch ? "REGRESSION" : baseDiff.classification;
  const semanticDiffReasonCodes = loweredQueryMismatch
    ? [...baseDiff.reasonCodes, "lowered_query_request_mismatch"]
    : baseDiff.reasonCodes;
  const validation = shadow?.validation;
  const loweringStatus = lowering?.status ?? "UNSUPPORTED";
  const loweringClassification = lowering?.classification ?? record.adaptation.classification;
  return {
    record,
    summary: {
      event: "operational_ir_shadow_compilation",
      version: 1,
      mode: "PURE_SHADOW",
      authoritativePath: "EXISTING",
      executionModel: "QUERY",
      queryIntent: input.readDecision.request.intent,
      candidateFingerprint: fingerprint,
      sameCandidateUsed: true,
      irSemanticHash: shadow?.irSemanticHash ?? null,
      validationValid: validation?.valid ?? false,
      validationErrorCodes: validation?.errors.map((issue) => issue.code) ?? [],
      validationWarningCodes: validation?.warnings.map((issue) => issue.code) ?? [],
      loweringStatus,
      loweringTarget: lowering?.status === "LOWERED" && lowering.target === "operational_query" ? "operational_query" : null,
      loweringClassification,
      loweredRequestMatches,
      semanticDiff,
      semanticDiffReasonCodes,
      ...ZERO_SHADOW_MUTATIONS,
    },
  };
}

function failureSummary(input: OperationalQueryShadowInput): OperationalIrShadowSummary {
  return {
    event: "operational_ir_shadow_compilation",
    version: 1,
    mode: "PURE_SHADOW",
    authoritativePath: "EXISTING",
    executionModel: "QUERY",
    queryIntent: input.readDecision.request.intent,
    candidateFingerprint: "candidate:sha256:unavailable",
    sameCandidateUsed: true,
    irSemanticHash: null,
    validationValid: false,
    validationErrorCodes: ["SHADOW_INTERNAL_FAILURE"],
    validationWarningCodes: [],
    loweringStatus: "INVALID",
    loweringTarget: null,
    loweringClassification: "UNSUPPORTED",
    loweredRequestMatches: false,
    semanticDiff: "FIXTURE_INVALID",
    semanticDiffReasonCodes: ["shadow_internal_failure"],
    ...ZERO_SHADOW_MUTATIONS,
  };
}

/** Best-effort observation only. Every construction, validation, lowering,
 * comparison, and recorder failure is contained so the existing query remains
 * authoritative and its control flow cannot be changed by shadow IR. */
export function observeOperationalQueryIrShadow(
  input: OperationalQueryShadowInput,
  recorder?: OperationalIrShadowRecorder,
): OperationalQueryShadowResult {
  let compiled: { summary: OperationalIrShadowSummary; record: PureShadowCandidateCompilationRecord | null };
  try {
    compiled = compile(input);
  } catch {
    compiled = { summary: failureSummary(input), record: null };
  }
  const effectiveRecorder = recorder ?? ((summary: OperationalIrShadowSummary) => {
    logWithTrace({ workId: input.workId, instructionId: input.instructionId }).info(
      summary,
      "Operational IR query shadow semantic diff",
    );
  });
  try {
    effectiveRecorder(compiled.summary);
    return { summary: compiled.summary, recording: "RECORDED", record: compiled.record };
  } catch {
    return { summary: compiled.summary, recording: "RECORDER_FAILED", record: compiled.record };
  }
}
