import type {
  AlignmentGroup,
  ExecutionTrace,
  InferredPredicate,
  ParameterClassification,
  ProcedureAuthorityRequirement,
  ProcedureBranch,
  ProcedureCompensation,
  ProcedureConstant,
  ProcedureDerivedValue,
  ProcedureLoop,
  ProcedureModelDecision,
  ProcedureObservation,
  ProcedureParameter,
  ProcedureProgramEdge,
  ProcedureRetry,
  ProcedureStep,
  ProcedureSuccessCondition,
  ProcedureWait,
  TraceAlignment,
  TraceEdge,
  TraceNode,
  TraceValue,
} from "./contracts";
import { canonicalSerialize, prefixedHash, stableUnique } from "./canonical";
import { isPositiveRealTrace, isRealTrace, supportMetrics } from "./support";

interface InferenceContext {
  traces: ExecutionTrace[];
  alignment: TraceAlignment;
  traceById: Map<string, ExecutionTrace>;
  nodeById: Map<string, TraceNode>;
  groupByNodeId: Map<string, AlignmentGroup>;
  stepIdByGroupId: Map<string, string>;
}

export interface ValueInferenceResult {
  parameters: ProcedureParameter[];
  constants: ProcedureConstant[];
  derivedValues: ProcedureDerivedValue[];
  parameterBySlot: Map<string, string>;
  constantBySlot: Map<string, string>;
  derivedBySlot: Map<string, string>;
}

export interface ControlInferenceResult {
  predicates: InferredPredicate[];
  branches: ProcedureBranch[];
  retries: ProcedureRetry[];
  loops: ProcedureLoop[];
  waits: ProcedureWait[];
  observations: ProcedureObservation[];
  authorityRequirements: ProcedureAuthorityRequirement[];
  modelDecisions: ProcedureModelDecision[];
  compensation: ProcedureCompensation[];
  successConditions: ProcedureSuccessCondition[];
}

export function inferenceContext(traces: ExecutionTrace[], alignment: TraceAlignment): InferenceContext {
  const traceById = new Map(traces.map((trace) => [trace.traceId, trace]));
  const nodeById = new Map(traces.flatMap((trace) => trace.nodes.map((node) => [node.nodeId, node] as const)));
  const groupByNodeId = new Map<string, AlignmentGroup>();
  for (const group of alignment.groups) for (const member of group.members) for (const nodeId of member.nodeIds) groupByNodeId.set(nodeId, group);
  const stepIdByGroupId = new Map(alignment.groups.map((group) => [group.groupId, prefixedHash("p6:procedure-step:sha256:", { alignmentId: alignment.alignmentId, groupId: group.groupId })]));
  return { traces, alignment, traceById, nodeById, groupByNodeId, stepIdByGroupId };
}

function groupNodes(context: InferenceContext, group: AlignmentGroup): Array<{ trace: ExecutionTrace; node: TraceNode }> {
  return group.members.flatMap((member) => {
    const trace = context.traceById.get(member.traceId)!;
    return member.nodeIds.map((nodeId) => ({ trace, node: context.nodeById.get(nodeId)! }));
  });
}

function slotKey(group: AlignmentGroup, value: TraceValue): string {
  return `${group.groupId}\u0000${value.path}\u0000${value.semanticType}`;
}

function traceValueMap(rows: Array<{ trace: ExecutionTrace; value: TraceValue }>): Map<string, TraceValue[]> {
  const result = new Map<string, TraceValue[]>();
  for (const row of rows) result.set(row.trace.traceId, [...(result.get(row.trace.traceId) ?? []), row.value]);
  return result;
}

