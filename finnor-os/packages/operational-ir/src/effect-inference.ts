import type { OperationalQueryRequest } from "@finnor/shared-types";
import type { Effect, OperationalProgram, Predicate, Query, Wait } from "./contracts";
import type {
  AuthorityRequirement,
  EffectDeclaration,
  EffectResource,
  InformationClassification,
  InformationDescriptor,
  InformationFlow,
  ResourceAccess,
  StaticReversibility,
  StaticRiskLevel,
} from "./effects";

export const EFFECT_INFERENCE_VERSION = 1 as const;

/** Closed evidence vocabulary audited from existing canonical schema/catalog and
 * CapabilityContract/tool PII allowlists. IR carries only the semantic evidence id. */
export const AUDITED_INFORMATION_CLASSIFICATION_EVIDENCE = {
  "capability:communication:pii-allowlist:v1": {
    classification: "PII",
    fields: ["recipient", "to", "phoneNumber", "message", "body", "subject"],
    sourceOwner: "existing communications CapabilityContract/tool piiAllowlist",
  },
  "canonical:invoice:financial:v1": {
    classification: "FINANCIAL",
    fields: ["amount", "amountUsd", "currency", "memo", "status"],
    sourceOwner: "existing canonical invoice schema plus audited money query catalog",
  },
} as const;

export type EffectInferenceSupport = "SUPPORTED" | "RUNTIME_ONLY" | "UNSUPPORTED";

export interface EffectInferenceResult {
  nodeId: string;
  support: EffectInferenceSupport;
  declaration?: EffectDeclaration;
  reasonCodes: string[];
}

export interface AuditedOperationSemantics {
  operation: string;
  actionProfile: "INTERNAL_WRITE" | "FINANCIAL_WRITE" | "EXTERNAL_SIDE_EFFECT" | "EXTERNAL_SPEND";
  runtimeOperationClass: "internal_write" | "financial_write" | "external_side_effect" | "external_spend";
  risk: StaticRiskLevel;
  approvalFloor: "POLICY" | "REQUIRED" | "TYPED_REQUIRED";
  external: boolean;
  reversibility: StaticReversibility;
  allowedWriteResourceTypes: readonly string[];
  requiredDimensions: readonly string[];
  runtimeObservation: "canonical_state" | "provider_delivery" | "computer_state" | "recorded_result";
}

/** Audited representative rollout scope; unsupported operations never inherit a profile. */
export const AUDITED_OPERATION_EFFECT_CATALOG: Readonly<Record<string, AuditedOperationSemantics>> = {
  create_task: {
    operation: "create_task",
    actionProfile: "INTERNAL_WRITE",
    runtimeOperationClass: "internal_write",
    risk: "medium",
    approvalFloor: "POLICY",
    external: false,
    reversibility: "REVERSIBLE",
    allowedWriteResourceTypes: ["task"],
    requiredDimensions: ["READ", "WRITE", "AUTHORITY", "REVERSIBILITY", "OBSERVATION"],
    runtimeObservation: "recorded_result",
  },
  send_message: {
    operation: "send_message",
    actionProfile: "EXTERNAL_SIDE_EFFECT",
    runtimeOperationClass: "external_side_effect",
    risk: "high",
    approvalFloor: "REQUIRED",
    external: true,
    reversibility: "IRREVERSIBLE",
    allowedWriteResourceTypes: ["communication", "communication_delivery", "message"],
    requiredDimensions: ["READ", "WRITE", "COMMUNICATION", "EXTERNAL", "AUTHORITY", "REVERSIBILITY", "OBSERVATION"],
    runtimeObservation: "provider_delivery",
  },
  record_payment: {
    operation: "record_payment",
    actionProfile: "FINANCIAL_WRITE",
    runtimeOperationClass: "financial_write",
    risk: "high",
    approvalFloor: "TYPED_REQUIRED",
    external: true,
    reversibility: "IRREVERSIBLE",
    allowedWriteResourceTypes: ["payment", "invoice"],
    requiredDimensions: ["READ", "WRITE", "FINANCIAL", "EXTERNAL", "AUTHORITY", "REVERSIBILITY", "OBSERVATION"],
    runtimeObservation: "recorded_result",
  },
  launch_ad_campaign: {
    operation: "launch_ad_campaign",
    actionProfile: "EXTERNAL_SPEND",
    runtimeOperationClass: "external_spend",
    risk: "high",
    approvalFloor: "TYPED_REQUIRED",
    external: true,
    reversibility: "IRREVERSIBLE",
    allowedWriteResourceTypes: ["ad_campaign"],
    requiredDimensions: ["WRITE", "FINANCIAL", "EXTERNAL", "AUTHORITY", "REVERSIBILITY", "OBSERVATION"],
    runtimeObservation: "provider_delivery",
  },
  computer_task: {
    operation: "computer_task",
    actionProfile: "EXTERNAL_SIDE_EFFECT",
    runtimeOperationClass: "external_side_effect",
    risk: "high",
    approvalFloor: "POLICY",
    external: true,
    reversibility: "UNKNOWN",
    allowedWriteResourceTypes: ["*"],
    requiredDimensions: ["WRITE", "EXTERNAL", "COMPUTER", "AUTHORITY", "REVERSIBILITY", "OBSERVATION"],
    runtimeObservation: "computer_state",
  },
} as const;

