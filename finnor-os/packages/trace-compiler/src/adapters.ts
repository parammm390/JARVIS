import type {
  CausalReplayProjection,
  DecisionReceipt,
  ExecutionActionNode,
  ExecutionProjection,
  ExternalEffectObservation,
} from "@finnor/shared-types";
import type {
  CompletionEvidence,
  EvidenceClass,
  RawEvidenceEvent,
  SourceTraceBundle,
  TraceNodeSemanticKind,
  TraceOperationIdentity,
  TraceSourceKind,
} from "./contracts";
import { stableUnique } from "./canonical";

function identity(operation: Partial<TraceOperationIdentity> & Pick<TraceOperationIdentity, "semanticOperation" | "goal">): TraceOperationIdentity {
  return {
    semanticOperation: operation.semanticOperation,
    goal: operation.goal,
    plannerIrSemanticHash: operation.plannerIrSemanticHash ?? null,
    executionModel: operation.executionModel ?? null,
    sourceOperationRefs: stableUnique(operation.sourceOperationRefs ?? []),
  };
}

function actionStatus(action: ExecutionActionNode): RawEvidenceEvent["outcome"] {
  if (action.status === "succeeded") return {
    status: "SUCCEEDED",
    verified: action.observation.verification === "verified",
    verificationBasis: action.observation.basis,
  };
  if (action.status === "failed" || action.status === "denied" || action.status === "rejected" || action.status === "blocked") return {
    status: action.status === "blocked" ? "BLOCKED" : "FAILED",
    verified: false,
    verificationBasis: action.observation.basis,
    failure: action.failure ? {
      kind: action.failure.errorKind?.toUpperCase() as NonNullable<NonNullable<RawEvidenceEvent["outcome"]>["failure"]>["kind"] ?? "UNKNOWN",
      reasonCode: action.failure.message,
      possibleExternalMutation: action.externalEffect === "possible" || action.externalEffect === "unknown",
      reconciliationRequired: action.failure.reconciliationRequired,
    } : null,
  };
  if (action.externalEffect === "possible" || action.externalEffect === "unknown") return {
    status: "AMBIGUOUS",
    verified: false,
    verificationBasis: action.observation.basis,
    failure: { kind: "UNKNOWN_OUTCOME", reasonCode: "EXTERNAL_EFFECT_AMBIGUOUS", possibleExternalMutation: true, reconciliationRequired: true },
  };
  return { status: "UNKNOWN", verified: false, verificationBasis: action.observation.basis };
}

function evidenceKindForAction(action: ExecutionActionNode): TraceNodeSemanticKind {
  if (action.computer) return "COMPUTER_OPERATION";
  if (action.route?.route === "api" || action.route?.route === "browser" || action.route?.route === "computer") return "PROVIDER_OPERATION";
  return "ACTION";
}