function classifyValues(rows: Array<{ trace: ExecutionTrace; value: TraceValue }>): ParameterClassification {
  const positive = rows.filter((row) => isPositiveRealTrace(row.trace));
  const sample = positive.length > 0 ? positive : rows;
  if (sample.some((row) => row.value.role === "DERIVED")) return "DERIVED_PARAMETER";
  if (sample.some((row) => row.value.bindingScope === "ENVIRONMENT")) return "ENVIRONMENT_BOUND";
  if (sample.some((row) => row.value.bindingScope === "TENANT")) return "TENANT_BOUND";
  if (sample.some((row) => ["PII", "CUSTOMER_DATA", "FINANCIAL"].includes(row.value.sensitivity))) return "PARAMETER";
  if (sample.some((row) => row.value.role === "PARAMETER" || row.value.role === "USER_INPUT")) return "PARAMETER";
  const perTrace = traceValueMap(sample);
  const tokens = stableUnique([...perTrace.values()].flatMap((values) => values.map((value) => value.equalityToken).filter((token): token is string => Boolean(token))));
  if (perTrace.size <= 1) return "UNKNOWN";
  if (tokens.length > 1) return "PARAMETER";
  if (tokens.length === 1 && sample.every((row) => row.value.sensitivity === "PUBLIC")) return "CONSTANT";
  return "UNKNOWN";
}

export function inferValues(context: InferenceContext, includedGroupIds?: ReadonlySet<string>): ValueInferenceResult {
  const slots = new Map<string, { group: AlignmentGroup; rows: Array<{ trace: ExecutionTrace; value: TraceValue }> }>();
  for (const group of context.alignment.groups) {
    if (includedGroupIds && !includedGroupIds.has(group.groupId)) continue;
    for (const row of groupNodes(context, group)) {
      for (const value of row.node.inputs) {
        const key = slotKey(group, value);
        const slot = slots.get(key) ?? { group, rows: [] };
        slot.rows.push({ trace: row.trace, value });
        slots.set(key, slot);
      }
    }
  }
  const parameters: ProcedureParameter[] = [];
  const constants: ProcedureConstant[] = [];
  const derivedValues: ProcedureDerivedValue[] = [];
  const parameterBySlot = new Map<string, string>();
  const constantBySlot = new Map<string, string>();
  const derivedBySlot = new Map<string, string>();

  for (const [key, slot] of [...slots.entries()].sort(([left], [right]) => left.localeCompare(right))) {
    const classification = classifyValues(slot.rows);
    const supporting = stableUnique(slot.rows.map((row) => row.trace.traceId));
    const positiveRows = slot.rows.filter((row) => isPositiveRealTrace(row.trace));
    const positiveTokens = stableUnique(positiveRows.map((row) => row.value.equalityToken).filter((value): value is string => Boolean(value)));
    const contradicting = stableUnique(slot.rows.filter((row) => isRealTrace(row.trace) && !isPositiveRealTrace(row.trace)
      && classification === "CONSTANT" && row.value.equalityToken && !positiveTokens.includes(row.value.equalityToken)).map((row) => row.trace.traceId));
    const exemplar = positiveRows[0]?.value ?? slot.rows[0]!.value;
    const support = supportMetrics(context.traces, supporting, contradicting);
    if (classification === "CONSTANT" && support.realExecution.supporting >= 2 && exemplar.representation.kind === "LITERAL") {
      const constantId = prefixedHash("p6:constant:sha256:", { key, representation: exemplar.representation });
      constants.push({
        constantId,
        path: exemplar.path,
        semanticType: exemplar.semanticType,
        value: exemplar.representation,
        support,
        universalClaim: false,
      });
      constantBySlot.set(key, constantId);
    } else if (classification === "DERIVED_PARAMETER") {
      const valueId = prefixedHash("p6:derived-value:sha256:", { key, semanticType: exemplar.semanticType });
      const derivationRules = slot.rows.flatMap((row) => row.value.provenance.derivationRule ? [row.value.provenance.derivationRule] : [])
        .sort((left, right) => `${left.id}:${left.version}`.localeCompare(`${right.id}:${right.version}`))
        .filter((rule, index, values) => index === 0 || rule.id !== values[index - 1]!.id || rule.version !== values[index - 1]!.version);
      derivedValues.push({
        valueId,
        semanticType: exemplar.semanticType,
        sourceParameters: [],
        derivationRules,
        provenanceComplete: slot.rows.every((row) => row.value.provenance.complete),
        support,
      });
      derivedBySlot.set(key, valueId);
    } else {
      const parameterId = prefixedHash("p6:parameter:sha256:", { key, semanticType: exemplar.semanticType, classification });
      parameters.push({
        parameterId,
        path: exemplar.path,
        semanticType: exemplar.semanticType,
        classification,
        required: !slot.group.optional,
        sensitivity: exemplar.sensitivity,
        evidenceValues: new Set(slot.rows.map((row) => row.value.equalityToken ?? `${row.trace.traceId}:${row.value.valueId}`)).size,
        support,
        uncertainty: stableUnique([
          ...(classification === "UNKNOWN" ? ["INSUFFICIENT_EVIDENCE_FOR_CONSTANT_OR_PARAMETER"] : []),
          ...(support.sampleQuality === "SINGLE_TRACE_HYPOTHESIS" ? ["SINGLE_TRACE_HYPOTHESIS"] : []),
        ]),
      });
      parameterBySlot.set(key, parameterId);
    }
  }
  return {
    parameters: parameters.sort((left, right) => left.parameterId.localeCompare(right.parameterId)),
    constants: constants.sort((left, right) => left.constantId.localeCompare(right.constantId)),
    derivedValues: derivedValues.sort((left, right) => left.valueId.localeCompare(right.valueId)),
    parameterBySlot,
    constantBySlot,
    derivedBySlot,
  };
}

