import type {
  BusinessEffectSet,
  DomainAction,
  ObjectiveCompletionEvidence,
  OperationalQueryRequest,
} from "@finnor/shared-types";
import type {
  AdapterClassification,
  AdapterResult,
  Effect,
  EffectTargetBinding,
  EntityRef,
  InstructionExecutionModel,
  JsonObject,
  Observation,
  OperationalProgram,
  OperationalProgramDraft,
  Predicate,
  ProgramNode,
  Query,
  WaitEventRef,
} from "./contracts";
import { sealOperationalProgram } from "./canonical";
import { JsonObjectSchema, OperationalQueryRequestSchema } from "./schema";

function result(
  classification: AdapterClassification,
  value: undefined,
  reasons: string[],
  preserved: string[],
  omitted: string[],
): AdapterResult<never>;
function result<T>(
  classification: AdapterClassification,
  value: T,
  reasons: string[],
  preserved: string[],
  omitted: string[],
): AdapterResult<T>;
function result<T>(
  classification: AdapterClassification,
  value: T | undefined,
  reasons: string[],
  preserved: string[],
  omitted: string[],
): AdapterResult<T> {
  return { classification, ...(value === undefined ? {} : { value }), reasons, preserved, omitted };
}

export interface InstructionRouteDecisionLike {
  version: 1;
  route: "QUERY" | "ATOMIC_ACTION" | "OBJECTIVE" | "CONVERSATION" | "CLARIFY";
  reasonCodes: string[];
  queryDecision?: unknown;
}

export interface InstructionRouteIrView {
  executionModel: InstructionExecutionModel;
  policyVersion: 1;
  reasonCodes: string[];
}

/** Route output contains classification, not desired-state semantics. This adapter
 * is lossless for the route artifact but deliberately does not fabricate a program. */
export function adaptInstructionRouteDecision(decision: InstructionRouteDecisionLike): AdapterResult<InstructionRouteIrView> {
  const omitsQueryDecision = decision.queryDecision !== undefined;
  return result(
    omitsQueryDecision ? "LOSSY" : "LOSSLESS",
    { executionModel: decision.route, policyVersion: decision.version, reasonCodes: [...decision.reasonCodes] },
    [omitsQueryDecision
      ? "The route classification is exact, but queryDecision must be adapted separately through the Operational Query adapter."
      : "The current route name/version/reasons are preserved exactly."],
    ["route", "policyVersion", "reasonCodes"],
    omitsQueryDecision ? ["queryDecision"] : [],
  );
}

/** Structural mirror of the current orchestration-owned CompiledHumanOperation.
 * The pure IR package cannot import orchestration, so the adapter depends only on
 * this exact data contract and is type-checked by orchestration integration tests. */
export interface CompiledHumanOperationLike {
  version: 1;
  route: InstructionExecutionModel;
  capability: string;
  target: { scope: "tenant" | "canonical" | "direct" | "ambiguous"; values: Record<string, unknown> };
  date: { scope: "current" | "explicit"; values: Record<string, unknown> };
  payload: Record<string, unknown>;
  reasonCodes: string[];
}

export interface CompiledHumanOperationIrView {
  executionModel: InstructionExecutionModel;
  capability: string;
  target: { scope: CompiledHumanOperationLike["target"]["scope"]; values: JsonObject };
  date: { scope: CompiledHumanOperationLike["date"]["scope"]; values: JsonObject };
  payload: JsonObject;
  reasonCodes: string[];
}

/** CompiledHumanOperation is now the canonical Human Operating Compiler result.
 * It preserves route/capability/target/date/payload, but cannot by itself create
 * an OperationalProgram because it has no desired-state predicate, observation,
 * success condition, or structural dependencies. */
