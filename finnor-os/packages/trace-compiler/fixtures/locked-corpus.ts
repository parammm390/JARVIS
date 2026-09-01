import assert from "node:assert/strict";
import manifest from "./locked-cases.json";
import type {
  CompileProcedureResult,
  EvidenceClass,
  RawEvidenceEvent,
  SourceTraceBundle,
  TraceCompilerOptions,
  TraceOperationIdentity,
} from "../src/contracts";
import { bundleFromEvents } from "../src/adapters";
import { compileProcedureCandidate } from "../src/compiler";
import { defaultTraceCompilerOptions, normalizeExecutionTrace } from "../src/normalize";
import { canonicalSerialize } from "../src/canonical";

export const P6_FIXED_CLOCK = manifest.fixedClock;
export const P6_SEED = manifest.seed;
export const P6_LOCKED_CASES = manifest.cases;
export const P6_OPTIONS: TraceCompilerOptions = defaultTraceCompilerOptions({
  fixedClock: P6_FIXED_CLOCK,
  seed: P6_SEED,
  equalitySalt: "p6-locked-certification-equality-salt-v1",
});

interface ReminderConfig {
  suffix: string;
  tenantId?: string;
  customerId?: string;
  invoiceId?: string;
  amount?: number;
  channel?: "SMS" | "EMAIL";
  evidenceClass?: EvidenceClass;
  optionalStep?: boolean;
  reorderIndependent?: boolean;
  branchArm?: "EMAIL" | "SMS";
  branchState?: "TRUE" | "FALSE";
  retry?: "SAFE" | "RECONCILE" | "HUMAN" | "UNKNOWN";
  loop?: boolean;
  repeatedWithoutLoop?: boolean;
  wait?: "EVENT_DRIVEN" | "FIXED_DURATION" | "DEADLINE" | "POLLING" | "UNKNOWN";
  approval?: boolean;
  provider?: string;
  computer?: boolean;
  modelDecision?: boolean;
  compensation?: boolean;
  recovered?: boolean;
  failure?: boolean;
  ambiguous?: boolean;
  incomplete?: boolean;
  corrupt?: boolean;
  derived?: boolean;
  plannerDivergence?: boolean;
  tenantLiteral?: string;
  pii?: boolean;
  predicateState?: "TRUE" | "FALSE";
  failureOnlyAction?: boolean;
}

const BASE_TIME = Date.parse("2026-08-01T10:00:00.000Z");
function at(offsetMinutes: number): string {
  return new Date(BASE_TIME + offsetMinutes * 60_000).toISOString();
}

function sourceIdentities(config: ReminderConfig) {
  return {
    workIds: [`work-${config.suffix}`],
    businessEffectIds: [`effect-${config.suffix}`],
    businessEffectSemanticHashes: [`effect-semantic-${config.suffix}`],
    operationalIrSemanticHashes: config.plannerDivergence ? ["ir:actual:v2"] : ["ir:reminder:v1"],
  };
}

