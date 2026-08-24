import { createHash } from "node:crypto";
import { z } from "zod";
import type {
  CanonicalEntityRef,
  ObjectiveSuccessCondition,
  OutcomePackAutonomyMode,
  OutcomePackDefinition,
  OutcomePackId,
  OutcomePackStartBinding,
  TenantContext,
} from "@finnor/shared-types";
import { OUTCOME_PACK_IDS } from "@finnor/shared-types";
import { attachWorkEntity } from "@finnor/db";
import { parseObjectiveSuccessCondition } from "./objective-success";
import { startWorkObjective, type StartObjectiveOptions, type StartObjectiveResult } from "./objective-loop";

const dependencyVersions = {
  effectCompiler: 1,
  objectiveController: 1,
  autonomySemantics: 1,
  sourceTruth: 1,
  verification: 1,
} as const;

const invariantSlos: OutcomePackDefinition["slos"] = [
  { metric: "cross_tenant_effects", comparison: "eq", threshold: 0, unit: "count", critical: true, rationale: "Tenant isolation is a correctness boundary, not a service average." },
  { metric: "unapproved_effects_outside_grant", comparison: "eq", threshold: 0, unit: "count", critical: true, rationale: "Every consequential effect must cite human approval or one exact current grant." },
  { metric: "duplicate_consequential_effects", comparison: "eq", threshold: 0, unit: "count", critical: true, rationale: "Effect identity and durable idempotency make duplicates an invariant violation." },
  { metric: "false_verified_success", comparison: "eq", threshold: 0, unit: "count", critical: true, rationale: "Provider acceptance is not canonical outcome verification." },
  { metric: "secret_exposure", comparison: "eq", threshold: 0, unit: "count", critical: true, rationale: "Credentials may only be resolved by the governed security boundary." },
];

const operationalSlos: OutcomePackDefinition["slos"] = [
  { metric: "verification_coverage", comparison: "gte", threshold: 1, unit: "ratio", critical: true, rationale: "Certified runs cannot omit terminal verification." },
  { metric: "event_to_resume_latency", comparison: "lte", threshold: 60_000, unit: "milliseconds", critical: false, rationale: "The durable event-wait worker is expected to resume within one normal worker recovery window." },
  { metric: "reconciliation_eventual_completion", comparison: "gte", threshold: 0.99, unit: "ratio", critical: false, rationale: "Unknown provider outcomes must converge or remain explicitly open, never become false success." },
];

