import type { CanonicalEntityRef } from "./company-graph";

/**
 * Evidence classes are deliberately ordered.  Callers may enrich a higher class
 * with a lower one, but a lower class can never replace or contradict a higher
 * class when answering a current operating-state question.
 */
export const OPERATING_TRUTH_PRECEDENCE = [
  "CANONICAL",
  "WORK",
  "PROFILE",
  "SESSION",
  "MEMORY",
  "WEB",
] as const;

export type OperatingEvidenceKind = (typeof OPERATING_TRUTH_PRECEDENCE)[number];

export interface OperatingSourceRef {
  kind: OperatingEvidenceKind;
  source: string;
  ref?: string;
  asOf: string;
  /** Context may inform a later query without being valid answer evidence. */
  role: "answer_evidence" | "context_only";
}

export interface TenantOperatingProfile {
  industry: string | null;
  niche: string | null;
  description: string | null;
  primaryGeographies: string[];
  foundedYear: number | null;
  idealCustomerProfile: Record<string, unknown>;
  businessFacts: Record<string, unknown>;
  comparisonDefaults: {
    scaleMetric?: string;
    performanceMetric?: string;
  };
  updatedAt: string | null;
}

export interface UserOperatingProfile {
  title: string | null;
  profileFacts: Record<string, unknown>;
  updatedAt: string | null;
}

export interface OperatingIntegrationHealth {
  capability: string;
  binding: string;
  source: "tenant" | "env" | "default";
  health: "ok" | "degraded" | "down" | "unknown";
  circuit: "closed" | "open";
  unavailable: boolean;
  reason: string | null;
}

export interface OperatingContextMemoryHit {
  id?: string;
  sourceDocId: string | null;
  chunk: string;
  similarity: number;
  relevanceScore?: number;
  sourceKind?: string;
  occurredAt?: string;
  entityRefs?: unknown[];
  provenance?: Record<string, unknown>;
}

export interface OperatingContext {
  version: 1;
  assembledAt: string;
  truthPrecedence: readonly OperatingEvidenceKind[];
  tenant: {
    id: string;
    companyName: string | null;
    timezone: string | null;
    profile: TenantOperatingProfile;
  };
  employee: {
    userId: string;
    employeeId: string | null;
    displayName: string | null;
    role: string;
    authorityRoles: string[];
    profile: UserOperatingProfile;
  };
  activeWork: {
    id: string;
    status: string | null;
    sessionId: string | null;
    initialInstruction: string | null;
    activeContext: Record<string, unknown>;
    updatedAt: string | null;
  } | null;
  referencedEntities: CanonicalEntityRef[];
  canonicalSummaries: Array<{
    name: string;
    asOf: string;
    source: string;
    data: Record<string, unknown>;
  }>;
  memory: {
    conversation: Record<string, unknown> | null;
    semantic: OperatingContextMemoryHit[];
    episodic: Array<Record<string, unknown>>;
  };
  integrationHealth: Record<string, OperatingIntegrationHealth>;
  authority: {
    principal: string;
    employeeId: string | null;
    revision: number | null;
    roles: string[];
  };
  sources: OperatingSourceRef[];
  health: {
    status: "complete" | "partial" | "unavailable";
    missing: string[];
    errors: string[];
  };
}

export function operatingEvidenceRank(kind: OperatingEvidenceKind): number {
  return OPERATING_TRUTH_PRECEDENCE.indexOf(kind);
}
