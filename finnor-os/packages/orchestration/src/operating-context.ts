import {
  CANONICAL_ENTITY_TYPES,
  OPERATING_TRUTH_PRECEDENCE,
  type CanonicalEntityRef,
  type MemorySnapshot,
  type OperatingContext,
  type OperatingSourceRef,
  type TenantContext,
} from "@finnor/shared-types";
import {
  tenantOperatingProfiles,
  tenants,
  userOperatingProfiles,
  users,
  withTenant,
  workEntityLinks,
  works,
} from "@finnor/db";
import { and, eq } from "drizzle-orm";
import { buildMemorySnapshot } from "@finnor/memory";
import { executeOperationalQuery, resolveHouseholdMention } from "@finnor/read-models";
import { buildPlanningHealthContext } from "./planning-health";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const ENTITY_TYPES = new Set<string>(CANONICAL_ENTITY_TYPES);

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? [...new Set(value.filter((item): item is string => typeof item === "string").map((item) => item.trim()).filter(Boolean))].slice(0, 20)
    : [];
}

function iso(value: Date | string | null | undefined): string | null {
  if (!value) return null;
  const parsed = value instanceof Date ? value : new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
}

function emptyMemory(): MemorySnapshot {
  return { shortTerm: null, longTerm: null, semantic: [], episodic: [], patterns: null };
}

function profileSource(source: string, ref: string, asOf: string | null): OperatingSourceRef {
  return { kind: "PROFILE", source, ref, asOf: asOf ?? new Date().toISOString(), role: "context_only" };
}

export interface AssembleOperatingContextOptions {
  instruction: string;
  workId?: string;
  sessionId?: string;
  householdId?: string;
  activeContext?: Record<string, unknown>;
  /** Semantic memory is deliberately omitted for deterministic live-state reads. */
  includeMemory?: boolean;
  includeSemanticMemory?: boolean;
  /** A bounded current-state summary for the general planner, never for fast reads. */
  includeCanonicalBusinessState?: boolean;
}

export interface AssembledOperatingContext {
  context: OperatingContext;
  memory: MemorySnapshot;
  resolvedHouseholdId?: string;
  mentionedHousehold: { householdId: string; label: string } | null;
}

/**
 * Assemble the authenticated operating frame before planning. Every dependency is
 * fail-visible and bounded: a missing profile remains null, a failed source is listed
 * in context.health, and no lower-precedence source is promoted to canonical truth.
 */