export const OUTCOME_PACK_DEFINITIONS: Record<OutcomePackId, OutcomePackDefinition> = {
  lead_to_verified_water_test_booking: {
    contractVersion: 1, id: "lead_to_verified_water_test_booking", version: 1,
    title: "Lead to verified water-test booking", objectiveClass: "qualified_customer_booking",
    supportedTenantPrerequisites: ["one unambiguous household/lead", "eligible service location", "governed communication identity", "scheduling source truth"],
    requiredCapabilities: [
      { capability: "crm", required: true, maxSourceLagMs: 300_000, acceptedModes: ["real", "sandbox"] },
      { capability: "scheduling", required: true, maxSourceLagMs: 120_000, acceptedModes: ["real", "sandbox"] },
      { capability: "communications", required: true, maxSourceLagMs: 300_000, acceptedModes: ["real", "sandbox"] },
    ],
    allowedEffectClasses: ["internal_write", "operational_change", "external_side_effect", "durable_workflow"],
    permanentlyApprovalRequiredEffectClasses: ["operational_change", "external_side_effect", "durable_workflow"],
    authorityRequirements: ["action target is in the principal's household/scheduling scope", "current authority revision remains valid"],
    approvalBoundaries: ["customer contact", "appointment creation or reschedule"],
    recoveryPaths: ["re-inspect availability", "wait for exact customer response", "replan after provider or schedule change", "manual escalation"],
    compensationCapabilities: ["governed appointment cancellation or reschedule where provider supports it"],
    irreversibilityBoundaries: ["delivered customer communication cannot be recalled"],
    evidenceRequirements: ["canonical appointment related to the household", "externally observed scheduling truth", "all pack effects verified"],
    terminalBlockedConditions: ["ambiguous customer", "ineligible location", "no safe contact route", "provider/source truth stale or blocked", "customer declines"],
    verificationRules: ["a confirmed canonical appointment exists for the exact household", "provider acknowledgement alone is insufficient"],
    slos: [...invariantSlos, ...operationalSlos], dependencyVersions,
  },
  stuck_installation_service_resolution: {
    contractVersion: 1, id: "stuck_installation_service_resolution", version: 1,
    title: "Stuck installation or service job resolved", objectiveClass: "operational_exception_resolution",
    supportedTenantPrerequisites: ["exact work order or service visit", "current customer and operational context"],
    requiredCapabilities: [
      { capability: "scheduling", required: true, maxSourceLagMs: 120_000, acceptedModes: ["real", "sandbox"] },
      { capability: "inventory", required: false, maxSourceLagMs: 300_000, acceptedModes: ["real", "sandbox"] },
      { capability: "communications", required: false, maxSourceLagMs: 300_000, acceptedModes: ["real", "sandbox"] },
    ],
    allowedEffectClasses: ["internal_write", "operational_change", "external_side_effect", "durable_workflow"],
    permanentlyApprovalRequiredEffectClasses: ["operational_change", "external_side_effect", "durable_workflow"],
    authorityRequirements: ["work/resource scope is current", "delegations resolve to active parties"],
    approvalBoundaries: ["customer/provider communication", "dispatch, schedule, supplier, or financial constraint changes"],
    recoveryPaths: ["re-inspect work, schedule, inventory, and customer state", "delegate or wait for exact event", "replan", "reconcile", "manual escalation"],
    compensationCapabilities: ["cancel future workflow steps", "compensate only a capability explicitly declared by the EffectSet"],
    irreversibilityBoundaries: ["provider communication and completed field work remain historical truth"],
    evidenceRequirements: ["exact work order/service visit reaches the certified resolved state", "open effects settle", "reconciliation is not blocked"],
    terminalBlockedConditions: ["ambiguous job", "unsupported supplier dependency", "material source staleness", "unrecoverable provider outcome"],
    verificationRules: ["the exact canonical operational record is completed", "the controller re-inspects before completion"],
    slos: [...invariantSlos, ...operationalSlos], dependencyVersions,
  },
  overdue_receivable_collection: {
    contractVersion: 1, id: "overdue_receivable_collection", version: 1,
    title: "Overdue receivable to verified collection outcome", objectiveClass: "receivable_resolution",
    supportedTenantPrerequisites: ["exact invoice", "current accounting/payment truth", "governed customer contact"],
    requiredCapabilities: [
      { capability: "accounting", required: true, maxSourceLagMs: 300_000, acceptedModes: ["real", "sandbox"] },
      { capability: "payments", required: true, maxSourceLagMs: 120_000, acceptedModes: ["real", "sandbox"] },
      { capability: "communications", required: true, maxSourceLagMs: 300_000, acceptedModes: ["real", "sandbox"] },
    ],
    allowedEffectClasses: ["internal_write", "financial_write", "external_side_effect", "durable_workflow"],
    permanentlyApprovalRequiredEffectClasses: ["financial_write", "external_side_effect", "durable_workflow"],
    authorityRequirements: ["invoice/account is in scope", "amount and payment account are exact", "current policy and authority revisions match"],
    approvalBoundaries: ["customer outreach", "payment request", "any charge, refund, amount change, arrangement, or write-off"],
    recoveryPaths: ["retry before-effect failures", "reconcile uncertain provider outcomes", "wait for payment event", "record dispute block", "manual escalation"],
    compensationCapabilities: ["provider-specific void/refund only through separately authorized financial EffectSet"],
    irreversibilityBoundaries: ["money movement and delivered collection communication"],
    evidenceRequirements: ["canonical invoice paid state", "payment/provider event linked to the invoice", "accounting reconciliation"],
    terminalBlockedConditions: ["invoice/amount/account ambiguity", "customer dispute", "payment or accounting truth stale", "unreconciled unknown outcome"],
    verificationRules: ["collection success requires canonical paid/reconciled financial truth", "message delivery is not collection success"],
    slos: [...invariantSlos, ...operationalSlos], dependencyVersions,
  },
  service_due_lifecycle: {
    contractVersion: 1, id: "service_due_lifecycle", version: 1,
    title: "Service-due customer to verified service outcome", objectiveClass: "service_lifecycle",
    supportedTenantPrerequisites: ["exact household/equipment", "due-state evidence", "consent-compliant contact route", "scheduling truth"],
    requiredCapabilities: [
      { capability: "crm", required: true, maxSourceLagMs: 300_000, acceptedModes: ["real", "sandbox"] },
      { capability: "communications", required: true, maxSourceLagMs: 300_000, acceptedModes: ["real", "sandbox"] },
      { capability: "scheduling", required: true, maxSourceLagMs: 120_000, acceptedModes: ["real", "sandbox"] },
    ],
    allowedEffectClasses: ["internal_write", "operational_change", "external_side_effect", "durable_workflow"],
    permanentlyApprovalRequiredEffectClasses: ["operational_change", "external_side_effect", "durable_workflow"],
    authorityRequirements: ["customer/equipment and communication identity are exact", "contact policy permits the selected route"],
    approvalBoundaries: ["outreach", "booking, cancellation, reschedule, assignment"],
    recoveryPaths: ["suppress duplicate reminder", "block opt-out/invalid route", "wait for response", "re-inspect schedule", "manual escalation"],
    compensationCapabilities: ["cancel or reschedule a future appointment where supported"],
    irreversibilityBoundaries: ["delivered outreach and completed service cannot be undone"],
    evidenceRequirements: ["due-state evidence", "exact communication evidence", "confirmed appointment or completed visit in canonical truth"],
    terminalBlockedConditions: ["already serviced", "opt-out", "unreachable customer", "ambiguous household", "schedule/source conflict"],
    verificationRules: ["the exact household has a confirmed booking or completed visit", "duplicate external events do not duplicate outreach"],
    slos: [...invariantSlos, ...operationalSlos], dependencyVersions,
  },
  general_operator_objective: {
    contractVersion: 1, id: "general_operator_objective", version: 1,
    title: "Bounded operator objective to verified resolution", objectiveClass: "bounded_operator_resolution",
    supportedTenantPrerequisites: ["explicit bounded objective", "unambiguous subject scope", "explicit canonical success condition"],
    requiredCapabilities: [],
    allowedEffectClasses: ["internal_draft", "internal_write", "operational_change", "financial_write", "external_side_effect", "durable_workflow"],
    permanentlyApprovalRequiredEffectClasses: ["financial_write", "operational_change", "external_side_effect", "external_spend", "batch_external", "durable_workflow"],
    authorityRequirements: ["every query/action remains inside original Work scope", "each EffectSet independently passes current authority"],
    approvalBoundaries: ["all fixed REQUIRED/TYPED_REQUIRED floors", "any effect outside a current exact grant"],
    recoveryPaths: ["query", "replan", "wait", "delegate", "reconcile", "compensate where declared", "escalate"],
    compensationCapabilities: ["only compensation named by the exact EffectSet"],
    irreversibilityBoundaries: ["determined per EffectSet and never inferred by the model"],
    evidenceRequirements: ["persisted explicit success condition", "current canonical evidence", "verified pack effects"],
    terminalBlockedConditions: ["scope expansion", "material ambiguity", "unsupported capability", "stale truth", "budget exhaustion", "human stop"],
    verificationRules: ["the persisted explicit condition passes without weakening", "no model-authored claim substitutes for canonical evidence"],
    slos: [...invariantSlos, ...operationalSlos], dependencyVersions,
  },
};

