// scan_data_quality job: the blueprint's Phase 1 data-quality mechanism (duplicate
// detection, entity resolution, missing critical data, stale data) — the one thing the
// codebase had zero precedent for before docs/jarvis-90-execution-blueprint.md §1.
// Writes to data_quality_findings, NOT scan_findings — scan_findings is a one-way
// "digest once via the owner call" contract; these findings need an open/resolved
// lifecycle and must not be re-created every time the scan re-runs (see upsertFinding).

import {
  withTenant,
  households,
  leads,
  opportunities,
  workOrders,
  businessEvents,
  dataQualityFindings,
  domainPolicies,
  type Db,
} from "@finnor/db";
import { and, eq, isNull, or, desc } from "drizzle-orm";
import type { JobHandler } from "../queue";

const DEFAULT_STALE_DAYS = 14;
const DATA_QUALITY_ACTION_TYPE = "data_quality_scan";

type FindingType = "duplicate_candidate" | "missing_critical_field" | "stale_data" | "ambiguous_match";

/** Idempotent per (tenant, findingType, entity, relatedEntity): re-running the scan
 *  never piles up duplicate findings for the same underlying issue. */
async function upsertFinding(
  db: Db,
  params: {
    tenantId: string;
    findingType: FindingType;
    entityType: string;
    entityId: string;
    relatedEntityId?: string;
    details: Record<string, unknown>;
    severity?: "low" | "medium" | "high";
  },
): Promise<void> {
  const conditions = [
    eq(dataQualityFindings.tenantId, params.tenantId),
    eq(dataQualityFindings.findingType, params.findingType),
    eq(dataQualityFindings.entityType, params.entityType),
    eq(dataQualityFindings.entityId, params.entityId),
    isNull(dataQualityFindings.resolvedAt),
    params.relatedEntityId
      ? eq(dataQualityFindings.relatedEntityId, params.relatedEntityId)
      : isNull(dataQualityFindings.relatedEntityId),
  ];
  const [existing] = await db.select().from(dataQualityFindings).where(and(...conditions));
  if (existing) return;
  await db.insert(dataQualityFindings).values({
    tenantId: params.tenantId,
    findingType: params.findingType,
    entityType: params.entityType,
    entityId: params.entityId,
    relatedEntityId: params.relatedEntityId ?? null,
    details: params.details,
    severity: params.severity ?? "medium",
  });
}

function normalizedPhone(contactInfo: unknown): string | null {
  const phone = (contactInfo as Record<string, unknown> | null)?.phone;
  return typeof phone === "string" && phone.length > 0 ? phone.replace(/\D/g, "") : null;
}

export const scanDataQuality: JobHandler = async (payload) => {
  const tenantId = String(payload.tenantId ?? "");
  if (!tenantId) throw new Error("scan_data_quality requires tenantId");

  await withTenant(tenantId, async (db) => {
    // --- Duplicate candidates: households sharing the same normalized phone number. ---
    const hhRows = await db
      .select({ id: households.id, contactInfo: households.contactInfo })
      .from(households)
      .where(eq(households.tenantId, tenantId));
    const byPhone = new Map<string, string[]>();
    for (const h of hhRows) {
      const phone = normalizedPhone(h.contactInfo);
      if (!phone) continue;
      byPhone.set(phone, [...(byPhone.get(phone) ?? []), h.id]);
    }
    for (const [phone, ids] of byPhone) {
      if (ids.length < 2) continue;
      const [first, ...rest] = ids;
      for (const dupeId of rest) {
        await upsertFinding(db, {
          tenantId,
          findingType: "duplicate_candidate",
          entityType: "household",
          entityId: first!,
          relatedEntityId: dupeId,
          details: { reason: "same phone number", phone },
          severity: "high",
        });
      }
    }

    // --- Missing critical fields: leads with neither phone nor email on file. ---
    const openLeads = await db
      .select()
      .from(leads)
      .where(and(eq(leads.tenantId, tenantId), or(eq(leads.status, "new"), eq(leads.status, "contacted"), eq(leads.status, "qualified"))));
    for (const lead of openLeads) {
      if (!lead.phone && !lead.email) {
        await upsertFinding(db, {
          tenantId,
          findingType: "missing_critical_field",
          entityType: "lead",
          entityId: lead.id,
          details: { field: "contact_method", note: "lead has neither phone nor email on file" },
          severity: "high",
        });
      }
    }

    // --- Missing critical fields: work orders with no technician assigned once scheduled. ---
    const unassigned = await db
      .select()
      .from(workOrders)
      .where(and(eq(workOrders.tenantId, tenantId), eq(workOrders.status, "scheduled"), isNull(workOrders.technicianId)));
    for (const wo of unassigned) {
      await upsertFinding(db, {
        tenantId,
        findingType: "missing_critical_field",
        entityType: "work_order",
        entityId: wo.id,
        details: { field: "technician_id", note: "scheduled work order has no technician assigned" },
        severity: "medium",
      });
    }

    // --- Stale data: open leads/opportunities with no recent business_events activity. ---
    const [policyRow] = await db
      .select()
      .from(domainPolicies)
      .where(and(eq(domainPolicies.tenantId, tenantId), eq(domainPolicies.actionType, DATA_QUALITY_ACTION_TYPE)));
    const staleDays = Number((policyRow?.policy as Record<string, unknown> | undefined)?.staleDataThresholdDays ?? DEFAULT_STALE_DAYS);
    const staleCutoff = new Date(Date.now() - staleDays * 24 * 3600 * 1000);

    for (const lead of openLeads) {
      const [latest] = await db
        .select({ occurredAt: businessEvents.occurredAt })
        .from(businessEvents)
        .where(and(eq(businessEvents.tenantId, tenantId), eq(businessEvents.entityType, "lead"), eq(businessEvents.entityId, lead.id)))
        .orderBy(desc(businessEvents.occurredAt))
        .limit(1);
      const lastActivity = latest?.occurredAt ?? lead.createdAt;
      if (lastActivity < staleCutoff) {
        await upsertFinding(db, {
          tenantId,
          findingType: "stale_data",
          entityType: "lead",
          entityId: lead.id,
          details: { lastActivityAt: lastActivity.toISOString(), staleDays },
          severity: "low",
        });
      }
    }

    const openOpportunities = await db
      .select()
      .from(opportunities)
      .where(and(eq(opportunities.tenantId, tenantId), eq(opportunities.pipelineStage, "open")));
    for (const opp of openOpportunities) {
      const [latest] = await db
        .select({ occurredAt: businessEvents.occurredAt })
        .from(businessEvents)
        .where(and(eq(businessEvents.tenantId, tenantId), eq(businessEvents.entityType, "opportunity"), eq(businessEvents.entityId, opp.id)))
        .orderBy(desc(businessEvents.occurredAt))
        .limit(1);
      const lastActivity = latest?.occurredAt ?? opp.createdAt;
      if (lastActivity < staleCutoff) {
        await upsertFinding(db, {
          tenantId,
          findingType: "stale_data",
          entityType: "opportunity",
          entityId: opp.id,
          details: { lastActivityAt: lastActivity.toISOString(), staleDays },
          severity: "low",
        });
      }
    }
  });
};
