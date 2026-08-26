import { createHash } from "node:crypto";
import {
  canonicalSerialize,
  computeIrSemanticHash,
  createPlanningIrArtifact,
  type CanonicalEntityRef,
  type ConstraintSpec,
  type ObservationKind,
  type PlanningIrArtifact,
  type PlanningSemanticSnapshot,
} from "@finnor/planning-ir";
import { businessEffectObservationForAction, semanticSnapshotFromArtifact } from "@finnor/orchestration";
import { ACTION_HARDENING_SPEC, type ActionHardeningSpecRow } from "../../scripts/release/action-hardening-spec";

export const PHASE1_CORPUS_VERSION = "phase1-2.0.0" as const;
export const PHASE1_CORPUS_SEED = 0x0f1a0b1c;
export const PHASE1_FIXED_CLOCK = "2026-08-26T00:00:00.000Z";

const uuid = (value: number) => `00000000-0000-4000-8000-${value.toString(16).padStart(12, "0")}`;
const consequential = ACTION_HARDENING_SPEC.filter((row) => !["READ_ONLY", "META_NO_SIDE_EFFECT"].includes(row.profile));
export const PHASE1_CONSEQUENTIAL_ACTION_TYPES = Object.freeze(consequential.map((row) => row.actionType));
export const PHASE1_CONSEQUENTIAL_ACTION_FAMILIES = Object.freeze([...new Set(consequential.map((row) => row.profile))].sort());

export type LockedCase =
  | { id: string; suite: "routing"; semantic: string; expected: "QUERY" | "ATOMIC_EFFECT" | "OBJECTIVE" | "CONVERSATION"; instruction: string; conversational?: boolean; fastRead: boolean }
  | { id: string; suite: "ir"; semantic: string; expected: "ADMISSIBLE_AND_LOWERABLE"; artifact: PlanningIrArtifact; effectCount: number; actionTypes: string[]; assetDomain?: "WATER" | "HVAC" | "PLUMBING"; scenarioTags: string[] }
  | { id: string; suite: "malformed"; semantic: string; expected: "REJECT"; artifact: PlanningIrArtifact; scenarioTags: string[] }
  | { id: string; suite: "forged"; semantic: string; expected: "REJECT_NOT_GROUNDED"; artifact: PlanningIrArtifact; forgery: "CROSS_TENANT" | "NONEXISTENT" }
  | { id: string; suite: "constraint"; semantic: string; expected: "REJECT_HARD" | "ADMIT_SOFT"; artifact: PlanningIrArtifact; scenarioTags: string[] }
  | { id: string; suite: "semantic_diff"; semantic: string; expected: "EQUIVALENT" | "EXPECTED_IMPROVEMENT" | "REGRESSION"; legacy: PlanningSemanticSnapshot; ir: PlanningSemanticSnapshot; actionType: string };

interface ScenarioIds {
  household: string; property: string; equipment: string; technician: string; visit: string; invoice: string; quote: string; proposal: string;
  contact: string; agreement: string; employee: string; team: string; work: string; task: string; delegation: string; internalEvent: string; document: string;
}

function ids(index: number): ScenarioIds {
  const base = 100_000 + index * 32;
  return {
    household: uuid(base + 1), property: uuid(base + 2), equipment: uuid(base + 3), technician: uuid(base + 4), visit: uuid(base + 5),
    invoice: uuid(base + 6), quote: uuid(base + 7), proposal: uuid(base + 8), contact: uuid(base + 9), agreement: uuid(base + 10),
    employee: uuid(base + 11), team: uuid(base + 12), work: uuid(base + 13), task: uuid(base + 14), delegation: uuid(base + 15),
    internalEvent: uuid(base + 16), document: uuid(base + 17),
  };
}