function actionEvents(tenantId: string, projection: ExecutionProjection, action: ExecutionActionNode, evidenceClass: EvidenceClass): RawEvidenceEvent[] {
  const events: RawEvidenceEvent[] = [];
  const baseIds = {
    workIds: [projection.work.id],
    businessEffectIds: action.businessEffect ? [action.businessEffect.id] : [],
    businessEffectSemanticHashes: action.businessEffect ? [action.businessEffect.semanticHash] : [],
    decisionReceiptIds: [...action.receiptIds],
    workflowRunIds: [...action.workflowRunIds],
    authorityDecisionIds: action.authority.decisionId ? [action.authority.decisionId] : [],
  };
  const authorityId = `${action.id}:authority`;
  if (action.authority.state !== "unknown" || action.authority.decisionId || action.authority.operation) events.push({
    eventId: authorityId,
    tenantId,
    evidenceClass,
    sourceKind: "AUTHORITY_DECISION",
    sourceRef: action.authority.sourceRef ?? `domain_action:${action.id}:authority`,
    occurredAt: action.timestamps.createdAt,
    semanticKind: "AUTHORITY_GATE",
    operation: { name: action.authority.operation ?? "authority.requirement", equivalenceClass: `authority:${action.authority.operation ?? "unknown"}` },
    authority: {
      requirementObserved: true,
      capability: action.authority.operation,
      risk: action.authority.risk?.toUpperCase() as "LOW" | "MEDIUM" | "HIGH" | undefined,
      authorityState: action.authority.state === "allowed" ? "ALLOWED"
        : action.authority.state === "approval_required" ? "APPROVAL_REQUIRED"
          : action.authority.state === "denied" ? "DENIED"
            : action.authority.state === "authority_changed" || action.authority.state === "reauthorization_required" ? "CHANGED" : "UNKNOWN",
      decisionId: action.authority.decisionId,
      revision: action.authority.revision,
      approvalRequired: action.approval.required,
      approvalStatus: action.approval.status.toUpperCase() as "NOT_REQUIRED" | "PENDING" | "APPROVED" | "REJECTED" | "EXPIRED" | "UNKNOWN",
    },
    outcome: { status: action.authority.state === "denied" ? "FAILED" : action.authority.state === "unknown" ? "UNKNOWN" : "SUCCEEDED", verified: Boolean(action.authority.decisionId) },
    sourceIdentities: baseIds,
    parents: { control: [`${projection.work.id}:start`] },
  });
  const approvalId = `${action.id}:approval`;
  if (action.approval.required || action.approval.status !== "not_required") events.push({
    eventId: approvalId,
    tenantId,
    evidenceClass,
    sourceKind: "HUMAN_APPROVAL",
    sourceRef: action.approval.sourceRef ?? `domain_action:${action.id}:approval`,
    occurredAt: action.approval.decidedAt ?? action.timestamps.createdAt,
    semanticKind: "APPROVAL_GATE",
    operation: { name: "human.approval", equivalenceClass: "requires-approval" },
    inputs: [{ path: "approval.consequence", value: action.approval.consequence, role: "SOURCE", sensitivity: "TENANT_INTERNAL" }],
    authority: {
      requirementObserved: true,
      capability: action.authority.operation,
      risk: action.authority.risk?.toUpperCase() as "LOW" | "MEDIUM" | "HIGH" | undefined,
      authorityState: action.authority.state === "allowed" ? "ALLOWED" : "APPROVAL_REQUIRED",
      decisionId: action.authority.decisionId,
      revision: action.authority.revision,
      approvalRequired: true,
      approvalStatus: action.approval.status.toUpperCase() as "PENDING" | "APPROVED" | "REJECTED" | "EXPIRED" | "UNKNOWN",
    },
    outcome: {
      status: action.approval.status === "approved" ? "SUCCEEDED" : action.approval.status === "rejected" || action.approval.status === "expired" ? "FAILED" : "UNKNOWN",
      verified: action.approval.status === "approved" || action.approval.status === "rejected" || action.approval.status === "expired",
      verificationBasis: action.approval.sourceRef,
    },
    sourceIdentities: baseIds,
    parents: { control: events.some((event) => event.eventId === authorityId) ? [authorityId] : [`${projection.work.id}:start`] },
  });
  const gateIds = [events.some((event) => event.eventId === authorityId) ? authorityId : null, events.some((event) => event.eventId === approvalId) ? approvalId : null].filter((value): value is string => Boolean(value));
  events.push({
    eventId: action.id,
    tenantId,
    evidenceClass,
    sourceKind: "EXECUTION_PROJECTION",
    sourceRef: `domain_action:${action.id}`,
    occurredAt: action.timestamps.executionStartedAt ?? action.timestamps.createdAt,
    endedAt: action.timestamps.lastChangedAt,
    semanticKind: evidenceKindForAction(action),
    operation: {
      name: action.businessEffect?.contract.delta.operation ?? action.businessVerb ?? action.actionType,
      equivalenceClass: action.businessEffect?.contract.operation.name ?? action.actionType,
      effectClass: action.businessEffect?.contract.operation.class,
      consequential: Boolean(action.businessEffect) || action.externalEffect !== "none",
      providerClass: action.route?.route ?? undefined,
    },
    inputs: [{ path: "action.input", value: action.semanticPayload, role: "PARAMETER" }],
    outputs: action.observation.actualResult ? [{ path: "action.result", value: action.observation.actualResult, role: "EXTERNAL_OBSERVATION" }] : [],
    authority: {
      requirementObserved: action.authority.state !== "unknown" || action.approval.required,
      capability: action.authority.operation,
      risk: action.authority.risk?.toUpperCase() as "LOW" | "MEDIUM" | "HIGH" | undefined,
      approvalRequired: action.approval.required,
      approvalStatus: action.approval.status.toUpperCase() as "NOT_REQUIRED" | "PENDING" | "APPROVED" | "REJECTED" | "EXPIRED" | "UNKNOWN",
      decisionId: action.authority.decisionId,
      revision: action.authority.revision,
    },
    outcome: actionStatus(action),
    sourceIdentities: baseIds,
    parents: { authorityFor: gateIds, causal: action.dependencyIds },
  });
  if (action.observation.actualResult || action.observation.evidence.length > 0 || action.observation.verification !== "not_started") events.push({
    eventId: `${action.id}:observation`,
    tenantId,
    evidenceClass,
    sourceKind: action.computer ? "COMPUTER_TRACE" : "EXTERNAL_OBSERVATION",
    sourceRef: action.observation.evidence[0]?.ref ?? `domain_action:${action.id}:observation`,
    occurredAt: action.timestamps.lastChangedAt,
    semanticKind: action.observation.verification === "verified" ? "VERIFICATION" : "OBSERVATION",
    operation: { name: "observe.effect", equivalenceClass: `observe:${action.businessEffect?.contract.expected.observation ?? "result"}` },
    outputs: action.observation.actualResult ? [{ path: "observation.value", value: action.observation.actualResult, role: "EXTERNAL_OBSERVATION" }] : [],
    observations: [{
      kind: action.computer ? "COMPUTER" : action.businessEffect?.contract.expected.observation === "canonical_state" ? "CANONICAL" : "PROVIDER",
      subject: action.businessEffect?.contract.expected.observation ?? action.actionType,
      state: action.observation.verification === "verified" ? "OBSERVED" : action.observation.verification === "failed" ? "DIVERGENT" : "UNKNOWN",
      externalRealityRequired: true,
    }],
    outcome: {
      status: action.observation.verification === "verified" ? "SUCCEEDED" : action.observation.verification === "failed" ? "FAILED" : "UNKNOWN",
      verified: action.observation.verification === "verified",
      verificationBasis: action.observation.basis,
    },
    sourceIdentities: baseIds,
    parents: { observationOf: [action.id] },
  });
  return events;
}

