import type { DomainAction, OperationalQueryRequest } from "@finnor/shared-types";
import type {
  Constraint,
  Effect,
  EntityRef,
  Observation,
  OperationalProgram,
  Predicate,
  ProgramNode,
  ProgramScope,
  Provenance,
  SuccessCondition,
} from "./contracts";
import type { ObjectiveDecisionLike } from "./adapters";
import { analyzeProgramGraph } from "./graph";
import { validateOperationalProgram, type IrValidationIssue } from "./validation";

export interface TrustedDomainActionPolicy {
  policyId: string | null;
  policyVersion?: number | null;
}

/** All identity-bearing values are supplied by trusted runtime context, never read
 * from model-authored IR. Fixed values make the pure lowerer deterministic. */
export interface TrustedLoweringContext {
  tenantId: string;
  createdAt: string;
  domainActionIds: Record<string, string>;
  policyByEffect?: Record<string, TrustedDomainActionPolicy>;
  workId?: string | null;
  plannerAttemptId?: string | null;
  initiatedBy?: string | null;
  objectiveStepIdByEffect?: Record<string, string | null>;
  authorityContext?: Record<string, unknown>;
}

export interface RetainedIrSemanticContract {
  irSemanticHash: OperationalProgram["irSemanticHash"];
  executionModel: OperationalProgram["executionModel"];
  goal: OperationalProgram["goal"];
  hardConstraints: Constraint[];
  entities: EntityRef[];
  scope: ProgramScope;
  /** Structural intended computation retained as a non-authoritative parity
   * sidecar because current executable representations cannot carry it. */
  body: ProgramNode;
  expectedObservations: Observation[];
  successCondition: SuccessCondition;
  provenance: Provenance;
}

export interface LoweredDomainActionNode {
  irEffectSemanticId: string;
  domainAction: DomainAction;
  dependsOnDomainActionIds: string[];
  /** The existing compiler/grounder must still run when true. */
  requiresCurrentGrounding: boolean;
}

export interface LoweredDomainActionPlan {
  kind: "domain_action_plan";
  actions: LoweredDomainActionNode[];
}

export interface LoweredOperationalQuery {
  kind: "operational_query";
  request: OperationalQueryRequest;
}

export interface LoweredObjectiveDecision {
  kind: "objective_decision";
  decision: ObjectiveDecisionLike;
}

export type LoweredExecutable = LoweredDomainActionPlan | LoweredOperationalQuery | LoweredObjectiveDecision;

export interface LoweringGuarantees {
  authorizes: false;
  executes: false;
  persists: false;
  selectsProvider: false;
  compilesBusinessEffect: false;
  derivesIdempotencyKey: false;
  bypassesGrounding: false;
  weakensVerification: false;
}

export const LOWERING_GUARANTEES: LoweringGuarantees = Object.freeze({
  authorizes: false,
  executes: false,
  persists: false,
  selectsProvider: false,
  compilesBusinessEffect: false,
  derivesIdempotencyKey: false,
  bypassesGrounding: false,
  weakensVerification: false,
});

export type CompatibilityLoweringResult =
  | {
      status: "LOWERED";
      classification: "LOSSLESS" | "LOSSY";
      target: LoweredExecutable["kind"];
      value: LoweredExecutable;
      retained: RetainedIrSemanticContract;
      guarantees: LoweringGuarantees;
      reasons: string[];
    }
  | {
      status: "INVALID";
      classification: "UNSUPPORTED";
      validationErrors: IrValidationIssue[];
      guarantees: LoweringGuarantees;
      reasons: string[];
    }
  | {
      status: "UNSUPPORTED";
      classification: "UNSUPPORTED" | "NOT_APPLICABLE";
      guarantees: LoweringGuarantees;
      reasons: string[];
    };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function retained(program: OperationalProgram): RetainedIrSemanticContract {
  return {
    irSemanticHash: program.irSemanticHash,
    executionModel: program.executionModel,
    goal: program.goal,
    hardConstraints: program.constraints.filter((constraint) => constraint.severity === "HARD"),
    entities: program.entities,
    scope: program.scope,
    body: program.body,
    expectedObservations: program.observations,
    successCondition: program.successCondition,
    provenance: program.provenance,
  };
}

