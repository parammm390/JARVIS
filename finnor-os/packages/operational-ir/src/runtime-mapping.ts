import type { BusinessEffectSet, ComputerAuthorizedEffect, DomainAction } from "@finnor/shared-types";
import { canonicalSerialize, canonicalizeIrFragment } from "./canonical";
import { AUDITED_OPERATION_EFFECT_CATALOG } from "./effect-inference";
import type {
  AuthorityRequirement,
  EffectDimension,
  EffectResource,
  ProgramEffectSummary,
  StaticReversibility,
} from "./effects";

export const IR_RUNTIME_MAPPING_CLASSIFICATIONS = ["LOSSLESS", "LOSSY", "RUNTIME_ONLY", "IR_ONLY", "UNSUPPORTED"] as const;
export type IrRuntimeMappingClassification = (typeof IR_RUNTIME_MAPPING_CLASSIFICATIONS)[number];

export interface IrRuntimeMappingRow {
  p2Semantic: string;
  runtimeOwner: "DomainAction" | "BusinessEffectSet" | "CapabilityContract" | "AuthorityRequest" | "ComputerAuthorizedEffect" | "Observation / verification";
  classification: IrRuntimeMappingClassification;
  note: string;
}

export const IR_RUNTIME_MAPPING_MATRIX: readonly IrRuntimeMappingRow[] = [
  { p2Semantic: "resource reads", runtimeOwner: "DomainAction", classification: "LOSSY", note: "Payload/query selectors can imply inputs, but DomainAction has no complete read set." },
  { p2Semantic: "resource writes and intended delta", runtimeOwner: "BusinessEffectSet", classification: "LOSSLESS", note: "Supported P2 writes compile to the existing authoritative target/delta compiler; P2 never creates its identity." },
  { p2Semantic: "information classification / PII", runtimeOwner: "CapabilityContract", classification: "LOSSY", note: "piiAllowlist and redaction boundaries enforce fields, but runtime contracts do not expose the full P2 lattice." },
  { p2Semantic: "communication", runtimeOwner: "CapabilityContract", classification: "LOSSY", note: "Communication capability/channel is represented; recipient information classification remains IR-only." },
  { p2Semantic: "financial exposure", runtimeOwner: "BusinessEffectSet", classification: "LOSSLESS", note: "Supported amount/currency maps to BusinessEffectSet.exposure and runtime spend authority." },
  { p2Semantic: "external mutation", runtimeOwner: "BusinessEffectSet", classification: "LOSSY", note: "operation.external/class is preserved; provider binding selection remains runtime-owned." },
  { p2Semantic: "computer mutation", runtimeOwner: "ComputerAuthorizedEffect", classification: "LOSSLESS", note: "Supported declaration maps to the exact operation/target/changes object; runner still checks exact equality." },
  { p2Semantic: "required capability/risk/spend/resource scope", runtimeOwner: "AuthorityRequest", classification: "LOSSLESS", note: "Requirements map downward; AuthorityDecision is always runtime-only and re-evaluated." },
  { p2Semantic: "approval requirement", runtimeOwner: "AuthorityRequest", classification: "LOSSY", note: "The requirement maps to policyRequiresApproval; approval chain/eligibility remain runtime-only." },
  { p2Semantic: "reversibility", runtimeOwner: "BusinessEffectSet", classification: "LOSSY", note: "Static categories map conservatively; BusinessEffect provider-dependent execution truth remains authoritative." },
  { p2Semantic: "requires/ensures", runtimeOwner: "BusinessEffectSet", classification: "LOSSY", note: "Target existence/state contracts map to snapshots/preconditions; current hashes and values are runtime-only." },
  { p2Semantic: "mandatory observation", runtimeOwner: "Observation / verification", classification: "LOSSLESS", note: "Supported observation class maps to existing verification; P2 cannot lower the verification floor." },
  { p2Semantic: "compensation linkage", runtimeOwner: "BusinessEffectSet", classification: "LOSSLESS", note: "The link maps to compensationForEffectId; compensation never rewrites original reversibility." },
  { p2Semantic: "runtime authority decision", runtimeOwner: "AuthorityRequest", classification: "RUNTIME_ONLY", note: "P2 declares requirements and cannot declare an actor currently authorized." },
  { p2Semantic: "provider binding/account/reconciliation outcome", runtimeOwner: "BusinessEffectSet", classification: "RUNTIME_ONLY", note: "Current binding, dispatch outcome, and reconciliation evidence exist only at governed execution time." },
] as const;