export function sourceBundleFromExecutionProjection(input: {
  tenantId: string;
  projection: ExecutionProjection;
  evidenceClass?: EvidenceClass;
  operationIdentity?: Partial<TraceOperationIdentity>;
}): SourceTraceBundle {
  const { projection } = input;
  const evidenceClass = input.evidenceClass ?? "REAL_EXECUTION";
  const startId = `${projection.work.id}:start`;
  const events: RawEvidenceEvent[] = [{
    eventId: startId,
    tenantId: input.tenantId,
    evidenceClass,
    sourceKind: "WORK",
    sourceRef: `work:${projection.work.id}`,
    occurredAt: projection.work.createdAt,
    semanticKind: "WORK_TRANSITION",
    operation: { name: "work.started", equivalenceClass: "work.start" },
    inputs: [{ path: "work.objective", value: projection.work.objective, role: "USER_INPUT", sensitivity: "TENANT_INTERNAL" }],
    outcome: { status: "SUCCEEDED", verified: true, verificationBasis: "durable Work row" },
    sourceIdentities: { workIds: [projection.work.id] },
  }];
  for (const action of projection.nodes) events.push(...actionEvents(input.tenantId, projection, action, evidenceClass));

  for (const workflow of projection.workflows) {
    const sortedSteps = [...workflow.steps].sort((left, right) => left.sequence - right.sequence || left.id.localeCompare(right.id));
    let previous: string | null = null;
    for (const step of sortedSteps) {
      const attempts = Math.max(1, step.attempts);
      for (let attempt = 1; attempt <= attempts; attempt += 1) {
        const eventId = attempts === 1 ? `workflow_step:${step.id}` : `workflow_step:${step.id}:attempt:${attempt}`;
        const isLast = attempt === attempts;
        events.push({
          eventId,
          tenantId: input.tenantId,
          evidenceClass,
          sourceKind: "WORKFLOW_STEP",
          sourceRef: step.sourceRef,
          occurredAt: step.updatedAt,
          semanticKind: attempt > 1 ? "RETRY_ATTEMPT" : "ACTION",
          operation: { name: step.stepType, equivalenceClass: step.stepType, consequential: Boolean(step.domainActionId) },
          outcome: {
            status: !isLast ? "FAILED" : step.status === "completed" || step.executionState === "verified" ? "SUCCEEDED" : step.status === "failed" ? "FAILED" : "UNKNOWN",
            verified: isLast && step.executionState === "verified",
            verificationBasis: step.terminalReason,
            failure: !isLast ? { kind: "RETRYABLE", reasonCode: "AGGREGATED_PRIOR_ATTEMPT", possibleExternalMutation: false, reconciliationRequired: false } : null,
          },
          retry: attempts > 1 ? {
            family: `workflow_step:${step.id}`,
            attempt,
            trigger: attempt === 1 ? "INITIAL" : "PRIOR_ATTEMPT_FAILED",
            delayMs: null,
            backoffEvidence: null,
            idempotencyEvidence: step.sourceRef,
            reconciliationBeforeAttempt: Boolean(step.reconciliation),
            humanInitiated: false,
          } : undefined,
          sourceIdentities: {
            workIds: [projection.work.id],
            workflowRunIds: [workflow.id],
            workflowStepIds: [step.id],
          },
          parents: {
            control: previous ? [previous] : [startId],
            retryOf: attempt > 1 ? [attempts === 2 && attempt === 2 ? `workflow_step:${step.id}:attempt:1` : `workflow_step:${step.id}:attempt:${attempt - 1}`] : [],
          },
        });
        previous = eventId;
      }
      if (step.reconciliation) events.push({
        eventId: `reconciliation:${step.reconciliation.caseId}`,
        tenantId: input.tenantId,
        evidenceClass,
        sourceKind: "RECONCILIATION",
        sourceRef: step.reconciliation.sourceRef,
        occurredAt: step.updatedAt,
        semanticKind: "RECONCILIATION",
        operation: { name: "reconcile.external_effect", equivalenceClass: "reconciliation" },
        outcome: { status: step.reconciliation.status === "resolved" ? "SUCCEEDED" : "UNKNOWN", verified: step.reconciliation.status === "resolved" },
        sourceIdentities: { workIds: [projection.work.id], workflowRunIds: [workflow.id], workflowStepIds: [step.id] },
        parents: { causal: previous ? [previous] : [] },
      });
      if (step.compensation) events.push({
        eventId: `compensation:${step.compensation.caseId}`,
        tenantId: input.tenantId,
        evidenceClass,
        sourceKind: "COMPENSATION",
        sourceRef: step.compensation.sourceRef,
        occurredAt: step.updatedAt,
        semanticKind: "COMPENSATION",
        operation: { name: `compensate.${step.stepType}`, equivalenceClass: `compensation:${step.stepType}`, consequential: true },
        outcome: { status: step.compensation.status === "succeeded" ? "SUCCEEDED" : step.compensation.status === "failed" ? "FAILED" : "UNKNOWN", verified: step.compensation.status === "succeeded" },
        sourceIdentities: { workIds: [projection.work.id], workflowRunIds: [workflow.id], workflowStepIds: [step.id] },
        parents: { compensationFor: previous ? [previous] : [] },
      });
    }
  }

  for (const receipt of projection.receipts) events.push({
    eventId: `receipt:${receipt.id}`,
    tenantId: input.tenantId,
    evidenceClass,
    sourceKind: "DECISION_RECEIPT",
    sourceRef: receipt.sourceRef,
    occurredAt: receipt.finalizedAt ?? receipt.createdAt,
    semanticKind: receipt.effectVerification?.state === "verified" ? "VERIFICATION" : receipt.failure ? "FAILURE" : "OBSERVATION",
    operation: { name: "decision.receipt", equivalenceClass: "decision-receipt" },
    inputs: receipt.expectedResult ? [{ path: "receipt.expected", value: receipt.expectedResult, role: "SOURCE" }] : [],
    outputs: receipt.actualResult ? [{ path: "receipt.actual", value: receipt.actualResult, role: "EXTERNAL_OBSERVATION" }] : [],
    authority: { approvalRequired: receipt.approval.required, approvalStatus: receipt.approval.required ? receipt.approval.approvedBy ? "APPROVED" : "UNKNOWN" : "NOT_REQUIRED" },
    outcome: receipt.failure ? {
      status: "FAILED",
      verified: false,
      failure: {
        kind: receipt.failure.errorKind?.toUpperCase() as NonNullable<NonNullable<RawEvidenceEvent["outcome"]>["failure"]>["kind"] ?? "UNKNOWN",
        reasonCode: receipt.failure.message,
        possibleExternalMutation: receipt.failure.reconciliationRequired,
        reconciliationRequired: receipt.failure.reconciliationRequired,
      },
    } : {
      status: receipt.effectVerification?.state === "verified" ? "SUCCEEDED" : receipt.actualResult ? "SUCCEEDED" : "UNKNOWN",
      verified: receipt.effectVerification?.state === "verified",
      verificationBasis: receipt.effectVerification?.basis ?? null,
    },
    sourceIdentities: {
      workIds: [projection.work.id],
      decisionReceiptIds: [receipt.id],
      businessEffectIds: receipt.businessEffectId ? [receipt.businessEffectId] : [],
      workflowRunIds: receipt.workflowRunId ? [receipt.workflowRunId] : [],
      workflowStepIds: receipt.workflowStepId ? [receipt.workflowStepId] : [],
    },
    parents: { observationOf: receipt.domainActionId ? [receipt.domainActionId] : [] },
  });

  if (projection.work.successCondition || projection.work.successVerification) events.push({
    eventId: `${projection.work.id}:success-condition`,
    tenantId: input.tenantId,
    evidenceClass,
    sourceKind: "OBJECTIVE_RUNTIME",
    sourceRef: `work:${projection.work.id}:success_verification`,
    occurredAt: projection.work.successVerifiedAt ?? projection.work.updatedAt,
    semanticKind: "SUCCESS_CONDITION",
    operation: { name: "objective.success", equivalenceClass: "verified-success-condition" },
    inputs: projection.work.successCondition ? [{ path: "success.condition", value: projection.work.successCondition, role: "SOURCE", sensitivity: "TENANT_INTERNAL" }] : [],
    outputs: projection.work.successVerification ? [{ path: "success.verification", value: projection.work.successVerification, role: "EXTERNAL_OBSERVATION", sensitivity: "TENANT_INTERNAL" }] : [],
    outcome: {
      status: projection.work.successVerification?.state === "verified" ? "SUCCEEDED" : projection.work.successVerification?.state === "unsatisfied" ? "FAILED" : "UNKNOWN",
      verified: projection.work.successVerification?.state === "verified",
      verificationBasis: projection.work.successVerification ? "persisted ObjectiveSuccessVerification" : null,
    },
    sourceIdentities: { workIds: [projection.work.id], queryExecutionIds: projection.work.successVerification?.queryExecutionIds ?? [] },
    parents: { causal: projection.nodes.map((action) => action.id) },
  });

  const effectVerifications: CompletionEvidence["effectVerifications"] = projection.nodes.flatMap((action) => action.businessEffect ? [{
    verified: "VERIFIED",
    partially_verified: "PARTIALLY_VERIFIED",
    unverified: "UNVERIFIED",
    divergent: "DIVERGENT",
    reconciliation_required: "RECONCILIATION_REQUIRED",
    not_started: "UNVERIFIED",
  }[action.businessEffect.verification?.state ?? "not_started"] as CompletionEvidence["effectVerifications"][number]] : []);
  const objectiveVerification = projection.work.successVerification?.state === "verified" ? "VERIFIED"
    : projection.work.successVerification?.state === "unsatisfied" ? "UNSATISFIED"
      : projection.work.successVerification?.state === "blocked" ? "BLOCKED"
        : projection.work.successCondition ? "UNKNOWN" : "NOT_APPLICABLE";
  return {
    tenantId: input.tenantId,
    operationIdentity: identity({
      semanticOperation: input.operationIdentity?.semanticOperation ?? projection.work.executionModel ?? "work.execution",
      goal: input.operationIdentity?.goal ?? projection.work.objective,
      plannerIrSemanticHash: input.operationIdentity?.plannerIrSemanticHash,
      executionModel: input.operationIdentity?.executionModel ?? projection.work.executionModel,
      sourceOperationRefs: input.operationIdentity?.sourceOperationRefs ?? [`work:${projection.work.id}`],
    }),
    startedAt: projection.work.createdAt,
    endedAt: [projection.work.successVerifiedAt, projection.work.updatedAt].filter((value): value is string => Boolean(value)).sort().at(-1),
    events,
    completion: {
      workStatus: projection.work.status,
      objectiveVerification,
      effectVerifications,
      providerAcknowledged: false,
      recovered: projection.workflows.some((workflow) => workflow.status === "compensated" || workflow.steps.some((step) => Boolean(step.reconciliation))),
      terminalFailure: Boolean(projection.work.failure),
      ambiguousExternalOutcome: projection.nodes.some((action) => action.externalEffect === "possible" || action.externalEffect === "unknown"),
      explicitlyIncomplete: projection.truncated.actions || projection.truncated.workflowSteps || projection.truncated.computerSteps || projection.truncated.evidence,
    },
  };
}