function baseEvents(config: ReminderConfig): RawEvidenceEvent[] {
  const tenantId = config.tenantId ?? "tenant-a";
  const customerId = config.customerId ?? `customer-${config.suffix}`;
  const invoiceId = config.invoiceId ?? `invoice-${config.suffix}`;
  const amount = config.amount ?? 2480;
  const channel = config.channel ?? "SMS";
  const evidenceClass = config.evidenceClass ?? "REAL_EXECUTION";
  const ids = sourceIdentities(config);
  const startId = `start-${config.suffix}`;
  const customerIdEvent = `customer-${config.suffix}`;
  const invoiceEvent = `invoice-${config.suffix}`;
  const sendEvent = `send-${config.suffix}`;
  const waitEvent = `wait-${config.suffix}`;
  const observeEvent = `observe-${config.suffix}`;
  const verifyEvent = `verify-${config.suffix}`;
  const result: RawEvidenceEvent[] = [{
    eventId: startId,
    tenantId,
    evidenceClass,
    sourceKind: "WORK_EVENT",
    sourceRef: `work_event:${startId}`,
    occurredAt: at(0),
    semanticKind: "WORK_TRANSITION",
    operation: { name: "work.started", equivalenceClass: "work.start" },
    inputs: [
      { path: "work.goal", value: "Collect overdue invoice", role: "USER_INPUT", sensitivity: "TENANT_INTERNAL" },
      ...(config.tenantLiteral ? [{ path: "tenant.reminder_policy", value: config.tenantLiteral, role: "SOURCE" as const, sensitivity: "TENANT_INTERNAL" as const, bindingScope: "TENANT" as const }] : []),
    ],
    outcome: { status: "SUCCEEDED", verified: true, verificationBasis: "durable Work event" },
    sourceIdentities: ids,
  }, {
    eventId: customerIdEvent,
    tenantId,
    evidenceClass,
    sourceKind: "OPERATIONAL_QUERY",
    sourceRef: `query:${customerIdEvent}`,
    occurredAt: at(1),
    semanticKind: "QUERY",
    operation: { name: "resolve.customer", equivalenceClass: "resolve.customer" },
    inputs: [{ path: "customer.query", value: config.pii ? "Henderson, h@example.com, +1 555 0123" : `customer-query-${config.suffix}`, role: "USER_INPUT", sensitivity: config.pii ? "PII" : "CUSTOMER_DATA", semanticType: "CustomerRef" }],
    outputs: [{ path: "customer.id", value: customerId, role: "LOOKUP_RESULT", sensitivity: "CUSTOMER_DATA", semanticType: "CustomerRef" }],
    outcome: { status: "SUCCEEDED", verified: true, verificationBasis: "canonical query result" },
    sourceIdentities: { ...ids, queryExecutionIds: [`query-execution-${config.suffix}-customer`] },
    parents: { control: [startId] },
  }, {
    eventId: invoiceEvent,
    tenantId,
    evidenceClass,
    sourceKind: "OPERATIONAL_QUERY",
    sourceRef: `query:${invoiceEvent}`,
    occurredAt: at(2),
    semanticKind: "QUERY",
    operation: { name: "resolve.open_invoice", equivalenceClass: "resolve.open_invoice" },
    inputs: [{ path: "invoice.customer_id", value: customerId, role: "PARAMETER", sensitivity: "CUSTOMER_DATA", semanticType: "CustomerRef" }],
    outputs: [
      { path: "invoice.id", value: invoiceId, role: "LOOKUP_RESULT", sensitivity: "CUSTOMER_DATA", semanticType: "InvoiceRef" },
      { path: "invoice.amount", value: amount, role: "LOOKUP_RESULT", sensitivity: "FINANCIAL", semanticType: "Amount" },
      { path: "invoice.status", value: "OPEN", role: "SOURCE", semanticType: "Status" },
    ],
    predicates: [{ predicateId: "invoice-open", subjectPath: "invoice.status", operator: "EQ", expected: "OPEN", state: config.predicateState ?? "TRUE", safetyCritical: true }],
    outcome: config.failure ? { status: "FAILED", verified: false, failure: { kind: "VALIDATION", reasonCode: "INVOICE_NOT_OPEN", possibleExternalMutation: false, reconciliationRequired: false } } : { status: "SUCCEEDED", verified: true, verificationBasis: "canonical query result" },
    sourceIdentities: { ...ids, queryExecutionIds: [`query-execution-${config.suffix}-invoice`] },
    parents: { control: [customerIdEvent] },
    dataBindings: [{ fromEventId: customerIdEvent, fromPath: "customer.id", toPath: "invoice.customer_id", derivation: "IDENTITY" }],
  }];

  if (config.optionalStep) result.push({
    eventId: `optional-${config.suffix}`,
    tenantId,
    evidenceClass,
    sourceKind: "OPERATIONAL_QUERY",
    sourceRef: `query:optional-${config.suffix}`,
    occurredAt: at(2.25),
    semanticKind: "QUERY",
    operation: { name: "resolve.communication_preference", equivalenceClass: "resolve.communication_preference" },
    inputs: [{ path: "preference.customer_id", value: customerId, role: "PARAMETER", sensitivity: "CUSTOMER_DATA", semanticType: "CustomerRef" }],
    outputs: [{ path: "preference.channel", value: channel, role: "LOOKUP_RESULT", semanticType: "Channel" }],
    outcome: { status: "SUCCEEDED", verified: true, verificationBasis: "canonical query result" },
    parents: { causal: [customerIdEvent] },
    dataBindings: [{ fromEventId: customerIdEvent, fromPath: "customer.id", toPath: "preference.customer_id", derivation: "IDENTITY" }],
  });

  if (config.reorderIndependent) {
    const reverse = config.suffix.endsWith("b");
    result.push(...[
      { id: "risk", operation: "read.risk_flag", sequence: reverse ? 2 : 1 },
      { id: "history", operation: "read.contact_history", sequence: reverse ? 1 : 2 },
    ].map((entry): RawEvidenceEvent => ({
      eventId: `${entry.id}-${config.suffix}`,
      tenantId,
      evidenceClass,
      sourceKind: "OPERATIONAL_QUERY",
      sourceRef: `query:${entry.id}-${config.suffix}`,
      occurredAt: at(2.5),
      sequence: entry.sequence,
      semanticKind: "QUERY",
      operation: { name: entry.operation, equivalenceClass: entry.operation },
      inputs: [{ path: `${entry.id}.customer_id`, value: customerId, role: "PARAMETER", sensitivity: "CUSTOMER_DATA", semanticType: "CustomerRef" }],
      outputs: [{ path: `${entry.id}.value`, value: true, role: "LOOKUP_RESULT" }],
      outcome: { status: "SUCCEEDED", verified: true, verificationBasis: "canonical query" },
      parents: { causal: [customerIdEvent] },
      dataBindings: [{ fromEventId: customerIdEvent, fromPath: "customer.id", toPath: `${entry.id}.customer_id`, derivation: "IDENTITY" }],
    })));
  }

  if (config.approval) result.push({
    eventId: `approval-${config.suffix}`,
    tenantId,
    evidenceClass,
    sourceKind: "HUMAN_APPROVAL",
    sourceRef: `authority_approval_request:approval-${config.suffix}`,
    occurredAt: at(3),
    semanticKind: "APPROVAL_GATE",
    operation: { name: "approve.customer_communication", equivalenceClass: "requires-approval" },
    authority: { requirementObserved: true, capability: "communicate.customer", risk: "MEDIUM", authorityState: "ALLOWED", approvalRequired: true, approvalStatus: "APPROVED", decisionId: `authority-${config.suffix}`, revision: 1 },
    outcome: { status: "SUCCEEDED", verified: true, verificationBasis: "durable human approval" },
    sourceIdentities: { ...ids, authorityDecisionIds: [`authority-${config.suffix}`] },
    parents: { control: [invoiceEvent] },
  });

  if (config.modelDecision) result.push({
    eventId: `model-${config.suffix}`,
    tenantId,
    evidenceClass,
    sourceKind: "P3_EPISTEMIC_TRACE",
    sourceRef: `epistemic:model-${config.suffix}`,
    occurredAt: at(3.25),
    semanticKind: "MODEL_DECISION",
    operation: { name: "select.reminder_tone", equivalenceClass: "decision.reminder_tone" },
    inputs: [{ path: "decision.customer_state", value: "OVERDUE", role: "SOURCE" }],
    outputs: [{ path: "decision.tone", value: "POLITE", role: "MODEL_DECISION" }],
    modelDecision: { purpose: "select reminder tone", inputSchema: ["CustomerState"], outputSchema: "ReminderTone", constraints: ["NO_THREATS", "POLICY_COMPLIANT"] },
    outcome: { status: "SUCCEEDED", verified: false, verificationBasis: "model output is a decision, not reality" },
    parents: { causal: [invoiceEvent] },
  });

  const sendInputs: RawEvidenceEvent["inputs"] = [
    { path: "reminder.customer_id", value: customerId, role: "PARAMETER", sensitivity: "CUSTOMER_DATA", semanticType: "CustomerRef" },
    { path: "reminder.invoice_id", value: invoiceId, role: "PARAMETER", sensitivity: "CUSTOMER_DATA", semanticType: "InvoiceRef" },
    { path: "reminder.amount", value: amount, role: "PARAMETER", sensitivity: "FINANCIAL", semanticType: "Amount" },
    { path: "reminder.channel", value: channel, role: "CONSTANT", semanticType: "Channel", bindingScope: "GLOBAL" },
    ...(config.derived ? [{
      path: "reminder.formatted_amount",
      value: `$${amount}`,
      role: "DERIVED" as const,
      semanticType: "FormattedAmount",
      sensitivity: "FINANCIAL" as const,
      derivedFrom: [{ eventId: invoiceEvent, path: "invoice.amount" }],
      derivationRule: { id: "format-currency", version: "1" },
      provenanceComplete: true,
    }] : []),
    ...(config.pii ? [
      { path: "customer.email", value: "h@example.com", role: "PARAMETER" as const, semanticType: "Email", sensitivity: "PII" as const },
      { path: "customer.phone", value: "+1 555 0123", role: "PARAMETER" as const, semanticType: "Phone", sensitivity: "PII" as const },
      { path: "customer.address", value: "1 Private Road", role: "PARAMETER" as const, semanticType: "Address", sensitivity: "PII" as const },
    ] : []),
  ];
  const sendParents = [config.approval ? `approval-${config.suffix}` : invoiceEvent];
  result.push({
    eventId: sendEvent,
    tenantId,
    evidenceClass,
    sourceKind: config.computer ? "COMPUTER_TRACE" : "PROVIDER_OPERATION",
    sourceRef: `${config.computer ? "computer_run" : "provider_operation"}:${sendEvent}`,
    occurredAt: at(4),
    endedAt: at(4.5),
    semanticKind: config.computer ? "COMPUTER_OPERATION" : "PROVIDER_OPERATION",
    operation: { name: "communicate.reminder", equivalenceClass: "communicate.reminder", effectClass: "external_side_effect", consequential: true, providerClass: config.provider ?? (config.computer ? "browser" : "communications_api") },
    inputs: sendInputs,
    outputs: [{ path: "delivery.id", value: `delivery-${config.suffix}`, role: "RUNTIME_GENERATED", sensitivity: "CUSTOMER_DATA", semanticType: "DeliveryRef" }],
    predicates: [{ predicateId: "invoice-open", subjectPath: "invoice.status", operator: "EQ", expected: "OPEN", state: config.predicateState ?? "TRUE", safetyCritical: true }],
    observations: config.computer ? [{ kind: "COMPUTER", subject: "reminder submitted page state", state: "OBSERVED", externalRealityRequired: true }] : [],
    authority: { requirementObserved: true, capability: "communicate.customer", risk: "MEDIUM", authorityState: config.approval ? "ALLOWED" : "APPROVAL_REQUIRED", approvalRequired: Boolean(config.approval), approvalStatus: config.approval ? "APPROVED" : "NOT_REQUIRED", decisionId: `authority-${config.suffix}`, revision: 1 },
    outcome: config.failure ? { status: "FAILED", verified: false, failure: { kind: "VALIDATION", reasonCode: "PRECONDITION_FAILED", possibleExternalMutation: false, reconciliationRequired: false } }
      : config.ambiguous ? { status: "AMBIGUOUS", verified: false, verificationBasis: "provider acknowledgement only", failure: { kind: "UNKNOWN_OUTCOME", reasonCode: "ACK_WITHOUT_OBSERVATION", possibleExternalMutation: true, reconciliationRequired: true } }
        : { status: "SUCCEEDED", verified: true, verificationBasis: config.computer ? "structured page observation" : "provider delivery observation" },
    sourceIdentities: { ...ids, providerOperationIds: [`provider-op-${config.suffix}`], idempotencyKeys: [`idem-${config.suffix}`], computerRunIds: config.computer ? [`computer-${config.suffix}`] : [] },
    parents: { authorityFor: sendParents },
    dataBindings: [
      { fromEventId: customerIdEvent, fromPath: "customer.id", toPath: "reminder.customer_id", derivation: "IDENTITY" },
      { fromEventId: invoiceEvent, fromPath: "invoice.id", toPath: "reminder.invoice_id", derivation: "IDENTITY" },
      { fromEventId: invoiceEvent, fromPath: "invoice.amount", toPath: "reminder.amount", derivation: "IDENTITY" },
      ...(config.derived ? [{ fromEventId: invoiceEvent, fromPath: "invoice.amount", toPath: "reminder.formatted_amount", derivation: "EXPLICIT_TRANSFORM" as const, ruleRef: "format-currency@1" }] : []),
    ],
    uncertainty: config.plannerDivergence ? ["PLANNER_EXECUTION_DIVERGENCE"] : [],
  });

  if (config.branchArm) {
    const branchEvent = `branch-${config.suffix}`;
    result.push({
      eventId: branchEvent,
      tenantId,
      evidenceClass,
      sourceKind: "WORK_EVENT",
      sourceRef: `work_event:${branchEvent}`,
      occurredAt: at(3.5),
      semanticKind: "BRANCH_DECISION",
      operation: { name: "select.contact_channel", equivalenceClass: "branch.contact_channel" },
      predicates: [{ predicateId: "customer-contact-available", subjectPath: config.branchArm === "EMAIL" ? "customer.email" : "customer.phone", operator: "EXISTS", state: config.branchState ?? (config.branchArm === "EMAIL" ? "TRUE" : "FALSE") }],
      branch: { family: "contact-channel", arm: config.branchArm, predicateId: "customer-contact-available", observedPredicateState: config.branchState ?? (config.branchArm === "EMAIL" ? "TRUE" : "FALSE") },
      outcome: { status: "SUCCEEDED", verified: true, verificationBasis: "observed contact field" },
      parents: { causal: [customerIdEvent] },
    });
    const send = result.find((event) => event.eventId === sendEvent)!;
    send.parents = { ...send.parents, control: [branchEvent] };
    send.branch = { family: "contact-channel", arm: config.branchArm, predicateId: "customer-contact-available", observedPredicateState: config.branchState ?? (config.branchArm === "EMAIL" ? "TRUE" : "FALSE") };
  }

  if (config.retry) {
    const send = result.find((event) => event.eventId === sendEvent)!;
    send.semanticKind = "RETRY_ATTEMPT";
    const ambiguousRetry = config.retry === "RECONCILE" || config.retry === "UNKNOWN";
    send.outcome = { status: "FAILED", verified: false, failure: { kind: ambiguousRetry ? "UNKNOWN_OUTCOME" : "RETRYABLE", reasonCode: ambiguousRetry ? "AMBIGUOUS_FIRST_ATTEMPT" : "PROVIDER_TRANSIENT", possibleExternalMutation: ambiguousRetry, reconciliationRequired: ambiguousRetry } };
    send.retry = { family: `reminder-retry-${config.suffix}`, attempt: 1, trigger: "INITIAL", delayMs: null, backoffEvidence: null, idempotencyEvidence: config.retry === "HUMAN" ? null : `idem-${config.suffix}`, reconciliationBeforeAttempt: false, humanInitiated: false };
    if (config.retry === "RECONCILE") result.push({
      eventId: `reconcile-${config.suffix}`,
      tenantId,
      evidenceClass,
      sourceKind: "RECONCILIATION",
      sourceRef: `reconciliation_case:${config.suffix}`,
      occurredAt: at(4.75),
      semanticKind: "RECONCILIATION",
      operation: { name: "reconcile.reminder_delivery", equivalenceClass: "reconciliation" },
      observations: [{ kind: "PROVIDER", subject: "delivery status", state: "ABSENT", externalRealityRequired: true }],
      outcome: { status: "SUCCEEDED", verified: true, verificationBasis: "read-after-write absent" },
      parents: { observationOf: [sendEvent] },
    });
    result.push({
      ...send,
      eventId: `send-retry-${config.suffix}`,
      sourceRef: `provider_operation:send-retry-${config.suffix}`,
      occurredAt: at(5),
      endedAt: at(5.5),
      outcome: { status: "SUCCEEDED", verified: true, verificationBasis: "provider delivery observation" },
      retry: { family: `reminder-retry-${config.suffix}`, attempt: 2, trigger: config.retry === "RECONCILE" ? "RECONCILIATION_CONFIRMED_ABSENT" : config.retry === "HUMAN" ? "HUMAN_DECISION" : "TRANSIENT_FAILURE", delayMs: 1000, backoffEvidence: "configured-backoff-v1", idempotencyEvidence: config.retry === "HUMAN" ? null : `idem-${config.suffix}`, reconciliationBeforeAttempt: config.retry === "RECONCILE", humanInitiated: config.retry === "HUMAN" },
      parents: { retryOf: [sendEvent], ...(config.retry === "RECONCILE" ? { causal: [`reconcile-${config.suffix}`] } : {}) },
      dataBindings: send.dataBindings,
    });
  }

  const repetitions = config.loop || config.repeatedWithoutLoop ? 2 : 0;
  for (let iteration = 1; iteration <= repetitions; iteration += 1) result.push({
    eventId: `batch-reminder-${config.suffix}-${iteration}`,
    tenantId,
    evidenceClass,
    sourceKind: "PROVIDER_OPERATION",
    sourceRef: `provider_operation:batch-${config.suffix}-${iteration}`,
    occurredAt: at(5 + iteration / 10),
    semanticKind: "LOOP_ITERATION",
    operation: { name: "communicate.batch_reminder_item", equivalenceClass: "communicate.batch_reminder_item", consequential: true },
    inputs: [{ path: "iterator.invoice_id", value: `${invoiceId}-${iteration}`, role: "PARAMETER", sensitivity: "CUSTOMER_DATA", semanticType: "InvoiceRef" }],
    outcome: { status: "SUCCEEDED", verified: true, verificationBasis: "provider delivery observation" },
    loop: config.loop ? { family: "overdue-invoices", iteration, iteratorSource: "query.overdue_invoices", itemValueId: `${invoiceId}-${iteration}`, terminationCondition: "iterator.exhausted", ordering: "SEQUENTIAL" } : undefined,
    parents: { control: [sendEvent] },
  });

  if (config.failureOnlyAction) result.push({
    eventId: `failure-only-action-${config.suffix}`,
    tenantId,
    evidenceClass,
    sourceKind: "PROVIDER_OPERATION",
    sourceRef: `provider_operation:failure-only-action-${config.suffix}`,
    occurredAt: at(5.75),
    semanticKind: "PROVIDER_OPERATION",
    operation: { name: "mutate.failure_only", equivalenceClass: "mutate.failure_only", consequential: true },
    outcome: { status: "FAILED", verified: false, failure: { kind: "TERMINAL", reasonCode: "NEGATIVE_ONLY_ACTION", possibleExternalMutation: false, reconciliationRequired: false } },
    parents: { causal: [sendEvent] },
  });

  const effectiveWait = config.wait ?? "EVENT_DRIVEN";
  const waitOperation = effectiveWait === "FIXED_DURATION" ? "wait.fixed"
    : effectiveWait === "EVENT_DRIVEN" ? "wait.event"
      : effectiveWait === "DEADLINE" ? "wait.deadline"
        : effectiveWait === "POLLING" ? "wait.polling" : "wait.unknown";
  result.push({
    eventId: waitEvent,
    tenantId,
    evidenceClass,
    sourceKind: "WORK_EVENT",
    sourceRef: `work_event_wait:${waitEvent}`,
    occurredAt: at(6),
    endedAt: effectiveWait === "FIXED_DURATION" ? at(6 + 24 * 60) : at(8),
    semanticKind: "WAIT",
    operation: { name: waitOperation, equivalenceClass: waitOperation },
    wait: effectiveWait === "FIXED_DURATION"
      ? { kind: "FIXED_DURATION", durationMs: 86_400_000, eventType: null, deadline: null, pollIntervalMs: null, terminalPredicateId: null }
      : effectiveWait === "EVENT_DRIVEN"
        ? { kind: "EVENT_DRIVEN", durationMs: null, eventType: "payment.observed", deadline: null, pollIntervalMs: null, terminalPredicateId: "payment-present" }
        : effectiveWait === "DEADLINE"
          ? { kind: "DEADLINE", durationMs: null, eventType: null, deadline: at(8), pollIntervalMs: null, terminalPredicateId: "payment-present" }
          : effectiveWait === "POLLING"
            ? { kind: "POLLING", durationMs: null, eventType: null, deadline: at(8), pollIntervalMs: 60_000, terminalPredicateId: "payment-present" }
            : { kind: "UNKNOWN", durationMs: null, eventType: null, deadline: null, pollIntervalMs: null, terminalPredicateId: null },
    outcome: config.failure || config.ambiguous ? { status: "UNKNOWN", verified: false } : { status: "SUCCEEDED", verified: true, verificationBasis: effectiveWait === "FIXED_DURATION" ? "durable deadline" : "matched integration event" },
    parents: { control: [config.retry ? `send-retry-${config.suffix}` : sendEvent] },
  }, {
    eventId: observeEvent,
    tenantId,
    evidenceClass,
    sourceKind: config.computer ? "COMPUTER_TRACE" : "WEBHOOK_OBSERVATION",
    sourceRef: `${config.computer ? "computer_artifact" : "integration_event"}:${observeEvent}`,
    occurredAt: at(8),
    semanticKind: "OBSERVATION",
    operation: { name: "observe.payment", equivalenceClass: "observe.payment", providerClass: config.provider ?? "payments" },
    inputs: [{ path: "payment.invoice_id", value: invoiceId, role: "PARAMETER", sensitivity: "CUSTOMER_DATA", semanticType: "InvoiceRef" }],
    outputs: [{ path: "payment.status", value: config.failure ? "ABSENT" : "PAID", role: "EXTERNAL_OBSERVATION", semanticType: "Status" }],
    predicates: [{ predicateId: "payment-present", subjectPath: "payment.status", operator: "EQ", expected: "PAID", state: config.failure || config.ambiguous ? "FALSE" : "TRUE", safetyCritical: true }],
    observations: [{ kind: config.computer ? "COMPUTER" : "WEBHOOK", subject: "payment", state: config.failure ? "ABSENT" : config.ambiguous ? "UNKNOWN" : "OBSERVED", externalRealityRequired: true }],
    outcome: config.failure ? { status: "FAILED", verified: false, failure: { kind: "TERMINAL", reasonCode: "PAYMENT_NOT_OBSERVED", possibleExternalMutation: false, reconciliationRequired: false } } : config.ambiguous ? { status: "AMBIGUOUS", verified: false } : { status: "SUCCEEDED", verified: true, verificationBasis: "matched payment event" },
    sourceIdentities: ids,
    parents: { observationOf: [waitEvent] },
    dataBindings: [{ fromEventId: invoiceEvent, fromPath: "invoice.id", toPath: "payment.invoice_id", derivation: "OBSERVATION" }],
  });

  if (config.compensation) result.push({
    eventId: `compensate-${config.suffix}`,
    tenantId,
    evidenceClass,
    sourceKind: "COMPENSATION",
    sourceRef: `compensation_case:${config.suffix}`,
    occurredAt: at(8.5),
    semanticKind: "COMPENSATION",
    operation: { name: "compensate.reminder", equivalenceClass: "compensation:communicate.reminder", consequential: true },
    outcome: { status: "SUCCEEDED", verified: true, verificationBasis: "compensation receipt" },
    parents: { compensationFor: [sendEvent] },
  });

  result.push({
    eventId: verifyEvent,
    tenantId,
    evidenceClass,
    sourceKind: "OBJECTIVE_RUNTIME",
    sourceRef: `objective_success_verification:${verifyEvent}`,
    occurredAt: at(9),
    semanticKind: "SUCCESS_CONDITION",
    operation: { name: "verify.payment_collected", equivalenceClass: "success.payment_collected" },
    inputs: [{ path: "success.invoice_id", value: invoiceId, role: "PARAMETER", sensitivity: "CUSTOMER_DATA", semanticType: "InvoiceRef" }],
    outcome: config.failure ? { status: "FAILED", verified: false, verificationBasis: "unsatisfied objective condition" } : config.ambiguous || config.incomplete ? { status: "UNKNOWN", verified: false } : { status: "SUCCEEDED", verified: true, verificationBasis: "persisted ObjectiveSuccessVerification" },
    parents: { causal: [observeEvent] },
    dataBindings: [{ fromEventId: invoiceEvent, fromPath: "invoice.id", toPath: "success.invoice_id", derivation: "IDENTITY" }],
  });

  if (config.corrupt) {
    const start = result.find((event) => event.eventId === startId)!;
    start.parents = { causal: [verifyEvent] };
  }
  return result;
}

