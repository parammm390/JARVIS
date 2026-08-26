import { createHash } from "node:crypto";
import {
  canonicalSerialize,
  createPlanningIrArtifact,
  type CanonicalEntityRef,
  type ConstraintKind,
  type ConstraintSpec,
  type ConstraintStatus,
  type ObservationKind,
  type PlanningIrArtifact,
  type PlanningSemanticSnapshot,
} from "@finnor/planning-ir";
import { businessEffectObservationForAction, semanticSnapshotFromArtifact } from "@finnor/orchestration";
import { ACTION_HARDENING_SPEC_BY_ACTION, type ApprovalFloor } from "../../scripts/release/action-hardening-spec";

export const REAL_FINNOR_CORPUS_VERSION = "real-finnor-phase1-1.0.0" as const;
export const REAL_FINNOR_CORPUS_SEED = 0x51f1_2026;
export const REAL_FINNOR_FIXED_CLOCK = "2026-08-26T00:00:00.000Z";

export const REAL_FINNOR_CATEGORY_COUNTS = Object.freeze({
  grounding_reference: 150,
  ambiguous_multi_entity: 100,
  cross_tenant_forged: 100,
  hard_constraint: 100,
  soft_constraint: 75,
  authority_policy: 100,
  capability_provider_health: 100,
  multi_action_objective: 100,
  cancellation_recovery_race: 75,
  computer_write: 50,
  observation_reconciliation: 50,
});

export type RealFinnorCategory = keyof typeof REAL_FINNOR_CATEGORY_COUNTS;
export type RealExecutionClass = "QUERY" | "ATOMIC_EFFECT" | "OBJECTIVE" | "CONVERSATION";
export type RealCompilerResult = "ADMIT" | "REJECT" | "NO_PLANNER";

type EntityType = "household" | "property" | "equipment" | "appointment" | "service_visit" | "technician" | "lead" | "quote" | "proposal" | "invoice" | "payment" | "inventory_item" | "contact" | "maintenance_agreement" | "work" | "task" | "user" | "internal_event" | "document";

export interface RealWorldEntity { entityType: EntityType; entityId: string; tenantId: string; state: Record<string, unknown> }
export interface RealConstraintExpectation { id: string; kind: ConstraintKind; truth: ConstraintStatus; description: string }

export interface RealFinnorCase {
  id: string;
  category: RealFinnorCategory;
  semanticKey: string;
  instruction: string;
  trustedWorld: {
    tenantId: string;
    otherTenantId: string;
    entities: RealWorldEntity[];
    availableCapabilities: string[];
    providerHealth: "healthy" | "down" | "unknown";
    policyRevision: number;
    policyRequiresConfirmation: boolean;
    workStatus?: "planning" | "awaiting_approval" | "executing" | "recovery" | "completed" | "failed" | "cancelled";
    assetDomain: "WATER" | "HVAC" | "PLUMBING" | "GENERIC";
  };
  expected: {
    executionClass: RealExecutionClass;
    groundedEntities: string[];
    unresolvedEntities: string[];
    hardConstraints: RealConstraintExpectation[];
    capabilityRequirements: string[];
    allowedEffects: string[];
    forbiddenEffects: string[];
    requiredApprovalFloor: ApprovalFloor | "NONE";
    requiredObservationFloor: ObservationKind | "NONE";
    compilerResult: RealCompilerResult;
  };
  actionType?: string;
  payload?: Record<string, unknown>;
  ambiguityCandidates?: CanonicalEntityRef[];
  effectCount?: number;
  invalidGraph?: "cycle" | "missing_dependency";
  observationVariant?: "existing_floor" | "ack_only" | "weakened";
}

interface Blueprint {
  key: string;
  actionType: string;
  entityTypes: EntityType[];
  payload(ids: Record<EntityType, string>, variant: number): Record<string, unknown>;
  instruction(variant: number, domain: string): string;
}