function replayKind(stage: CausalReplayProjection["nodes"][number]["stage"]): TraceNodeSemanticKind {
  if (stage === "authority") return "AUTHORITY_GATE";
  if (stage === "approval") return "APPROVAL_GATE";
  if (stage === "provider") return "PROVIDER_OPERATION";
  if (stage === "external_event" || stage === "canonical_change") return "OBSERVATION";
  if (stage === "verification") return "VERIFICATION";
  if (stage === "compensation") return "COMPENSATION";
  if (stage === "recovery") return "RECONCILIATION";
  if (stage === "failure" || stage === "missing") return "FAILURE";
  if (stage === "planning" || stage === "policy" || stage === "dependency") return "MODEL_DECISION";
  if (stage === "execution") return "ACTION";
  if (stage === "trigger") return "INSTRUCTION";
  return "WORK_TRANSITION";
}

export function sourceBundleFromCausalReplay(input: {
  tenantId: string;
  replay: CausalReplayProjection;
  evidenceClass?: EvidenceClass;
}): SourceTraceBundle {
  const evidenceClass = input.evidenceClass ?? "REAL_EXECUTION";
  const events: RawEvidenceEvent[] = input.replay.nodes.map((node) => ({
    eventId: node.id,
    tenantId: input.tenantId,
    evidenceClass,
    sourceKind: "CAUSAL_REPLAY",
    sourceRef: node.sourceRefs[0] ?? `causal_replay:${node.id}`,
    occurredAt: node.occurredAt,
    semanticKind: replayKind(node.stage),
    operation: { name: node.stage, equivalenceClass: `causal:${node.stage}`, consequential: ["execution", "provider", "compensation"].includes(node.stage) },
    outputs: [{ path: "causal.facts", value: node.facts, role: node.stage === "external_event" || node.stage === "verification" ? "EXTERNAL_OBSERVATION" : "SOURCE", sensitivity: "TENANT_INTERNAL" }],
    observations: ["provider", "external_event", "canonical_change", "verification"].includes(node.stage) ? [{
      kind: node.stage === "canonical_change" ? "CANONICAL" : node.stage === "external_event" ? "EVENT" : "PROVIDER",
      subject: node.title,
      state: node.status.includes("missing") || node.status.includes("unknown") ? "UNKNOWN" : "OBSERVED",
      externalRealityRequired: true,
    }] : [],
    outcome: {
      status: node.stage === "failure" || node.status === "failed" ? "FAILED" : node.stage === "missing" || node.status.includes("unknown") ? "UNKNOWN" : "SUCCEEDED",
      verified: node.stage === "verification" && !node.status.includes("unknown") && !node.status.includes("failed"),
      verificationBasis: node.evidence[0]?.source ?? null,
    },
    sourceIdentities: { workIds: [input.replay.work.id] },
  }));
  for (const edge of input.replay.edges) {
    const target = events.find((event) => event.eventId === edge.to);
    if (!target) continue;
    const relation = edge.relation.toLowerCase();
    const kind = relation.includes("authority") || relation.includes("approval") ? "authorityFor"
      : relation.includes("observe") || relation.includes("verify") ? "observationOf"
        : relation.includes("temporal") ? "temporalAfter"
          : relation.includes("compens") ? "compensationFor" : "causal";
    target.parents = { ...target.parents, [kind]: [...(target.parents?.[kind] ?? []), edge.from] };
    if (edge.certainty === "missing") target.uncertainty = [...(target.uncertainty ?? []), `MISSING_CAUSAL_EDGE:${edge.id}`];
  }
  return {
    tenantId: input.tenantId,
    operationIdentity: identity({
      semanticOperation: input.replay.work.executionModel ?? "work.execution",
      goal: input.replay.work.objective,
      executionModel: input.replay.work.executionModel,
      sourceOperationRefs: [`work:${input.replay.work.id}:causal_replay`],
    }),
    startedAt: input.replay.work.createdAt,
    endedAt: input.replay.work.updatedAt,
    events,
    completion: {
      workStatus: input.replay.work.status,
      objectiveVerification: (input.replay.work.successVerification as { state?: string } | null)?.state === "verified" ? "VERIFIED" : input.replay.work.successCondition ? "UNKNOWN" : "NOT_APPLICABLE",
      effectVerifications: [],
      providerAcknowledged: input.replay.nodes.some((node) => node.stage === "provider"),
      recovered: input.replay.nodes.some((node) => node.stage === "recovery" || node.stage === "compensation"),
      terminalFailure: input.replay.nodes.some((node) => node.stage === "failure" && node.status === "failed"),
      ambiguousExternalOutcome: input.replay.completeness.status !== "complete" || input.replay.nodes.some((node) => node.stage === "missing"),
      explicitlyIncomplete: input.replay.truncated.nodes || input.replay.truncated.edges || input.replay.truncated.actionEvents || input.replay.truncated.computerArtifacts,
    },
  };
}