function predicateKey(predicate: TraceNode["predicates"][number]): string {
  return canonicalSerialize({ subjectPath: predicate.subjectPath, operator: predicate.operator, expected: predicate.expected });
}

function inferPredicates(context: InferenceContext): InferredPredicate[] {
  const rows = new Map<string, Array<{ trace: ExecutionTrace; node: TraceNode; predicate: TraceNode["predicates"][number] }>>();
  for (const trace of context.traces) for (const node of trace.nodes) for (const predicate of node.predicates) {
    const key = predicateKey(predicate);
    rows.set(key, [...(rows.get(key) ?? []), { trace, node, predicate }]);
  }
  return [...rows.entries()].map(([key, evidence]) => {
    const positives = evidence.filter((row) => isPositiveRealTrace(row.trace));
    const negatives = evidence.filter((row) => isRealTrace(row.trace) && !isPositiveRealTrace(row.trace));
    const allPositiveTrue = positives.length > 0 && positives.every((row) => row.predicate.state === "TRUE");
    const negativeContradiction = negatives.some((row) => row.predicate.state !== "TRUE");
    const branchPredicate = evidence.some((row) => Boolean(row.node.branch));
    const classification: InferredPredicate["classification"] = allPositiveTrue && negativeContradiction
      ? "OBSERVED_REQUIRED"
      : allPositiveTrue && new Set(positives.map((row) => row.trace.traceId)).size >= 2
        ? "CANDIDATE_REQUIRED"
        : evidence.some((row) => row.predicate.state !== evidence[0]!.predicate.state) && !branchPredicate
          ? "INCIDENTAL"
          : "UNKNOWN";
    const exemplar = evidence[0]!.predicate;
    const supporting = stableUnique(positives.filter((row) => row.predicate.state === "TRUE").map((row) => row.trace.traceId));
    const contradicting = stableUnique(negatives.filter((row) => row.predicate.state !== "TRUE").map((row) => row.trace.traceId));
    return {
      predicateId: prefixedHash("p6:inferred-predicate:sha256:", key),
      subjectPath: exemplar.subjectPath,
      operator: exemplar.operator,
      expected: exemplar.expected,
      classification,
      safetyCritical: evidence.some((row) => row.predicate.safetyCritical),
      support: supportMetrics(context.traces, supporting, contradicting),
      evidence: evidence.map((row) => ({ traceId: row.trace.traceId, nodeId: row.node.nodeId, state: row.predicate.state }))
        .sort((left, right) => `${left.traceId}:${left.nodeId}`.localeCompare(`${right.traceId}:${right.nodeId}`)),
    };
  }).sort((left, right) => left.predicateId.localeCompare(right.predicateId));
}

