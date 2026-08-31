import { CANONICAL_ENTITY_TYPES, PARTY_TYPES } from "@finnor/shared-types";
import type { OperationalProgram } from "./contracts";
import type { EffectDimension, ProgramEffectSummary } from "./effects";

export type ResolutionDecision = "RESOLVED" | "REJECTED" | "UNRESOLVED";

export type ResolutionReasonCode =
  | "ENTITY_RESOLVED_IN_TRUSTED_TENANT"
  | "ENTITY_REFERENCE_UNRESOLVED"
  | "ENTITY_REFERENCE_AMBIGUOUS"
  | "ENTITY_TYPE_UNKNOWN"
  | "ENTITY_NOT_FOUND"
  | "ENTITY_STALE"
  | "ENTITY_TYPE_MISMATCH"
  | "CROSS_TENANT_REFERENCE"
  | "CAPABILITY_RESOLVED"
  | "CAPABILITY_NOT_FOUND"
  | "CAPABILITY_EFFECT_CLASS_MISMATCH"
  | "CAPABILITY_RESOLUTION_UNAVAILABLE"
  | "REQUIRED_BINDING_NOT_CONFIGURED"
  | "BINDING_CONFIGURATION_UNRESOLVED";

export interface StaticEntityResolutionRequest {
  trustedTenantId: string;
  refSemanticId: string;
  kind: "entity" | "party" | "resource";
  type: string;
  id: string;
}

export type StaticEntityResolutionResponse =
  | { status: "EXISTS"; tenantId: string; type: string }
  | { status: "MISSING" }
  | { status: "CROSS_TENANT"; tenantId: string }
  | { status: "TYPE_MISMATCH"; actualType: string }
  | { status: "STALE" }
  | { status: "UNRESOLVED" };

export interface StaticCapabilityResolutionRequest {
  trustedTenantId: string;
  capability: string;
  operation?: string;
  requiredDimensions: EffectDimension[];
  requiresConfiguredBinding: boolean;
  /** Business-level binding hints only; never browser/session/provider credentials. */
  externalSystems: string[];
  computerApplications: string[];
}

export type StaticCapabilityResolutionResponse =
  | { status: "EXISTS"; supportedDimensions: EffectDimension[]; configured: boolean | "NOT_REQUIRED" }
  | { status: "MISSING" }
  | { status: "INCOMPATIBLE"; supportedDimensions: EffectDimension[] }
  | { status: "UNRESOLVED" };

export interface StaticResolutionProvider {
  resolveEntity(request: StaticEntityResolutionRequest): Promise<StaticEntityResolutionResponse>;
  resolveCapability(request: StaticCapabilityResolutionRequest): Promise<StaticCapabilityResolutionResponse>;
}

export interface StaticResolutionContext {
  /** Trusted runtime identity. It is never read from model-authored IR. */
  tenantId: string;
  provider: StaticResolutionProvider;
}

export interface StaticResolutionIssue {
  decision: ResolutionDecision;
  reasonCode: ResolutionReasonCode;
  nodeId: string;
  message: string;
}

export interface StaticResolutionReport {
  decision: ResolutionDecision;
  issues: StaticResolutionIssue[];
}

function aggregateDecision(issues: StaticResolutionIssue[]): ResolutionDecision {
  if (issues.some((issue) => issue.decision === "REJECTED")) return "REJECTED";
  if (issues.some((issue) => issue.decision === "UNRESOLVED")) return "UNRESOLVED";
  return "RESOLVED";
}

function knownType(kind: "entity" | "party" | "resource", type: string): boolean {
  if (kind === "entity") return (CANONICAL_ENTITY_TYPES as readonly string[]).includes(type);
  if (kind === "party") return (PARTY_TYPES as readonly string[]).includes(type);
  // Runtime resource targets (communication endpoint, ad campaign, computer target)
  // are not canonical entity ids and are resolved by their governing capability.
  return true;
}

function issue(
  decision: ResolutionDecision,
  reasonCode: ResolutionReasonCode,
  nodeId: string,
  message: string,
): StaticResolutionIssue {
  return { decision, reasonCode, nodeId, message };
}