function businessPayload(actionType: string, index: number): Record<string, unknown> {
  const x = ids(index);
  const amount = 125 + (index % 17) * 25;
  const when = `2026-09-${String(1 + (index % 20)).padStart(2, "0")}T${String(8 + (index % 8)).padStart(2, "0")}:00:00.000Z`;
  const payloads: Record<string, Record<string, unknown>> = {
    create_invoice: { householdId: x.household, customerName: "Existing service customer", amountUsd: amount, memo: `Completed service visit ${index}` },
    send_payment_reminder: { invoiceId: x.invoice, channel: index % 2 ? "sms" : "email" },
    record_payment: { invoiceId: x.invoice },
    call_overdue_invoices: {},
    bulk_notify_existing_customers: { offerScript: `Seasonal service offer ${index}`, channel: "sms", discountPercent: 5 + (index % 4) * 5, minDaysInactive: 90 + index % 30 },
    generate_compliance_summary: { householdLabel: "Existing service customer", waterProfile: { hardness_gpg: 8 + index % 18, pfoa_ppt: index % 5, pfos_ppt: index % 4 } },
    create_lead: { name: `Inbound lead scenario ${index}`, phone: `+1555${String(10_000_000 + index).slice(-7)}`, address: `${100 + index} Service Lane`, notes: "Requested an onsite assessment" },
    update_lead_status: { householdId: x.household, status: index % 2 ? "qualified" : "contacted" },
    log_interaction: { householdId: x.household, channel: "call", direction: "inbound", content: `Customer confirmed service requirement ${index}` },
    assign_lead_to_technician: { householdId: x.household, technicianId: x.technician, phone: `+1555${String(20_000_000 + index).slice(-7)}` },
    send_customer_message: { householdId: x.household, message: `Your service appointment ${index} is confirmed.`, channel: "sms", phone: `+1555${String(30_000_000 + index).slice(-7)}` },
    send_follow_up: { householdId: x.household, phone: `+1555${String(40_000_000 + index).slice(-7)}`, context: `Follow up after completed visit ${index}` },
    flag_reorder_needed: { sku: `FILTER-${10 + index % 8}`, name: "Replacement filter", reasoning: "Available stock is below the service threshold", suggestedQuantity: 2 + index % 8 },
    log_stock_used_on_visit: { sku: `FILTER-${10 + index % 8}`, quantity: 1 + index % 3, visitId: x.visit },
    start_invoice_to_cash_workflow: { invoiceId: x.invoice, contactId: x.contact, channel: "sms" },
    start_water_test_workflow: { householdId: x.household, technicianId: x.technician, scheduledAt: when, phoneNumber: `+1555${String(50_000_000 + index).slice(-7)}`, confirmationMessage: "Your water test is scheduled." },
    renew_maintenance_agreement: { agreementId: x.agreement, householdId: x.household, householdLabel: "Existing service customer", contactPhone: `+1555${String(60_000_000 + index).slice(-7)}`, cadence: "annual", message: "Your annual service agreement is ready to renew." },
    launch_ad_campaign: { name: `Fall service campaign ${index}`, dailyBudgetUsd: 10 + index % 40, objective: "leads", targetZip: String(33_000 + index % 900) },
    create_review_request: { householdId: x.household, contactName: "Completed-service customer", phone: `+1555${String(70_000_000 + index).slice(-7)}` },
    send_proposal_to_recent_installs: { windowDays: 30 + index % 60, limit: 5 + index % 10, offerNote: `Whole-home follow-up offer ${index}` },
    request_proposal_signature: { proposalId: x.proposal, signerName: "Property decision maker", signerEmail: `owner${index}@example.test` },
    start_installation_workflow: { quoteId: x.quote, householdId: x.household, sku: `SOFTENER-${32 + index % 32}K`, quantity: 1, depositAmountUsd: amount },
    generate_quote: { householdId: x.household, householdLabel: "Existing service customer", items: [`Treatment system option ${1 + index % 4}`], notes: `Quote scenario ${index}` },
    send_proposal: { proposalId: x.proposal, channel: "email", email: `owner${index}@example.test` },
    assign_technician_to_visit: { visitId: x.visit, technicianId: x.technician },
    reschedule_visit: { visitId: x.visit, newTime: when, reason: `Customer scheduling conflict ${index}` },
    log_visit_report: { visitId: x.visit, householdId: x.household, report: `Observed and documented service condition ${index}`, markCompleted: false },
    flag_visit_issue: { visitId: x.visit, issue: `Follow-up part required for visit ${index}` },
    schedule_water_test: { householdId: x.household, address: `${100 + index} Service Lane`, contactPhone: `+1555${String(80_000_000 + index).slice(-7)}`, contactName: "Service customer", requestedAt: when, technicianId: x.technician },
    send_message: { recipient: { partyType: "employee", partyId: x.employee }, channel: "internal", body: `Dispatch update ${index}` },
    place_call: { recipient: { partyType: "household", partyId: x.household }, objective: `Confirm access for appointment ${index}`, script: "Confirm the service window and property access." },
    request_acknowledgement: { recipient: { partyType: "employee", partyId: x.employee }, request: `Acknowledge dispatch handoff ${index}`, deadline: when },
    notify_group: { teamRef: { partyType: "team", partyId: x.team }, channel: "internal", body: `Weather routing update ${index}` },
    create_task: { subjectRef: { entityType: "household", entityId: x.household }, title: `Order follow-up part ${index}`, priority: index % 3 ? "normal" : "high" },
    assign_task: { taskRef: { taskId: x.task }, assigneeRef: { partyType: "employee", partyId: x.employee } },
    update_task: { taskRef: { taskId: x.task }, status: "done" },
    handoff_work: { workRef: { workId: x.work }, targetEmployeeRef: { partyType: "employee", partyId: x.employee }, note: `Handoff with property context ${index}` },
    delegate_objective: { workRef: { workId: x.work }, targetRef: { partyType: "employee", partyId: x.employee }, objective: `Complete customer recovery objective ${index}`, acknowledgementDeadline: when, completionDeadline: `2026-10-${String(1 + index % 20).padStart(2, "0")}T12:00:00.000Z` },
    escalate_work: { delegationRef: { delegationId: x.delegation }, targetRef: { partyType: "employee", partyId: x.employee }, reason: `Customer-impact deadline at risk ${index}`, evidenceRefs: [] },
    cancel_delegation: { delegationRef: { delegationId: x.delegation }, reason: `Objective cancelled before dispatch ${index}` },
    schedule_internal_event: { title: `Installation readiness review ${index}`, startsAt: when, endsAt: when.replace(":00:00.000Z", ":30:00.000Z"), participants: [{ partyType: "employee", partyId: x.employee }] },
    reschedule_internal_event: { internalEventRef: { internalEventId: x.internalEvent }, startsAt: when, endsAt: when.replace(":00:00.000Z", ":30:00.000Z"), reason: `Technician conflict ${index}` },
    share_document: { documentRef: { documentId: x.document }, recipient: { partyType: "household", partyId: x.household }, accessLevel: "view" },
    computer_task: { application: "supplier_portal", authProfileRef: "supplier-west", task: `Update confirmed ship date for order WS-${index}`, target: { kind: "supplier_order", identifier: `WS-${index}` }, mode: "WRITE", successCriteria: [`Order WS-${index} shows the approved ship date`], authorizedEffect: { operation: "update_ship_date", target: { kind: "supplier_order", identifier: `WS-${index}` }, changes: { shipDate: "2026-09-15" } } },
  };
  const payload = payloads[actionType];
  if (!payload) throw new Error(`Locked corpus lacks a real business payload for consequential action ${actionType}`);
  return payload;
}

