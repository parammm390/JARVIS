import { canonicalSerialize, canonicalizeIrFragment } from "./canonical";
import type { Constraint, Effect, OperationalProgram, Predicate, ProgramNode, Query } from "./contracts";
import {
  AUDITED_INFORMATION_CLASSIFICATION_EVIDENCE,
  AUDITED_OPERATION_EFFECT_CATALOG,
  AUDITED_QUERY_EFFECT_CATALOG,
  inferExecutableNodeEffects,
} from "./effect-inference";
import { authorizedRequirementManifest, composeOperationalProgramEffects } from "./effect-composition";
import { analyzeProgramGraph } from "./graph";
import { evaluateInformationFlows, type InformationFlowEvaluation } from "./information-flow";
import {
  resolveStaticProgramEnvironment,
  type StaticResolutionContext,
  type StaticResolutionReport,
} from "./resolution";
import type {
  AuthorizedRequirementManifest,
  EffectDeclaration,
  EffectResource,
  ProgramEffectSummary,
  StaticReversibility,
} from "./effects";
import { validateOperationalProgram } from "./validation";

export type StaticAdmissibilityStatus = "ADMISSIBLE" | "REJECTED" | "UNRESOLVED";

export type StaticAdmissibilityReasonCode =
  | "MALFORMED_OPERATIONAL_IR"
  | "UNSUPPORTED_EFFECT_INFERENCE"
  | "RUNTIME_ONLY_EFFECT_INFERENCE"
  | "UNSUPPORTED_EFFECT_LOWERING"
  | "FORBIDDEN_INFORMATION_FLOW"
  | "MISSING_INFORMATION_FLOW_DECLARATION"
  | "UNCLASSIFIED_SENSITIVE_EXPORT"
  | "UNPROVEN_INFORMATION_CLASSIFICATION"
  | "TRANSFORMATION_UNPROVEN"
  | "MISSING_REQUIRED_CAPABILITY_DECLARATION"
  | "CAPABILITY_DECLARATION_MISMATCH"
  | "CAPABILITY_EFFECT_CLASS_MISMATCH"
  | "ILLEGAL_RESOURCE_WRITE"
  | "INCOMPATIBLE_EFFECT_COMPOSITION"
  | "MISSING_MANDATORY_OBSERVATION"
  | "MISSING_COMPENSATION_REQUIREMENT"
  | "FORBIDDEN_IRREVERSIBLE_EFFECT"
  | "OPTIMISTIC_REVERSIBILITY"
  | "IMPOSSIBLE_AUTHORITY_REQUIREMENT"
  | "CONTRADICTORY_HARD_EFFECT_CONSTRAINT"
  | "MALFORMED_PRECONDITION"
  | "MALFORMED_POSTCONDITION"
  | "DECLARATION_ARGUMENT_MISMATCH"
  | "INVALID_COMPENSATION_LINKAGE"
  | "ENTITY_RESOLUTION_FAILED"
  | "ENTITY_RESOLUTION_UNRESOLVED"
  | "CAPABILITY_RESOLUTION_FAILED"
  | "CAPABILITY_RESOLUTION_UNRESOLVED";

export interface StaticAdmissibilityIssue {
  status: Exclude<StaticAdmissibilityStatus, "ADMISSIBLE">;
  reasonCode: StaticAdmissibilityReasonCode;
  nodeId: string;
  path: string;
  message: string;
  detail?: Record<string, unknown>;
}

export interface StaticAdmissibilityPolicy {
  forbiddenIrreversibleOperations?: readonly string[];
  compensationRequiredOperations?: readonly string[];
  /** Current lowerer does not support static multi-node OBJECTIVE lowering. */
  rejectKnownParallelConflicts?: boolean;
}

export interface StaticAdmissibilityOptions {
  resolution?: StaticResolutionContext;
  policy?: StaticAdmissibilityPolicy;
}

export interface StaticAdmissibilityResult {
  status: StaticAdmissibilityStatus;
  reasonCodes: StaticAdmissibilityReasonCode[];
  issues: StaticAdmissibilityIssue[];
  summary?: ProgramEffectSummary;
  manifest?: AuthorizedRequirementManifest;
  informationFlows: InformationFlowEvaluation[];
  resolution?: StaticResolutionReport;
}