export function reminderBundle(config: ReminderConfig): SourceTraceBundle {
  const tenantId = config.tenantId ?? "tenant-a";
  const operationIdentity: TraceOperationIdentity = {
    semanticOperation: "collect.overdue_invoice",
    goal: "Collect overdue invoice",
    plannerIrSemanticHash: config.plannerDivergence ? "ir:planned:v1" : "ir:reminder:v1",
    executionModel: "objective",
    sourceOperationRefs: [`work:work-${config.suffix}`],
  };
  return bundleFromEvents({
    tenantId,
    operationIdentity,
    startedAt: at(0),
    endedAt: config.incomplete ? undefined : at(9),
    events: baseEvents(config),
    completion: {
      workStatus: config.failure ? "failed" : config.incomplete ? "running" : "completed",
      objectiveVerification: config.failure ? "UNSATISFIED" : config.ambiguous || config.incomplete ? "UNKNOWN" : "VERIFIED",
      effectVerifications: config.failure ? ["UNVERIFIED"] : config.ambiguous ? ["RECONCILIATION_REQUIRED"] : ["VERIFIED"],
      providerAcknowledged: Boolean(config.ambiguous),
      recovered: Boolean(config.recovered || config.retry || config.compensation),
      terminalFailure: Boolean(config.failure),
      ambiguousExternalOutcome: Boolean(config.ambiguous),
      explicitlyIncomplete: Boolean(config.incomplete),
    },
  });
}