const BLUEPRINTS: Blueprint[] = [
  { key: "invoice_create", actionType: "create_invoice", entityTypes: ["household", "property"], payload: (x, v) => ({ householdId: x.household, amountUsd: 125 + v * 25, memo: `Completed ${["water", "HVAC", "plumbing"][v % 3]} service at the selected property` }), instruction: (v, d) => `Create the approved $${125 + v * 25} invoice for the selected ${d} service customer.` },
  { key: "payment_record", actionType: "record_payment", entityTypes: ["invoice", "payment", "household"], payload: (x) => ({ invoiceId: x.invoice, paymentId: x.payment }), instruction: (v) => `Record the reconciled payment for invoice batch ${v + 1}.` },
  { key: "customer_message", actionType: "send_customer_message", entityTypes: ["household", "property"], payload: (x, v) => ({ householdId: x.household, channel: v % 2 ? "email" : "sms", message: `Your service appointment window ${v + 1} is confirmed.`, phone: `+155501${String(v).padStart(4, "0")}` }), instruction: (v, d) => `Send the approved ${d} appointment confirmation using channel policy ${v % 2 ? "email" : "SMS"}.` },
  { key: "inventory_usage", actionType: "log_stock_used_on_visit", entityTypes: ["service_visit", "inventory_item", "equipment", "property"], payload: (x, v) => ({ visitId: x.service_visit, sku: `FILTER-${10 + v}`, quantity: 1 + v % 3, equipmentId: x.equipment, propertyId: x.property }), instruction: (v, d) => `Record ${1 + v % 3} ${d} replacement filter unit(s) used on the selected visit.` },
  { key: "lead_status", actionType: "update_lead_status", entityTypes: ["lead", "household"], payload: (x, v) => ({ leadId: x.lead, householdId: x.household, status: ["contacted", "qualified", "won"][v % 3] }), instruction: (v) => `Move the grounded lead to ${["contacted", "qualified", "won"][v % 3]}.` },
  { key: "quote_generate", actionType: "generate_quote", entityTypes: ["household", "property", "equipment"], payload: (x, v) => ({ householdId: x.household, propertyId: x.property, equipmentId: x.equipment, householdLabel: "Existing customer", items: [`Option ${1 + v % 4}`], notes: `Scope revision ${1 + Math.floor(v / 4)}` }), instruction: (v, d) => `Generate quote option ${1 + v % 4} for the grounded ${d} asset and property.` },
  { key: "proposal_signature", actionType: "request_proposal_signature", entityTypes: ["proposal", "household"], payload: (x, v) => ({ proposalId: x.proposal, signerName: "Grounded decision maker", signerEmail: `signer${v}@example.test` }), instruction: (v) => `Request the approved signature for proposal revision ${v + 1}.` },
  { key: "technician_assign", actionType: "assign_technician_to_visit", entityTypes: ["service_visit", "technician", "property"], payload: (x) => ({ visitId: x.service_visit, technicianId: x.technician, propertyId: x.property }), instruction: (v, d) => `Assign the selected qualified technician to ${d} visit window ${v + 1}.` },
  { key: "visit_reschedule", actionType: "reschedule_visit", entityTypes: ["service_visit", "appointment", "property"], payload: (x, v) => ({ visitId: x.service_visit, appointmentId: x.appointment, propertyId: x.property, newTime: `2026-09-${String(1 + v % 20).padStart(2, "0")}T${String(8 + v % 8).padStart(2, "0")}:00:00.000Z`, reason: `Customer window conflict ${v + 1}` }), instruction: (v) => `Reschedule the grounded service visit to approved time window ${v + 1}.` },
  { key: "water_workflow", actionType: "start_water_test_workflow", entityTypes: ["household", "property", "technician"], payload: (x, v) => ({ householdId: x.household, propertyId: x.property, technicianId: x.technician, scheduledAt: `2026-09-${String(1 + v % 20).padStart(2, "0")}T14:00:00.000Z`, phoneNumber: `+155502${String(v).padStart(4, "0")}`, confirmationMessage: "Your onsite test is scheduled." }), instruction: (v) => `Start the grounded onsite water-test workflow for service window ${v + 1}.` },
  { key: "invoice_to_cash", actionType: "start_invoice_to_cash_workflow", entityTypes: ["invoice", "contact", "household"], payload: (x, v) => ({ invoiceId: x.invoice, contactId: x.contact, channel: v % 2 ? "email" : "sms" }), instruction: (v) => `Drive invoice ${v + 1} through payment link, delivery, and accounting reconciliation.` },
  { key: "campaign_launch", actionType: "launch_ad_campaign", entityTypes: [], payload: (_x, v) => ({ name: `Seasonal service cohort ${v + 1}`, dailyBudgetUsd: 10 + v * 5, objective: "leads", targetZip: String(33000 + v) }), instruction: (v, d) => `Launch the approved $${10 + v * 5}/day ${d} service campaign in ZIP ${33000 + v}.` },
  { key: "bulk_notify", actionType: "bulk_notify_existing_customers", entityTypes: [], payload: (_x, v) => ({ offerScript: `Seasonal maintenance offer ${v + 1}`, channel: v % 2 ? "call" : "sms", discountPercent: 5 + v % 4 * 5, minDaysInactive: 90 + v }), instruction: (v) => `Notify customers inactive more than ${90 + v} days with the approved ${5 + v % 4 * 5}% offer.` },
  { key: "task_create", actionType: "create_task", entityTypes: ["household", "property"], payload: (x, v) => ({ subjectRef: { entityType: "household", entityId: x.household }, propertyId: x.property, title: `Order follow-up part ${v + 1}`, priority: v % 3 ? "normal" : "high" }), instruction: (v, d) => `Create a ${v % 3 ? "normal" : "high"}-priority ${d} property follow-up task.` },
  { key: "work_handoff", actionType: "handoff_work", entityTypes: ["work", "user", "property"], payload: (x, v) => ({ workRef: { workId: x.work }, targetEmployeeRef: { partyType: "employee", partyId: x.user }, propertyId: x.property, note: `Handoff with service evidence revision ${v + 1}` }), instruction: (v) => `Hand off the grounded Work with evidence revision ${v + 1} to the selected employee.` },
  { key: "objective_delegate", actionType: "delegate_objective", entityTypes: ["work", "user", "household"], payload: (x, v) => ({ workRef: { workId: x.work }, targetRef: { partyType: "employee", partyId: x.user }, objective: `Complete customer recovery stage ${v + 1}`, acknowledgementDeadline: `2026-09-15T12:00:00.000Z`, completionDeadline: `2026-09-${String(16 + v % 10).padStart(2, "0")}T12:00:00.000Z` }), instruction: (v) => `Delegate customer recovery stage ${v + 1} and wait for persisted completion evidence.` },
  { key: "event_schedule", actionType: "schedule_internal_event", entityTypes: ["user", "property"], payload: (x, v) => ({ title: `Installation readiness review ${v + 1}`, startsAt: `2026-09-${String(1 + v % 20).padStart(2, "0")}T15:00:00.000Z`, endsAt: `2026-09-${String(1 + v % 20).padStart(2, "0")}T15:30:00.000Z`, participants: [{ partyType: "employee", partyId: x.user }], propertyId: x.property }), instruction: (v) => `Schedule installation readiness review ${v + 1} with the grounded employee and property.` },
  { key: "document_share", actionType: "share_document", entityTypes: ["document", "household"], payload: (x, v) => ({ documentRef: { documentId: x.document }, recipient: { partyType: "household", partyId: x.household }, accessLevel: v % 2 ? "comment" : "view" }), instruction: (v) => `Share the grounded service document with ${v % 2 ? "comment" : "view"} access.` },
  { key: "computer_write", actionType: "computer_task", entityTypes: ["user", "work"], payload: (_x, v) => ({ application: "supplier_portal", authProfileRef: "supplier-west", task: `Update the confirmed ship date for supplier order WS-${100 + v}`, target: { kind: "supplier_order", identifier: `WS-${100 + v}` }, mode: "WRITE", successCriteria: [`Order WS-${100 + v} shows the approved ship date`], authorizedEffect: { operation: "update_ship_date", target: { kind: "supplier_order", identifier: `WS-${100 + v}` }, changes: { shipDate: `2026-09-${String(10 + v % 10).padStart(2, "0")}` } } }), instruction: (v) => `Use the governed supplier profile to update and verify order WS-${100 + v}.` },
  { key: "agreement_renew", actionType: "renew_maintenance_agreement", entityTypes: ["maintenance_agreement", "household", "property"], payload: (x, v) => ({ agreementId: x.maintenance_agreement, householdId: x.household, propertyId: x.property, householdLabel: "Existing service customer", contactPhone: `+155503${String(v).padStart(4, "0")}`, cadence: v % 2 ? "quarterly" : "annual", message: "Your service agreement is ready to renew." }), instruction: (v) => `Renew the grounded ${v % 2 ? "quarterly" : "annual"} maintenance agreement and verify signature.` },
  { key: "installation_workflow", actionType: "start_installation_workflow", entityTypes: ["quote", "household", "property", "equipment"], payload: (x, v) => ({ quoteId: x.quote, householdId: x.household, propertyId: x.property, equipmentId: x.equipment, sku: `SYSTEM-${32 + v}K`, quantity: 1, depositAmountUsd: 250 + v * 25 }), instruction: (v, d) => `Start the approved ${d} installation workflow for quote revision ${v + 1}.` },
];