function unsupported(reasons: string[], classification: "UNSUPPORTED" | "NOT_APPLICABLE" = "UNSUPPORTED"): CompatibilityLoweringResult {
  return { status: "UNSUPPORTED", classification, guarantees: LOWERING_GUARANTEES, reasons };
}

function effectOnlyPlan(node: ProgramNode): boolean {
  if (node.kind === "effect") return true;
  if (node.kind === "sequence") return node.steps.every(effectOnlyPlan);
  if (node.kind === "parallel") return node.branches.every(effectOnlyPlan);
  return false;
}

function lowerDomainActionPlan(program: OperationalProgram, context: TrustedLoweringContext | undefined): CompatibilityLoweringResult {
  if (!context) return unsupported(["DomainAction lowering requires a trusted runtime context for tenant/action identities and timestamps."]);
  if (!UUID.test(context.tenantId)) return unsupported(["Trusted lowering tenantId must be a canonical UUID."]);
  if (!Number.isFinite(Date.parse(context.createdAt))) return unsupported(["Trusted lowering createdAt must be an ISO timestamp."]);
  if (!effectOnlyPlan(program.body)) return unsupported(["The current DomainAction plan can lower only Effect/Sequence/Parallel effect DAGs; Branch, Wait, Query, and Compensation remain Objective-owned."]);

  const graph = analyzeProgramGraph(program.body);
  const effects = [...graph.nodes.values()]
    .filter((node): node is typeof node & { node: Effect } => node.kind === "effect" && !node.compensationForEffectId)
    .sort((left, right) => left.semanticId.localeCompare(right.semanticId));
  const actionIds = new Map<string, string>();
  for (const effect of effects) {
    const actionId = context.domainActionIds[effect.semanticId];
    if (!actionId || !UUID.test(actionId)) return unsupported([`Trusted context has no canonical DomainAction UUID for ${effect.semanticId}.`]);
    actionIds.set(effect.semanticId, actionId);
    if (!effect.node.domainActionCompatibility) return unsupported([`Effect ${effect.semanticId} has no audited compiledGraph; current grounding/compiler output cannot be fabricated by the IR lowerer.`]);
    if (effect.node.domainActionCompatibility.compiledGraph.commandType !== effect.node.operation) return unsupported([`Effect ${effect.semanticId} compiledGraph commandType does not match operation.`]);
  }

  const actions: LoweredDomainActionNode[] = effects.map(({ semanticId, node }) => {
    const policy = context.policyByEffect?.[semanticId];
    const exactGrounding = node.domainActionCompatibility?.groundedPayload;
    const dependencySemanticIds = graph.edges.filter((edge) => edge.to === semanticId).map((edge) => edge.from).sort();
    const dependsOnDomainActionIds = dependencySemanticIds.map((dependency) => actionIds.get(dependency)!).filter(Boolean);
    const domainAction: DomainAction = {
      id: actionIds.get(semanticId)!,
      tenantId: context.tenantId,
      actionType: node.operation,
      payload: node.arguments,
      policyId: policy?.policyId ?? null,
      policyVersion: policy?.policyVersion ?? null,
      status: "draft",
      createdAt: new Date(context.createdAt).toISOString(),
      workId: context.workId ?? null,
      plannerAttemptId: context.plannerAttemptId ?? null,
      initiatedBy: context.initiatedBy ?? null,
      authorityContext: context.authorityContext ?? {},
      objectiveStepId: context.objectiveStepIdByEffect?.[semanticId] ?? null,
      groundedPayload: exactGrounding ?? null,
      compiledGraph: node.domainActionCompatibility!.compiledGraph,
      // Authority, BusinessEffect, execution, provider, Work lifecycle, and
      // idempotency identities are deliberately absent.
      authorityDecisionId: null,
      authorityRevision: null,
      businessEffectId: null,
    };
    return {
      irEffectSemanticId: semanticId,
      domainAction,
      dependsOnDomainActionIds,
      requiresCurrentGrounding: exactGrounding === undefined || exactGrounding === null || exactGrounding.some((field) => field.status !== "verified"),
    };
  });

  return {
    status: "LOWERED",
    classification: "LOSSY",
    target: "domain_action_plan",
    value: { kind: "domain_action_plan", actions },
    retained: retained(program),
    guarantees: LOWERING_GUARANTEES,
    reasons: ["Existing DomainAction cannot carry Goal/Constraint/Observation/SuccessCondition, so they remain an explicit non-authoritative sidecar for parity checks."],
  };
}

