import type {
  AuthorityRequirement,
  InformationClassification,
  InformationFlow,
  InformationTransformation,
} from "./effects";

export type InformationFlowDecision = "LEGAL" | "REJECTED" | "UNRESOLVED";

export type InformationFlowReasonCode =
  | "INTERNAL_GOVERNED_FLOW"
  | "PUBLIC_EXTERNAL_FLOW"
  | "GOVERNED_EXTERNAL_FLOW"
  | "UNCLASSIFIED_EXTERNAL_EXPORT"
  | "FORBIDDEN_SENSITIVE_EXTERNAL_FLOW"
  | "PII_EXTERNAL_RESEARCH_REQUIRES_DECLASSIFICATION"
  | "MISSING_FLOW_CAPABILITY_REQUIREMENT"
  | "MISSING_RESOURCE_SCOPE_REQUIREMENT"
  | "MISSING_DECLASSIFICATION_REQUIREMENT"
  | "DECLASSIFICATION_REQUIREMENT_MISMATCH"
  | "TRANSFORMATION_PROOF_MISSING"
  | "TRANSFORMATION_PROOF_MISMATCH"
  | "REDACTION_IS_NOT_DECLASSIFICATION"
  | "MALFORMED_DECLASSIFICATION_LINK";

export interface InformationFlowEvaluation {
  flowId: string;
  decision: InformationFlowDecision;
  reasonCodes: InformationFlowReasonCode[];
  sourceClassification: InformationClassification;
  effectiveClassification: InformationClassification;
  destinationKind: InformationFlow["destination"]["kind"];
}

function requirementById(requirements: AuthorityRequirement[], requirementId: string | undefined): AuthorityRequirement | undefined {
  return requirementId ? requirements.find((requirement) => requirement.requirementId === requirementId) : undefined;
}

function hasCapability(requirements: AuthorityRequirement[], capability: string): boolean {
  return requirements.some((requirement) => requirement.kind === "REQUIRES_CAPABILITY" && requirement.capability === capability);
}

function hasResourceScope(requirements: AuthorityRequirement[], flow: InformationFlow): boolean {
  const destinationResource = flow.destination.kind === "COMMUNICATION_RECIPIENT" ? flow.destination.recipient : flow.source;
  return requirements.some((requirement) => requirement.kind === "REQUIRES_RESOURCE_SCOPE"
    && requirement.resource.kind === destinationResource.kind
    && requirement.resource.type === destinationResource.type
    && (requirement.resource.entityRef ? requirement.resource.entityRef === destinationResource.entityRef : true)
    && (requirement.resource.id ? requirement.resource.id === destinationResource.id : true));
}

function effectiveClassification(
  source: InformationClassification,
  transformation: InformationTransformation,
): { classification: InformationClassification; proven: boolean; reasonCodes: InformationFlowReasonCode[] } {
  if (transformation.kind === "IDENTITY") return { classification: source, proven: true, reasonCodes: [] };
  const proof = transformation.proof;
  if (proof.kind === "NONE") {
    return { classification: source, proven: false, reasonCodes: ["TRANSFORMATION_PROOF_MISSING"] };
  }
  if (proof.verifiedOutputClassification !== transformation.outputClassification) {
    return { classification: source, proven: false, reasonCodes: ["TRANSFORMATION_PROOF_MISMATCH"] };
  }
  return { classification: transformation.outputClassification, proven: true, reasonCodes: [] };
}

function declassificationValid(
  flow: InformationFlow,
  requirements: AuthorityRequirement[],
  effective: InformationClassification,
): InformationFlowReasonCode[] {
  const linkedId = flow.transformation.kind === "DECLASSIFICATION"
    ? flow.transformation.authorityRequirementId
    : flow.declassificationRequirementId;
  if (!linkedId) return ["MISSING_DECLASSIFICATION_REQUIREMENT"];
  if (flow.declassificationRequirementId && flow.declassificationRequirementId !== linkedId) return ["MALFORMED_DECLASSIFICATION_LINK"];
  const requirement = requirementById(requirements, linkedId);
  if (!requirement) return ["MISSING_DECLASSIFICATION_REQUIREMENT"];
  if (requirement.kind !== "REQUIRES_DECLASSIFICATION_AUTHORITY"
      || requirement.sourceClassification !== flow.information.classification
      || requirement.outputClassification !== effective
      || requirement.destinationKind !== flow.destination.kind) {
    return ["DECLASSIFICATION_REQUIREMENT_MISMATCH"];
  }
  return [];
}

