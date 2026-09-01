import type {
  RawEvidenceEvent,
  SourceTraceBundle,
  TraceAuthorityContext,
  TraceCompilerOptions,
  TraceEdge,
  TraceFailure,
  TraceNode,
  TraceNodeOutcome,
  TracePredicate,
  TraceValue,
  ExecutionTrace,
} from "./contracts";
import {
  ALIGNMENT_VERSION,
  ANTI_UNIFIER_VERSION,
  DATAFLOW_VERSION,
  NORMALIZER_VERSION,
  TRACE_ID_PREFIX,
  TRACE_IR_VERSION,
} from "./contracts";
import {
  assertIsoTimestamp,
  canonicalSerialize,
  compareIsoThenId,
  mergeSourceIdentities,
  prefixedHash,
  stableUnique,
} from "./canonical";
import { reconstructDataflow, traceBoundaryValues } from "./dataflow";
import {
  emptyRedactionCounter,
  expandSemanticValueInput,
  redactSemanticValue,
  redactionSummary,
} from "./redaction";
import { validateNormalizedTrace } from "./validity";

const EMPTY_PARENTS = {
  control: [],
  causal: [],
  observationOf: [],
  authorityFor: [],
  temporalAfter: [],
  retryOf: [],
  compensationFor: [],
} as const;

function nodeId(event: RawEvidenceEvent): string {
  return prefixedHash("p6:node:sha256:", { eventId: event.eventId, sourceKind: event.sourceKind, sourceRef: event.sourceRef });
}

function normalizeAuthority(event: RawEvidenceEvent): TraceAuthorityContext {
  const authority = event.authority ?? {};
  return {
    requirementObserved: authority.requirementObserved ?? (event.semanticKind === "AUTHORITY_GATE" || event.semanticKind === "APPROVAL_GATE"),
    capability: authority.capability ?? null,
    risk: authority.risk ?? "UNKNOWN",
    authorityState: authority.authorityState ?? "UNKNOWN",
    decisionId: authority.decisionId ?? null,
    revision: authority.revision ?? null,
    approvalRequired: authority.approvalRequired ?? (event.semanticKind === "APPROVAL_GATE"),
    approvalStatus: authority.approvalStatus ?? "UNKNOWN",
    grantsAuthority: false,
  };
}

function normalizeFailure(failure: Partial<TraceFailure> | null | undefined): TraceFailure | null {
  if (!failure) return null;
  return {
    kind: failure.kind ?? "UNKNOWN",
    reasonCode: failure.reasonCode ?? "UNKNOWN_FAILURE",
    possibleExternalMutation: failure.possibleExternalMutation ?? false,
    reconciliationRequired: failure.reconciliationRequired ?? false,
  };
}

function normalizeOutcome(event: RawEvidenceEvent): TraceNodeOutcome {
  const outcome = event.outcome;
  return {
    status: outcome?.status ?? "UNKNOWN",
    verified: outcome?.verified ?? false,
    verificationBasis: outcome?.verificationBasis ?? null,
    failure: normalizeFailure(outcome?.failure),
  };
}

function normalizeValues(
  event: RawEvidenceEvent,
  direction: "input" | "output",
  options: TraceCompilerOptions,
  counter: ReturnType<typeof emptyRedactionCounter>,
): TraceValue[] {
  const values = direction === "input" ? event.inputs ?? [] : event.outputs ?? [];
  return values.flatMap(expandSemanticValueInput).map((value) => redactSemanticValue(value, {
    tenantId: event.tenantId,
    nodeId: nodeId(event),
    direction,
    evidenceId: event.eventId,
    sourceRef: event.sourceRef,
    equalitySalt: options.equalitySalt,
  }, counter)).sort((left, right) => `${left.path}:${left.valueId}`.localeCompare(`${right.path}:${right.valueId}`));
}