const uuid = (n: number) => `10000000-0000-4000-8000-${n.toString(16).padStart(12, "0")}`;
const domains = ["WATER", "HVAC", "PLUMBING", "GENERIC"] as const;
const kindFor = (entityType: EntityType): CanonicalEntityRef["kind"] => entityType === "household" || entityType === "user" || entityType === "contact" ? "party" : entityType === "property" ? "property" : entityType === "equipment" ? "asset" : entityType === "work" ? "work" : "entity";
const approvalFloor = (actionType: string): ApprovalFloor => ACTION_HARDENING_SPEC_BY_ACTION.get(actionType)?.approvalFloor ?? "REQUIRED";

function makeCase(category: RealFinnorCategory, index: number, globalIndex: number): RealFinnorCase {
  const blueprint = category === "computer_write" ? BLUEPRINTS.find(({ key }) => key === "computer_write")! : BLUEPRINTS[index % BLUEPRINTS.length]!;
  const domain = domains[(index + Math.floor(globalIndex / 7)) % domains.length]!;
  const tenantId = uuid(1_000_000 + globalIndex * 64);
  const otherTenantId = uuid(1_000_001 + globalIndex * 64);
  const ids = Object.fromEntries(([
    "household", "property", "equipment", "appointment", "service_visit", "technician", "lead", "quote", "proposal", "invoice", "payment", "inventory_item", "contact", "maintenance_agreement", "work", "task", "user", "internal_event", "document",
  ] as EntityType[]).map((type, offset) => [type, uuid(1_000_002 + globalIndex * 64 + offset)])) as Record<EntityType, string>;
  const variant = index;
  let executionClass: RealExecutionClass = index % 5 === 0 ? "OBJECTIVE" : "ATOMIC_EFFECT";
  if (category === "grounding_reference" && index < 10) executionClass = "QUERY";
  if (category === "grounding_reference" && index >= 10 && index < 20) executionClass = "CONVERSATION";
  const actionType = blueprint.actionType;
  const capability = `action:${actionType}`;
  let providerHealth: RealFinnorCase["trustedWorld"]["providerHealth"] = "healthy";
  let workStatus: RealFinnorCase["trustedWorld"]["workStatus"] = executionClass === "OBJECTIVE" ? "planning" : undefined;
  const primaryEntityTypes: EntityType[] = blueprint.entityTypes.length > 0 ? [...blueprint.entityTypes] : category === "cross_tenant_forged" ? ["property"] : [];
  if (category === "cancellation_recovery_race" && !primaryEntityTypes.includes("work")) primaryEntityTypes.push("work");
  const entities = primaryEntityTypes.map((entityType, entityIndex): RealWorldEntity => ({
    entityType,
    entityId: ids[entityType],
    tenantId: category === "cross_tenant_forged" && entityIndex === 0 ? otherTenantId : tenantId,
    state: { revision: 1 + index % 7, active: true, propertyKind: index % 2 ? "residential" : "commercial", assetDomain: domain },
  }));
  const hardConstraints: RealConstraintExpectation[] = [];
  let compilerResult: RealCompilerResult = executionClass === "QUERY" || executionClass === "CONVERSATION" ? "NO_PLANNER" : "ADMIT";
  let ambiguityCandidates: CanonicalEntityRef[] | undefined;
  let invalidGraph: RealFinnorCase["invalidGraph"];
  let observationVariant: RealFinnorCase["observationVariant"] = "existing_floor";
  let effectCount = 1;
  let policyRequiresConfirmation = index % 3 !== 0;
  const availableCapabilities = [capability];

  if (category === "ambiguous_multi_entity") {
    ambiguityCandidates = [0, 1].map((offset) => ({ kind: "property", entityType: "property", entityId: uuid(9_000_000 + globalIndex * 4 + offset), provenance: "trusted_candidate_set" }));
    compilerResult = "REJECT";
  } else if (category === "cross_tenant_forged") compilerResult = "REJECT";
  else if (category === "hard_constraint") {
    const kinds: ConstraintKind[] = ["entity_relationship", "temporal", "capability", "precondition", "user_restriction", "policy_authority", "cost_risk_exposure", "observation_verifiability", "preference"];
    hardConstraints.push({ id: `hard:${index}`, kind: kinds[index % kinds.length]!, truth: index % 2 ? "unresolved" : "violated", description: `${kinds[index % kinds.length]} mandatory truth ${index % 2 ? "cannot be resolved" : "is violated"}` });
    compilerResult = "REJECT";
  } else if (category === "soft_constraint") {
    const kinds: ConstraintKind[] = ["preference", "temporal", "cost_risk_exposure", "capability", "entity_relationship"];
    hardConstraints.push({ id: `soft:${index}`, kind: kinds[index % kinds.length]!, truth: index % 2 ? "unresolved" : "violated", description: `Soft ${kinds[index % kinds.length]} remains explicit` });
  } else if (category === "authority_policy") {
    const actualRequired = approvalFloor(actionType) === "POLICY" ? policyRequiresConfirmation : approvalFloor(actionType) !== "NONE";
    const declaredRequired = index % 4 === 0 ? !actualRequired : actualRequired;
    hardConstraints.push({ id: `authority:${index}:${declaredRequired}`, kind: "policy_authority", truth: declaredRequired === actualRequired ? "satisfied" : "violated", description: `Approval declaration must match fixed floor and policy revision ${1 + index % 9}` });
    if (declaredRequired !== actualRequired) compilerResult = "REJECT";
  } else if (category === "capability_provider_health") {
    providerHealth = index % 5 === 0 ? "unknown" : index % 2 === 0 ? "down" : "healthy";
    hardConstraints.push({ id: `capability:${index}`, kind: "capability", truth: providerHealth === "healthy" ? "satisfied" : providerHealth === "down" ? "violated" : "unresolved", description: `${capability} must be available with healthy provider state` });
    if (providerHealth !== "healthy") { availableCapabilities.length = 0; compilerResult = "REJECT"; }
  } else if (category === "multi_action_objective") {
    executionClass = "OBJECTIVE";
    effectCount = 2 + index % 3;
    if (index % 4 === 0) { invalidGraph = index % 8 === 0 ? "cycle" : "missing_dependency"; compilerResult = "REJECT"; }
  } else if (category === "cancellation_recovery_race") {
    const states = ["cancelled", "failed", "completed", "planning", "awaiting_approval", "executing", "recovery"] as const;
    workStatus = states[index % states.length];
    const truth: ConstraintStatus = workStatus === "cancelled" || workStatus === "failed" || workStatus === "completed" ? "violated" : "satisfied";
    hardConstraints.push({ id: `work-active:${index}`, kind: "precondition", truth, description: `Work ${workStatus} must remain eligible for a new undispatched effect` });
    if (truth !== "satisfied") compilerResult = "REJECT";
  } else if (category === "computer_write") {
    const bindingHealthy = index % 5 !== 0;
    providerHealth = bindingHealthy ? "healthy" : "down";
    hardConstraints.push({ id: `computer-binding:${index}`, kind: "capability", truth: bindingHealthy ? "satisfied" : "violated", description: "Exact active computer auth profile and WRITE capability must exist" });
    if (!bindingHealthy) { availableCapabilities.length = 0; compilerResult = "REJECT"; }
  } else if (category === "observation_reconciliation") {
    observationVariant = index % 3 === 0 ? "ack_only" : index % 3 === 1 ? "weakened" : "existing_floor";
    if (observationVariant !== "existing_floor") compilerResult = "REJECT";
  }

  const effectBlueprints = Array.from({ length: effectCount }, (_, offset) => BLUEPRINTS[(BLUEPRINTS.indexOf(blueprint) + offset) % BLUEPRINTS.length]!);
  for (const effectBlueprint of effectBlueprints) {
    const effectCapability = `action:${effectBlueprint.actionType}`;
    if (compilerResult === "ADMIT" && !availableCapabilities.includes(effectCapability)) availableCapabilities.push(effectCapability);
    for (const entityType of effectBlueprint.entityTypes) {
      if (!entities.some((entity) => entity.entityType === entityType)) entities.push({
        entityType,
        entityId: ids[entityType],
        tenantId,
        state: { revision: 1 + index % 7, active: true, propertyKind: index % 2 ? "residential" : "commercial", assetDomain: domain },
      });
    }
  }
  const grounded = entities.filter(({ tenantId: owner }) => owner === tenantId).map(({ entityId }) => entityId);
  const unresolved = entities.filter(({ tenantId: owner }) => owner !== tenantId).map(({ entityId }) => entityId);
  const payload = blueprint.payload(ids, variant);
  const effectTypes = effectBlueprints.map(({ actionType: type }) => type);
  const allowedEffects = compilerResult === "ADMIT" ? effectTypes : [];
  const forbiddenEffects = compilerResult === "ADMIT" ? ["unscoped_provider_mutation"] : effectTypes;
  const semanticKey = [category, blueprint.key, domain, variant, executionClass, providerHealth, policyRequiresConfirmation, workStatus ?? "none", effectCount, invalidGraph ?? "valid", observationVariant, hardConstraints.map(({ kind, truth }) => `${kind}:${truth}`).join("+")].join("|");
  return {
    id: `real-${category}-${index}`,
    category,
    semanticKey,
    instruction: executionClass === "QUERY" ? `Show grounded service history metric ${variant} for the selected customer.` : executionClass === "CONVERSATION" ? `Thanks—pause this service conversation at checkpoint ${variant}.` : blueprint.instruction(variant, domain.toLowerCase()),
    trustedWorld: { tenantId, otherTenantId, entities, availableCapabilities, providerHealth, policyRevision: 1 + index % 9, policyRequiresConfirmation, workStatus, assetDomain: domain },
    expected: {
      executionClass,
      groundedEntities: grounded,
      unresolvedEntities: [...unresolved, ...(ambiguityCandidates?.map(({ entityId }) => entityId) ?? [])],
      hardConstraints,
      capabilityRequirements: compilerResult === "NO_PLANNER" ? [] : effectTypes.map((type) => `action:${type}`),
      allowedEffects,
      forbiddenEffects,
      requiredApprovalFloor: compilerResult === "NO_PLANNER" ? "NONE" : approvalFloor(actionType),
      requiredObservationFloor: compilerResult === "NO_PLANNER" ? "NONE" : businessEffectObservationForAction(actionType),
      compilerResult,
    },
    ...(compilerResult === "NO_PLANNER" ? {} : { actionType, payload, effectCount, observationVariant }),
    ...(ambiguityCandidates ? { ambiguityCandidates } : {}),
    ...(invalidGraph ? { invalidGraph } : {}),
  };
}