const evidenceFor = (kind: ObservationKind): string[] => kind === "provider_delivery" ? ["external_observation_or_reconciliation"]
  : kind === "computer_state" ? ["computer_terminal_state", "computer_evidence"]
    : kind === "workflow_completion" ? ["workflow_terminal_state"]
      : kind === "canonical_query" ? ["canonical_query_result"]
        : kind === "canonical_state" ? ["canonical_read_back"] : ["recorded_result"];

const riskFor = (row: ActionHardeningSpecRow): "low" | "medium" | "high" => ["INTERNAL_DRAFT", "INTERNAL_WRITE"].includes(row.profile) ? "medium" : "high";

function realArtifact(index: number, options: { domain?: "WATER" | "HVAC" | "PLUMBING"; hard?: ConstraintSpec[]; soft?: ConstraintSpec[]; multiStep?: boolean } = {}): PlanningIrArtifact {
  const rows = [consequential[index % consequential.length]!, consequential[(index + 7) % consequential.length]!];
  const selected = options.multiStep ? rows : rows.slice(0, 1);
  const x = ids(index);
  const propertyRef: CanonicalEntityRef = { kind: "property", entityType: "property", entityId: x.property, field: "propertyId", relationship: "service_location" };
  const householdRef: CanonicalEntityRef = { kind: "party", entityType: "household", entityId: x.household, field: "householdId", relationship: "customer_account" };
  const assetRef: CanonicalEntityRef = { kind: "asset", entityType: "equipment", entityId: x.equipment, field: "equipmentId", relationship: "installed_at" };
  const refs = [householdRef, propertyRef, assetRef];
  const effects = selected.map((row, effectIndex) => {
    const payload = businessPayload(row.actionType, index + effectIndex);
    const amount = Object.entries(payload).find(([key, value]) => /(?:amount|budget|cost|price).*usd/i.test(key) && typeof value === "number")?.[1];
    return { id: `effect-${index}-${effectIndex}`, actionType: row.actionType, effectIntent: `${row.actionType.replaceAll("_", " ")} for the grounded service account and property`, payload, targetRefs: refs, requiredCapability: `action:${row.actionType}`, risk: riskFor(row), exposure: typeof amount === "number" ? { amount, currency: "USD" } : null, proposalOnly: true as const };
  });
  const observations = effects.map((effect, effectIndex) => {
    const kind = businessEffectObservationForAction(effect.actionType);
    return { id: `observation-${index}-${effectIndex}`, effectId: effect.id, kind, predicate: { actionType: effect.actionType, canonicalOutcomeRequired: true }, requiredEvidence: evidenceFor(kind), acknowledgementSufficient: false as const, verificationFloor: "at_least_existing" as const };
  });
  const effectNodes = effects.map((effect, effectIndex) => ({ id: `effect-node-${index}-${effectIndex}`, kind: "effect" as const, effectId: effect.id, dependsOn: effectIndex === 0 ? [] : [`effect-node-${index}-${effectIndex - 1}`], causalPrerequisites: effectIndex === 0 ? [] : [`effect-node-${index}-${effectIndex - 1}`], requiredCapabilities: [effect.requiredCapability] }));
  const observeNodes = observations.map((observation, effectIndex) => ({ id: `observe-node-${index}-${effectIndex}`, kind: "observe" as const, observationId: observation.id, dependsOn: [effectNodes[effectIndex]!.id], causalPrerequisites: [effectNodes[effectIndex]!.id], requiredCapabilities: [] }));
  const domain = options.domain ?? "GENERIC";
  const requestedOutcome = selected.length > 1 ? `Complete governed ${selected.map((row) => row.actionType.replaceAll("_", " ")).join(" then ")} and verify every resulting business state` : `Complete governed ${selected[0]!.actionType.replaceAll("_", " ")} and verify the resulting business state`;
  const authorityConstraints: ConstraintSpec[] = selected.map((row, constraintIndex) => ({ id: `authority-${index}-${constraintIndex}`, strength: "HARD", kind: "policy_authority", description: `Current approval truth for ${row.actionType} must be enforced`, status: index % 2 ? "violated" : "satisfied", subjectRefs: refs, values: { requiresApproval: row.approvalFloor !== "NONE", actualTruth: "satisfied" } }));
  return createPlanningIrArtifact({
    intent: { requestedOutcome, executionModel: selected.length > 1 || index % 5 === 0 ? "OBJECTIVE" : "ATOMIC_EFFECT", groundedEntities: refs, scope: { included: refs, excluded: [], textExclusions: [`Do not widen beyond service property scenario ${index}`] }, unresolvedAmbiguity: [], provenance: { source: "deterministic_fixture", sourceRef: `${PHASE1_CORPUS_VERSION}:business:${index}`, createdAt: PHASE1_FIXED_CLOCK, traceId: `trace-${index}` } },
    goal: { statement: requestedOutcome, desiredState: [{ subject: options.domain ? assetRef : { kind: "business_state", key: selected.map((row) => row.actionType).join("+") }, path: options.domain ? ["domain"] : ["terminalStatus"], operator: "eq", expected: options.domain ?? "verified" }], completionMode: "all", objectiveCompatibility: "reuse_existing_objective_semantics" },
    constraints: { hard: options.hard ?? authorityConstraints, soft: options.soft ?? [] },
    plan: { nodes: [...effectNodes, ...observeNodes], completion: { mode: "all", observationIds: observations.map((observation) => observation.id) } },
    effects,
    observations,
  }, { compilerVersion: "phase1-admissibility-2", provenance: { source: "deterministic_fixture", sourceRef: `${PHASE1_CORPUS_VERSION}:business:${index}`, createdAt: PHASE1_FIXED_CLOCK, traceId: `trace-${index}` } });
}