export async function resolveStaticProgramEnvironment(
  program: OperationalProgram,
  summary: ProgramEffectSummary,
  context?: StaticResolutionContext,
): Promise<StaticResolutionReport> {
  const issues: StaticResolutionIssue[] = [];
  const resolvedEntities = [...program.entities].sort((left, right) => left.semanticId.localeCompare(right.semanticId));
  for (const entity of resolvedEntities) {
    if (entity.resolution.status === "unresolved") {
      issues.push(issue("UNRESOLVED", "ENTITY_REFERENCE_UNRESOLVED", entity.semanticId, "Canonical entity resolution is incomplete."));
      continue;
    }
    if (entity.resolution.status === "ambiguous") {
      issues.push(issue("UNRESOLVED", "ENTITY_REFERENCE_AMBIGUOUS", entity.semanticId, "Canonical entity resolution is ambiguous."));
      continue;
    }
    const canonical = entity.resolution.canonical;
    if (!knownType(canonical.kind, canonical.type)) {
      issues.push(issue("REJECTED", "ENTITY_TYPE_UNKNOWN", entity.semanticId, `Unknown canonical ${canonical.kind} type ${canonical.type}.`));
      continue;
    }
    if (!context) {
      issues.push(issue("UNRESOLVED", "ENTITY_REFERENCE_UNRESOLVED", entity.semanticId, "Trusted tenant-scoped database resolution was not supplied."));
      continue;
    }
    const resolution = await context.provider.resolveEntity({
      trustedTenantId: context.tenantId,
      refSemanticId: entity.semanticId,
      kind: canonical.kind,
      type: canonical.type,
      id: canonical.id,
    });
    if (resolution.status === "EXISTS") {
      if (resolution.tenantId !== context.tenantId) {
        issues.push(issue("REJECTED", "CROSS_TENANT_REFERENCE", entity.semanticId, "Resolved entity belongs to a different tenant."));
      } else if (resolution.type !== canonical.type) {
        issues.push(issue("REJECTED", "ENTITY_TYPE_MISMATCH", entity.semanticId, `Resolved entity type ${resolution.type} does not match ${canonical.type}.`));
      } else {
        issues.push(issue("RESOLVED", "ENTITY_RESOLVED_IN_TRUSTED_TENANT", entity.semanticId, "Entity exists in the trusted runtime tenant."));
      }
    } else if (resolution.status === "CROSS_TENANT") {
      issues.push(issue("REJECTED", "CROSS_TENANT_REFERENCE", entity.semanticId, "Resolved entity belongs to a different tenant."));
    } else if (resolution.status === "TYPE_MISMATCH") {
      issues.push(issue("REJECTED", "ENTITY_TYPE_MISMATCH", entity.semanticId, `Resolved entity type ${resolution.actualType} does not match ${canonical.type}.`));
    } else if (resolution.status === "MISSING") {
      issues.push(issue("REJECTED", "ENTITY_NOT_FOUND", entity.semanticId, "Required canonical entity does not exist."));
    } else if (resolution.status === "STALE") {
      issues.push(issue("REJECTED", "ENTITY_STALE", entity.semanticId, "Required canonical entity evidence is stale."));
    } else {
      issues.push(issue("UNRESOLVED", "ENTITY_REFERENCE_UNRESOLVED", entity.semanticId, "Canonical entity resolution could not be established."));
    }
  }

  const capabilityRequirements = summary.authorityRequirements
    .filter((requirement): requirement is Extract<typeof requirement, { kind: "REQUIRES_CAPABILITY" }> => requirement.kind === "REQUIRES_CAPABILITY")
    .sort((left, right) => left.capability.localeCompare(right.capability));
  for (const requirement of capabilityRequirements) {
    const authorityEffect = summary.possible.find((entry) =>
      entry.effect.dimension === "AUTHORITY"
      && entry.effect.requirement.requirementId === requirement.requirementId,
    );
    const nodeId = authorityEffect?.effect.nodeId ?? requirement.requirementId;
    const nodeEffects = summary.possible.filter((entry) => entry.effect.nodeId === nodeId);
    const requiredDimensions = [...new Set(nodeEffects.map((entry) => entry.effect.dimension))].sort() as EffectDimension[];
    const requiresConfiguredBinding = nodeEffects.some((entry) => entry.effect.dimension === "EXTERNAL" || entry.effect.dimension === "COMPUTER");
    if (!context) {
      issues.push(issue("UNRESOLVED", "CAPABILITY_RESOLUTION_UNAVAILABLE", nodeId, `Capability ${requirement.capability} requires trusted runtime resolution.`));
      continue;
    }
    const resolution = await context.provider.resolveCapability({
      trustedTenantId: context.tenantId,
      capability: requirement.capability,
      operation: requirement.capability.startsWith("action:") ? requirement.capability.slice("action:".length) : undefined,
      requiredDimensions,
      requiresConfiguredBinding,
      externalSystems: [...new Set(nodeEffects.flatMap((entry) => entry.effect.dimension === "EXTERNAL" ? [entry.effect.mutation.system] : []))].sort(),
      computerApplications: [...new Set(nodeEffects.flatMap((entry) => entry.effect.dimension === "COMPUTER" ? [entry.effect.mutation.application] : []))].sort(),
    });
    if (resolution.status === "MISSING") {
      issues.push(issue("REJECTED", "CAPABILITY_NOT_FOUND", nodeId, `Required capability ${requirement.capability} does not exist.`));
    } else if (resolution.status === "INCOMPATIBLE") {
      issues.push(issue("REJECTED", "CAPABILITY_EFFECT_CLASS_MISMATCH", nodeId, `Capability ${requirement.capability} cannot represent the requested effect dimensions.`));
    } else if (resolution.status === "UNRESOLVED") {
      issues.push(issue("UNRESOLVED", "CAPABILITY_RESOLUTION_UNAVAILABLE", nodeId, `Capability ${requirement.capability} could not be resolved.`));
    } else if (requiresConfiguredBinding && resolution.configured === false) {
      issues.push(issue("REJECTED", "REQUIRED_BINDING_NOT_CONFIGURED", nodeId, `Required binding for ${requirement.capability} is not configured.`));
    } else if (requiresConfiguredBinding && resolution.configured === "NOT_REQUIRED") {
      issues.push(issue("UNRESOLVED", "BINDING_CONFIGURATION_UNRESOLVED", nodeId, `Binding configuration for ${requirement.capability} was not established.`));
    } else {
      issues.push(issue("RESOLVED", "CAPABILITY_RESOLVED", nodeId, `Capability ${requirement.capability} exists and matches the requested effect class.`));
    }
  }
  issues.sort((left, right) => `${left.nodeId}\u0000${left.reasonCode}`.localeCompare(`${right.nodeId}\u0000${right.reasonCode}`));
  return { decision: aggregateDecision(issues), issues };
}