interface QueryCatalogRow {
  resources: readonly string[];
  classification: InformationClassification;
}

export const AUDITED_QUERY_EFFECT_CATALOG: Readonly<Record<string, QueryCatalogRow>> = {
  customer_lookup: { resources: ["household", "contact"], classification: "PII" },
  customer_cohort: { resources: ["household", "service_visit", "communication"], classification: "PII" },
  inactivity_cohort: { resources: ["household", "service_visit", "communication"], classification: "PII" },
  schedule_range: { resources: ["appointment", "service_visit", "technician"], classification: "CUSTOMER_DATA" },
  money_summary: { resources: ["invoice", "payment"], classification: "FINANCIAL" },
  money: { resources: ["invoice", "payment"], classification: "FINANCIAL" },
  work_list: { resources: ["work", "task", "work_order"], classification: "TENANT_INTERNAL" },
  work: { resources: ["work", "task", "work_order"], classification: "TENANT_INTERNAL" },
  inventory_status: { resources: ["inventory_item", "procurement_order"], classification: "FINANCIAL" },
  inventory: { resources: ["inventory_item", "procurement_order"], classification: "FINANCIAL" },
  agent_activity: { resources: ["user", "work", "domain_action"], classification: "TENANT_INTERNAL" },
  business_state: { resources: ["business_operation", "work", "invoice", "appointment"], classification: "TENANT_INTERNAL" },
  company_context: { resources: ["org_unit", "user", "household", "contact", "external_contact"], classification: "PII" },
  party_lookup: { resources: ["user", "household", "contact", "external_contact"], classification: "PII" },
  party_context: { resources: ["user", "household", "contact", "external_contact"], classification: "PII" },
  team_roster: { resources: ["org_unit", "user"], classification: "PII" },
  party_availability: { resources: ["user", "technician", "appointment", "internal_event"], classification: "CUSTOMER_DATA" },
} as const;

function descriptor(classification: InformationClassification, fields: string[], basis: InformationDescriptor["basis"]): InformationDescriptor {
  return { classification, fields, basis };
}

function access(resource: EffectResource, classification: InformationClassification, fields = ["*"]): ResourceAccess {
  return { resource, fields, information: descriptor(classification, fields, "AUDITED_CATALOG") };
}

function resourceKey(resource: EffectResource): string {
  return `${resource.kind}:${resource.type}:${resource.selector}:${resource.entityRef ?? ""}:${resource.id ?? ""}`;
}

function uniqueResources(resources: EffectResource[]): EffectResource[] {
  return [...new Map(resources.map((resource) => [resourceKey(resource), resource])).values()]
    .sort((left, right) => resourceKey(left).localeCompare(resourceKey(right)));
}