export interface ExistingRuntimeRequirementProjection {
  nodeId: string;
  operation: string;
  domainAction: { actionType: string; classification: "LOSSLESS" };
  businessEffect: {
    operationClass: BusinessEffectSet["operation"]["class"];
    external: boolean;
    targetTypes: string[];
    expectedObservation: BusinessEffectSet["expected"]["observation"];
    reversibility: BusinessEffectSet["reversibility"]["classification"];
    classification: "LOSSY";
  };
  authorityRequirements: AuthorityRequirement[];
  computerAuthorizedEffect?: ComputerAuthorizedEffect;
}

function runtimeReversibility(value: StaticReversibility): BusinessEffectSet["reversibility"]["classification"] {
  if (value === "REVERSIBLE") return "safely_reversible";
  if (value === "COMPENSATABLE") return "compensatable";
  if (value === "IRREVERSIBLE") return "irreversible";
  return "unknown_provider_dependent";
}

function resourceTarget(resource: EffectResource): { kind: string; identifier: string } {
  return { kind: resource.type, identifier: resource.id ?? resource.entityRef ?? resource.selector.toLowerCase() };
}

export function projectP2RequirementsToExistingRuntime(
  summary: ProgramEffectSummary,
): ExistingRuntimeRequirementProjection[] {
  const nodeIds = [...new Set(summary.possible.map((entry) => entry.effect.nodeId))].sort();
  return nodeIds.flatMap((nodeId) => {
    const effects = summary.possible.filter((entry) => entry.effect.nodeId === nodeId).map((entry) => entry.effect);
    const capability = effects.find((effect) => effect.dimension === "AUTHORITY" && effect.requirement.kind === "REQUIRES_CAPABILITY");
    const operation = capability?.dimension === "AUTHORITY" && capability.requirement.kind === "REQUIRES_CAPABILITY"
      ? capability.requirement.capability.replace(/^action:/, "")
      : "";
    const catalog = AUDITED_OPERATION_EFFECT_CATALOG[operation];
    if (!catalog) return [];
    const writes = effects.filter((effect): effect is Extract<typeof effect, { dimension: "WRITE" }> => effect.dimension === "WRITE");
    const reversibility = effects.find((effect): effect is Extract<typeof effect, { dimension: "REVERSIBILITY" }> => effect.dimension === "REVERSIBILITY");
    const computer = effects.find((effect): effect is Extract<typeof effect, { dimension: "COMPUTER" }> => effect.dimension === "COMPUTER");
    const computerAuthorizedEffect = computer
      ? {
          operation: computer.mutation.operation,
          target: resourceTarget(computer.mutation.resource),
          changes: computer.mutation.changes as Record<string, string | number | boolean | null>,
        }
      : undefined;
    return [{
      nodeId,
      operation,
      domainAction: { actionType: operation, classification: "LOSSLESS" as const },
      businessEffect: {
        operationClass: catalog.runtimeOperationClass,
        external: catalog.external,
        targetTypes: [...new Set(writes.map((write) => write.access.resource.type))].sort(),
        expectedObservation: catalog.runtimeObservation,
        reversibility: runtimeReversibility(reversibility?.classification ?? "UNKNOWN"),
        classification: "LOSSY" as const,
      },
      authorityRequirements: summary.authorityRequirements.filter((requirement) => effects.some((effect) => effect.dimension === "AUTHORITY" && effect.requirement.requirementId === requirement.requirementId)),
      ...(computerAuthorizedEffect ? { computerAuthorizedEffect } : {}),
    }];
  });
}

export const P2_SEMANTIC_DIFF_CLASSIFICATIONS = ["EQUIVALENT", "STRICTER_SAFE", "REGRESSION", "RUNTIME_ONLY", "IR_UNSUPPORTED", "FIXTURE_INVALID"] as const;
export type P2SemanticDiffClassification = (typeof P2_SEMANTIC_DIFF_CLASSIFICATIONS)[number];

export interface P2SemanticDiffField {
  field:
    | "resource_reads_writes"
    | "pii_exposure"
    | "external_mutation"
    | "communication"
    | "financial_exposure"
    | "computer_mutation"
    | "required_capability"
    | "risk_approval"
    | "reversibility"
    | "preconditions"
    | "required_observation"
    | "compensation";
  relation: "EQUAL" | "P2_STRICTER" | "MISMATCH" | "RUNTIME_ONLY" | "IR_ONLY";
  detail: string;
}

export interface P2SemanticDiffResult {
  classification: P2SemanticDiffClassification;
  fields: P2SemanticDiffField[];
  reasonCodes: string[];
}

function equal(left: unknown, right: unknown): boolean {
  return canonicalSerialize(canonicalizeIrFragment(left)) === canonicalSerialize(canonicalizeIrFragment(right));
}