function normalizePredicates(
  event: RawEvidenceEvent,
  options: TraceCompilerOptions,
  counter: ReturnType<typeof emptyRedactionCounter>,
): TracePredicate[] {
  return (event.predicates ?? []).map((predicate, index) => {
    const expected = predicate.expected === undefined ? null : redactSemanticValue({
      path: `${predicate.subjectPath}.expected`,
      value: predicate.expected,
      role: "CONSTANT",
    }, {
      tenantId: event.tenantId,
      nodeId: nodeId(event),
      direction: "input",
      evidenceId: event.eventId,
      sourceRef: event.sourceRef,
      equalitySalt: options.equalitySalt,
    }, counter).representation;
    return {
      predicateId: predicate.predicateId ?? prefixedHash("p6:predicate:sha256:", {
        eventId: event.eventId,
        index,
        subjectPath: predicate.subjectPath,
        operator: predicate.operator,
        expected,
      }),
      subjectPath: predicate.subjectPath,
      operator: predicate.operator,
      expected,
      state: predicate.state,
      safetyCritical: predicate.safetyCritical ?? false,
      evidenceIds: [event.eventId],
    };
  }).sort((left, right) => left.predicateId.localeCompare(right.predicateId));
}

function normalizeNode(
  event: RawEvidenceEvent,
  options: TraceCompilerOptions,
  counter: ReturnType<typeof emptyRedactionCounter>,
): TraceNode {
  assertIsoTimestamp(event.occurredAt, `${event.eventId}.occurredAt`);
  if (event.endedAt) assertIsoTimestamp(event.endedAt, `${event.eventId}.endedAt`);
  const started = Date.parse(event.occurredAt);
  const ended = event.endedAt ? Date.parse(event.endedAt) : null;
  return {
    nodeId: nodeId(event),
    semanticKind: event.semanticKind,
    operation: {
      name: event.operation.name,
      equivalenceClass: event.operation.equivalenceClass ?? event.operation.name,
      effectClass: event.operation.effectClass ?? null,
      consequential: event.operation.consequential ?? false,
      providerClass: event.operation.providerClass ?? null,
    },
    inputs: normalizeValues(event, "input", options, counter),
    outputs: normalizeValues(event, "output", options, counter),
    predicates: normalizePredicates(event, options, counter),
    observations: (event.observations ?? []).map((observation, index) => ({
      observationId: observation.observationId ?? prefixedHash("p6:observation:sha256:", { eventId: event.eventId, index, observation }),
      kind: observation.kind,
      subject: observation.subject,
      state: observation.state,
      externalRealityRequired: observation.externalRealityRequired ?? observation.kind !== "MODEL_OUTPUT",
      evidenceIds: [event.eventId],
    })).sort((left, right) => left.observationId.localeCompare(right.observationId)),
    authorityContext: normalizeAuthority(event),
    timing: {
      startedAt: event.occurredAt,
      endedAt: event.endedAt ?? null,
      durationMs: ended === null ? null : ended - started,
    },
    outcome: normalizeOutcome(event),
    retry: event.retry ? { ...event.retry } : null,
    loop: event.loop ? { ...event.loop } : null,
    wait: event.wait ? { ...event.wait } : null,
    branch: event.branch ? { ...event.branch } : null,
    modelDecision: event.modelDecision ? {
      purpose: event.modelDecision.purpose,
      inputSchema: stableUnique(event.modelDecision.inputSchema),
      outputSchema: event.modelDecision.outputSchema,
      constraints: stableUnique(event.modelDecision.constraints),
      hiddenReasoningPersisted: false,
    } : null,
    provenance: {
      evidenceClass: event.evidenceClass,
      sourceKind: event.sourceKind,
      evidenceIds: [event.eventId],
      sourceRefs: [event.sourceRef],
      sourceIdentities: mergeSourceIdentities(event.sourceIdentities),
      uncertainty: stableUnique(event.uncertainty ?? []),
      synthetic: event.evidenceClass !== "REAL_EXECUTION",
    },
  };
}