export function externalObservationEvent(observation: ExternalEffectObservation): RawEvidenceEvent {
  return {
    eventId: `external_observation:${observation.businessEffectId}:${observation.provider}:${observation.observedAt}`,
    tenantId: observation.tenantId,
    evidenceClass: "REAL_EXECUTION",
    sourceKind: observation.evidence.mechanism === "webhook" ? "WEBHOOK_OBSERVATION" : "EXTERNAL_OBSERVATION",
    sourceRef: observation.evidence.providerEventId ?? `business_effect:${observation.businessEffectId}:observation`,
    occurredAt: observation.observedAt,
    semanticKind: observation.classification === "present" ? "VERIFICATION" : "OBSERVATION",
    operation: { name: "observe.external_effect", equivalenceClass: `observe:${observation.externalObjectType}`, providerClass: observation.provider },
    inputs: [{ path: "observation.expected", value: observation.expected, role: "SOURCE" }],
    outputs: observation.observed ? [{ path: "observation.actual", value: observation.observed, role: "EXTERNAL_OBSERVATION" }] : [],
    observations: [{
      kind: observation.evidence.mechanism === "webhook" ? "WEBHOOK" : "PROVIDER",
      subject: observation.externalObjectType,
      state: observation.classification === "present" ? "OBSERVED" : observation.classification === "absent" ? "ABSENT" : observation.classification === "divergent" ? "DIVERGENT" : "UNKNOWN",
      externalRealityRequired: true,
    }],
    outcome: { status: observation.classification === "present" ? "SUCCEEDED" : observation.classification === "divergent" ? "FAILED" : "UNKNOWN", verified: observation.classification === "present" },
    sourceIdentities: { businessEffectIds: [observation.businessEffectId], providerOperationIds: observation.externalId ? [observation.externalId] : [] },
  };
}