function resolvedEffectTargets(effect: Effect, program: OperationalProgram): EffectResource[] {
  const entities = new Map(program.entities.map((entity) => [entity.semanticId, entity]));
  return uniqueResources(effect.targets.flatMap((target) => {
    const entity = entities.get(target.entityRef);
    if (!entity || entity.resolution.status !== "resolved") return [];
    return [{
      kind: entity.resolution.canonical.kind,
      type: entity.resolution.canonical.type,
      selector: "EXISTING" as const,
      entityRef: entity.semanticId,
      id: entity.resolution.canonical.id,
    }];
  }));
}

function resourceExistsPredicate(resource: EffectResource): Predicate | null {
  if (!resource.entityRef) return null;
  return { kind: "assertion", subject: { kind: "entity", ref: resource.entityRef }, path: [], operator: "exists" };
}

function authorityForEffect(effect: Effect, targets: EffectResource[], row: AuditedOperationSemantics): AuthorityRequirement[] {
  const requirements: AuthorityRequirement[] = [
    { requirementId: `authority.${effect.semanticId}.capability`, kind: "REQUIRES_CAPABILITY", capability: effect.requiredCapability },
    { requirementId: `authority.${effect.semanticId}.risk`, kind: "REQUIRES_RISK_LEVEL", risk: row.risk },
    ...targets.map((resource, index): AuthorityRequirement => ({
      requirementId: `authority.${effect.semanticId}.resource-${index + 1}`,
      kind: "REQUIRES_RESOURCE_SCOPE",
      resource,
    })),
  ];
  const compiledRequiresApproval = effect.domainActionCompatibility?.compiledGraph.requiresConfirmation === true;
  if (row.approvalFloor === "REQUIRED" || row.approvalFloor === "TYPED_REQUIRED" || compiledRequiresApproval) {
    requirements.push({
      requirementId: `authority.${effect.semanticId}.approval`,
      kind: "REQUIRES_APPROVAL",
      typed: row.approvalFloor === "TYPED_REQUIRED",
    });
  }
  return requirements;
}

function amountFromArguments(arguments_: Record<string, unknown>): { amount: number; currency: string } | null {
  const candidates = [arguments_.amountUsd, arguments_.amount, arguments_.budgetUsd, arguments_.budget, arguments_.spend, arguments_.totalUsd];
  const amount = candidates.map((value) => typeof value === "number" ? value : typeof value === "string" ? Number(value) : NaN)
    .find((value) => Number.isFinite(value) && value >= 0);
  if (amount === undefined) return null;
  const currency = typeof arguments_.currency === "string" && /^[A-Za-z]{3}$/.test(arguments_.currency)
    ? arguments_.currency.toUpperCase()
    : "USD";
  return { amount, currency };
}

function channelFromArguments(arguments_: Record<string, unknown>): "internal" | "email" | "sms" | "voice" | "chat" | "calendar" | "unknown" {
  const raw = typeof arguments_.channel === "string" ? arguments_.channel.toLowerCase() : "unknown";
  if (raw === "text") return "sms";
  if (raw === "phone" || raw === "call") return "voice";
  return ["internal", "email", "sms", "voice", "chat", "calendar"].includes(raw)
    ? raw as "internal" | "email" | "sms" | "voice" | "chat" | "calendar"
    : "unknown";
}

function baseEffectDeclaration(effect: Effect, row: AuditedOperationSemantics, targets: EffectResource[]): EffectDeclaration {
  const authorityRequirements = authorityForEffect(effect, targets, row);
  return {
    version: 1,
    source: "AUDITED_CATALOG",
    contract: {
      requires: targets.map(resourceExistsPredicate).filter((value): value is Predicate => Boolean(value)),
      ensures: [effect.intendedState],
      reads: targets.map((target) => access(target, "CUSTOMER_DATA", ["id"])),
      writes: [],
      modifies: [],
      throws: ["AUTHORITY_DENIED", "STALE_PRECONDITION", "CAPABILITY_UNAVAILABLE"],
      observes: [...effect.expectedObservationRefs],
    },
    communications: [],
    financial: [],
    externalMutations: [],
    computerMutations: [],
    informationFlows: [],
    authorityRequirements,
    reversibility: { classification: row.reversibility },
  };
}