export function reminderTrace(config: ReminderConfig) {
  return normalizeExecutionTrace(reminderBundle(config), P6_OPTIONS);
}

function compile(configs: ReminderConfig[], crossTenant = false): CompileProcedureResult {
  return compileProcedureCandidate(configs.map(reminderTrace), { ...P6_OPTIONS, ...(crossTenant ? { crossTenantMode: "ANONYMIZED" as const } : {}) }) as CompileProcedureResult;
}

function assertPrivateRepresentations(result: CompileProcedureResult): void {
  for (const parameter of result.candidate.parameters) if (parameter.sensitivity !== "PUBLIC") assert.notEqual(parameter.classification, "CONSTANT");
  for (const constant of result.candidate.constants) assert.equal(constant.value.kind, "LITERAL");
  assert.equal(result.candidate.provenance.rawPrivateValuesPersisted, false);
}

export interface P6CorpusResult {
  id: string;
  passed: boolean;
  traceCount: number;
  traceOutcomes: string[];
  candidateId: string | null;
  semanticDiff: string | null;
  error?: string;
}

export function executeLockedCase(id: string): P6CorpusResult {
  try {
    let result: CompileProcedureResult;
    switch (id) {
      case "identical_successes":
        result = compile([{ suffix: "identical-a", customerId: "customer-same", invoiceId: "invoice-same" }, { suffix: "identical-b", customerId: "customer-same", invoiceId: "invoice-same" }]);
        assert.equal(result.candidate.evidence.positiveRealTraceIds.length, 2);
        break;
      case "different_entity_ids":
        result = compile([{ suffix: "entity-a", customerId: "customer-a" }, { suffix: "entity-b", customerId: "customer-b" }]);
        assert.ok(result.candidate.parameters.some((parameter) => parameter.semanticType === "CustomerRef"));
        break;
      case "different_amounts":
        result = compile([{ suffix: "amount-a", amount: 2480 }, { suffix: "amount-b", amount: 910 }]);
        assert.ok(result.candidate.parameters.some((parameter) => parameter.semanticType === "Amount"));
        break;
      case "true_constant":
        result = compile([{ suffix: "constant-a", customerId: "a", amount: 1, channel: "SMS" }, { suffix: "constant-b", customerId: "b", amount: 2, channel: "SMS" }]);
        assert.ok(result.candidate.constants.some((constant) => constant.semanticType === "Channel"));
        break;
      case "false_constant":
        result = compile([{ suffix: "false-constant-a", channel: "SMS" }, { suffix: "false-constant-b", channel: "EMAIL" }]);
        assert.ok(!result.candidate.constants.some((constant) => constant.semanticType === "Channel"));
        break;
      case "derived_value":
        result = compile([{ suffix: "derived-a", derived: true }, { suffix: "derived-b", derived: true, amount: 910 }]);
        assert.ok(result.candidate.derivedValues.some((value) => value.provenanceComplete && value.derivationRules.some((rule) => rule.id === "format-currency")));
        break;
      case "optional_step":
        result = compile([{ suffix: "optional-a", optionalStep: true }, { suffix: "optional-b" }]);
        assert.ok(result.candidate.programStructure.steps.some((step) => step.operation === "resolve.communication_preference" && step.optional));
        break;
      case "reordered_independent":
        result = compile([{ suffix: "reorder-a", reorderIndependent: true }, { suffix: "reorder-b", reorderIndependent: true }]);
        assert.ok(result.alignment.groups.some((group) => group.operation === "read.risk_flag" && group.supportingTraceCount === 2));
        assert.ok(result.alignment.groups.some((group) => group.operation === "read.contact_history" && group.supportingTraceCount === 2));
        break;
      case "branch_inference":
        result = compile([{ suffix: "branch-a", branchArm: "EMAIL", branchState: "TRUE", channel: "EMAIL" }, { suffix: "branch-b", branchArm: "SMS", branchState: "FALSE", channel: "SMS" }]);
        assert.equal(result.candidate.branches.length, 1);
        assert.deepEqual(result.candidate.branches[0]!.arms.map((arm) => arm.label).sort(), ["EMAIL", "SMS"]);
        break;
      case "false_branch_inference":
        result = compile([{ suffix: "false-branch-a", branchArm: "EMAIL", branchState: "TRUE" }, { suffix: "false-branch-b", branchArm: "EMAIL", branchState: "TRUE" }]);
        assert.equal(result.candidate.branches.length, 0);
        break;
      case "safe_retry":
        result = compile([{ suffix: "retry-safe", retry: "SAFE", recovered: true }]);
        assert.equal(result.candidate.retries[0]?.classification, "SAFE_RETRY");
        assert.equal(result.candidate.retries[0]?.automatic, true);
        break;
      case "reconcile_before_retry":
        result = compile([{ suffix: "retry-reconcile", retry: "RECONCILE", recovered: true }]);
        assert.equal(result.candidate.retries[0]?.classification, "RECONCILIATION_BEFORE_RETRY");
        break;
      case "loop":
        result = compile([{ suffix: "loop-a", loop: true }, { suffix: "loop-b", loop: true }]);
        assert.equal(result.candidate.loops.length, 1);
        break;
      case "repeated_not_loop":
        result = compile([{ suffix: "not-loop", repeatedWithoutLoop: true }]);
        assert.equal(result.candidate.loops.length, 0);
        break;
      case "event_wait":
        result = compile([{ suffix: "event-wait-a", wait: "EVENT_DRIVEN" }, { suffix: "event-wait-b", wait: "EVENT_DRIVEN" }]);
        assert.ok(result.candidate.waits.some((wait) => wait.kind === "EVENT_DRIVEN" && wait.durationsMs.length === 0));
        break;
      case "fixed_wait":
        result = compile([{ suffix: "fixed-wait-a", wait: "FIXED_DURATION" }, { suffix: "fixed-wait-b", wait: "FIXED_DURATION" }]);
        assert.ok(result.candidate.waits.some((wait) => wait.kind === "FIXED_DURATION" && wait.durationsMs.includes(86_400_000)));
        break;
      case "human_approval":
        result = compile([{ suffix: "approval-a", approval: true }, { suffix: "approval-b", approval: true }]);
        assert.ok(result.candidate.authorityRequirements.some((requirement) => requirement.approvalRequired && !requirement.grantsAuthority));
        break;
      case "provider_observation":
        result = compile([{ suffix: "provider-a", provider: "provider-one" }, { suffix: "provider-b", provider: "provider-two" }]);
        assert.ok(result.alignment.groups.some((group) => group.operation === "communicate.reminder" && group.supportingTraceCount === 2));
        assert.ok(result.candidate.observations.some((observation) => observation.externalRealityRequired));
        break;
      case "computer_observation":
        result = compile([{ suffix: "computer-a", computer: true }, { suffix: "computer-b", computer: true }]);
        assert.ok(result.candidate.observations.some((observation) => observation.kind === "COMPUTER" && observation.externalRealityRequired));
        break;
      case "model_decision":
        result = compile([{ suffix: "model-a", modelDecision: true }, { suffix: "model-b", modelDecision: true }]);
        assert.ok(result.candidate.modelDecisions.every((decision) => !decision.promptTranscriptPersisted && !decision.chainOfThoughtPersisted));
        break;
      case "compensation":
        result = compile([{ suffix: "compensation", compensation: true, recovered: true }]);
        assert.equal(result.traceValidation[0]!.validation.outcome, "RECOVERED_SUCCESS");
        assert.ok(result.candidate.compensation.length > 0);
        break;
      case "recovered_success":
        result = compile([{ suffix: "recovered", retry: "SAFE", recovered: true }]);
        assert.equal(result.traceValidation[0]!.validation.outcome, "RECOVERED_SUCCESS");
        break;
      case "failure_trace":
        result = compile([{ suffix: "positive" }, { suffix: "failure", failure: true, predicateState: "FALSE" }]);
        assert.equal(result.candidate.evidence.positiveRealTraceIds.length, 1);
        assert.equal(result.candidate.evidence.negativeRealTraceIds.length, 1);
        break;
      case "ambiguous_outcome":
        result = compile([{ suffix: "ambiguous", ambiguous: true }]);
        assert.equal(result.traceValidation[0]!.validation.outcome, "AMBIGUOUS");
        assert.equal(result.traceValidation[0]!.validation.trainingEligible, false);
        break;
      case "planner_execution_divergence":
        result = compile([{ suffix: "divergence-a", plannerDivergence: true }, { suffix: "divergence-b", plannerDivergence: true }]);
        assert.equal(result.candidate.evidence.plannedExecutionDivergences.length, 2);
        break;
      case "synthetic_p5":
        result = compile([{ suffix: "p5-synthetic", evidenceClass: "SIMULATED_EXECUTION" }]);
        assert.equal(result.candidate.support.realExecution.supporting, 0);
        assert.equal(result.candidate.support.simulatedExecution.supporting, 1);
        assert.ok(result.candidate.uncertainty.includes("NO_REAL_SUCCESS_SUPPORT"));
        break;
      case "single_trace":
        result = compile([{ suffix: "single" }]);
        assert.equal(result.candidate.support.sampleQuality, "SINGLE_TRACE_HYPOTHESIS");
        assert.ok(result.candidate.uncertainty.includes("SINGLE_TRACE_HYPOTHESIS"));
        break;
      case "tenant_literal":
        result = compile([{ suffix: "tenant-a", tenantId: "tenant-a", tenantLiteral: "dealer-private-policy-a" }, { suffix: "tenant-b", tenantId: "tenant-b", tenantLiteral: "dealer-private-policy-b" }], true);
        assert.ok(result.candidate.parameters.some((parameter) => parameter.classification === "TENANT_BOUND"));
        assertPrivateRepresentations(result);
        break;
      case "pii_redaction": {
        result = compile([{ suffix: "pii-a", pii: true }, { suffix: "pii-b", pii: true }]);
        const trace = reminderTrace({ suffix: "pii-check", pii: true });
        const privateValues = trace.nodes.flatMap((node) => [...node.inputs, ...node.outputs]).filter((value) => value.sensitivity === "PII");
        assert.ok(privateValues.length >= 3);
        assert.ok(privateValues.every((value) => value.representation.kind === "TYPED_PLACEHOLDER"));
        assert.doesNotMatch(canonicalSerialize(result.candidate), /h@example\.com|555 0123|Private Road/);
        break;
      }
      case "contradictory_traces":
        result = compile([{ suffix: "contradiction-positive", predicateState: "TRUE" }, { suffix: "contradiction-negative", predicateState: "FALSE", failure: true }]);
        assert.ok(result.candidate.predicates.some((predicate) => predicate.classification === "OBSERVED_REQUIRED" && predicate.support.contradictingTraceCount > 0));
        break;
      case "malformed_incomplete": {
        const corrupt = reminderTrace({ suffix: "corrupt", corrupt: true });
        const incomplete = reminderTrace({ suffix: "incomplete", incomplete: true });
        result = compileProcedureCandidate([corrupt, incomplete], P6_OPTIONS) as CompileProcedureResult;
        assert.deepEqual(result.traceValidation.map((row) => row.validation.outcome).sort(), ["CORRUPT", "INCOMPLETE"]);
        assert.ok(result.traceValidation.every((row) => !row.validation.trainingEligible));
        break;
      }
      default:
        throw new Error(`Unknown P6 locked case: ${id}`);
    }
    assert.equal(result.candidate.executionStatus, "NON_EXECUTABLE_HYPOTHESIS");
    assert.equal(result.candidate.certificationStatus, "UNCERTIFIED_P6_HYPOTHESIS");
    assert.equal(result.candidate.provenance.realAndSyntheticSupportSeparated, true);
    return {
      id,
      passed: true,
      traceCount: result.traceValidation.length,
      traceOutcomes: result.traceValidation.map((row) => row.validation.outcome),
      candidateId: result.candidate.candidateId,
      semanticDiff: result.semanticDiff.classification,
    };
  } catch (error) {
    return {
      id,
      passed: false,
      traceCount: 0,
      traceOutcomes: [],
      candidateId: null,
      semanticDiff: null,
      error: error instanceof Error ? error.stack ?? error.message : String(error),
    };
  }
}

export function runP6LockedCorpus(): P6CorpusResult[] {
  return P6_LOCKED_CASES.map((fixture) => executeLockedCase(fixture.id));
}