function capabilityForDestination(flow: InformationFlow): string | undefined {
  switch (flow.destination.kind) {
    case "GOVERNED_CAPABILITY":
    case "COMMUNICATION_RECIPIENT":
    case "EXTERNAL_PROVIDER":
    case "COMPUTER_APPLICATION":
      return flow.destination.capability;
    default:
      return undefined;
  }
}

function rejected(flow: InformationFlow, effective: InformationClassification, reasonCodes: InformationFlowReasonCode[]): InformationFlowEvaluation {
  return {
    flowId: flow.flowId,
    decision: "REJECTED",
    reasonCodes,
    sourceClassification: flow.information.classification,
    effectiveClassification: effective,
    destinationKind: flow.destination.kind,
  };
}

export function evaluateInformationFlow(
  flow: InformationFlow,
  requirements: AuthorityRequirement[],
): InformationFlowEvaluation {
  const transformed = effectiveClassification(flow.information.classification, flow.transformation);
  const base = {
    flowId: flow.flowId,
    sourceClassification: flow.information.classification,
    effectiveClassification: transformed.classification,
    destinationKind: flow.destination.kind,
  };
  if (!transformed.proven) {
    return { ...base, decision: "UNRESOLVED", reasonCodes: transformed.reasonCodes };
  }

  const destinationCapability = capabilityForDestination(flow);
  if (destinationCapability && !hasCapability(requirements, destinationCapability)) {
    return rejected(flow, transformed.classification, ["MISSING_FLOW_CAPABILITY_REQUIREMENT"]);
  }

  if (flow.destination.kind === "INTERNAL_CANONICAL" || flow.destination.kind === "GOVERNED_CAPABILITY") {
    return { ...base, decision: "LEGAL", reasonCodes: ["INTERNAL_GOVERNED_FLOW"] };
  }

  if (transformed.classification === "UNCLASSIFIED") {
    return rejected(flow, transformed.classification, ["UNCLASSIFIED_EXTERNAL_EXPORT"]);
  }
  const isExplicitDeclassification = flow.transformation.kind === "DECLASSIFICATION";
  if (flow.destination.kind === "EXTERNAL_RESEARCH") {
    if (!isExplicitDeclassification) {
      return rejected(flow, transformed.classification, [
        ...(flow.transformation.kind === "REDACTION" ? ["REDACTION_IS_NOT_DECLASSIFICATION" as const] : []),
        "PII_EXTERNAL_RESEARCH_REQUIRES_DECLASSIFICATION",
      ]);
    }
    const declassificationIssues = declassificationValid(flow, requirements, transformed.classification);
    return declassificationIssues.length
      ? rejected(flow, transformed.classification, declassificationIssues)
      : { ...base, decision: "LEGAL", reasonCodes: ["GOVERNED_EXTERNAL_FLOW"] };
  }

  if (flow.destination.kind === "LOG_OR_TELEMETRY") {
    if (!isExplicitDeclassification) {
      return rejected(flow, transformed.classification, [
        ...(flow.transformation.kind === "REDACTION" ? ["REDACTION_IS_NOT_DECLASSIFICATION" as const] : []),
        "FORBIDDEN_SENSITIVE_EXTERNAL_FLOW",
      ]);
    }
    const declassificationIssues = declassificationValid(flow, requirements, transformed.classification);
    return declassificationIssues.length
      ? rejected(flow, transformed.classification, declassificationIssues)
      : { ...base, decision: "LEGAL", reasonCodes: ["GOVERNED_EXTERNAL_FLOW"] };
  }

  if (transformed.classification === "PUBLIC") {
    return { ...base, decision: "LEGAL", reasonCodes: ["PUBLIC_EXTERNAL_FLOW"] };
  }

  if (["SECRET", "CREDENTIAL_BOUND"].includes(transformed.classification) && !isExplicitDeclassification) {
    return rejected(flow, transformed.classification, ["FORBIDDEN_SENSITIVE_EXTERNAL_FLOW"]);
  }
  if (isExplicitDeclassification) {
    const declassificationIssues = declassificationValid(flow, requirements, transformed.classification);
    if (declassificationIssues.length) return rejected(flow, transformed.classification, declassificationIssues);
  }
  if (!hasResourceScope(requirements, flow)) {
    return rejected(flow, transformed.classification, ["MISSING_RESOURCE_SCOPE_REQUIREMENT"]);
  }
  return { ...base, decision: "LEGAL", reasonCodes: ["GOVERNED_EXTERNAL_FLOW"] };
}

export function evaluateInformationFlows(
  flows: InformationFlow[],
  requirements: AuthorityRequirement[],
): InformationFlowEvaluation[] {
  return [...flows]
    .sort((left, right) => left.flowId.localeCompare(right.flowId))
    .map((flow) => evaluateInformationFlow(flow, requirements));
}