function inferBranches(context: InferenceContext): ProcedureBranch[] {
  const families = new Map<string, Array<{ trace: ExecutionTrace; node: TraceNode }>>();
  for (const trace of context.traces) for (const node of trace.nodes) if (node.branch) {
    families.set(node.branch.family, [...(families.get(node.branch.family) ?? []), { trace, node }]);
  }
  return [...families.entries()].flatMap(([family, rows]) => {
    const observedArms = stableUnique(rows.map((row) => row.node.branch!.arm));
    if (observedArms.length < 2) return [];
    const predicateIds = stableUnique(rows.map((row) => row.node.branch!.predicateId));
    if (predicateIds.length !== 1) return [];
    const arms = observedArms.map((label) => {
      const armRows = rows.filter((row) => row.node.branch!.arm === label);
      const supporting = stableUnique(armRows.map((row) => row.trace.traceId));
      return {
        label,
        observedPredicateState: armRows[0]!.node.branch!.observedPredicateState,
        stepIds: stableUnique(armRows.flatMap((row) => {
          const group = context.groupByNodeId.get(row.node.nodeId);
          return group ? [context.stepIdByGroupId.get(group.groupId)!] : [];
        })),
        outcomes: stableUnique(armRows.map((row) => row.node.outcome.status)),
        support: supportMetrics(context.traces, supporting),
      };
    });
    return [{
      branchId: prefixedHash("p6:branch:sha256:", { family, predicateId: predicateIds[0], arms: observedArms }),
      predicateId: predicateIds[0]!,
      arms,
      evidenceTraceIds: stableUnique(rows.map((row) => row.trace.traceId)),
      unseenArmsInvented: 0 as const,
    }];
  }).sort((left, right) => left.branchId.localeCompare(right.branchId));
}

function inferRetries(context: InferenceContext): ProcedureRetry[] {
  const families = new Map<string, Array<{ trace: ExecutionTrace; node: TraceNode }>>();
  for (const trace of context.traces) for (const node of trace.nodes) if (node.retry) families.set(node.retry.family, [...(families.get(node.retry.family) ?? []), { trace, node }]);
  return [...families.entries()].flatMap(([family, rows]) => {
    const byTrace = new Map<string, typeof rows>();
    for (const row of rows) byTrace.set(row.trace.traceId, [...(byTrace.get(row.trace.traceId) ?? []), row]);
    const attempts = [...byTrace.values()].map((traceRows) => Math.max(...traceRows.map((row) => row.node.retry!.attempt)));
    if (!attempts.some((count) => count > 1)) return [];
    const retryRows = rows.filter((row) => row.node.retry!.attempt > 1);
    const hasAmbiguousMutation = rows.some((row) => row.node.outcome.status === "AMBIGUOUS" || row.node.outcome.failure?.possibleExternalMutation);
    const everyIdempotent = retryRows.length > 0 && retryRows.every((row) => Boolean(row.node.retry!.idempotencyEvidence));
    const everyHuman = retryRows.length > 0 && retryRows.every((row) => row.node.retry!.humanInitiated);
    const reconciliation = retryRows.some((row) => row.node.retry!.reconciliationBeforeAttempt);
    const classification: ProcedureRetry["classification"] = everyHuman
      ? "HUMAN_RETRY"
      : reconciliation
        ? "RECONCILIATION_BEFORE_RETRY"
        : everyIdempotent && !hasAmbiguousMutation
          ? "SAFE_RETRY"
          : "UNKNOWN";
    const supporting = stableUnique(rows.filter((row) => row.node.retry!.attempt > 1).map((row) => row.trace.traceId));
    return [{
      retryId: prefixedHash("p6:retry:sha256:", { family, classification }),
      operation: stableUnique(rows.map((row) => row.node.operation.equivalenceClass))[0]!,
      trigger: stableUnique(retryRows.map((row) => row.node.retry!.trigger)).join(" | "),
      attemptCounts: [...new Set(attempts)].sort((left, right) => left - right),
      delaysMs: [...new Set(retryRows.map((row) => row.node.retry!.delayMs).filter((value): value is number => value !== null))].sort((left, right) => left - right),
      backoffEvidence: stableUnique(retryRows.map((row) => row.node.retry!.backoffEvidence).filter((value): value is string => Boolean(value))),
      terminalConditions: stableUnique([...byTrace.values()].map((traceRows) => traceRows.sort((left, right) => left.node.retry!.attempt - right.node.retry!.attempt).at(-1)!.node.outcome.status)),
      classification,
      automatic: classification === "SAFE_RETRY" || classification === "RECONCILIATION_BEFORE_RETRY",
      support: supportMetrics(context.traces, supporting),
    }];
  }).sort((left, right) => left.retryId.localeCompare(right.retryId));
}