export interface ProviderOperationEvidence {
  eventId: string;
  tenantId: string;
  occurredAt: string;
  endedAt?: string;
  providerOperationId: string;
  providerClass: string;
  semanticOperation: string;
  inputs: Record<string, unknown>;
  result?: Record<string, unknown>;
  acknowledgement: boolean;
  verifiedObservation: boolean;
  status: "SUCCEEDED" | "FAILED" | "AMBIGUOUS" | "UNKNOWN";
  idempotencyKey?: string;
  businessEffectId?: string;
  possibleExternalMutation?: boolean;
}

export function providerOperationEvent(input: ProviderOperationEvidence): RawEvidenceEvent {
  return {
    eventId: input.eventId,
    tenantId: input.tenantId,
    evidenceClass: "REAL_EXECUTION",
    sourceKind: "PROVIDER_OPERATION",
    sourceRef: `provider_operation:${input.providerOperationId}`,
    occurredAt: input.occurredAt,
    endedAt: input.endedAt,
    semanticKind: "PROVIDER_OPERATION",
    operation: { name: input.semanticOperation, equivalenceClass: input.semanticOperation, providerClass: input.providerClass, consequential: true },
    inputs: [{ path: "provider.input", value: input.inputs, role: "PARAMETER" }],
    outputs: input.result ? [{ path: "provider.result", value: input.result, role: "EXTERNAL_OBSERVATION" }] : [],
    observations: input.verifiedObservation ? [{ kind: "PROVIDER", subject: input.semanticOperation, state: "OBSERVED", externalRealityRequired: true }] : [],
    outcome: {
      status: input.status,
      verified: input.verifiedObservation,
      verificationBasis: input.verifiedObservation ? "external observation" : input.acknowledgement ? "provider acknowledgement only" : null,
      failure: input.status === "AMBIGUOUS" ? { kind: "UNKNOWN_OUTCOME", reasonCode: "PROVIDER_OUTCOME_AMBIGUOUS", possibleExternalMutation: input.possibleExternalMutation ?? true, reconciliationRequired: true } : null,
    },
    sourceIdentities: {
      providerOperationIds: [input.providerOperationId],
      idempotencyKeys: input.idempotencyKey ? [input.idempotencyKey] : [],
      businessEffectIds: input.businessEffectId ? [input.businessEffectId] : [],
    },
  };
}

export interface P3TraceEvidence {
  traceId: string;
  decisionId: string;
  startedAt: string;
  completedAt: string;
  selectedActions: Array<{ actionId: string; kind: string; adapterId: string; outcome: string }>;
  finalPropositions: Array<{ id: string; status: string; evidenceCount: number }>;
  redaction: "STRUCTURED_DECISIONS_ONLY";
}

export function p3TraceEvents(tenantId: string, trace: P3TraceEvidence, evidenceClass: EvidenceClass = "REAL_EXECUTION"): RawEvidenceEvent[] {
  if (trace.redaction !== "STRUCTURED_DECISIONS_ONLY") throw new Error("P3 trace must already be structurally redacted");
  return trace.selectedActions.map((action, index) => ({
    eventId: `${trace.traceId}:action:${action.actionId}`,
    tenantId,
    evidenceClass,
    sourceKind: "P3_EPISTEMIC_TRACE",
    sourceRef: trace.traceId,
    occurredAt: index === trace.selectedActions.length - 1 ? trace.completedAt : trace.startedAt,
    semanticKind: action.kind === "WAIT" ? "WAIT" : action.kind === "ASK" ? "APPROVAL_GATE" : "OBSERVATION",
    operation: { name: `information.${action.kind.toLowerCase()}`, equivalenceClass: action.adapterId },
    observations: [{ kind: action.adapterId.includes("COMPUTER") ? "COMPUTER" : action.adapterId.includes("PROVIDER") ? "PROVIDER" : "CANONICAL", subject: action.adapterId, state: action.outcome === "SUCCEEDED" ? "OBSERVED" : "UNKNOWN", externalRealityRequired: true }],
    outcome: { status: action.outcome === "SUCCEEDED" ? "SUCCEEDED" : action.outcome === "FAILED" ? "FAILED" : "UNKNOWN", verified: false },
    sourceIdentities: { other: [{ domain: "p3_epistemic_trace", id: trace.traceId }, { domain: "p3_decision", id: trace.decisionId }] },
  }));
}