function stable(value: unknown): string {
  return canonicalSerialize(canonicalizeIrFragment(value));
}

function allNodes(root: ProgramNode): ProgramNode[] {
  const nodes: ProgramNode[] = [];
  const visit = (node: ProgramNode) => {
    nodes.push(node);
    if (node.kind === "sequence") node.steps.forEach(visit);
    else if (node.kind === "parallel") node.branches.forEach(visit);
    else if (node.kind === "branch") {
      node.cases.forEach((branchCase) => visit(branchCase.then));
      if (node.otherwise) visit(node.otherwise);
    } else if (node.kind === "compensation") nodes.push(node.effect);
  };
  visit(root);
  return nodes;
}

function statusFor(issues: StaticAdmissibilityIssue[]): StaticAdmissibilityStatus {
  if (issues.some((issue) => issue.status === "REJECTED")) return "REJECTED";
  if (issues.some((issue) => issue.status === "UNRESOLVED")) return "UNRESOLVED";
  return "ADMISSIBLE";
}

function issue(
  issues: StaticAdmissibilityIssue[],
  status: Exclude<StaticAdmissibilityStatus, "ADMISSIBLE">,
  reasonCode: StaticAdmissibilityReasonCode,
  nodeId: string,
  path: string,
  message: string,
  detail?: Record<string, unknown>,
): void {
  issues.push({ status, reasonCode, nodeId, path, message, ...(detail ? { detail } : {}) });
}

function resourceMatches(left: EffectResource, right: EffectResource): boolean {
  return left.kind === right.kind
    && left.type === right.type
    && (left.entityRef ? left.entityRef === right.entityRef : true)
    && (left.id ? left.id === right.id : true);
}

function predicateReferencesEntity(predicate: Predicate, entityRef: string): boolean {
  if (predicate.kind === "assertion") return predicate.subject.kind === "entity" && predicate.subject.ref === entityRef;
  if (predicate.kind === "not") return predicateReferencesEntity(predicate.predicate, entityRef);
  return predicate.predicates.some((child) => predicateReferencesEntity(child, entityRef));
}

function declarationForNode(node: Effect | Query, program: OperationalProgram): EffectDeclaration | undefined {
  return inferExecutableNodeEffects(node, program).declaration;
}

function declaredCapabilities(declaration: EffectDeclaration): string[] {
  return declaration.authorityRequirements.flatMap((requirement) => requirement.kind === "REQUIRES_CAPABILITY" ? [requirement.capability] : []);
}

function riskRank(risk: "low" | "medium" | "high"): number {
  return risk === "low" ? 0 : risk === "medium" ? 1 : 2;
}

function reversibilityOptimistic(declared: StaticReversibility, audited: StaticReversibility): boolean {
  if (declared === "UNKNOWN") return false;
  if (audited === "UNKNOWN") return true;
  if (audited === "IRREVERSIBLE") return declared !== "IRREVERSIBLE";
  if (audited === "COMPENSATABLE") return declared === "REVERSIBLE" || declared === "READ_ONLY";
  if (audited === "REVERSIBLE") return declared === "READ_ONLY";
  return declared !== "READ_ONLY";
}

function constraintCapability(constraint: Constraint): string | null {
  const predicate = constraint.predicate;
  if (predicate.kind !== "assertion" || predicate.subject.kind !== "program" || predicate.operator !== "contains") return null;
  if (stable(predicate.path) !== stable(["requiredCapabilities"]) || typeof predicate.expected !== "string") return null;
  return predicate.expected;
}