export function adaptCompiledHumanOperation(operation: CompiledHumanOperationLike): AdapterResult<CompiledHumanOperationIrView> {
  const target = JsonObjectSchema.safeParse(operation.target.values);
  const date = JsonObjectSchema.safeParse(operation.date.values);
  const payload = JsonObjectSchema.safeParse(operation.payload);
  if (!target.success || !date.success || !payload.success) {
    return result(
      "UNSUPPORTED",
      undefined,
      ["CompiledHumanOperation contains values outside deterministic JSON."],
      ["route", "capability", "target/date scopes", "reasonCodes"],
      ["target/date/payload values"],
    );
  }
  return result(
    "LOSSY",
    {
      executionModel: operation.route,
      capability: operation.capability,
      target: { scope: operation.target.scope, values: target.data },
      date: { scope: operation.date.scope, values: date.data },
      payload: payload.data,
      reasonCodes: [...operation.reasonCodes],
    },
    ["The current compiler envelope is preserved, but missing desired-state and verification semantics are never fabricated."],
    ["route", "capability", "target", "date", "payload", "reasonCodes"],
    ["Goal", "dependencies", "observations", "success condition"],
  );
}

export interface DomainActionEffectContext {
  semanticId: string;
  targets: EffectTargetBinding[];
  intendedState: Predicate;
  requiredCapability: string;
  expectedObservationRefs: string[];
  /** Semantic dependency ids, not database action ids. */
  dependsOn: string[];
}

/** DomainAction does not contain a business goal or success predicate. Those values
 * are required from the same already-parsed candidate/context; omission is reported
 * as UNSUPPORTED instead of being inferred from actionType. */
export function adaptDomainActionToEffect(
  action: DomainAction,
  context?: DomainActionEffectContext,
): AdapterResult<Effect> {
  if (!context) {
    return result(
      "UNSUPPORTED",
      undefined,
      ["DomainAction alone has no desired business-state predicate, expected observation, or completion condition."],
      ["actionType", "payload"],
      ["goal", "intendedState", "expectedObservation", "successCondition"],
    );
  }
  const argumentsResult = JsonObjectSchema.safeParse(action.payload);
  if (!argumentsResult.success) {
    return result(
      "UNSUPPORTED",
      undefined,
      ["DomainAction payload is outside deterministic JSON and cannot enter Operational IR."],
      [],
      ["payload"],
    );
  }
  const compatibility = action.compiledGraph
    ? {
        compiledGraph: action.compiledGraph,
        groundedPayload: action.groundedPayload,
      }
    : undefined;
  return result(
    "LOSSY",
    {
      kind: "effect",
      semanticId: context.semanticId,
      operation: action.actionType,
      arguments: argumentsResult.data,
      targets: context.targets,
      intendedState: context.intendedState,
      requiredCapability: context.requiredCapability,
      consequential: true,
      expectedObservationRefs: context.expectedObservationRefs,
      dependsOn: context.dependsOn,
      ...(compatibility ? { domainActionCompatibility: compatibility } : {}),
    },
    ["DomainAction is an execution-shaped artifact; conversion intentionally drops identity/lifecycle/authority and requires explicit goal semantics."],
    ["actionType", "payload", "groundedPayload", "compiledGraph", "dependencies supplied by the audited plan", "explicit intended state"],
    ["DomainAction id", "tenantId", "status", "BusinessEffect id", "authority ids", "runtime timestamps"],
  );
}

export interface BusinessEffectSemanticView {
  operation: string;
  operationClass: BusinessEffectSet["operation"]["class"];
  consequential: true;
  canonicalTargets: Array<{ kind: string; type: string; id: string }>;
  intendedDelta: { operation: string; values: Record<string, unknown> };
  requiredCapability: string;
  expectedObservation: BusinessEffectSet["expected"];
  reversibility: BusinessEffectSet["reversibility"];
}

/** BusinessEffectSet is never converted back into an executable IR Effect. This
 * read-only view exists solely for normalized semantic comparison. */
export function adaptBusinessEffectSetForComparison(effect: BusinessEffectSet): AdapterResult<BusinessEffectSemanticView> {
  return result(
    "LOSSY",
    {
      operation: effect.operation.name,
      operationClass: effect.operation.class,
      consequential: true,
      canonicalTargets: effect.targets.map(({ kind, type, id }) => ({ kind, type, id })),
      intendedDelta: effect.delta,
      requiredCapability: effect.authority.capability,
      expectedObservation: effect.expected,
      reversibility: effect.reversibility,
    },
    ["BusinessEffect is downstream immutable execution truth; only its planning-comparable semantics are projected."],
    ["operation", "targets", "delta", "capability", "expected observation", "reversibility"],
    ["BusinessEffect id/hash/scopeHash", "authority decision", "approval", "before-state", "provider binding identity", "execution status"],
  );
}