function rehash(value: PlanningIrArtifact): PlanningIrArtifact { value.metadata.irSemanticHash = computeIrSemanticHash(value); return value; }

function frozenLegacySnapshot(artifact: PlanningIrArtifact): PlanningSemanticSnapshot {
  const effectNodes = artifact.plan.nodes.filter((node): node is Extract<typeof node, { kind: "effect" }> => node.kind === "effect");
  const nodeByEffect = new Map(effectNodes.map((node) => [node.effectId, node]));
  const effectIdByNode = new Map(effectNodes.map((node) => [node.id, node.effectId]));
  const observationByEffect = new Map(artifact.observations.filter((observation) => observation.effectId).map((observation) => [observation.effectId!, observation]));
  return { executionModel: artifact.intent.executionModel, groundedTargets: structuredClone(artifact.intent.groundedEntities), scope: structuredClone(artifact.intent.scope), intendedOutcome: artifact.goal.statement, effects: artifact.effects.map((effect) => ({ actionType: effect.actionType, payload: structuredClone(effect.payload), requiredCapability: effect.requiredCapability, dependsOn: (nodeByEffect.get(effect.id)?.dependsOn ?? []).map((nodeId) => effectIdByNode.get(nodeId) ?? nodeId), observation: observationByEffect.get(effect.id)?.kind ?? "recorded_result", authorityRisk: effect.risk })), hardConstraints: structuredClone(artifact.constraints.hard), completionPredicates: structuredClone(artifact.observations), supported: true, valid: true };
}