function canonical(value: unknown): string {
  if (value === undefined) return "null";
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  const row = value as Record<string, unknown>;
  return `{${Object.keys(row).filter((key) => row[key] !== undefined).sort().map((key) => `${JSON.stringify(key)}:${canonical(row[key])}`).join(",")}}`;
}

export function outcomePackFingerprint(pack: OutcomePackDefinition | OutcomePackId): string {
  const definition = typeof pack === "string" ? OUTCOME_PACK_DEFINITIONS[pack] : pack;
  return createHash("sha256").update(canonical({
    contractVersion: definition.contractVersion,
    id: definition.id,
    version: definition.version,
    allowedEffectClasses: definition.allowedEffectClasses,
    permanentApproval: definition.permanentlyApprovalRequiredEffectClasses,
    requiredCapabilities: definition.requiredCapabilities,
    verificationRules: definition.verificationRules,
    dependencyVersions: definition.dependencyVersions,
  })).digest("hex");
}

const RefSchema = z.object({ entityType: z.string().min(1), entityId: z.string().uuid() }).strict();
const BaseStartSchema = z.object({ mode: z.enum(["shadow", "approval", "autopilot"]).default("approval"), objective: z.string().trim().min(1).max(10_000).optional() });
const StartSchemas = {
  lead_to_verified_water_test_booking: BaseStartSchema.extend({ householdId: z.string().uuid() }),
  stuck_installation_service_resolution: BaseStartSchema.extend({ target: RefSchema.refine((ref) => ref.entityType === "work_order" || ref.entityType === "service_visit", "target must be a work_order or service_visit") }),
  overdue_receivable_collection: BaseStartSchema.extend({ invoiceId: z.string().uuid() }),
  service_due_lifecycle: BaseStartSchema.extend({ householdId: z.string().uuid(), desiredOutcome: z.enum(["booked", "completed"]).default("booked") }),
  general_operator_objective: BaseStartSchema.extend({ objective: z.string().trim().min(1).max(10_000), subjectRefs: z.array(RefSchema).min(1).max(20), successCondition: z.unknown() }),
} satisfies Record<OutcomePackId, z.ZodTypeAny>;