export interface P4ReceiptEvidence {
  receiptId: string;
  decisionId: string;
  recordedAt: string;
  selectedProgramHash: string | null;
  candidateOrigins: Array<{ candidateId: string; programHash: string }>;
  status: string;
  redaction: "STRUCTURED_DECISIONS_ONLY";
}

export function p4ReceiptEvent(tenantId: string, receipt: P4ReceiptEvidence, evidenceClass: EvidenceClass = "REAL_EXECUTION"): RawEvidenceEvent {
  if (receipt.redaction !== "STRUCTURED_DECISIONS_ONLY") throw new Error("P4 receipt must already be structurally redacted");
  return {
    eventId: receipt.receiptId,
    tenantId,
    evidenceClass,
    sourceKind: "P4_PROGRAM_SEARCH_RECEIPT",
    sourceRef: receipt.receiptId,
    occurredAt: receipt.recordedAt,
    semanticKind: "MODEL_DECISION",
    operation: { name: "select.operational_program", equivalenceClass: "P4_PROGRAM_SEARCH" },
    inputs: [{ path: "program.candidates", value: receipt.candidateOrigins.map((candidate) => candidate.programHash), role: "SOURCE", sensitivity: "TENANT_INTERNAL" }],
    outputs: receipt.selectedProgramHash ? [{ path: "program.selected_hash", value: receipt.selectedProgramHash, role: "MODEL_DECISION", sensitivity: "TENANT_INTERNAL" }] : [],
    modelDecision: { purpose: "bounded operational program selection", inputSchema: ["ProgramCandidate[]", "HardConstraint[]"], outputSchema: "OperationalProgramHash|null", constraints: ["P2_ADMISSIBLE", "P3_RESOLVED"] },
    outcome: { status: receipt.status === "SELECTED" ? "SUCCEEDED" : "UNKNOWN", verified: false },
    sourceIdentities: { operationalIrSemanticHashes: receipt.selectedProgramHash ? [receipt.selectedProgramHash] : [], other: [{ domain: "p4_receipt", id: receipt.receiptId }, { domain: "p4_decision", id: receipt.decisionId }] },
  };
}

export interface P5SimulationEvidence {
  traceId: string;
  replayIdentity: string;
  tenantId: string;
  programIrSemanticHash: string;
  snapshotProvenance: { asOf: string };
  status: string;
  branchOutcomes: Array<{ outcome: string }>;
}

export function p5SimulationEvents(simulation: P5SimulationEvidence): RawEvidenceEvent[] {
  return simulation.branchOutcomes.map((outcome, index) => ({
    eventId: `${simulation.traceId}:branch:${index}`,
    tenantId: simulation.tenantId,
    evidenceClass: "SIMULATED_EXECUTION",
    sourceKind: "P5_SIMULATION_TRACE",
    sourceRef: simulation.replayIdentity,
    occurredAt: simulation.snapshotProvenance.asOf,
    semanticKind: "MODEL_DECISION",
    operation: { name: "simulate.operational_program", equivalenceClass: `simulation:${index}` },
    modelDecision: { purpose: "predict bounded world branch", inputSchema: ["WorldSnapshot", "OperationalProgram"], outputSchema: "BranchOutcome", constraints: ["HYPOTHETICAL_ONLY"] },
    outcome: { status: outcome.outcome === "PREDICTED_SUCCESS" ? "SUCCEEDED" : outcome.outcome === "PREDICTED_FAILURE" ? "FAILED" : outcome.outcome === "PREDICTED_PARTIAL" ? "PARTIAL" : "UNKNOWN", verified: false, verificationBasis: "P5 predicted only" },
    sourceIdentities: { operationalIrSemanticHashes: [simulation.programIrSemanticHash], p5SimulationTraceIds: [simulation.traceId], other: [{ domain: "p5_replay", id: simulation.replayIdentity }] },
  }));
}

export function decisionReceiptEvent(tenantId: string, receipt: DecisionReceipt, occurredAt: string): RawEvidenceEvent {
  return {
    eventId: `decision_receipt:${receipt.id}`,
    tenantId,
    evidenceClass: "REAL_EXECUTION",
    sourceKind: "DECISION_RECEIPT",
    sourceRef: `decision_receipt:${receipt.id}`,
    occurredAt,
    semanticKind: receipt.failure ? "FAILURE" : "OBSERVATION",
    operation: { name: "decision.receipt", equivalenceClass: "decision-receipt" },
    inputs: [{ path: "receipt.proposed", value: receipt.proposedAction, role: "SOURCE" }],
    outputs: receipt.actualResult ? [{ path: "receipt.actual", value: receipt.actualResult, role: "EXTERNAL_OBSERVATION" }] : [],
    authority: { approvalRequired: receipt.approval.required, approvalStatus: receipt.approval.required ? receipt.approval.approvedBy ? "APPROVED" : "UNKNOWN" : "NOT_REQUIRED" },
    outcome: receipt.failure ? { status: "FAILED", verified: false, failure: { kind: receipt.failure.errorKind.toUpperCase() as NonNullable<NonNullable<RawEvidenceEvent["outcome"]>["failure"]>["kind"], reasonCode: receipt.failure.message, possibleExternalMutation: receipt.failure.errorKind === "unknown_outcome", reconciliationRequired: receipt.failure.errorKind === "unknown_outcome" } } : { status: receipt.actualResult ? "SUCCEEDED" : "UNKNOWN", verified: false },
    sourceIdentities: { businessEffectIds: receipt.businessEffectId ? [receipt.businessEffectId] : [], decisionReceiptIds: [receipt.id], workflowRunIds: receipt.workflowRunId ? [receipt.workflowRunId] : [], workflowStepIds: receipt.stepId ? [receipt.stepId] : [] },
  };
}