const cases: LockedCase[] = [];
const queryScenarios = ["overdue invoice value", "cash collected", "open qualified leads", "technician utilization", "service-due customers", "low-stock SKUs", "pending approval queue", "workflow recovery cases", "customer service history", "schedule capacity"];
const horizons = ["today", "this week", "this month", "this quarter", "year to date", "the rolling thirty-day window"];
for (let i = 0; i < 60; i += 1) cases.push({ id: `routing-query-${i}`, suite: "routing", semantic: `Canonical query for ${queryScenarios[i % 10]} during ${horizons[Math.floor(i / 10)]}`, expected: "QUERY", instruction: `Show ${queryScenarios[i % 10]} for ${horizons[Math.floor(i / 10)]}.`, fastRead: true });
const atomicInstructions = ["Create a $275 invoice for the selected completed visit", "Assign the selected technician to tomorrow's service visit", "Send the approved appointment confirmation to the selected customer", "Record one replacement filter used on the selected visit", "Reschedule the selected visit to the approved time", "Create a follow-up task for the selected service account", "Send the selected proposal for signature", "Create a documented issue record for the selected visit", "Record the confirmed payment against the selected invoice", "Send the selected compliance document to the customer"];
for (let i = 0; i < 60; i += 1) cases.push({ id: `routing-atomic-${i}`, suite: "routing", semantic: `${atomicInstructions[i % 10]} under authority variant ${1 + Math.floor(i / 10)}`, expected: "ATOMIC_EFFECT", instruction: `${atomicInstructions[i % 10]!.replace("approved ", "")} for owner${i}@example.test using policy revision ${1 + Math.floor(i / 10)}.`, fastRead: false });
const objectiveInstructions = ["Follow every overdue invoice through verified customer delivery and reconciliation", "Recover the failed installation workflow and continue until canonical completion", "Convert the selected qualified lead through a completed water-test appointment", "Renew the maintenance agreement and verify the signed external outcome", "Complete the approved proposal-to-installation workflow", "Resolve the customer escalation across dispatch and billing", "Reconcile unknown provider outcomes before retrying customer communications", "Restore the supplier-order update and verify the computer terminal evidence", "Complete every prerequisite for the selected service objective", "Drive the selected invoice-to-cash workflow to its persisted success condition"];
for (let i = 0; i < 60; i += 1) cases.push({ id: `routing-objective-${i}`, suite: "routing", semantic: `${objectiveInstructions[i % 10]} with continuation budget ${1 + Math.floor(i / 10)}`, expected: "OBJECTIVE", instruction: `${objectiveInstructions[i % 10]}; keep working with continuation budget ${1 + Math.floor(i / 10)} until verified.`, fastRead: false });
const conversationInstructions = ["Good morning", "Thanks for the careful explanation", "What kind of assistant are you?", "That makes sense", "Goodbye for now", "How are you doing?", "I appreciate the help", "Can you explain your capabilities conversationally?", "Nice to meet you", "Let's pause here"];
for (let i = 0; i < 60; i += 1) cases.push({ id: `routing-conversation-${i}`, suite: "routing", semantic: `${conversationInstructions[i % 10]} conversation variation ${1 + Math.floor(i / 10)}`, expected: "CONVERSATION", instruction: `${conversationInstructions[i % 10]} — conversation turn ${1 + Math.floor(i / 10)}.`, conversational: true, fastRead: false });