function checkNodeContracts(program: OperationalProgram, summary: ProgramEffectSummary, issues: StaticAdmissibilityIssue[]): void {
  const nodes = allNodes(program.body);
  const compensationByEffect = new Map(summary.compensationLinks.map((link) => [link.compensationEffectId, link]));
  for (const node of nodes) {
    if (node.kind !== "effect" && node.kind !== "query") continue;
    const declaration = declarationForNode(node, program);
    if (!declaration) continue;
    const descriptors = [
      ...declaration.contract.reads.map((entry) => entry.information),
      ...declaration.contract.writes.map((entry) => entry.information),
      ...declaration.contract.modifies.map((entry) => entry.information),
      ...declaration.communications.map((entry) => entry.information),
      ...declaration.informationFlows.map((entry) => entry.information),
    ];
    for (const descriptor of descriptors) {
      const evidence = descriptor.evidenceRef
        ? AUDITED_INFORMATION_CLASSIFICATION_EVIDENCE[descriptor.evidenceRef as keyof typeof AUDITED_INFORMATION_CLASSIFICATION_EVIDENCE]
        : undefined;
      const invalidDeclaredEvidence = descriptor.basis === "IR_DECLARED" && descriptor.classification !== "UNCLASSIFIED"
        && (!evidence
          || evidence.classification !== descriptor.classification
          || descriptor.fields.some((field) => !(evidence.fields as readonly string[]).includes(field)));
      if (invalidDeclaredEvidence || descriptor.basis === "RUNTIME_ONLY") {
        issue(issues, "REJECTED", "UNPROVEN_INFORMATION_CLASSIFICATION", node.semanticId, `body.${node.semanticId}.effectDeclaration`, `Classification ${descriptor.classification} has no static evidence reference.`);
      }
    }
    const capability = node.kind === "effect" ? node.requiredCapability : `query:${node.request.intent}`;
    const capabilities = declaredCapabilities(declaration);
    if (capabilities.length === 0) {
      issue(issues, "REJECTED", "MISSING_REQUIRED_CAPABILITY_DECLARATION", node.semanticId, `body.${node.semanticId}.effectDeclaration.authorityRequirements`, `Required capability ${capability} is not declared.`);
    } else if (!capabilities.includes(capability)) {
      issue(issues, "REJECTED", "CAPABILITY_DECLARATION_MISMATCH", node.semanticId, `body.${node.semanticId}.effectDeclaration.authorityRequirements`, `Declared capabilities do not include ${capability}.`, { declared: capabilities });
    }

    if (node.kind === "query") {
      if (!AUDITED_QUERY_EFFECT_CATALOG[node.request.intent]) continue;
      if (declaration.contract.writes.length || declaration.contract.modifies.length || declaration.reversibility.classification !== "READ_ONLY") {
        issue(issues, "REJECTED", "ILLEGAL_RESOURCE_WRITE", node.semanticId, `body.${node.semanticId}.effectDeclaration.contract`, "An audited Operational Query must remain READ_ONLY.");
      }
      continue;
    }

    const catalog = AUDITED_OPERATION_EFFECT_CATALOG[node.operation];
    if (!catalog) continue;
    if (capability !== `action:${node.operation}`) {
      issue(issues, "REJECTED", "CAPABILITY_DECLARATION_MISMATCH", node.semanticId, `body.${node.semanticId}.requiredCapability`, `Operation ${node.operation} requires the existing action:${node.operation} vocabulary.`);
    }
    if (node.operation === "record_payment" || node.operation === "launch_ad_campaign") {
      const rawAmount = node.operation === "record_payment" ? node.arguments.amountUsd ?? node.arguments.amount : node.arguments.budgetUsd ?? node.arguments.budget;
      const amount = typeof rawAmount === "number" ? rawAmount : typeof rawAmount === "string" ? Number(rawAmount) : NaN;
      const currency = typeof node.arguments.currency === "string" ? node.arguments.currency.toUpperCase() : "USD";
      if (!Number.isFinite(amount) || !declaration.financial.some((entry) =>
        entry.amount === amount
        && entry.currency === currency
        && entry.operation === (node.operation === "launch_ad_campaign" ? "SPEND" : "WRITE"),
      )) {
        issue(issues, "REJECTED", "DECLARATION_ARGUMENT_MISMATCH", node.semanticId, `body.${node.semanticId}.effectDeclaration.financial`, "Financial declaration does not preserve the exact requested amount, currency, and operation.");
      }
      if (declaration.financial.some((entry) => !declaration.informationFlows.some((flow) =>
        flow.destination.kind === "EXTERNAL_PROVIDER"
        && flow.destination.capability === capability
        && resourceMatches(flow.source, entry.resource)
        && flow.information.classification === "FINANCIAL",
      ))) {
        issue(issues, "REJECTED", "MISSING_INFORMATION_FLOW_DECLARATION", node.semanticId, `body.${node.semanticId}.effectDeclaration.informationFlows`, "Every external financial effect requires a matching FINANCIAL provider flow.");
      }
    }
    if (node.operation === "send_message") {
      const rawChannel = typeof node.arguments.channel === "string" ? node.arguments.channel.toLowerCase() : "unknown";
      const channel = rawChannel === "text" ? "sms" : rawChannel === "phone" || rawChannel === "call" ? "voice" : rawChannel;
      const communication = declaration.communications.find((entry) => entry.channel === channel);
      if (!communication || !declaration.externalMutations.some((entry) => entry.system === "communications")) {
        issue(issues, "REJECTED", "DECLARATION_ARGUMENT_MISMATCH", node.semanticId, `body.${node.semanticId}.effectDeclaration.communications`, "Communication declaration does not preserve the requested channel and external communication class.");
      } else if (!declaration.informationFlows.some((flow) =>
        flow.destination.kind === "COMMUNICATION_RECIPIENT"
        && flow.destination.capability === capability
        && resourceMatches(flow.destination.recipient, communication.recipient)
        && stable(flow.information) === stable(communication.information),
      )) {
        issue(issues, "REJECTED", "MISSING_INFORMATION_FLOW_DECLARATION", node.semanticId, `body.${node.semanticId}.effectDeclaration.informationFlows`, "Every communication requires a matching recipient information flow.");
      }
    }
    if (node.operation === "computer_task") {
      const authorized = node.arguments.authorizedEffect;
      const application = node.arguments.application;
      const row = authorized && typeof authorized === "object" && !Array.isArray(authorized) ? authorized as Record<string, unknown> : null;
      const target = row?.target && typeof row.target === "object" && !Array.isArray(row.target) ? row.target as Record<string, unknown> : null;
      const changes = row?.changes && typeof row.changes === "object" && !Array.isArray(row.changes) ? row.changes as Record<string, unknown> : null;
      const exact = typeof application === "string" && typeof row?.operation === "string" && target && changes
        && declaration.computerMutations.some((entry) => stable({
          application: entry.application,
          operation: entry.operation,
          target: { kind: entry.resource.type, identifier: entry.resource.id },
          changes: entry.changes,
        }) === stable({
          application,
          operation: row.operation,
          target: { kind: target.kind, identifier: target.identifier },
          changes,
        }));
      if (!exact) {
        issue(issues, "REJECTED", "DECLARATION_ARGUMENT_MISMATCH", node.semanticId, `body.${node.semanticId}.effectDeclaration.computerMutations`, "Computer declaration does not preserve the exact application, operation, target, and changes.");
      }
      if (declaration.computerMutations.some((entry) => !declaration.informationFlows.some((flow) =>
        flow.destination.kind === "COMPUTER_APPLICATION"
        && flow.destination.capability === capability
        && flow.destination.application === entry.application,
      ))) {
        issue(issues, "REJECTED", "MISSING_INFORMATION_FLOW_DECLARATION", node.semanticId, `body.${node.semanticId}.effectDeclaration.informationFlows`, "Every computer mutation requires a matching computer-application information flow.");
      }
    }
    for (const write of [...declaration.contract.writes, ...declaration.contract.modifies]) {
      if (!catalog.allowedWriteResourceTypes.includes("*") && !catalog.allowedWriteResourceTypes.includes(write.resource.type)) {
        issue(issues, "REJECTED", "ILLEGAL_RESOURCE_WRITE", node.semanticId, `body.${node.semanticId}.effectDeclaration.contract.writes`, `${node.operation} cannot statically write ${write.resource.type}.`, { allowed: [...catalog.allowedWriteResourceTypes] });
      }
    }
    const requiredDimensions = new Set(catalog.requiredDimensions);
    const actualDimensions = new Set(summary.possible.filter((entry) => entry.effect.nodeId === node.semanticId).map((entry) => entry.effect.dimension));
    const missingDimensions = [...requiredDimensions].filter((dimension) => !actualDimensions.has(dimension as never));
    if (missingDimensions.length) {
      issue(issues, "REJECTED", "CAPABILITY_EFFECT_CLASS_MISMATCH", node.semanticId, `body.${node.semanticId}.effectDeclaration`, `Effect declaration omits required dimensions: ${missingDimensions.join(", ")}.`);
    }
    const riskRequirements = declaration.authorityRequirements.flatMap((requirement) => requirement.kind === "REQUIRES_RISK_LEVEL" ? [requirement.risk] : []);
    if (!riskRequirements.some((risk) => riskRank(risk) >= riskRank(catalog.risk))) {
      issue(issues, "REJECTED", "IMPOSSIBLE_AUTHORITY_REQUIREMENT", node.semanticId, `body.${node.semanticId}.effectDeclaration.authorityRequirements`, `Risk declaration is weaker than the existing ${catalog.risk} runtime classification.`);
    }
    const approval = declaration.authorityRequirements.find((requirement) => requirement.kind === "REQUIRES_APPROVAL");
    if ((catalog.approvalFloor === "REQUIRED" || catalog.approvalFloor === "TYPED_REQUIRED") && !approval) {
      issue(issues, "REJECTED", "MISSING_REQUIRED_CAPABILITY_DECLARATION", node.semanticId, `body.${node.semanticId}.effectDeclaration.authorityRequirements`, "Mandatory runtime approval requirement is missing.");
    } else if (catalog.approvalFloor === "TYPED_REQUIRED" && approval?.kind === "REQUIRES_APPROVAL" && !approval.typed) {
      issue(issues, "REJECTED", "IMPOSSIBLE_AUTHORITY_REQUIREMENT", node.semanticId, `body.${node.semanticId}.effectDeclaration.authorityRequirements`, "Typed approval is mandatory for this operation.");
    }
    if (reversibilityOptimistic(declaration.reversibility.classification, catalog.reversibility)) {
      issue(issues, "REJECTED", "OPTIMISTIC_REVERSIBILITY", node.semanticId, `body.${node.semanticId}.effectDeclaration.reversibility`, `Static reversibility ${declaration.reversibility.classification} is more optimistic than audited ${catalog.reversibility}.`);
    }
    if (declaration.contract.ensures.length === 0 || !declaration.contract.ensures.some((predicate) => stable(predicate) === stable(node.intendedState))) {
      issue(issues, "REJECTED", "MALFORMED_POSTCONDITION", node.semanticId, `body.${node.semanticId}.effectDeclaration.contract.ensures`, "The exact intendedState must be retained as an ensure contract.");
    }
    const existingTargets = declaration.contract.reads.map((read) => read.resource).filter((resource) => resource.selector === "EXISTING" && resource.entityRef);
    for (const target of existingTargets) {
      if (!declaration.contract.requires.some((predicate) => predicateReferencesEntity(predicate, target.entityRef!))) {
        issue(issues, "REJECTED", "MALFORMED_PRECONDITION", node.semanticId, `body.${node.semanticId}.effectDeclaration.contract.requires`, `No precondition references existing target ${target.entityRef}.`);
      }
    }
    const observes = new Set(declaration.contract.observes);
    const missingObservations = node.expectedObservationRefs.filter((ref) => !observes.has(ref));
    if (missingObservations.length || (catalog.requiredDimensions.includes("OBSERVATION") && observes.size === 0)) {
      issue(issues, "REJECTED", "MISSING_MANDATORY_OBSERVATION", node.semanticId, `body.${node.semanticId}.effectDeclaration.contract.observes`, `Mandatory observations are missing: ${missingObservations.join(", ") || "none declared"}.`);
    }
    if (declaration.reversibility.classification === "COMPENSATABLE") {
      const linked = declaration.reversibility.compensationEffectId;
      const actual = linked ? summary.compensationLinks.find((link) => link.originalEffectId === node.semanticId && link.compensationEffectId === linked) : undefined;
      if (!actual) {
        issue(issues, "REJECTED", "INVALID_COMPENSATION_LINKAGE", node.semanticId, `body.${node.semanticId}.effectDeclaration.reversibility`, "COMPENSATABLE requires an exact structural compensation link.");
      }
    }
    const compensation = compensationByEffect.get(node.semanticId);
    if (compensation && declaration.contract.compensates !== compensation.originalEffectId) {
      issue(issues, "REJECTED", "INVALID_COMPENSATION_LINKAGE", node.semanticId, `body.${node.semanticId}.effectDeclaration.contract.compensates`, `Compensation declaration must link to ${compensation.originalEffectId}.`);
    }
  }
}