function inferCreateTask(effect: Effect, program: OperationalProgram, row: AuditedOperationSemantics): EffectInferenceResult {
  const targets = resolvedEffectTargets(effect, program);
  const declaration = baseEffectDeclaration(effect, row, targets);
  const task = { kind: "entity" as const, type: "task", selector: "NEW" as const };
  declaration.contract.writes.push(access(task, "TENANT_INTERNAL", ["title", "subject", "assignee", "status", "dueAt"]));
  return { nodeId: effect.semanticId, support: "SUPPORTED", declaration, reasonCodes: ["audited_internal_write_catalog"] };
}

function inferSendMessage(effect: Effect, program: OperationalProgram, row: AuditedOperationSemantics): EffectInferenceResult {
  const targets = resolvedEffectTargets(effect, program);
  const declaration = baseEffectDeclaration(effect, row, targets);
  const recipient = targets[0] ?? { kind: "resource" as const, type: "communication_recipient", selector: "EXTERNAL" as const };
  const communication = { kind: "entity" as const, type: "communication_delivery", selector: "NEW" as const };
  const information = descriptor("UNCLASSIFIED", ["body", "subject"], "AUDITED_CATALOG");
  declaration.contract.writes.push(access(communication, "TENANT_INTERNAL", ["status", "channel", "recipient"]));
  declaration.communications.push({ recipient, channel: channelFromArguments(effect.arguments), information });
  declaration.externalMutations.push({ system: "communications", resource: communication });
  declaration.informationFlows.push({
    flowId: `flow.${effect.semanticId}.message`,
    source: targets[0] ?? communication,
    information,
    destination: { kind: "COMMUNICATION_RECIPIENT", recipient, capability: effect.requiredCapability },
    transformation: { kind: "IDENTITY" },
  });
  return {
    nodeId: effect.semanticId,
    support: "SUPPORTED",
    declaration,
    reasonCodes: ["audited_external_communication_catalog", "message_content_unclassified_fail_closed"],
  };
}

function inferFinancial(effect: Effect, program: OperationalProgram, row: AuditedOperationSemantics): EffectInferenceResult {
  const targets = resolvedEffectTargets(effect, program);
  const declaration = baseEffectDeclaration(effect, row, targets);
  const amount = amountFromArguments(effect.arguments);
  if (!amount) {
    return { nodeId: effect.semanticId, support: "RUNTIME_ONLY", reasonCodes: ["financial_amount_not_statically_resolved"] };
  }
  const resource: EffectResource = effect.operation === "record_payment"
    ? { kind: "entity", type: "payment", selector: "NEW" }
    : { kind: "resource", type: "ad_campaign", selector: "NEW" };
  declaration.contract.writes.push(access(resource, "FINANCIAL", ["amount", "currency", "status"]));
  declaration.financial.push({ operation: effect.operation === "launch_ad_campaign" ? "SPEND" : "WRITE", resource, ...amount });
  declaration.externalMutations.push({ system: effect.operation === "launch_ad_campaign" ? "marketing" : "accounting", resource });
  declaration.authorityRequirements.push({
    requirementId: `authority.${effect.semanticId}.financial-resource`,
    kind: "REQUIRES_RESOURCE_SCOPE",
    resource,
  });
  declaration.informationFlows.push({
    flowId: `flow.${effect.semanticId}.financial`,
    source: resource,
    information: descriptor("FINANCIAL", ["amount", "currency", "status"], "AUDITED_CATALOG"),
    destination: {
      kind: "EXTERNAL_PROVIDER",
      system: effect.operation === "launch_ad_campaign" ? "marketing" : "accounting",
      capability: effect.requiredCapability,
    },
    transformation: { kind: "IDENTITY" },
  });
  if (effect.operation === "launch_ad_campaign") {
    declaration.authorityRequirements.push({
      requirementId: `authority.${effect.semanticId}.spend`,
      kind: "REQUIRES_SPEND_AUTHORITY",
      ...amount,
    });
  }
  return { nodeId: effect.semanticId, support: "SUPPORTED", declaration, reasonCodes: ["audited_financial_catalog"] };
}