function inferLoops(context: InferenceContext): ProcedureLoop[] {
  const families = new Map<string, Array<{ trace: ExecutionTrace; node: TraceNode }>>();
  for (const trace of context.traces) for (const node of trace.nodes) if (node.loop) families.set(node.loop.family, [...(families.get(node.loop.family) ?? []), { trace, node }]);
  return [...families.entries()].flatMap(([family, rows]) => {
    const byPositiveTrace = new Map<string, typeof rows>();
    for (const row of rows.filter((candidate) => isPositiveRealTrace(candidate.trace))) {
      byPositiveTrace.set(row.trace.traceId, [...(byPositiveTrace.get(row.trace.traceId) ?? []), row]);
    }
    const structurallyRepeated = [...byPositiveTrace.values()].filter((traceRows) => new Set(traceRows.map((row) => row.node.loop!.iteration)).size >= 2);
    if (structurallyRepeated.length < 2) return [];
    const evidenceRows = structurallyRepeated.flat();
    const iteratorSources = stableUnique(evidenceRows.map((row) => row.node.loop!.iteratorSource).filter((value): value is string => Boolean(value)));
    const terminations = stableUnique(evidenceRows.map((row) => row.node.loop!.terminationCondition).filter((value): value is string => Boolean(value)));
    if (iteratorSources.length !== 1 || terminations.length !== 1) return [];
    const orderings = stableUnique(evidenceRows.map((row) => row.node.loop!.ordering));
    const supporting = stableUnique(structurallyRepeated.map((traceRows) => traceRows[0]!.trace.traceId));
    return [{
      loopId: prefixedHash("p6:loop:sha256:", { family, iteratorSource: iteratorSources[0], termination: terminations[0] }),
      iteratorSource: iteratorSources[0]!,
      bodyStepIds: stableUnique(evidenceRows.flatMap((row) => {
        const group = context.groupByNodeId.get(row.node.nodeId);
        return group ? [context.stepIdByGroupId.get(group.groupId)!] : [];
      })),
      terminationCondition: terminations[0]!,
      ordering: orderings.length === 1 ? orderings[0]! : "UNKNOWN",
      parallelismEvidence: orderings.includes("PARALLEL") ? supporting.map((traceId) => `trace:${traceId}`) : [],
      support: supportMetrics(context.traces, supporting),
      boundedStructuralEvidence: true as const,
    }];
  }).sort((left, right) => left.loopId.localeCompare(right.loopId));
}

function inferWaits(context: InferenceContext): ProcedureWait[] {
  return context.alignment.groups.flatMap((group) => {
    const rows = groupNodes(context, group).filter((row) => row.node.wait);
    if (rows.length === 0) return [];
    const kinds = stableUnique(rows.map((row) => row.node.wait!.kind));
    const stepId = context.stepIdByGroupId.get(group.groupId)!;
    const supporting = stableUnique(rows.map((row) => row.trace.traceId));
    return [{
      waitId: prefixedHash("p6:wait:sha256:", { groupId: group.groupId, kinds }),
      stepId,
      kind: kinds.length === 1 ? kinds[0]! : "UNKNOWN",
      durationsMs: [...new Set(rows.map((row) => row.node.wait!.durationMs).filter((value): value is number => value !== null))].sort((left, right) => left - right),
      eventTypes: stableUnique(rows.map((row) => row.node.wait!.eventType).filter((value): value is string => Boolean(value))),
      deadlines: stableUnique(rows.map((row) => row.node.wait!.deadline).filter((value): value is string => Boolean(value))),
      pollIntervalsMs: [...new Set(rows.map((row) => row.node.wait!.pollIntervalMs).filter((value): value is number => value !== null))].sort((left, right) => left - right),
      terminalPredicateIds: stableUnique(rows.map((row) => row.node.wait!.terminalPredicateId).filter((value): value is string => Boolean(value))),
      support: supportMetrics(context.traces, supporting),
    }];
  }).sort((left, right) => left.waitId.localeCompare(right.waitId));
}