function checkHardConstraints(program: OperationalProgram, summary: ProgramEffectSummary, issues: StaticAdmissibilityIssue[]): void {
  const capabilities = new Set(summary.authorityRequirements.flatMap((requirement) => requirement.kind === "REQUIRES_CAPABILITY" ? [requirement.capability] : []));
  for (const constraint of program.constraints) {
    if (constraint.severity !== "HARD") continue;
    const requiredCapability = constraintCapability(constraint);
    if (requiredCapability && constraint.evaluation === "SATISFIED" && !capabilities.has(requiredCapability)) {
      issue(issues, "REJECTED", "CONTRADICTORY_HARD_EFFECT_CONSTRAINT", constraint.semanticId, `constraints.${constraint.semanticId}`, `HARD constraint claims ${requiredCapability} is satisfied but the manifest does not require it.`);
    }
  }
  if (program.budget?.maxCost) {
    const spend = summary.authorityRequirements.filter((requirement) => requirement.kind === "REQUIRES_SPEND_AUTHORITY");
    for (const requirement of spend) {
      if (requirement.kind === "REQUIRES_SPEND_AUTHORITY"
          && requirement.currency === program.budget.maxCost.currency
          && requirement.amount > program.budget.maxCost.amount) {
        issue(issues, "REJECTED", "CONTRADICTORY_HARD_EFFECT_CONSTRAINT", requirement.requirementId, "budget.maxCost", `Required spend ${requirement.amount} ${requirement.currency} exceeds the hard program budget.`);
      }
    }
  }
}

