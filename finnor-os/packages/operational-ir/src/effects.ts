import type { JsonValue, Predicate } from "./contracts";

/** Planning/static dimensions only. Runtime BusinessEffect remains execution truth. */
export const EFFECT_DIMENSIONS = [
  "READ",
  "WRITE",
  "PII",
  "COMMUNICATION",
  "FINANCIAL",
  "EXTERNAL",
  "COMPUTER",
  "AUTHORITY",
  "REVERSIBILITY",
  "OBSERVATION",
] as const;
export type EffectDimension = (typeof EFFECT_DIMENSIONS)[number];

export const INFORMATION_CLASSIFICATIONS = [
  "PUBLIC",
  "TENANT_INTERNAL",
  "CUSTOMER_DATA",
  "PII",
  "FINANCIAL",
  "CREDENTIAL_BOUND",
  "SECRET",
  "UNCLASSIFIED",
] as const;
export type InformationClassification = (typeof INFORMATION_CLASSIFICATIONS)[number];

/** UNCLASSIFIED is intentionally outside the lattice: it is unknown, not bottom. */
const INFORMATION_PARENTS: Readonly<Record<Exclude<InformationClassification, "UNCLASSIFIED">, readonly InformationClassification[]>> = {
  PUBLIC: ["TENANT_INTERNAL"],
  TENANT_INTERNAL: ["CUSTOMER_DATA", "FINANCIAL", "CREDENTIAL_BOUND"],
  CUSTOMER_DATA: ["PII"],
  PII: ["SECRET"],
  FINANCIAL: ["SECRET"],
  CREDENTIAL_BOUND: ["SECRET"],
  SECRET: [],
};

export function informationCanFlowToClassification(
  source: InformationClassification,
  destinationMaximum: InformationClassification,
): boolean {
  if (source === "UNCLASSIFIED" || destinationMaximum === "UNCLASSIFIED") return false;
  if (source === destinationMaximum) return true;
  const visited = new Set<InformationClassification>();
  const pending: InformationClassification[] = [source];
  while (pending.length) {
    const current = pending.shift()!;
    if (visited.has(current) || current === "UNCLASSIFIED") continue;
    visited.add(current);
    for (const parent of INFORMATION_PARENTS[current]) {
      if (parent === destinationMaximum) return true;
      pending.push(parent);
    }
  }
  return false;
}

export function joinInformationClassifications(
  left: InformationClassification,
  right: InformationClassification,
): InformationClassification {
  if (left === "UNCLASSIFIED" || right === "UNCLASSIFIED") return "UNCLASSIFIED";
  if (informationCanFlowToClassification(left, right)) return right;
  if (informationCanFlowToClassification(right, left)) return left;
  return "SECRET";
}

export type EffectResourceSelector = "EXISTING" | "NEW" | "COHORT" | "EXTERNAL";

/** Resource classes reuse existing FINNOR canonical names where one exists. */
export interface EffectResource {
  kind: "entity" | "party" | "resource";
  type: string;
  selector: EffectResourceSelector;
  entityRef?: string;
  /** Safe business identifier only. Credentials/provider session handles are forbidden. */
  id?: string;
}

export interface InformationDescriptor {
  classification: InformationClassification;
  /** Exact semantic fields, or ["*"] when the declaration cannot narrow them. */
  fields: string[];
  basis: "IR_DECLARED" | "AUDITED_CATALOG" | "RUNTIME_ONLY";
  /** Required for a non-UNCLASSIFIED IR declaration; points to audited schema,
   * capability-contract, or explicit export evidence, never secret material. */
  evidenceRef?: string;
}

export type DestinationBoundary =
  | { kind: "INTERNAL_CANONICAL" }
  | { kind: "GOVERNED_CAPABILITY"; capability: string }
  | { kind: "COMMUNICATION_RECIPIENT"; recipient: EffectResource; capability: string }
  | { kind: "EXTERNAL_PROVIDER"; system: string; capability: string }
  | { kind: "EXTERNAL_RESEARCH"; toolClass: string }
  | { kind: "COMPUTER_APPLICATION"; application: string; capability: string }
  | { kind: "LOG_OR_TELEMETRY" };

export type TransformationProof =
  | {
      kind: "EXACT_FIELD_PROJECTION" | "DETERMINISTIC_TRANSFORM";
      proofRef: string;
      verifiedOutputClassification: InformationClassification;
    }
  | {
      kind: "NONE";
    };

export type InformationTransformation =
  | { kind: "IDENTITY" }
  | {
      kind: "REDACTION" | "AGGREGATION" | "TOKENIZATION";
      outputClassification: InformationClassification;
      removedFields: string[];
      proof: TransformationProof;
    }
  | {
      kind: "DECLASSIFICATION";
      outputClassification: InformationClassification;
      authorityRequirementId: string;
      proof: Exclude<TransformationProof, { kind: "NONE" }>;
    };

export interface InformationFlow {
  flowId: string;
  source: EffectResource;
  information: InformationDescriptor;
  destination: DestinationBoundary;
  transformation: InformationTransformation;
  /** Required when the source is more sensitive than the destination permits. */
  declassificationRequirementId?: string;
}

export const STATIC_REVERSIBILITY = [
  "READ_ONLY",
  "REVERSIBLE",
  "COMPENSATABLE",
  "IRREVERSIBLE",
  "UNKNOWN",
] as const;
export type StaticReversibility = (typeof STATIC_REVERSIBILITY)[number];

export type StaticRiskLevel = "low" | "medium" | "high";