export type ObjectiveDecisionLike =
  | { kind: "query"; request: Record<string, unknown>; reason: string; nextStep?: string; recoveryMode?: "retry" | "replan" | "recover" | "compensate" | "escalate" }
  | { kind: "action"; actionType: string; payload: Record<string, unknown>; reason: string; nextStep?: string; recoveryMode?: "retry" | "replan" | "recover" | "compensate" | "escalate" }
  | { kind: "wait"; waitFor?: Record<string, unknown>; deadlineAt?: string; resumeAt?: string; condition?: string; reason: string; recoveryMode?: "retry" | "replan" | "recover" | "compensate" | "escalate" }
  | { kind: "complete"; outcome: Record<string, unknown>; evidence?: ObjectiveCompletionEvidence[]; reason: string }
  | { kind: "block"; reason: string; recovery?: string }
  | { kind: "fail"; reason: string; failure?: Record<string, unknown> };

export interface ObjectiveDecisionAdapterContext {
  semanticId: string;
  entityRefs?: string[];
  dependsOn?: string[];
  action?: Omit<DomainActionEffectContext, "semanticId" | "dependsOn">;
  waitCondition?: Predicate;
}

function waitRefs(waitFor: Record<string, unknown> | undefined): WaitEventRef[] {
  if (!waitFor) return [];
  const refs: WaitEventRef[] = [];
  for (const [key, value] of Object.entries(waitFor).sort(([left], [right]) => left.localeCompare(right))) {
    if (key === "eventType" || key === "correlationId" || key === "provider") continue;
    if ((key === "subject" || key === "resource") && value && typeof value === "object" && !Array.isArray(value)) {
      const row = value as Record<string, unknown>;
      if (typeof row.type === "string" && typeof row.id === "string") refs.push({ type: row.type, id: row.id });
    } else if (key.endsWith("Id") && typeof value === "string") {
      refs.push({ type: key.slice(0, -2), id: value });
    }
  }
  return refs;
}

export function adaptObjectiveDecisionToNode(
  decision: ObjectiveDecisionLike,
  context: ObjectiveDecisionAdapterContext,
): AdapterResult<ProgramNode> {
  const dependsOn = context.dependsOn ?? [];
  if (decision.kind === "query") {
    const request = OperationalQueryRequestSchema.safeParse(decision.request);
    if (!request.success) return result("UNSUPPORTED", undefined, ["Objective query decision is not a valid tenant-less Operational Query request."], [], ["request"]);
    return result(
      "LOSSY",
      { kind: "query", semanticId: context.semanticId, request: request.data, purpose: decision.reason, entityRefs: context.entityRefs ?? [], dependsOn },
      ["ObjectiveDecision.nextStep/recoveryMode are controller hints and have no structural Query equivalent."],
      ["query request", "reason"],
      ["nextStep", "recoveryMode"],
    );
  }
  if (decision.kind === "action") {
    if (!context.action) return result("UNSUPPORTED", undefined, ["Objective action conversion requires an explicit intended-state/observation context."], ["actionType", "payload"], ["intendedState", "observation"]);
    const payload = JsonObjectSchema.safeParse(decision.payload);
    if (!payload.success) return result("UNSUPPORTED", undefined, ["Objective action payload is outside deterministic JSON."], [], ["payload"]);
    return result(
      "LOSSY",
      {
        kind: "effect",
        semanticId: context.semanticId,
        operation: decision.actionType,
        arguments: payload.data,
        targets: context.action.targets,
        intendedState: context.action.intendedState,
        requiredCapability: context.action.requiredCapability,
        consequential: true,
        expectedObservationRefs: context.action.expectedObservationRefs,
        dependsOn,
      },
      ["Objective action is one bounded controller decision; reason/nextStep/recoveryMode remain controller provenance."],
      ["actionType", "payload", "explicit effect semantics"],
      ["reason", "nextStep", "recoveryMode"],
    );
  }
  if (decision.kind === "wait") {
    if (!context.waitCondition) return result("UNSUPPORTED", undefined, ["A prose Objective wait condition cannot be promoted into a predicate without explicit parsed semantics."], ["deadline/event refs"], ["condition predicate"]);
    const waitFor = decision.waitFor;
    const eventType = typeof waitFor?.eventType === "string" ? waitFor.eventType : undefined;
    return result(
      "LOSSY",
      {
        kind: "wait",
        semanticId: context.semanticId,
        condition: context.waitCondition,
        ...(eventType ? { event: { eventType, refs: waitRefs(waitFor) } } : {}),
        ...(decision.deadlineAt ?? decision.resumeAt ? { deadlineAt: decision.deadlineAt ?? decision.resumeAt } : {}),
        dependsOn,
      },
      ["The exact event/deadline is preserved; prose reason and recovery hints remain Objective-controller provenance."],
      ["wait event", "canonical refs", "deadline", "explicit condition predicate"],
      ["reason", "recoveryMode"],
    );
  }
  return result(
    "NOT_APPLICABLE",
    undefined,
    [`ObjectiveDecision.${decision.kind} is a controller terminal/control decision, not an executable Operational IR node.`],
    ["classification"],
    ["controller state remains owned by the existing Objective runtime"],
  );
}