function loweringSupported(program: OperationalProgram): boolean {
  if (program.executionModel === "QUERY" || program.executionModel === "ATOMIC_EFFECT" || program.executionModel === "KNOWN_ACTION_COMPATIBILITY") return true;
  if (program.executionModel !== "OBJECTIVE") return false;
  const graph = analyzeProgramGraph(program.body);
  return graph.nodes.size === 1;
}

function checkPolicy(program: OperationalProgram, summary: ProgramEffectSummary, policy: StaticAdmissibilityPolicy, issues: StaticAdmissibilityIssue[]): void {
  const forbidden = new Set(policy.forbiddenIrreversibleOperations ?? []);
  const requiredCompensation = new Set(policy.compensationRequiredOperations ?? []);
  for (const node of allNodes(program.body)) {
    if (node.kind !== "effect") continue;
    const declaration = declarationForNode(node, program);
    if (!declaration) continue;
    if (forbidden.has(node.operation) && declaration.reversibility.classification === "IRREVERSIBLE") {
      issue(issues, "REJECTED", "FORBIDDEN_IRREVERSIBLE_EFFECT", node.semanticId, `body.${node.semanticId}.effectDeclaration.reversibility`, `${node.operation} is irreversibly forbidden by the supplied static policy.`);
    }
    if (requiredCompensation.has(node.operation)
        && !summary.compensationLinks.some((link) => link.originalEffectId === node.semanticId)) {
      issue(issues, "REJECTED", "MISSING_COMPENSATION_REQUIREMENT", node.semanticId, `body.${node.semanticId}`, `${node.operation} requires an explicit compensation node.`);
    }
  }
  if ((policy.rejectKnownParallelConflicts ?? true) && summary.conflicts.length) {
    for (const conflict of summary.conflicts) {
      issue(issues, "REJECTED", "INCOMPATIBLE_EFFECT_COMPOSITION", conflict.parallelNodeId, `body.${conflict.parallelNodeId}`, conflict.code, { leftNodeId: conflict.leftNodeId, rightNodeId: conflict.rightNodeId, resource: conflict.resource });
    }
  }
}