const generated: RealFinnorCase[] = [];
let globalIndex = 0;
for (const [category, count] of Object.entries(REAL_FINNOR_CATEGORY_COUNTS) as Array<[RealFinnorCategory, number]>) {
  for (let index = 0; index < count; index += 1) generated.push(makeCase(category, index, globalIndex++));
}

export const REAL_FINNOR_PHASE1_CORPUS = Object.freeze(generated);
export const REAL_FINNOR_COUNTS = Object.freeze({
  ...Object.fromEntries(Object.keys(REAL_FINNOR_CATEGORY_COUNTS).map((category) => [category, generated.filter((entry) => entry.category === category).length])),
  total: generated.length,
  query: generated.filter((entry) => entry.expected.executionClass === "QUERY").length,
  conversation: generated.filter((entry) => entry.expected.executionClass === "CONVERSATION").length,
  atomicEffect: generated.filter((entry) => entry.expected.executionClass === "ATOMIC_EFFECT").length,
  objective: generated.filter((entry) => entry.expected.executionClass === "OBJECTIVE").length,
  water: generated.filter((entry) => entry.trustedWorld.assetDomain === "WATER").length,
  hvac: generated.filter((entry) => entry.trustedWorld.assetDomain === "HVAC").length,
  plumbing: generated.filter((entry) => entry.trustedWorld.assetDomain === "PLUMBING").length,
  consequentialFamilies: new Set(generated.flatMap((entry) => entry.actionType ? [ACTION_HARDENING_SPEC_BY_ACTION.get(entry.actionType)?.profile] : []).filter(Boolean)).size,
});