function inferComputer(effect: Effect, program: OperationalProgram, row: AuditedOperationSemantics): EffectInferenceResult {
  const targets = resolvedEffectTargets(effect, program);
  const declaration = baseEffectDeclaration(effect, row, targets);
  const authorized = effect.arguments.authorizedEffect;
  const application = effect.arguments.application;
  if (!authorized || typeof authorized !== "object" || Array.isArray(authorized) || typeof application !== "string") {
    return { nodeId: effect.semanticId, support: "RUNTIME_ONLY", reasonCodes: ["computer_authorized_effect_not_statically_resolved"] };
  }
  const authorizedRow = authorized as Record<string, unknown>;
  const operation = authorizedRow.operation;
  const changes = authorizedRow.changes;
  const target = authorizedRow.target;
  if (typeof operation !== "string" || operation.length === 0 || !changes || typeof changes !== "object" || Array.isArray(changes) || !target || typeof target !== "object" || Array.isArray(target)) {
    return { nodeId: effect.semanticId, support: "RUNTIME_ONLY", reasonCodes: ["computer_authorized_effect_malformed"] };
  }
  const targetRow = target as Record<string, unknown>;
  const computerTarget: EffectResource = {
    kind: "resource",
    type: typeof targetRow.kind === "string" && targetRow.kind ? targetRow.kind : "computer_target",
    selector: "EXTERNAL",
    ...(typeof targetRow.identifier === "string" && targetRow.identifier ? { id: targetRow.identifier } : {}),
  };
  const jsonChanges = Object.fromEntries(Object.entries(changes as Record<string, unknown>).filter(([, value]) =>
    value === null || ["string", "number", "boolean"].includes(typeof value),
  )) as Record<string, string | number | boolean | null>;
  if (Object.keys(jsonChanges).length !== Object.keys(changes as Record<string, unknown>).length) {
    return { nodeId: effect.semanticId, support: "RUNTIME_ONLY", reasonCodes: ["computer_authorized_effect_changes_not_scalar"] };
  }
  declaration.contract.writes.push(access(computerTarget, "UNCLASSIFIED", Object.keys(jsonChanges).sort()));
  declaration.computerMutations.push({ application, operation, resource: computerTarget, changes: jsonChanges });
  declaration.externalMutations.push({ system: application, resource: computerTarget });
  declaration.informationFlows.push({
    flowId: `flow.${effect.semanticId}.computer`,
    source: targets[0] ?? computerTarget,
    information: descriptor("UNCLASSIFIED", Object.keys(jsonChanges).sort(), "AUDITED_CATALOG"),
    destination: { kind: "COMPUTER_APPLICATION", application, capability: effect.requiredCapability },
    transformation: { kind: "IDENTITY" },
  });
  return { nodeId: effect.semanticId, support: "SUPPORTED", declaration, reasonCodes: ["audited_computer_catalog", "computer_changes_unclassified_fail_closed"] };
}

function inferEffect(effect: Effect, program: OperationalProgram): EffectInferenceResult {
  const row = AUDITED_OPERATION_EFFECT_CATALOG[effect.operation];
  if (!row) return { nodeId: effect.semanticId, support: "UNSUPPORTED", reasonCodes: ["operation_not_in_audited_p2_catalog"] };
  if (effect.effectDeclaration) {
    return { nodeId: effect.semanticId, support: "SUPPORTED", declaration: effect.effectDeclaration, reasonCodes: ["ir_declared_effect_semantics"] };
  }
  if (effect.operation === "create_task") return inferCreateTask(effect, program, row);
  if (effect.operation === "send_message") return inferSendMessage(effect, program, row);
  if (effect.operation === "record_payment" || effect.operation === "launch_ad_campaign") return inferFinancial(effect, program, row);
  return inferComputer(effect, program, row);
}