function rawEventIndex(events: RawEvidenceEvent[]): Map<string, RawEvidenceEvent> {
  const result = new Map<string, RawEvidenceEvent>();
  for (const event of events) if (!result.has(event.eventId)) result.set(event.eventId, event);
  return result;
}

function buildEdges(events: RawEvidenceEvent[], nodes: TraceNode[]): TraceEdge[] {
  const byEvent = rawEventIndex(events);
  const nodeByEvent = new Map([...byEvent].map(([eventId, event]) => [eventId, nodeId(event)]));
  const actualNodeByEvent = new Map<string, TraceNode>();
  for (const event of events) {
    if (!actualNodeByEvent.has(event.eventId)) actualNodeByEvent.set(event.eventId, nodes.find((node) => node.nodeId === nodeId(event))!);
  }
  const edges: TraceEdge[] = [];
  const add = (
    fromEventId: string,
    toEventId: string,
    kind: TraceEdge["kind"],
    certainty: TraceEdge["certainty"],
    valueBindings: TraceEdge["valueBindings"] = [],
  ) => {
    const from = nodeByEvent.get(fromEventId) ?? prefixedHash("p6:node:sha256:", { missingEventId: fromEventId });
    const to = nodeByEvent.get(toEventId) ?? prefixedHash("p6:node:sha256:", { missingEventId: toEventId });
    const evidenceIds = stableUnique([fromEventId, toEventId]);
    edges.push({
      edgeId: prefixedHash("p6:edge:sha256:", { from, to, kind, certainty, valueBindings }),
      from,
      to,
      kind,
      valueBindings,
      certainty,
      evidenceIds,
    });
  };

  for (const event of events) {
    const parents = { ...EMPTY_PARENTS, ...event.parents };
    for (const parent of parents.control) add(parent, event.eventId, "CONTROL", "PROVEN");
    for (const parent of parents.causal) add(parent, event.eventId, "CAUSAL", "PROVEN");
    for (const parent of parents.observationOf) add(parent, event.eventId, "OBSERVATION", "PROVEN");
    for (const parent of parents.authorityFor) add(parent, event.eventId, "AUTHORITY", "PROVEN");
    for (const parent of parents.temporalAfter) add(parent, event.eventId, "TEMPORAL", "PROVEN");
    for (const parent of parents.retryOf) add(parent, event.eventId, "RETRY", "PROVEN");
    for (const parent of parents.compensationFor) add(parent, event.eventId, "COMPENSATION", "PROVEN");
    for (const binding of event.dataBindings ?? []) {
      const producer = actualNodeByEvent.get(binding.fromEventId);
      const consumer = actualNodeByEvent.get(event.eventId);
      const fromValue = producer?.outputs.find((value) => value.path === binding.fromPath);
      const toValue = consumer?.inputs.find((value) => value.path === binding.toPath);
      add(binding.fromEventId, event.eventId, "DATA", "PROVEN", fromValue && toValue ? [{
        fromValueId: fromValue.valueId,
        toValueId: toValue.valueId,
        derivation: binding.derivation,
        ruleRef: binding.ruleRef ?? null,
      }] : []);
    }
  }

  const ordered = [...events].sort(compareIsoThenId);
  for (let index = 1; index < ordered.length; index += 1) {
    const previous = ordered[index - 1]!;
    const current = ordered[index]!;
    if (previous.eventId !== current.eventId && Date.parse(previous.occurredAt) < Date.parse(current.occurredAt)) {
      add(previous.eventId, current.eventId, "TEMPORAL", "INFERRED");
    }
  }
  return edges.sort((left, right) => `${left.from}:${left.to}:${left.kind}:${left.edgeId}`.localeCompare(`${right.from}:${right.to}:${right.kind}:${right.edgeId}`));
}