export function adaptOperationalQueryRequestToQuery(input: {
  request: OperationalQueryRequest;
  semanticId: string;
  purpose: string;
  entityRefs?: string[];
  dependsOn?: string[];
}): AdapterResult<Query> {
  const parsed = OperationalQueryRequestSchema.safeParse(input.request);
  if (!parsed.success) return result("UNSUPPORTED", undefined, ["Operational Query request is not deterministic tenant-less JSON."], [], ["request"]);
  return result(
    "LOSSLESS",
    { kind: "query", semanticId: input.semanticId, request: parsed.data, purpose: input.purpose, entityRefs: input.entityRefs ?? [], dependsOn: input.dependsOn ?? [] },
    ["The existing Operational Query request is embedded unchanged and remains owned by its query plane."],
    ["request"],
    [],
  );
}

export function lowerQueryToOperationalQueryRequest(query: Query): AdapterResult<OperationalQueryRequest> {
  return result("LOSSLESS", query.request, ["Query IR refers directly to the existing request contract."], ["request"], ["IR structural metadata"]);
}

/** Complete desired-state envelope supplied by the same parsed/planned candidate
 * and trusted existing context. The adapter never derives these fields from an
 * actionType or provider-shaped payload. */
export type OperationalProgramSemanticEnvelope = Omit<OperationalProgramDraft, "executionModel" | "body">;

export type ExistingPlanningCandidate =
  | {
      kind: "instruction_route";
      decision: InstructionRouteDecisionLike;
      query?: {
        request: OperationalQueryRequest;
        semanticId: string;
        purpose: string;
        entityRefs?: string[];
        dependsOn?: string[];
      };
    }
  | {
      kind: "domain_action";
      executionModel: "ATOMIC_ACTION";
      action: DomainAction;
      semantics?: DomainActionEffectContext;
    }
  | {
      kind: "objective_decision";
      decision: ObjectiveDecisionLike;
      context: ObjectiveDecisionAdapterContext;
    };

/** Assembles one coherent OperationalProgram from an actual audited planning seam.
 * Every semantic field missing from the legacy artifact must be explicit in the
 * envelope/context; absence is UNSUPPORTED, never guessed. */