for (let i = 0; i < 320; i += 1) {
  const domain = i >= 260 && i < 280 ? "WATER" : i >= 280 && i < 300 ? "HVAC" : i >= 300 ? "PLUMBING" : undefined;
  const multiStep = i % 8 === 0;
  const artifact = realArtifact(i, { domain, multiStep });
  const actionTypes = artifact.effects.map((effect) => effect.actionType);
  cases.push({ id: `ir-${i}`, suite: "ir", semantic: `${multiStep ? "Multi-step objective" : "Grounded action"} ${actionTypes.join(" then ")} for ${domain ?? "generic home service"} scenario ${i}`, expected: "ADMISSIBLE_AND_LOWERABLE", artifact, effectCount: artifact.effects.length, actionTypes, ...(domain ? { assetDomain: domain } : {}), scenarioTags: [multiStep ? "multi_step_objective" : "atomic_or_single_step", "authority", domain ? "asset_schema" : "business_operation"] });
}

const malformedFamilies = ["self_dependency", "missing_dependency", "cycle", "duplicate_dependency", "duplicate_node_id", "causal_not_dependency", "missing_effect", "missing_observation", "ack_only_verification", "weakened_observation", "unresolved_ambiguity"] as const;
for (let i = 0; i < 200; i += 1) {
  const candidate = structuredClone(realArtifact(1_000 + i));
  const family = malformedFamilies[i % malformedFamilies.length];
  const effectNode = candidate.plan.nodes.find((node) => node.kind === "effect")!;
  const observeNode = candidate.plan.nodes.find((node) => node.kind === "observe")!;
  if (family === "self_dependency") effectNode.dependsOn = [effectNode.id];
  if (family === "missing_dependency") effectNode.dependsOn = [`missing-${i}`];
  if (family === "cycle") { effectNode.dependsOn = [observeNode.id]; observeNode.dependsOn = [effectNode.id]; }
  if (family === "duplicate_dependency") observeNode.dependsOn = [effectNode.id, effectNode.id];
  if (family === "duplicate_node_id") observeNode.id = effectNode.id;
  if (family === "causal_not_dependency") observeNode.dependsOn = [];
  if (family === "missing_effect" && effectNode.kind === "effect") effectNode.effectId = `missing-effect-${i}`;
  if (family === "missing_observation" && observeNode.kind === "observe") observeNode.observationId = `missing-observation-${i}`;
  if (family === "ack_only_verification") candidate.observations[0]!.requiredEvidence = ["provider_acknowledgement"];
  if (family === "weakened_observation") candidate.observations[0]!.kind = "recorded_result";
  if (family === "unresolved_ambiguity") candidate.intent.unresolvedAmbiguity = [{ code: "MULTIPLE_SERVICE_PROPERTIES", description: "Two active properties match the requested service account", candidates: candidate.intent.groundedEntities.filter((ref) => ref.kind === "property") }];
  cases.push({ id: `malformed-${i}`, suite: "malformed", semantic: `${family} in real ${candidate.effects[0]!.actionType} scenario ${i}`, expected: "REJECT", artifact: rehash(candidate), scenarioTags: [family === "unresolved_ambiguity" ? "ambiguity" : "adversarial_graph"] });
}

for (let i = 0; i < 100; i += 1) {
  const candidate = realArtifact(2_000 + i);
  cases.push({ id: `forged-${i}`, suite: "forged", semantic: `${i < 50 ? "Cross-tenant" : "nonexistent"} target in ${candidate.effects[0]!.actionType} scenario ${i}`, expected: "REJECT_NOT_GROUNDED", artifact: candidate, forgery: i < 50 ? "CROSS_TENANT" : "NONEXISTENT" });
}