export function normalizeExecutionTrace(bundle: SourceTraceBundle, options: TraceCompilerOptions): ExecutionTrace {
  assertIsoTimestamp(bundle.startedAt, "bundle.startedAt");
  assertIsoTimestamp(options.fixedClock, "options.fixedClock");
  if (bundle.endedAt) assertIsoTimestamp(bundle.endedAt, "bundle.endedAt");
  if (!Number.isInteger(options.seed)) throw new Error("Trace compiler seed must be an integer");
  if (!options.equalitySalt) throw new Error("Trace compiler equalitySalt is required");
  const redactionCounter = emptyRedactionCounter();
  const orderedEvents = [...bundle.events].sort(compareIsoThenId);
  const nodes = orderedEvents.map((event) => normalizeNode(event, options, redactionCounter));
  const baseEdges = buildEdges(orderedEvents, nodes);
  const dataflow = reconstructDataflow(nodes, baseEdges);
  const evidenceClasses = stableUnique(orderedEvents.map((event) => event.evidenceClass));
  const tenantMismatch = orderedEvents.some((event) => event.tenantId !== bundle.tenantId);
  const validation = validateNormalizedTrace(nodes, dataflow.edges, bundle.completion, evidenceClasses, tenantMismatch);
  const boundaries = traceBoundaryValues(nodes, dataflow.edges);
  const sourceIdentities = mergeSourceIdentities(...nodes.map((node) => node.provenance.sourceIdentities));
  const normalizedCore = {
    tenantId: bundle.tenantId,
    operationIdentity: bundle.operationIdentity,
    startedAt: bundle.startedAt,
    endedAt: bundle.endedAt ?? null,
    outcome: validation.outcome,
    nodes,
    edges: dataflow.edges,
    inputs: boundaries.inputs,
    outputs: boundaries.outputs,
    evidenceClasses,
    sourceIdentities,
    completion: bundle.completion,
  };
  const sourceEvidenceHash = prefixedHash("p6:evidence:sha256:", normalizedCore);
  const traceId = prefixedHash(TRACE_ID_PREFIX, { ...normalizedCore, sourceEvidenceHash });
  const uncertainty = stableUnique([
    ...orderedEvents.flatMap((event) => event.uncertainty ?? []),
    ...validation.issues.map((issue) => issue.code),
    ...dataflow.unresolvedDerivedValues.map(() => "DERIVED_VALUE_PROVENANCE_INCOMPLETE"),
  ]);
  return {
    version: TRACE_IR_VERSION,
    traceId,
    tenantId: bundle.tenantId,
    operationIdentity: {
      ...bundle.operationIdentity,
      sourceOperationRefs: stableUnique(bundle.operationIdentity.sourceOperationRefs),
    },
    startedAt: bundle.startedAt,
    endedAt: bundle.endedAt ?? null,
    outcome: validation.outcome,
    nodes,
    edges: dataflow.edges,
    inputs: boundaries.inputs,
    outputs: boundaries.outputs,
    provenance: {
      evidenceClasses,
      sourceKinds: stableUnique(orderedEvents.map((event) => event.sourceKind)),
      sourceIdentities,
      sourceEvidenceHash,
      compiler: {
        traceIrVersion: TRACE_IR_VERSION,
        normalizerVersion: options.normalizerVersion ?? NORMALIZER_VERSION,
        dataflowVersion: options.dataflowVersion ?? DATAFLOW_VERSION,
        seed: options.seed,
        fixedClock: options.fixedClock,
      },
      redaction: redactionSummary(redactionCounter),
      uncertainty,
    },
  };
}

export function defaultTraceCompilerOptions(input: Pick<TraceCompilerOptions, "fixedClock" | "seed" | "equalitySalt">): TraceCompilerOptions {
  return {
    ...input,
    normalizerVersion: NORMALIZER_VERSION,
    dataflowVersion: DATAFLOW_VERSION,
    alignmentVersion: ALIGNMENT_VERSION,
    antiUnifierVersion: ANTI_UNIFIER_VERSION,
  };
}

export function normalizedTraceBytes(trace: ExecutionTrace): string {
  return canonicalSerialize(trace);
}