type ObjectiveLeaf = Extract<ProgramNode, { kind: "query" | "effect" | "wait" }>;

function singleLeaf(node: ProgramNode): ObjectiveLeaf | null {
  if (node.kind === "sequence" && node.steps.length === 1) return singleLeaf(node.steps[0]!);
  if (node.kind === "query" || node.kind === "effect" || node.kind === "wait") return node;
  return null;
}

function objectiveWaitFor(node: Extract<ProgramNode, { kind: "wait" }>): Record<string, unknown> | undefined {
  if (!node.event) return undefined;
  const result: Record<string, unknown> = { eventType: node.event.eventType };
  const knownIdKeys: Record<string, string> = {
    delegation: "delegationId",
    task: "taskId",
    acknowledgementRequest: "acknowledgementRequestId",
    computerRun: "computerRunId",
    domainAction: "domainActionId",
  };
  let generic = 0;
  for (const ref of node.event.refs) {
    const known = knownIdKeys[ref.type];
    if (known && result[known] === undefined) result[known] = ref.id;
    else if (generic === 0) { result.subject = ref; generic += 1; }
    else if (generic === 1) { result.resource = ref; generic += 1; }
    else return undefined;
  }
  return result;
}

function lowerObjectiveDecision(program: OperationalProgram): CompatibilityLoweringResult {
  const node = singleLeaf(program.body);
  if (!node) return unsupported(["The existing Objective runtime chooses exactly one bounded query/action/wait per iteration; static Sequence, Parallel, Branch, and Compensation programs cannot be lowered without implementing P4 search/execution semantics."]);
  let decision: ObjectiveDecisionLike;
  if (node.kind === "query") {
    decision = { kind: "query", request: node.request as unknown as Record<string, unknown>, reason: node.purpose, nextStep: program.successCondition.statement };
  } else if (node.kind === "effect") {
    decision = { kind: "action", actionType: node.operation, payload: node.arguments, reason: program.goal.statement, nextStep: program.successCondition.statement };
  } else {
    const waitFor = objectiveWaitFor(node);
    if (node.event && !waitFor) return unsupported(["Wait carries more canonical refs than the current ObjectiveDecision wait contract can preserve."]);
    decision = {
      kind: "wait",
      ...(waitFor ? { waitFor } : {}),
      ...(node.deadlineAt ? { deadlineAt: node.deadlineAt } : {}),
      condition: program.goal.statement,
      reason: `Wait for: ${program.goal.statement}`,
    };
  }
  return {
    status: "LOWERED",
    classification: "LOSSY",
    target: "objective_decision",
    value: { kind: "objective_decision", decision },
    retained: retained(program),
    guarantees: LOWERING_GUARANTEES,
    reasons: ["Current ObjectiveDecision carries one controller step; full IR Goal/constraints/observations remain parity sidecar data and do not replace Objective lifecycle truth."],
  };
}

function lowerOperationalQuery(program: OperationalProgram): CompatibilityLoweringResult {
  const node = singleLeaf(program.body);
  if (!node || node.kind !== "query") return unsupported(["QUERY lowering requires exactly one Query node."]);
  return {
    status: "LOWERED",
    classification: "LOSSLESS",
    target: "operational_query",
    value: { kind: "operational_query", request: node.request },
    retained: retained(program),
    guarantees: LOWERING_GUARANTEES,
    reasons: ["Query IR lowers to the existing tenant-less OperationalQueryRequest; execution remains in the Operational Query Plane."],
  };
}

export function lowerOperationalProgram(
  input: unknown,
  context?: TrustedLoweringContext,
): CompatibilityLoweringResult {
  const validation = validateOperationalProgram(input);
  if (!validation.valid || !validation.program) {
    return {
      status: "INVALID",
      classification: "UNSUPPORTED",
      validationErrors: validation.errors,
      guarantees: LOWERING_GUARANTEES,
      reasons: ["Malformed Operational IR cannot be lowered."],
    };
  }
  const program = validation.program;
  if (program.executionModel === "CONVERSATION") return unsupported(["CONVERSATION produces no Operational IR executable representation."], "NOT_APPLICABLE");
  if (program.executionModel === "QUERY") return lowerOperationalQuery(program);
  if (program.executionModel === "OBJECTIVE") return lowerObjectiveDecision(program);
  return lowerDomainActionPlan(program, context);
}