function p2Resources(summary: ProgramEffectSummary, nodeId: string): string[] {
  return [...new Set(summary.possible.flatMap(({ effect }) => effect.nodeId === nodeId && (effect.dimension === "READ" || effect.dimension === "WRITE")
    ? [`${effect.dimension}:${effect.access.resource.kind}:${effect.access.resource.type}:${effect.access.resource.id ?? effect.access.resource.entityRef ?? effect.access.resource.selector}`]
    : []))].sort();
}

function runtimeResources(effect: BusinessEffectSet): string[] {
  return effect.targets.map((target) => `WRITE:${target.kind}:${target.type}:${target.id}`).sort();
}

function field(
  fields: P2SemanticDiffField[],
  name: P2SemanticDiffField["field"],
  relation: P2SemanticDiffField["relation"],
  detail: string,
): void {
  fields.push({ field: name, relation, detail });
}

export function compareP2EffectsToExistingRuntime(input: {
  summary?: ProgramEffectSummary;
  nodeId?: string;
  domainAction?: DomainAction;
  businessEffect?: BusinessEffectSet;
  computerAuthorizedEffect?: ComputerAuthorizedEffect;
  fixtureValid?: boolean;
  irSupported?: boolean;
}): P2SemanticDiffResult {
  if (input.fixtureValid === false) return { classification: "FIXTURE_INVALID", fields: [], reasonCodes: ["fixture_invalid"] };
  if (input.irSupported === false || !input.summary || !input.nodeId) return { classification: "IR_UNSUPPORTED", fields: [], reasonCodes: ["ir_unsupported"] };
  if (!input.businessEffect || !input.domainAction) return { classification: "RUNTIME_ONLY", fields: [], reasonCodes: ["runtime_semantics_unavailable"] };
  const fields: P2SemanticDiffField[] = [];
  const p2 = input.summary.possible.filter((entry) => entry.effect.nodeId === input.nodeId).map((entry) => entry.effect);
  const operation = input.domainAction.actionType;
  const catalog = AUDITED_OPERATION_EFFECT_CATALOG[operation];
  if (!catalog) return { classification: "IR_UNSUPPORTED", fields: [], reasonCodes: ["operation_not_in_p2_catalog"] };

  const p2ResourceSet = p2Resources(input.summary, input.nodeId);
  const runtimeResourceSet = runtimeResources(input.businessEffect);
  const p2WriteSet = p2ResourceSet.filter((value) => value.startsWith("WRITE:"));
  const runtimeTypes = input.businessEffect.targets.map((target) => target.type);
  const p2WriteTypes = p2.filter((effect): effect is Extract<typeof effect, { dimension: "WRITE" }> => effect.dimension === "WRITE").map((effect) => effect.access.resource.type);
  const writesCovered = p2WriteTypes.every((type) => runtimeTypes.includes(type) || ["task", "communication_delivery", "ad_campaign", "computer_target", "payment"].includes(type));
  field(fields, "resource_reads_writes", writesCovered ? (p2ResourceSet.some((value) => value.startsWith("READ:")) ? "P2_STRICTER" : "EQUAL") : "MISMATCH", writesCovered ? `${p2WriteSet.length} P2 writes map to ${runtimeResourceSet.length} runtime targets.` : "P2 and runtime write targets differ.");

  const p2Pii = p2.some((effect) => effect.dimension === "PII");
  field(fields, "pii_exposure", p2Pii ? "IR_ONLY" : "EQUAL", p2Pii ? "BusinessEffectSet has no information-classification lattice." : "Neither snapshot declares PII exposure.");
  const p2External = p2.some((effect) => effect.dimension === "EXTERNAL");
  field(fields, "external_mutation", p2External === input.businessEffect.operation.external ? "EQUAL" : "MISMATCH", `P2 external=${p2External}; runtime external=${input.businessEffect.operation.external}.`);
  const p2Communication = p2.some((effect) => effect.dimension === "COMMUNICATION");
  const runtimeCommunication = ["send_message"].includes(operation) || catalog.runtimeOperationClass === "external_side_effect" && catalog.runtimeObservation === "provider_delivery";
  field(fields, "communication", p2Communication === runtimeCommunication ? "EQUAL" : "MISMATCH", `P2 communication=${p2Communication}; runtime profile=${runtimeCommunication}.`);
  const p2Financial = p2.find((effect): effect is Extract<typeof effect, { dimension: "FINANCIAL" }> => effect.dimension === "FINANCIAL");
  field(fields, "financial_exposure", equal(p2Financial ? { amount: p2Financial.financial.amount, currency: p2Financial.financial.currency } : null, input.businessEffect.exposure) ? "EQUAL" : "MISMATCH", "Compared amount/currency to BusinessEffectSet.exposure.");
  const p2Computer = p2.find((effect): effect is Extract<typeof effect, { dimension: "COMPUTER" }> => effect.dimension === "COMPUTER");
  if (p2Computer) {
    field(fields, "computer_mutation", input.computerAuthorizedEffect && equal(p2Computer.mutation.changes, input.computerAuthorizedEffect.changes) ? "EQUAL" : "MISMATCH", "Compared exact authorized computer changes.");
  } else field(fields, "computer_mutation", "EQUAL", "No computer mutation in either P2 operation profile.");
  const p2Capability = p2.find((effect) => effect.dimension === "AUTHORITY" && effect.requirement.kind === "REQUIRES_CAPABILITY");
  const p2CapabilityValue = p2Capability?.dimension === "AUTHORITY" && p2Capability.requirement.kind === "REQUIRES_CAPABILITY" ? p2Capability.requirement.capability : null;
  field(fields, "required_capability", p2CapabilityValue === input.businessEffect.authority.capability ? "EQUAL" : "MISMATCH", `P2=${p2CapabilityValue}; runtime=${input.businessEffect.authority.capability}.`);
  const p2Risk = p2.find((effect) => effect.dimension === "AUTHORITY" && effect.requirement.kind === "REQUIRES_RISK_LEVEL");
  const p2Approval = p2.some((effect) => effect.dimension === "AUTHORITY" && effect.requirement.kind === "REQUIRES_APPROVAL");
  const risk = p2Risk?.dimension === "AUTHORITY" && p2Risk.requirement.kind === "REQUIRES_RISK_LEVEL" ? p2Risk.requirement.risk : null;
  field(fields, "risk_approval", risk === input.businessEffect.authority.risk && (!p2Approval || input.businessEffect.approval.required) ? (p2Approval === input.businessEffect.approval.required ? "EQUAL" : "P2_STRICTER") : "MISMATCH", "Compared risk and approval floor.");
  const p2Reversibility = p2.find((effect): effect is Extract<typeof effect, { dimension: "REVERSIBILITY" }> => effect.dimension === "REVERSIBILITY");
  field(fields, "reversibility", p2Reversibility && runtimeReversibility(p2Reversibility.classification) === input.businessEffect.reversibility.classification ? "EQUAL" : "MISMATCH", "Compared conservative static mapping to BusinessEffect execution classification.");
  const p2Declaration = p2.filter((effect) => effect.dimension === "READ").length;
  field(fields, "preconditions", input.businessEffect.preconditions.length >= p2Declaration ? "RUNTIME_ONLY" : "MISMATCH", "Runtime owns current target/version hashes; P2 owns structural requirements.");
  const p2Observation = p2.some((effect) => effect.dimension === "OBSERVATION");
  field(fields, "required_observation", p2Observation && input.businessEffect.expected.observation === catalog.runtimeObservation ? "EQUAL" : "MISMATCH", `Runtime observation=${input.businessEffect.expected.observation}.`);
  const p2Compensation = input.summary.compensationLinks.some((link) => link.originalEffectId === input.nodeId);
  const runtimeCompensation = input.businessEffect.provenance.compensationForEffectId !== null;
  field(fields, "compensation", p2Compensation === runtimeCompensation ? "EQUAL" : p2Compensation && !runtimeCompensation ? "IR_ONLY" : "MISMATCH", "Compared structural link to BusinessEffect provenance.");

  const mismatches = fields.filter((entry) => entry.relation === "MISMATCH");
  const stricter = fields.filter((entry) => entry.relation === "P2_STRICTER" || entry.relation === "IR_ONLY");
  const runtimeOnly = fields.filter((entry) => entry.relation === "RUNTIME_ONLY");
  const classification: P2SemanticDiffClassification = mismatches.length ? "REGRESSION"
    : stricter.length ? "STRICTER_SAFE"
      : runtimeOnly.length ? "RUNTIME_ONLY"
        : "EQUIVALENT";
  return {
    classification,
    fields,
    reasonCodes: mismatches.length
      ? mismatches.map((entry) => `semantic_mismatch:${entry.field}`)
      : classification === "STRICTER_SAFE" ? ["p2_adds_static_safety"]
        : classification === "RUNTIME_ONLY" ? ["runtime_only_fields_remain"]
          : ["normalized_effect_semantics_equal"],
  };
}

export function dimensionsForNode(summary: ProgramEffectSummary, nodeId: string): EffectDimension[] {
  return [...new Set(summary.possible.filter((entry) => entry.effect.nodeId === nodeId).map((entry) => entry.effect.dimension))].sort();
}