function inferAuthority(context: InferenceContext): ProcedureAuthorityRequirement[] {
  return context.alignment.groups.flatMap((group) => {
    const rows = groupNodes(context, group).filter((row) => row.node.authorityContext.requirementObserved
      || row.node.semanticKind === "AUTHORITY_GATE" || row.node.semanticKind === "APPROVAL_GATE");
    if (rows.length === 0) return [];
    const stepId = context.stepIdByGroupId.get(group.groupId)!;
    const risks = rows.map((row) => row.node.authorityContext.risk);
    const riskOrder = { UNKNOWN: 0, LOW: 1, MEDIUM: 2, HIGH: 3 } as const;
    const risk = [...risks].sort((left, right) => riskOrder[right] - riskOrder[left])[0] ?? "UNKNOWN";
    const capabilities = stableUnique(rows.map((row) => row.node.authorityContext.capability).filter((value): value is string => Boolean(value)));
    return [{
      requirementId: prefixedHash("p6:authority-requirement:sha256:", { groupId: group.groupId, capabilities, risk }),
      stepId,
      capability: capabilities.length === 1 ? capabilities[0]! : capabilities.length > 1 ? capabilities.join(" | ") : null,
      risk,
      approvalRequired: rows.some((row) => row.node.authorityContext.approvalRequired || row.node.semanticKind === "APPROVAL_GATE"),
      observedStatuses: stableUnique(rows.map((row) => row.node.authorityContext.approvalStatus)),
      grantsAuthority: false as const,
      support: supportMetrics(context.traces, stableUnique(rows.map((row) => row.trace.traceId))),
    }];
  }).sort((left, right) => left.requirementId.localeCompare(right.requirementId));
}

function inferObservations(context: InferenceContext): ProcedureObservation[] {
  return context.alignment.groups.flatMap((group) => {
    const rows = groupNodes(context, group).flatMap((row) => row.node.observations.map((observation) => ({ ...row, observation })));
    const keys = stableUnique(rows.map((row) => `${row.observation.kind}\u0000${row.observation.subject}\u0000${row.observation.externalRealityRequired}`));
    return keys.map((key) => {
      const matches = rows.filter((row) => `${row.observation.kind}\u0000${row.observation.subject}\u0000${row.observation.externalRealityRequired}` === key);
      const exemplar = matches[0]!.observation;
      const stepId = context.stepIdByGroupId.get(group.groupId)!;
      return {
        observationId: prefixedHash("p6:procedure-observation:sha256:", { groupId: group.groupId, key }),
        stepId,
        kind: exemplar.kind,
        subject: exemplar.subject,
        externalRealityRequired: exemplar.externalRealityRequired,
        continuationPredicateIds: stableUnique(matches.flatMap((row) => row.node.predicates.map((predicate) => predicate.predicateId))),
        support: supportMetrics(context.traces, stableUnique(matches.map((row) => row.trace.traceId))),
      };
    });
  }).sort((left, right) => left.observationId.localeCompare(right.observationId));
}

function inferModelDecisions(context: InferenceContext): ProcedureModelDecision[] {
  return context.alignment.groups.flatMap((group) => {
    const rows = groupNodes(context, group).filter((row) => row.node.modelDecision);
    if (rows.length === 0) return [];
    const stepId = context.stepIdByGroupId.get(group.groupId)!;
    const purposes = stableUnique(rows.map((row) => row.node.modelDecision!.purpose));
    const outputSchemas = stableUnique(rows.map((row) => row.node.modelDecision!.outputSchema));
    return [{
      decisionId: prefixedHash("p6:model-decision:sha256:", { groupId: group.groupId, purposes, outputSchemas }),
      stepId,
      purpose: purposes.join(" | "),
      inputSchemas: stableUnique(rows.flatMap((row) => row.node.modelDecision!.inputSchema)),
      outputSchema: outputSchemas.length === 1 ? outputSchemas[0]! : outputSchemas.join(" | "),
      constraints: stableUnique(rows.flatMap((row) => row.node.modelDecision!.constraints)),
      promptTranscriptPersisted: false as const,
      chainOfThoughtPersisted: false as const,
      support: supportMetrics(context.traces, stableUnique(rows.map((row) => row.trace.traceId))),
    }];
  }).sort((left, right) => left.decisionId.localeCompare(right.decisionId));
}