function mapResolutionIssues(report: StaticResolutionReport, issues: StaticAdmissibilityIssue[]): void {
  for (const resolutionIssue of report.issues) {
    if (resolutionIssue.decision === "RESOLVED") continue;
    const entity = resolutionIssue.reasonCode.startsWith("ENTITY") || resolutionIssue.reasonCode === "CROSS_TENANT_REFERENCE";
    issue(
      issues,
      resolutionIssue.decision === "REJECTED" ? "REJECTED" : "UNRESOLVED",
      entity
        ? resolutionIssue.decision === "REJECTED" ? "ENTITY_RESOLUTION_FAILED" : "ENTITY_RESOLUTION_UNRESOLVED"
        : resolutionIssue.decision === "REJECTED" ? "CAPABILITY_RESOLUTION_FAILED" : "CAPABILITY_RESOLUTION_UNRESOLVED",
      resolutionIssue.nodeId,
      `resolution.${resolutionIssue.nodeId}`,
      resolutionIssue.message,
      { resolutionReasonCode: resolutionIssue.reasonCode },
    );
  }
}

/** One fail-closed deterministic checker. Runtime Authority is deliberately absent. */
export async function checkOperationalProgramAdmissibility(
  input: unknown,
  options: StaticAdmissibilityOptions = {},
): Promise<StaticAdmissibilityResult> {
  const validation = validateOperationalProgram(input);
  if (!validation.valid || !validation.program) {
    const issues = validation.errors.map((error): StaticAdmissibilityIssue => ({
      status: "REJECTED",
      reasonCode: "MALFORMED_OPERATIONAL_IR",
      nodeId: error.path.startsWith("body.") ? error.path.split(".").slice(0, 3).at(-1) ?? "$" : "$",
      path: error.path,
      message: `${error.code}: ${error.message}`,
      detail: { validationReasonCode: error.code },
    }));
    return { status: "REJECTED", reasonCodes: ["MALFORMED_OPERATIONAL_IR"], issues, informationFlows: [] };
  }

  const program = validation.program;
  const summary = composeOperationalProgramEffects(program);
  const manifest = authorizedRequirementManifest(program, summary);
  const issues: StaticAdmissibilityIssue[] = [];
  for (const nodeId of summary.unsupportedNodeIds) {
    issue(issues, "UNRESOLVED", "UNSUPPORTED_EFFECT_INFERENCE", nodeId, `body.${nodeId}`, "No audited P2 effect inference exists for this node.");
  }
  for (const nodeId of summary.runtimeOnlyNodeIds) {
    issue(issues, "UNRESOLVED", "RUNTIME_ONLY_EFFECT_INFERENCE", nodeId, `body.${nodeId}`, "Required effect semantics are available only at runtime.");
  }
  if (!loweringSupported(program)) {
    issue(issues, "UNRESOLVED", "UNSUPPORTED_EFFECT_LOWERING", program.body.semanticId, "body", "The existing lowerer cannot represent this complete static program.");
  }

  checkNodeContracts(program, summary, issues);
  checkHardConstraints(program, summary, issues);
  checkPolicy(program, summary, options.policy ?? {}, issues);

  const informationFlows = evaluateInformationFlows(summary.informationFlows, summary.authorityRequirements);
  for (const flow of informationFlows) {
    if (flow.decision === "LEGAL") continue;
    const unclassified = flow.reasonCodes.includes("UNCLASSIFIED_EXTERNAL_EXPORT");
    const unproven = flow.reasonCodes.includes("TRANSFORMATION_PROOF_MISSING") || flow.reasonCodes.includes("TRANSFORMATION_PROOF_MISMATCH");
    issue(
      issues,
      flow.decision === "REJECTED" ? "REJECTED" : "UNRESOLVED",
      unclassified ? "UNCLASSIFIED_SENSITIVE_EXPORT" : unproven ? "TRANSFORMATION_UNPROVEN" : "FORBIDDEN_INFORMATION_FLOW",
      summary.informationFlows.find((candidate) => candidate.flowId === flow.flowId)?.nodeId ?? flow.flowId,
      `informationFlows.${flow.flowId}`,
      `Information flow is ${flow.decision.toLowerCase()}: ${flow.reasonCodes.join(", ")}.`,
      { flowReasonCodes: flow.reasonCodes },
    );
  }

  const resolution = await resolveStaticProgramEnvironment(program, summary, options.resolution);
  mapResolutionIssues(resolution, issues);
  issues.sort((left, right) => `${left.nodeId}\u0000${left.path}\u0000${left.reasonCode}\u0000${left.message}`.localeCompare(`${right.nodeId}\u0000${right.path}\u0000${right.reasonCode}\u0000${right.message}`));
  const status = statusFor(issues);
  return {
    status,
    reasonCodes: [...new Set(issues.map((entry) => entry.reasonCode))].sort(),
    issues,
    summary,
    manifest,
    informationFlows,
    resolution,
  };
}