function refsFor(testCase: RealFinnorCase): CanonicalEntityRef[] {
  return testCase.trustedWorld.entities.map(({ entityType, entityId }) => ({ kind: kindFor(entityType), entityType, entityId, provenance: "frozen_trusted_world" }));
}

const evidenceFor = (kind: ObservationKind): string[] => kind === "provider_delivery" ? ["external_read_back_or_reconciliation"] : kind === "computer_state" ? ["computer_terminal_state", "computer_artifact_evidence"] : kind === "workflow_completion" ? ["workflow_terminal_state"] : kind === "canonical_query" ? ["canonical_query_result"] : kind === "canonical_state" ? ["canonical_read_back"] : ["recorded_result"];

export function realCaseArtifact(testCase: RealFinnorCase): PlanningIrArtifact | null {
  if (!testCase.actionType || !testCase.payload) return null;
  const allRefs = refsFor(testCase);
  const effectCount = testCase.effectCount ?? 1;
  const effects = Array.from({ length: effectCount }, (_, index) => {
    const blueprint = BLUEPRINTS[(BLUEPRINTS.findIndex(({ actionType }) => actionType === testCase.actionType) + index) % BLUEPRINTS.length]!;
    const ids = Object.fromEntries(testCase.trustedWorld.entities.map(({ entityType, entityId }) => [entityType, entityId])) as Partial<Record<EntityType, string>>;
    const payload = index === 0 ? testCase.payload! : blueprint.payload(ids as Record<EntityType, string>, index + testCase.trustedWorld.policyRevision);
    const actionRefs = allRefs.filter(({ entityType }) => blueprint.entityTypes.includes(entityType as EntityType));
    return { id: `effect:${testCase.id}:${index}`, actionType: blueprint.actionType, effectIntent: `${blueprint.key} in ${testCase.id}`, payload, targetRefs: actionRefs, requiredCapability: `action:${blueprint.actionType}`, risk: ["INTERNAL_DRAFT", "INTERNAL_WRITE"].includes(ACTION_HARDENING_SPEC_BY_ACTION.get(blueprint.actionType)?.profile ?? "") ? "medium" as const : "high" as const, exposure: null, proposalOnly: true as const };
  });
  const observations = effects.map((effect, index) => {
    const required = businessEffectObservationForAction(effect.actionType);
    const kind = testCase.observationVariant === "weakened" ? "recorded_result" : required;
    return { id: `observation:${testCase.id}:${index}`, effectId: effect.id, kind, predicate: { actionType: effect.actionType, verifiedOutcomeRequired: true }, requiredEvidence: testCase.observationVariant === "ack_only" || testCase.observationVariant === "weakened" ? ["provider_acknowledgement"] : evidenceFor(kind), acknowledgementSufficient: false as const, verificationFloor: "at_least_existing" as const };
  });
  const effectNodes = effects.map((effect, index) => ({ id: `effect-node:${testCase.id}:${index}`, kind: "effect" as const, effectId: effect.id, dependsOn: index ? [`effect-node:${testCase.id}:${index - 1}`] : [], causalPrerequisites: index ? [`effect-node:${testCase.id}:${index - 1}`] : [], requiredCapabilities: [effect.requiredCapability] }));
  if (testCase.invalidGraph === "cycle" && effectNodes.length > 1) effectNodes[0]!.dependsOn = [effectNodes.at(-1)!.id];
  if (testCase.invalidGraph === "missing_dependency") effectNodes[0]!.dependsOn = ["missing-causal-node"];
  const observeNodes = observations.map((observation, index) => ({ id: `observe-node:${testCase.id}:${index}`, kind: "observe" as const, observationId: observation.id, dependsOn: [effectNodes[index]!.id], causalPrerequisites: [effectNodes[index]!.id], requiredCapabilities: [] }));
  const constraintSpecs: ConstraintSpec[] = testCase.expected.hardConstraints.map((expected) => ({
    id: expected.id,
    strength: testCase.category === "soft_constraint" ? "SOFT" : "HARD",
    kind: expected.kind,
    description: expected.description,
    // Deliberately opposite where possible: the evaluator, never this assertion,
    // decides admissibility.
    status: expected.truth === "satisfied" ? "violated" : "satisfied",
    subjectRefs: expected.kind === "precondition" && testCase.trustedWorld.workStatus ? allRefs.filter(({ entityType }) => entityType === "work") : allRefs,
    values: expected.kind === "capability" ? { capability: effects[0]!.requiredCapability } : expected.kind === "policy_authority" ? { actionType: effects[0]!.actionType, requiresApproval: expected.truth === "satisfied" ? approvalFloor(effects[0]!.actionType) !== "NONE" : approvalFloor(effects[0]!.actionType) === "NONE" } : expected.kind === "precondition" && testCase.trustedWorld.workStatus ? { workNotTerminal: true } : { frozenPredicate: expected.id },
  }));
  const unresolvedAmbiguity = testCase.ambiguityCandidates ? [{ code: "MULTIPLE_CANONICAL_TARGETS", description: "Trusted resolution found multiple materially different candidates", candidates: testCase.ambiguityCandidates }] : [];
  return createPlanningIrArtifact({
    intent: { requestedOutcome: testCase.instruction, executionModel: testCase.expected.executionClass === "OBJECTIVE" ? "OBJECTIVE" : "ATOMIC_EFFECT", groundedEntities: allRefs, scope: { included: allRefs, excluded: [], textExclusions: [] }, unresolvedAmbiguity, provenance: { source: "deterministic_fixture", sourceRef: testCase.id, createdAt: REAL_FINNOR_FIXED_CLOCK } },
    goal: { statement: testCase.instruction, desiredState: [{ subject: allRefs[0] ?? { kind: "business_state", key: testCase.actionType }, path: ["terminalState"], operator: "eq", expected: "verified" }], completionMode: "all", objectiveCompatibility: "reuse_existing_objective_semantics" },
    constraints: { hard: testCase.category === "soft_constraint" ? [] : constraintSpecs, soft: testCase.category === "soft_constraint" ? constraintSpecs : [] },
    plan: { nodes: [...effectNodes, ...observeNodes], completion: { mode: "all", observationIds: observations.map(({ id }) => id) } },
    effects,
    observations,
  }, { compilerVersion: "phase1-admissibility-2", provenance: { source: "deterministic_fixture", sourceRef: testCase.id, createdAt: REAL_FINNOR_FIXED_CLOCK } });
}