export type AuthorityRequirement =
  | { requirementId: string; kind: "REQUIRES_CAPABILITY"; capability: string }
  | { requirementId: string; kind: "REQUIRES_APPROVAL"; typed: boolean }
  | { requirementId: string; kind: "REQUIRES_RISK_LEVEL"; risk: StaticRiskLevel }
  | { requirementId: string; kind: "REQUIRES_SPEND_AUTHORITY"; amount: number; currency: string }
  | { requirementId: string; kind: "REQUIRES_RESOURCE_SCOPE"; resource: EffectResource }
  | {
      requirementId: string;
      kind: "REQUIRES_DECLASSIFICATION_AUTHORITY";
      sourceClassification: InformationClassification;
      outputClassification: InformationClassification;
      destinationKind: DestinationBoundary["kind"];
    };

export interface ResourceAccess {
  resource: EffectResource;
  information: InformationDescriptor;
  fields: string[];
}

export interface CommunicationEffectDeclaration {
  recipient: EffectResource;
  channel: "internal" | "email" | "sms" | "voice" | "chat" | "calendar" | "unknown";
  information: InformationDescriptor;
}

export interface FinancialEffectDeclaration {
  operation: "WRITE" | "SPEND";
  resource: EffectResource;
  amount: number;
  currency: string;
}

export interface ExternalMutationDeclaration {
  system: string;
  resource: EffectResource;
}

export interface ComputerMutationDeclaration {
  application: string;
  /** Exact existing ComputerAuthorizedEffect operation; never inferred from UI mechanics. */
  operation: string;
  resource: EffectResource;
  changes: Record<string, JsonValue>;
}

export interface EffectConditionContract {
  requires: Predicate[];
  ensures: Predicate[];
  reads: ResourceAccess[];
  writes: ResourceAccess[];
  modifies: ResourceAccess[];
  throws: string[];
  /** Semantic id of the original Effect, only for a compensation Effect. */
  compensates?: string;
  observes: string[];
}

/**
 * Hash-participating planning declaration. It declares requirements and intended
 * semantics; it never grants authority or replaces execution-time revalidation.
 */
export interface EffectDeclaration {
  version: 1;
  source: "IR_DECLARED" | "AUDITED_CATALOG";
  contract: EffectConditionContract;
  communications: CommunicationEffectDeclaration[];
  financial: FinancialEffectDeclaration[];
  externalMutations: ExternalMutationDeclaration[];
  computerMutations: ComputerMutationDeclaration[];
  informationFlows: InformationFlow[];
  authorityRequirements: AuthorityRequirement[];
  reversibility: {
    classification: StaticReversibility;
    /** Link only; it never changes the original classification. */
    compensationEffectId?: string;
  };
}

export type AtomicTypedEffect =
  | { effectId: string; nodeId: string; dimension: "READ"; access: ResourceAccess }
  | { effectId: string; nodeId: string; dimension: "WRITE"; access: ResourceAccess }
  | { effectId: string; nodeId: string; dimension: "PII"; access: ResourceAccess; handling: "READ" | "WRITE" | "REVEAL" }
  | { effectId: string; nodeId: string; dimension: "COMMUNICATION"; communication: CommunicationEffectDeclaration }
  | { effectId: string; nodeId: string; dimension: "FINANCIAL"; financial: FinancialEffectDeclaration }
  | { effectId: string; nodeId: string; dimension: "EXTERNAL"; mutation: ExternalMutationDeclaration }
  | { effectId: string; nodeId: string; dimension: "COMPUTER"; mutation: ComputerMutationDeclaration }
  | { effectId: string; nodeId: string; dimension: "AUTHORITY"; requirement: AuthorityRequirement }
  | { effectId: string; nodeId: string; dimension: "REVERSIBILITY"; classification: StaticReversibility; compensationEffectId?: string }
  | { effectId: string; nodeId: string; dimension: "OBSERVATION"; observationRef: string };

export interface ConditionalTypedEffect {
  effect: AtomicTypedEffect;
  conditions: Array<{ branchId: string; caseId: string; when: Predicate | "OTHERWISE" }>;
  compensationForEffectId?: string;
}

export interface CompensationEffectLink {
  compensationNodeId: string;
  originalEffectId: string;
  compensationEffectId: string;
  trigger: "ON_FAILURE" | "ON_PARTIAL_FAILURE" | "MANUAL";
}

export interface CompositionConflict {
  code: "PARALLEL_WRITE_CONFLICT" | "PARALLEL_EXTERNAL_CONFLICT" | "PARALLEL_FINANCIAL_CONFLICT";
  parallelNodeId: string;
  leftNodeId: string;
  rightNodeId: string;
  resource: EffectResource;
}

export interface ProgramEffectSummary {
  version: 1;
  dimensions: EffectDimension[];
  possible: ConditionalTypedEffect[];
  guaranteed: AtomicTypedEffect[];
  authorityRequirements: AuthorityRequirement[];
  informationFlows: Array<InformationFlow & { nodeId: string }>;
  compensationLinks: CompensationEffectLink[];
  conflicts: CompositionConflict[];
  unsupportedNodeIds: string[];
  runtimeOnlyNodeIds: string[];
}

export interface AuthorizedRequirementManifest {
  /** "Authorized" means requirements for authorization, never a grant/decision. */
  version: 1;
  programSemanticId: string;
  requirements: AuthorityRequirement[];
  runtimeAuthorityReevaluationRequired: true;
  businessEffectCompilationRequired: true;
  executionPreconditionRevalidationRequired: true;
}