export async function assembleOperatingContext(
  ctx: TenantContext,
  opts: AssembleOperatingContextOptions,
): Promise<AssembledOperatingContext> {
  const assembledAt = new Date().toISOString();
  const errors: string[] = [];
  const missing: string[] = [];
  const sources: OperatingSourceRef[] = [];
  let tenantRow: { id: string; name: string; timezone: string } | undefined;
  let tenantProfile: typeof tenantOperatingProfiles.$inferSelect | undefined;
  let userRow: { id: string; displayName: string | null; role: string } | undefined;
  let userProfile: typeof userOperatingProfiles.$inferSelect | undefined;
  let workRow: typeof works.$inferSelect | undefined;
  let linkedEntities: Array<{ entityType: string; entityId: string }> = [];

  try {
    const loaded = await withTenant(ctx.tenantId, async (db) => {
      const [tenantResult] = await db
        .select({ id: tenants.id, name: tenants.name, timezone: tenants.timezone })
        .from(tenants)
        .where(eq(tenants.id, ctx.tenantId))
        .limit(1);
      const [companyProfile] = await db
        .select()
        .from(tenantOperatingProfiles)
        .where(eq(tenantOperatingProfiles.tenantId, ctx.tenantId))
        .limit(1);
      const [employee] = UUID.test(ctx.userId)
        ? await db
            .select({ id: users.id, displayName: users.displayName, role: users.role })
            .from(users)
            .where(and(eq(users.tenantId, ctx.tenantId), eq(users.id, ctx.userId)))
            .limit(1)
        : [];
      const [employeeProfile] = UUID.test(ctx.userId)
        ? await db
            .select()
            .from(userOperatingProfiles)
            .where(and(eq(userOperatingProfiles.tenantId, ctx.tenantId), eq(userOperatingProfiles.userId, ctx.userId)))
            .limit(1)
        : [];
      const [activeWork] = opts.workId
        ? await db
            .select()
            .from(works)
            .where(and(eq(works.tenantId, ctx.tenantId), eq(works.id, opts.workId)))
            .limit(1)
        : [];
      const entities = opts.workId
        ? await db
            .select({ entityType: workEntityLinks.entityType, entityId: workEntityLinks.entityId })
            .from(workEntityLinks)
            .where(and(eq(workEntityLinks.tenantId, ctx.tenantId), eq(workEntityLinks.workId, opts.workId)))
        : [];
      return { tenantResult, companyProfile, employee, employeeProfile, activeWork, entities };
    }, UUID.test(ctx.userId) ? ctx.userId : undefined);
    tenantRow = loaded.tenantResult;
    tenantProfile = loaded.companyProfile;
    userRow = loaded.employee;
    userProfile = loaded.employeeProfile;
    workRow = loaded.activeWork;
    linkedEntities = loaded.entities;
  } catch (error) {
    errors.push(`profile/work context unavailable: ${error instanceof Error ? error.message : String(error)}`);
  }

  if (!tenantRow) missing.push("tenant.identity");
  if (!tenantProfile?.industry && !tenantProfile?.niche) missing.push("tenant.profile.industry_or_niche");
  if (stringArray(tenantProfile?.primaryGeographies).length === 0) missing.push("tenant.profile.primaryGeographies");
  if (!userRow) missing.push("employee.identity");
  if (!tenantProfile) missing.push("tenant.profile");
  if (!userProfile) missing.push("employee.profile");
  if (tenantRow) sources.push(profileSource("tenant", tenantRow.id, assembledAt));
  if (tenantProfile) sources.push(profileSource("tenant_operating_profile", tenantProfile.tenantId, iso(tenantProfile.updatedAt)));
  if (userRow) sources.push(profileSource("authenticated_employee", userRow.id, assembledAt));
  if (userProfile) sources.push(profileSource("user_operating_profile", userProfile.userId, iso(userProfile.updatedAt)));
  if (workRow) sources.push({ kind: "WORK", source: "works", ref: workRow.id, asOf: iso(workRow.updatedAt) ?? assembledAt, role: "context_only" });

  let mentionedHousehold: { householdId: string; label: string } | null = null;
  let resolvedHouseholdId = opts.householdId;
  if (opts.includeMemory && !resolvedHouseholdId) {
    try {
      const resolved = await resolveHouseholdMention(ctx.tenantId, opts.instruction);
      if (resolved) {
        mentionedHousehold = { householdId: resolved.householdId, label: resolved.label };
        resolvedHouseholdId = resolved.householdId;
      }
    } catch (error) {
      errors.push(`household reference unavailable: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  let memory = emptyMemory();
  if (opts.includeMemory) {
    try {
      memory = await buildMemorySnapshot({
        tenantId: ctx.tenantId,
        sessionId: opts.sessionId,
        householdId: resolvedHouseholdId,
        semanticQuery: opts.includeSemanticMemory === false ? undefined : opts.instruction,
        semanticLimit: 5,
      });
      if (memory.shortTerm) sources.push({ kind: "SESSION", source: "session_memory", ref: opts.sessionId, asOf: assembledAt, role: "context_only" });
      if (memory.semantic.length > 0) sources.push({ kind: "MEMORY", source: "semantic_memory", asOf: assembledAt, role: "context_only" });
      if (memory.episodic.length > 0) sources.push({ kind: "WORK", source: "execution_history", asOf: assembledAt, role: "context_only" });
    } catch (error) {
      errors.push(`memory unavailable: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  let integrationHealth: OperatingContext["integrationHealth"] = {};
  try {
    integrationHealth = await buildPlanningHealthContext(ctx.tenantId);
  } catch (error) {
    errors.push(`integration health unavailable: ${error instanceof Error ? error.message : String(error)}`);
  }

  const canonicalSummaries: OperatingContext["canonicalSummaries"] = [];
  if (opts.includeCanonicalBusinessState) {
    try {
      const current = await executeOperationalQuery(ctx.tenantId, { intent: "business_state" });
      canonicalSummaries.push({
        name: "business_state",
        asOf: current.asOf,
        source: current.source.kind,
        data: { status: current.status, count: current.count, data: record(current.data) },
      });
      sources.push({ kind: "CANONICAL", source: "operational_query:business_state", asOf: current.asOf, role: "context_only" });
    } catch (error) {
      errors.push(`canonical business state unavailable: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  const refs = new Map<string, CanonicalEntityRef>();
  for (const item of linkedEntities) {
    if (ENTITY_TYPES.has(item.entityType) && UUID.test(item.entityId)) {
      const ref = { entityType: item.entityType as CanonicalEntityRef["entityType"], entityId: item.entityId };
      refs.set(`${ref.entityType}:${ref.entityId}`, ref);
    }
  }
  if (resolvedHouseholdId && UUID.test(resolvedHouseholdId)) refs.set(`household:${resolvedHouseholdId}`, { entityType: "household", entityId: resolvedHouseholdId });
  const active = record(opts.activeContext ?? workRow?.activeContext);
  if (Array.isArray(active.entityRefs)) {
    for (const candidate of active.entityRefs) {
      const value = record(candidate);
      if (typeof value.entityType === "string" && ENTITY_TYPES.has(value.entityType) && typeof value.entityId === "string" && UUID.test(value.entityId)) {
        const ref = { entityType: value.entityType as CanonicalEntityRef["entityType"], entityId: value.entityId };
        refs.set(`${ref.entityType}:${ref.entityId}`, ref);
      }
    }
  }

  const comparisonDefaults = record(tenantProfile?.comparisonDefaults);
  const context: OperatingContext = {
    version: 1,
    assembledAt,
    truthPrecedence: OPERATING_TRUTH_PRECEDENCE,
    tenant: {
      id: ctx.tenantId,
      companyName: tenantRow?.name ?? null,
      timezone: tenantRow?.timezone ?? null,
      profile: {
        industry: tenantProfile?.industry ?? null,
        niche: tenantProfile?.niche ?? null,
        description: tenantProfile?.description ?? null,
        primaryGeographies: stringArray(tenantProfile?.primaryGeographies),
        foundedYear: tenantProfile?.foundedYear ?? null,
        idealCustomerProfile: record(tenantProfile?.idealCustomerProfile),
        businessFacts: record(tenantProfile?.businessFacts),
        comparisonDefaults: {
          ...(typeof comparisonDefaults.scaleMetric === "string" ? { scaleMetric: comparisonDefaults.scaleMetric } : {}),
          ...(typeof comparisonDefaults.performanceMetric === "string" ? { performanceMetric: comparisonDefaults.performanceMetric } : {}),
        },
        updatedAt: iso(tenantProfile?.updatedAt),
      },
    },
    employee: {
      userId: ctx.userId,
      employeeId: ctx.employeeId ?? userRow?.id ?? null,
      displayName: userRow?.displayName ?? null,
      role: userRow?.role ?? ctx.role,
      authorityRoles: ctx.authorityRoles ?? [ctx.role],
      profile: {
        title: userProfile?.title ?? null,
        profileFacts: record(userProfile?.profileFacts),
        updatedAt: iso(userProfile?.updatedAt),
      },
    },
    activeWork: workRow ? {
      id: workRow.id,
      status: workRow.status,
      sessionId: workRow.sessionId,
      initialInstruction: workRow.initialInstruction,
      activeContext: record(workRow.activeContext),
      updatedAt: iso(workRow.updatedAt),
    } : null,
    referencedEntities: [...refs.values()],
    canonicalSummaries,
    memory: {
      conversation: memory.shortTerm,
      semantic: memory.semantic.map((hit) => ({
        ...(hit.id ? { id: hit.id } : {}),
        sourceDocId: hit.sourceDocId,
        chunk: hit.chunk,
        similarity: hit.similarity,
        ...(hit.relevanceScore === undefined ? {} : { relevanceScore: hit.relevanceScore }),
        ...(hit.sourceKind ? { sourceKind: hit.sourceKind } : {}),
        ...(hit.occurredAt ? { occurredAt: hit.occurredAt } : {}),
        ...(hit.entityRefs ? { entityRefs: hit.entityRefs } : {}),
        ...(hit.provenance ? { provenance: hit.provenance } : {}),
      })),
      episodic: memory.episodic.slice(0, 10),
    },
    integrationHealth,
    authority: {
      principal: ctx.userId,
      employeeId: ctx.employeeId ?? userRow?.id ?? null,
      revision: ctx.authorityRevision ?? null,
      roles: ctx.authorityRoles ?? [ctx.role],
    },
    sources,
    health: {
      status: errors.length === 0 && missing.length === 0 ? "complete" : tenantRow ? "partial" : "unavailable",
      missing: [...new Set(missing)],
      errors: errors.map((error) => error.slice(0, 500)),
    },
  };
  return { context, memory, ...(resolvedHouseholdId ? { resolvedHouseholdId } : {}), mentionedHousehold };
}