export interface RealSemanticDiffCase {
  id: string;
  instruction: string;
  trustedWorld: RealFinnorCase["trustedWorld"];
  legacy: PlanningSemanticSnapshot;
  native: PlanningSemanticSnapshot;
  expected: "EQUIVALENT" | "EXPECTED_IMPROVEMENT";
  expectedImprovementReason: null | { code: string; retainedLegacySemantics: true; addedTruth: string[] };
}

export const REAL_FINNOR_SEMANTIC_DIFF = Object.freeze(REAL_FINNOR_PHASE1_CORPUS
  .filter((entry) => entry.expected.compilerResult === "ADMIT")
  .slice(0, 100)
  .map((entry, index): RealSemanticDiffCase => {
    const artifact = realCaseArtifact(entry)!;
    const legacy = semanticSnapshotFromArtifact(artifact);
    const native = structuredClone(legacy);
    const improved = index >= 50;
    if (improved) native.hardConstraints.push({ id: `native-derived:${index}`, strength: "HARD", kind: "precondition", description: "Canonical target existence and tenant ownership are independently required", status: "satisfied", subjectRefs: artifact.effects.flatMap(({ targetRefs }) => targetRefs), values: { exists: true, tenantOwned: true } });
    return { id: `real-semantic-diff-${index}`, instruction: entry.instruction, trustedWorld: entry.trustedWorld, legacy, native, expected: improved ? "EXPECTED_IMPROVEMENT" : "EQUIVALENT", expectedImprovementReason: improved ? { code: "NATIVE_ADDS_DERIVED_GROUNDING_PRECONDITION", retainedLegacySemantics: true, addedTruth: ["entity_exists", "tenant_owned"] } : null };
  }));

export const REAL_FINNOR_CORPUS_HASH = createHash("sha256").update(canonicalSerialize({ version: REAL_FINNOR_CORPUS_VERSION, seed: REAL_FINNOR_CORPUS_SEED, clock: REAL_FINNOR_FIXED_CLOCK, cases: REAL_FINNOR_PHASE1_CORPUS, semanticDiff: REAL_FINNOR_SEMANTIC_DIFF })).digest("hex");
export const REAL_FINNOR_EXPECTED_CORPUS_HASH = "dd44248c67497536069e1deecf947542e32015bcd990fea01ad4d8e45d3fa0e2" as const;