function inferCompensation(context: InferenceContext): ProcedureCompensation[] {
  const result: ProcedureCompensation[] = [];
  for (const group of context.alignment.groups) {
    const rows = groupNodes(context, group).filter((row) => row.node.semanticKind === "COMPENSATION");
    if (rows.length === 0) continue;
    const stepId = context.stepIdByGroupId.get(group.groupId)!;
    const compensated = stableUnique(rows.flatMap((row) => row.trace.edges
      .filter((edge) => edge.kind === "COMPENSATION" && edge.to === row.node.nodeId)
      .flatMap((edge) => {
        const sourceGroup = context.groupByNodeId.get(edge.from);
        return sourceGroup ? [context.stepIdByGroupId.get(sourceGroup.groupId)!] : [];
      })));
    result.push({
      compensationId: prefixedHash("p6:procedure-compensation:sha256:", { groupId: group.groupId, compensated }),
      stepId,
      compensatesStepIds: compensated,
      operation: group.operation,
      support: supportMetrics(context.traces, stableUnique(rows.map((row) => row.trace.traceId))),
    });
  }
  return result.sort((left, right) => left.compensationId.localeCompare(right.compensationId));
}

function inferSuccessConditions(context: InferenceContext): ProcedureSuccessCondition[] {
  return context.alignment.groups.flatMap((group) => {
    const rows = groupNodes(context, group).filter((row) => row.node.semanticKind === "SUCCESS_CONDITION" || (row.node.semanticKind === "VERIFICATION" && row.node.outcome.verified));
    if (rows.length === 0) return [];
    const stepId = context.stepIdByGroupId.get(group.groupId)!;
    return [{
      conditionId: prefixedHash("p6:success-condition:sha256:", { groupId: group.groupId, operation: group.operation }),
      stepId,
      operation: group.operation,
      requiresVerifiedReality: rows.some((row) => row.node.outcome.verified || row.node.observations.some((observation) => observation.externalRealityRequired)),
      support: supportMetrics(context.traces, stableUnique(rows.map((row) => row.trace.traceId))),
    }];
  }).sort((left, right) => left.conditionId.localeCompare(right.conditionId));
}

export function inferControlAndSafety(context: InferenceContext): ControlInferenceResult {
  return {
    predicates: inferPredicates(context),
    branches: inferBranches(context),
    retries: inferRetries(context),
    loops: inferLoops(context),
    waits: inferWaits(context),
    observations: inferObservations(context),
    authorityRequirements: inferAuthority(context),
    modelDecisions: inferModelDecisions(context),
    compensation: inferCompensation(context),
    successConditions: inferSuccessConditions(context),
  };
}