export function adaptExistingPlanningCandidateToProgram(input: {
  candidate: ExistingPlanningCandidate;
  envelope: OperationalProgramSemanticEnvelope;
}): AdapterResult<OperationalProgram> {
  let executionModel: OperationalProgram["executionModel"];
  let node: ProgramNode;
  let classification: "LOSSLESS" | "LOSSY";
  let reasons: string[];
  let preserved: string[];
  let omitted: string[];

  if (input.candidate.kind === "instruction_route") {
    executionModel = input.candidate.decision.route;
    if (executionModel === "CONVERSATION" || executionModel === "CLARIFY") {
      return result("NOT_APPLICABLE", undefined, [`${executionModel} has no operational computation and does not produce an OperationalProgram.`], ["route classification"], ["no executable IR semantics exist"]);
    }
    if (executionModel !== "QUERY" || !input.candidate.query) {
      return result("UNSUPPORTED", undefined, ["InstructionRouteDecision alone carries classification, not the Goal/effect/query computation needed to build Operational IR."], ["executionModel"], ["program body"]);
    }
    const query = adaptOperationalQueryRequestToQuery(input.candidate.query);
    if (!query.value) return result("UNSUPPORTED", undefined, query.reasons, query.preserved, query.omitted);
    node = query.value;
    classification = "LOSSLESS";
    reasons = ["The same deterministic route candidate supplies the exact existing OperationalQueryRequest; the semantic envelope is explicit."];
    preserved = ["route", "query request", "Goal", "constraints", "entities", "observations", "success condition", "provenance"];
    omitted = ["query router confidence/reason metadata remains route provenance"];
  } else if (input.candidate.kind === "domain_action") {
    executionModel = input.candidate.executionModel;
    const effect = adaptDomainActionToEffect(input.candidate.action, input.candidate.semantics);
    if (!effect.value) return result(effect.classification, undefined, effect.reasons, effect.preserved, effect.omitted);
    node = effect.value;
    classification = "LOSSY";
    reasons = effect.reasons;
    preserved = [...effect.preserved, "explicit Goal", "constraints", "entities", "observations", "success condition", "provenance"];
    omitted = effect.omitted;
  } else {
    executionModel = "OBJECTIVE";
    const adapted = adaptObjectiveDecisionToNode(input.candidate.decision, input.candidate.context);
    if (!adapted.value) return result(adapted.classification, undefined, adapted.reasons, adapted.preserved, adapted.omitted);
    node = adapted.value;
    classification = "LOSSY";
    reasons = adapted.reasons;
    preserved = [...adapted.preserved, "explicit Goal", "constraints", "entities", "observations", "success condition", "provenance"];
    omitted = adapted.omitted;
  }

  try {
    const program = sealOperationalProgram({ ...input.envelope, executionModel, body: node });
    return result(classification, program, reasons, preserved, omitted);
  } catch (error) {
    return result(
      "UNSUPPORTED",
      undefined,
      [`The explicit semantic envelope cannot form a strict OperationalProgram: ${error instanceof Error ? error.message : String(error)}`],
      preserved,
      [...omitted, "malformed semantic envelope"],
    );
  }
}

export const OPERATIONAL_IR_ADAPTER_MATRIX = [
  { representation: "CompiledHumanOperation", actualAtBaseline: true, toIr: "LOSSY", fromIr: "NOT_APPLICABLE", note: "Current Human Operating Compiler envelope preserves route/capability/target/date/payload but cannot supply Goal, dependencies, observation, or success semantics." },
  { representation: "InstructionRouteDecision", actualAtBaseline: true, toIr: "LOSSY", fromIr: "NOT_APPLICABLE", note: "Route/version/reasons are lossless when no queryDecision is present; QUERY decisions are lossy until their request is adapted separately. A route cannot manufacture a program." },
  { representation: "DomainAction / planner DomainAction[]", actualAtBaseline: true, toIr: "LOSSY", fromIr: "LOSSY", note: "Identity/authority/lifecycle are excluded; explicit desired-state semantics and trusted runtime identities are required." },
  { representation: "BusinessEffectSet", actualAtBaseline: true, toIr: "LOSSY", fromIr: "NOT_APPLICABLE", note: "Read-only comparison projection only. BusinessEffect remains independently compiled downstream." },
  { representation: "ObjectiveDecision", actualAtBaseline: true, toIr: "LOSSY", fromIr: "LOSSY", note: "One query/action/wait decision is supported; terminal controller decisions remain Objective-owned." },
  { representation: "OperationalQueryRequest", actualAtBaseline: true, toIr: "LOSSLESS", fromIr: "LOSSLESS", note: "IR refers to the existing tenant-less request contract and never replaces execution." },
] as const;

export function resolvedEntityRef(semanticId: string, kind: "entity" | "party" | "resource", type: string, id: string): EntityRef {
  return { kind: "entity_ref", semanticId, entityType: type, resolution: { status: "resolved", canonical: { kind, type, id }, source: "canonical" } };
}

export function requiredEffectObservation(input: {
  semanticId: string;
  effectRef: string;
  description: string;
}): Observation {
  return {
    kind: "observation",
    semanticId: input.semanticId,
    subject: { kind: "effect", ref: input.effectRef },
    description: input.description,
    strength: "REQUIRED",
    verificationFloor: "EXISTING_OR_STRONGER",
    evidence: { kind: "effect_verification", effectRef: input.effectRef, minimumState: "verified" },
  };
}