export function bundleFromEvents(input: {
  tenantId: string;
  operationIdentity: TraceOperationIdentity;
  startedAt: string;
  endedAt?: string;
  events: RawEvidenceEvent[];
  completion: CompletionEvidence;
}): SourceTraceBundle {
  return { ...input, operationIdentity: identity(input.operationIdentity) };
}

export const TRACE_SOURCE_OWNERS: ReadonlyArray<{ sourceKind: TraceSourceKind; owner: string; path: string }> = Object.freeze([
  { sourceKind: "WORK", owner: "@finnor/db", path: "packages/db/schema.ts:works/workInputs/workEvents/workQueryExecutions/workObjectiveLoops" },
  { sourceKind: "WORK_EVENT", owner: "@finnor/db", path: "packages/db/schema.ts:workEvents" },
  { sourceKind: "OBJECTIVE_RUNTIME", owner: "@finnor/orchestration", path: "packages/orchestration/src/objective-loop.ts + packages/orchestration/src/objective-success.ts" },
  { sourceKind: "BUSINESS_EFFECT", owner: "@finnor/shared-types + @finnor/orchestration", path: "packages/shared-types/src/business-effects.ts + packages/orchestration/src/compiler.ts" },
  { sourceKind: "AUTHORIZED_COMMAND", owner: "@finnor/workflow-runtime", path: "packages/workflow-runtime/src/commands.ts" },
  { sourceKind: "WORKFLOW_STEP", owner: "@finnor/workflow-runtime", path: "packages/workflow-runtime/src/steps.ts" },
  { sourceKind: "DURABLE_JOB", owner: "@finnor/db + @finnor/workflow-runtime", path: "packages/db/schema.ts:jobs/outboxEvents/inboxEvents + packages/workflow-runtime/src" },
  { sourceKind: "DECISION_RECEIPT", owner: "@finnor/workflow-runtime", path: "packages/workflow-runtime/src/receipts.ts" },
  { sourceKind: "CAUSAL_REPLAY", owner: "@finnor/read-models", path: "packages/read-models/src/causal-replay.ts" },
  { sourceKind: "EXECUTION_PROJECTION", owner: "@finnor/read-models", path: "packages/read-models/src/execution-projection.ts" },
  { sourceKind: "PROVIDER_OPERATION", owner: "@finnor/workflow-runtime", path: "packages/workflow-runtime/src/steps.ts:integrationOperations" },
  { sourceKind: "WEBHOOK_OBSERVATION", owner: "@finnor/data-platform", path: "packages/db/schema.ts:webhookReceipts/integrationEvents + packages/data-platform/src/source-truth.ts" },
  { sourceKind: "EXTERNAL_OBSERVATION", owner: "@finnor/data-platform + @finnor/orchestration", path: "packages/data-platform/src/source-truth.ts + packages/orchestration/src/external-observation.ts" },
  { sourceKind: "COMPUTER_TRACE", owner: "@finnor/computer", path: "packages/computer/src/contracts.ts + packages/computer/src/repository.ts" },
  { sourceKind: "OPERATIONAL_QUERY", owner: "@finnor/orchestration + @finnor/read-models", path: "packages/db/schema.ts:workQueryExecutions + packages/orchestration/src/index.ts" },
  { sourceKind: "AUTHORITY_DECISION", owner: "@finnor/authority", path: "packages/authority/src/index.ts" },
  { sourceKind: "HUMAN_APPROVAL", owner: "@finnor/authority", path: "packages/db/schema.ts:authorityApprovalRequests + packages/authority/src/index.ts" },
  { sourceKind: "RECONCILIATION", owner: "@finnor/workflow-runtime", path: "packages/workflow-runtime/src/reconciliation.ts" },
  { sourceKind: "COMPENSATION", owner: "@finnor/workflow-runtime", path: "packages/workflow-runtime/src/compensation.ts" },
  { sourceKind: "INSTRUCTION_EVENT", owner: "@finnor/orchestration + @finnor/db", path: "packages/orchestration/src/instruction-trace.ts + packages/db/schema.ts:instructionSessions/instructionEvents" },
  { sourceKind: "P3_EPISTEMIC_TRACE", owner: "@finnor/epistemic-runtime", path: "packages/epistemic-runtime/src/trace.ts" },
  { sourceKind: "P4_PROGRAM_SEARCH_RECEIPT", owner: "@finnor/program-search", path: "packages/program-search/src/trace.ts" },
  { sourceKind: "P5_SIMULATION_TRACE", owner: "@finnor/speculative-runtime", path: "packages/speculative-runtime/src/contracts.ts + packages/speculative-runtime/src/replay.ts" },
  { sourceKind: "REPLAY_FIXTURE", owner: "phase-locked test corpora", path: "architecture/p0/replay-corpus.json through architecture/p6/replay-corpus.json" },
]);