export function buildProcedureStructure(
  context: InferenceContext,
  values: ValueInferenceResult,
  control: ControlInferenceResult,
  includedGroupIds?: ReadonlySet<string>,
): { steps: ProcedureStep[]; edges: ProcedureProgramEdge[] } {
  const authorityByStep = new Map<string, string[]>();
  for (const requirement of control.authorityRequirements) authorityByStep.set(requirement.stepId, [...(authorityByStep.get(requirement.stepId) ?? []), requirement.requirementId]);
  const observationsByStep = new Map<string, string[]>();
  for (const observation of control.observations) observationsByStep.set(observation.stepId, [...(observationsByStep.get(observation.stepId) ?? []), observation.observationId]);
  const predicateByRawId = new Map(control.predicates.flatMap((predicate) => predicate.evidence.map((evidence) => [
    `${evidence.traceId}\u0000${evidence.nodeId}`,
    predicate.predicateId,
  ] as const)));
  const steps = context.alignment.groups.filter((group) => !includedGroupIds || includedGroupIds.has(group.groupId)).map((group) => {
    const rows = groupNodes(context, group);
    const parameterRefs = stableUnique(rows.flatMap((row) => row.node.inputs.flatMap((value) => {
      const ref = values.parameterBySlot.get(slotKey(group, value));
      return ref ? [ref] : [];
    })));
    const constantRefs = stableUnique(rows.flatMap((row) => row.node.inputs.flatMap((value) => {
      const ref = values.constantBySlot.get(slotKey(group, value));
      return ref ? [ref] : [];
    })));
    const derivedValueRefs = stableUnique(rows.flatMap((row) => row.node.inputs.flatMap((value) => {
      const ref = values.derivedBySlot.get(slotKey(group, value));
      return ref ? [ref] : [];
    })));
    const stepId = context.stepIdByGroupId.get(group.groupId)!;
    return {
      stepId,
      semanticKind: group.semanticKind,
      operation: group.operation,
      equivalenceClass: group.operation,
      optional: group.safetyCritical ? false : group.optional,
      consequential: rows.some((row) => row.node.operation.consequential),
      parameterRefs,
      constantRefs,
      derivedValueRefs,
      predicateRefs: stableUnique(rows.flatMap((row) => {
        const inferred = predicateByRawId.get(`${row.trace.traceId}\u0000${row.node.nodeId}`);
        return inferred ? [inferred] : [];
      })),
      authorityRequirementRefs: stableUnique(authorityByStep.get(stepId) ?? []),
      observationRefs: stableUnique(observationsByStep.get(stepId) ?? []),
      sourceAlignmentGroupId: group.groupId,
    };
  }).sort((left, right) => left.stepId.localeCompare(right.stepId));

  const edgeRows = new Map<string, Array<{ trace: ExecutionTrace; certainty: TraceEdge["certainty"] }>>();
  for (const trace of context.traces) for (const edge of trace.edges) {
    const fromGroup = context.groupByNodeId.get(edge.from);
    const toGroup = context.groupByNodeId.get(edge.to);
    if (!fromGroup || !toGroup || fromGroup.groupId === toGroup.groupId) continue;
    if (includedGroupIds && (!includedGroupIds.has(fromGroup.groupId) || !includedGroupIds.has(toGroup.groupId))) continue;
    const from = context.stepIdByGroupId.get(fromGroup.groupId)!;
    const to = context.stepIdByGroupId.get(toGroup.groupId)!;
    const key = `${from}\u0000${to}\u0000${edge.kind}`;
    edgeRows.set(key, [...(edgeRows.get(key) ?? []), { trace, certainty: edge.certainty }]);
  }
  const conflictingInferredTemporalKeys = new Set<string>();
  for (const [key, rows] of edgeRows) {
    const [from, to, kind] = key.split("\u0000") as [string, string, ProcedureProgramEdge["kind"]];
    if (kind !== "TEMPORAL" || rows.some((row) => row.certainty === "PROVEN")) continue;
    const reverseKey = `${to}\u0000${from}\u0000TEMPORAL`;
    const reverse = edgeRows.get(reverseKey);
    if (reverse && reverse.every((row) => row.certainty !== "PROVEN")) {
      conflictingInferredTemporalKeys.add(key);
      conflictingInferredTemporalKeys.add(reverseKey);
    }
  }
  const edges = [...edgeRows.entries()].filter(([key]) => !conflictingInferredTemporalKeys.has(key)).map(([key, rows]) => {
    const [from, to, kind] = key.split("\u0000") as [string, string, ProcedureProgramEdge["kind"]];
    return {
      from,
      to,
      kind,
      support: supportMetrics(context.traces, stableUnique(rows.map((row) => row.trace.traceId))),
    };
  }).sort((left, right) => `${left.from}:${left.to}:${left.kind}`.localeCompare(`${right.from}:${right.to}:${right.kind}`));
  return { steps, edges };
}