const constraintKinds: ConstraintSpec["kind"][] = ["entity_relationship", "temporal", "capability", "precondition", "user_restriction", "policy_authority", "cost_risk_exposure", "preference"];
for (let i = 0; i < 100; i += 1) {
  const hard = i < 50;
  const kind = constraintKinds[i % constraintKinds.length]!;
  const truth = i % 2 === 0 ? "violated" : "unresolved";
  const constraint: ConstraintSpec = { id: `constraint-${i}`, strength: hard ? "HARD" : "SOFT", kind, description: `${hard ? "Mandatory" : "Preferred"} ${kind} business bound for scenario ${i}`, status: hard ? "satisfied" : "violated", subjectRefs: [], values: { actualTruth: hard ? truth : "violated", capability: kind === "capability" ? "provider:communications" : undefined, scenario: i } };
  const candidate = realArtifact(3_000 + i, hard ? { hard: [constraint] } : { hard: [], soft: [constraint] });
  cases.push({ id: `constraint-${i}`, suite: "constraint", semantic: `${constraint.strength} ${kind} independently ${hard ? truth : "soft-violated"} for ${candidate.effects[0]!.actionType} scenario ${i}`, expected: hard ? "REJECT_HARD" : "ADMIT_SOFT", artifact: candidate, scenarioTags: [kind === "capability" ? "provider_outage" : kind === "policy_authority" ? "authority" : "constraint_truth", hard && truth === "unresolved" ? "fail_closed" : "known_truth"] });
}

for (let i = 0; i < 100; i += 1) {
  const artifact = realArtifact(4_000 + i, { multiStep: i % 10 === 0 });
  const legacy = frozenLegacySnapshot(artifact);
  const ir = semanticSnapshotFromArtifact(artifact);
  let expected: "EQUIVALENT" | "EXPECTED_IMPROVEMENT" | "REGRESSION" = "EQUIVALENT";
  if (i >= 50 && i < 75) {
    expected = "EXPECTED_IMPROVEMENT";
    ir.hardConstraints.push({ id: `frozen-authority-strengthening-${i}`, strength: "HARD", kind: "precondition", description: `Require canonical state revision ${i}`, status: "satisfied", subjectRefs: [], values: { exists: true, revision: i, actualTruth: "satisfied" } });
  } else if (i >= 75) {
    expected = "REGRESSION";
    ir.intendedOutcome = `${ir.intendedOutcome} but silently omit required external verification ${i}`;
  }
  cases.push({ id: `semantic-diff-${i}`, suite: "semantic_diff", semantic: `Frozen legacy-vs-native ${expected} comparison for ${artifact.effects.map((effect) => effect.actionType).join("+")} scenario ${i}`, expected, legacy, ir, actionType: artifact.effects[0]!.actionType });
}

export const PHASE1_LOCKED_CORPUS = Object.freeze(cases);
export const PHASE1_LOCKED_COUNTS = Object.freeze({
  routing: cases.filter((entry) => entry.suite === "routing").length,
  ir: cases.filter((entry) => entry.suite === "ir").length,
  malformed: cases.filter((entry) => entry.suite === "malformed").length,
  forged: cases.filter((entry) => entry.suite === "forged").length,
  constraint: cases.filter((entry) => entry.suite === "constraint").length,
  semanticDiff: cases.filter((entry) => entry.suite === "semantic_diff").length,
  total: cases.length,
  water: cases.filter((entry) => entry.suite === "ir" && entry.assetDomain === "WATER").length,
  hvac: cases.filter((entry) => entry.suite === "ir" && entry.assetDomain === "HVAC").length,
  plumbing: cases.filter((entry) => entry.suite === "ir" && entry.assetDomain === "PLUMBING").length,
  multiStepObjectives: cases.filter((entry) => entry.suite === "ir" && entry.scenarioTags.includes("multi_step_objective")).length,
  ambiguity: cases.filter((entry) => entry.suite === "malformed" && entry.scenarioTags.includes("ambiguity")).length,
  providerOutage: cases.filter((entry) => entry.suite === "constraint" && entry.scenarioTags.includes("provider_outage")).length,
  consequentialActionTypes: new Set(cases.filter((entry): entry is Extract<LockedCase, { suite: "ir" }> => entry.suite === "ir").flatMap((entry) => entry.actionTypes)).size,
  consequentialActionFamilies: PHASE1_CONSEQUENTIAL_ACTION_FAMILIES.length,
});
export const PHASE1_LOCKED_CORPUS_HASH = createHash("sha256").update(canonicalSerialize({ version: PHASE1_CORPUS_VERSION, seed: PHASE1_CORPUS_SEED, fixedClock: PHASE1_FIXED_CLOCK, cases })).digest("hex");
export const PHASE1_EXPECTED_CORPUS_HASH = "f5816a7161a9eab0b6fc482a1f09cc8c8b81705524f704642853f56bb7f933ac" as const;