function canonicalOutcomeCondition(statement: string, anchor: CanonicalEntityRef, expected: { entityType: string; entityId?: string; status: string }): ObjectiveSuccessCondition {
  return {
    version: 1,
    statement,
    mode: "all",
    source: "explicit",
    criteria: [
      { kind: "no_open_execution" },
      { kind: "all_objective_effects_verified", minimumCount: 1 },
      {
        kind: "canonical_query",
        request: { intent: "company_context", anchor },
        assertion: { path: ["context", "nodes"], operator: "array_contains", expected },
      },
      { kind: "decision_evidence", minimumCount: 1, accepted: ["canonical_query", "business_effect", "matched_event", "delegation", "computer_run"] },
    ],
  };
}

export function bindOutcomePack(packId: OutcomePackId, rawInput: unknown): OutcomePackStartBinding {
  const input = StartSchemas[packId].parse(rawInput) as Record<string, unknown> & { mode: OutcomePackAutonomyMode; objective?: string };
  const definition = OUTCOME_PACK_DEFINITIONS[packId];
  let objective = input.objective ?? definition.title;
  let subjectRefs: CanonicalEntityRef[];
  let successCondition: ObjectiveSuccessCondition;
  if (packId === "lead_to_verified_water_test_booking") {
    const householdId = String(input.householdId);
    subjectRefs = [{ entityType: "household", entityId: householdId }];
    objective = input.objective ?? `Get household ${householdId} booked for a water test and verify the resulting appointment.`;
    successCondition = canonicalOutcomeCondition(objective, subjectRefs[0]!, { entityType: "appointment", status: "confirmed" });
  } else if (packId === "stuck_installation_service_resolution") {
    const target = input.target as CanonicalEntityRef;
    subjectRefs = [target];
    objective = input.objective ?? `Resolve the stuck ${target.entityType.replaceAll("_", " ")} ${target.entityId} and verify its operational completion.`;
    successCondition = canonicalOutcomeCondition(objective, target, { entityType: target.entityType, entityId: target.entityId, status: "completed" });
  } else if (packId === "overdue_receivable_collection") {
    const invoiceId = String(input.invoiceId);
    subjectRefs = [{ entityType: "invoice", entityId: invoiceId }];
    objective = input.objective ?? `Resolve overdue invoice ${invoiceId} and verify the reconciled collection outcome.`;
    successCondition = canonicalOutcomeCondition(objective, subjectRefs[0]!, { entityType: "invoice", entityId: invoiceId, status: "paid" });
  } else if (packId === "service_due_lifecycle") {
    const householdId = String(input.householdId);
    subjectRefs = [{ entityType: "household", entityId: householdId }];
    const completed = input.desiredOutcome === "completed";
    objective = input.objective ?? `Resolve the service-due lifecycle for household ${householdId} through a verified ${completed ? "completed visit" : "confirmed booking"}.`;
    successCondition = canonicalOutcomeCondition(objective, subjectRefs[0]!, { entityType: completed ? "service_visit" : "appointment", status: completed ? "completed" : "confirmed" });
  } else {
    subjectRefs = input.subjectRefs as CanonicalEntityRef[];
    successCondition = parseObjectiveSuccessCondition(input.successCondition);
    objective = String(input.objective);
  }
  return {
    packId,
    packVersion: definition.version,
    mode: input.mode,
    objective,
    subjectRefs,
    successCondition,
    input,
    certificationFingerprint: outcomePackFingerprint(definition),
  };
}

export async function startOutcomePack(
  packId: OutcomePackId,
  input: unknown,
  ctx: TenantContext,
  options: Omit<StartObjectiveOptions, "successCondition" | "outcomePack"> = {},
): Promise<StartObjectiveResult & { pack: OutcomePackStartBinding }> {
  if (!(OUTCOME_PACK_IDS as readonly string[]).includes(packId)) throw new Error(`Unknown outcome pack: ${packId}`);
  const pack = bindOutcomePack(packId, input);
  const started = await startWorkObjective(pack.objective, ctx, { ...options, successCondition: pack.successCondition, outcomePack: pack });
  for (const ref of pack.subjectRefs) {
    await attachWorkEntity(ctx.tenantId, started.workId, { ...ref, relationship: "target", source: `outcome_pack:${pack.packId}:v${pack.packVersion}` });
  }
  return { ...started, pack };
}