function queryResources(query: Query, program: OperationalProgram, catalog: QueryCatalogRow): EffectResource[] {
  const entities = new Map(program.entities.map((entity) => [entity.semanticId, entity]));
  const declared = query.entityRefs.flatMap((entityRef) => {
    const entity = entities.get(entityRef);
    if (!entity || entity.resolution.status !== "resolved") return [];
    return [{
      kind: entity.resolution.canonical.kind,
      type: entity.resolution.canonical.type,
      selector: "EXISTING" as const,
      entityRef,
      id: entity.resolution.canonical.id,
    }];
  });
  const request = query.request as OperationalQueryRequest & Record<string, unknown>;
  const nestedId = request.params && typeof request.params === "object" && !Array.isArray(request.params)
    ? (request.params as Record<string, unknown>).householdId
    : undefined;
  const id = typeof request.householdId === "string" ? request.householdId
    : typeof nestedId === "string" ? nestedId : undefined;
  const inferred = catalog.resources.map((type, index): EffectResource => ({
    kind: "entity",
    type,
    selector: id && index === 0 ? "EXISTING" : "COHORT",
    ...(id && index === 0 ? { id } : {}),
  }));
  return uniqueResources([...declared, ...inferred]);
}

function inferQuery(query: Query, program: OperationalProgram): EffectInferenceResult {
  if (query.effectDeclaration) {
    return { nodeId: query.semanticId, support: "SUPPORTED", declaration: query.effectDeclaration, reasonCodes: ["ir_declared_query_semantics"] };
  }
  const catalog = AUDITED_QUERY_EFFECT_CATALOG[query.request.intent];
  if (!catalog) return { nodeId: query.semanticId, support: "UNSUPPORTED", reasonCodes: ["query_intent_not_in_audited_p2_catalog"] };
  const resources = queryResources(query, program, catalog);
  const capability = `query:${query.request.intent}`;
  const reads = resources.map((resource) => access(resource, catalog.classification));
  const observes = program.observations.flatMap((observation) => observation.evidence.kind === "canonical_query" && observation.evidence.queryRef === query.semanticId
    ? [observation.semanticId]
    : []);
  const informationFlows: InformationFlow[] = reads.map((read, index) => ({
    flowId: `flow.${query.semanticId}.read-${index + 1}`,
    source: read.resource,
    information: read.information,
    destination: { kind: "GOVERNED_CAPABILITY", capability },
    transformation: { kind: "IDENTITY" },
  }));
  const declaration: EffectDeclaration = {
    version: 1,
    source: "AUDITED_CATALOG",
    contract: {
      requires: resources.map(resourceExistsPredicate).filter((value): value is Predicate => Boolean(value)),
      ensures: [],
      reads,
      writes: [],
      modifies: [],
      throws: ["AUTHORITY_DENIED", "CANONICAL_QUERY_UNAVAILABLE"],
      observes,
    },
    communications: [],
    financial: [],
    externalMutations: [],
    computerMutations: [],
    informationFlows,
    authorityRequirements: [{ requirementId: `authority.${query.semanticId}.capability`, kind: "REQUIRES_CAPABILITY", capability }],
    reversibility: { classification: "READ_ONLY" },
  };
  return { nodeId: query.semanticId, support: "SUPPORTED", declaration, reasonCodes: ["audited_operational_query_catalog"] };
}

function inferWait(wait: Wait): EffectInferenceResult {
  const declaration: EffectDeclaration = {
    version: 1,
    source: "AUDITED_CATALOG",
    contract: {
      requires: [],
      ensures: [wait.condition],
      reads: [],
      writes: [],
      modifies: [],
      throws: ["WAIT_DEADLINE_EXCEEDED"],
      observes: [],
    },
    communications: [],
    financial: [],
    externalMutations: [],
    computerMutations: [],
    informationFlows: [],
    authorityRequirements: [],
    reversibility: { classification: "READ_ONLY" },
  };
  return { nodeId: wait.semanticId, support: "SUPPORTED", declaration, reasonCodes: ["structural_wait_observation"] };
}

export function inferExecutableNodeEffects(
  node: Query | Effect | Wait,
  program: OperationalProgram,
): EffectInferenceResult {
  if (node.kind === "query") return inferQuery(node, program);
  if (node.kind === "effect") return inferEffect(node, program);
  return inferWait(node);
}
