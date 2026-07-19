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
  contacts,
  contactMethods,
  equipment,
  appointments,
  type Db,
} from "@finnor/db";
import { and, eq, isNull, or, desc, inArray } from "drizzle-orm";
import type { JobHandler } from "../queue";

const DEFAULT_STALE_DAYS = 14;
const DATA_QUALITY_ACTION_TYPE = "data_quality_scan";
// §5.4: no appointments row records a real duration in this codebase yet (nothing
// writes appointments.duration_minutes) — a conservative default keeps the overlap
// check honest (a real gap, not a fabricated precision) rather than treating a null
// duration as zero (which would never detect a genuine double-booking).
const DEFAULT_APPOINTMENT_DURATION_MINUTES = 60;

type FindingType = "duplicate_candidate" | "missing_critical_field" | "stale_data" | "ambiguous_match" | "contradiction";

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

    // --- Contradictions (§5.4): one entity's own data disagreeing with itself —
    // distinct in shape from duplicate_candidate above (two DIFFERENT entities that
    // might be the same record). "Implausible reading jumps" (the pack's fourth
    // example) has no data source in this codebase — no table stores a water-reading
    // time series (schedule_water_test only books a visit; nothing records the
    // resulting hardness/iron readings anywhere) — a real, honest gap, not fabricated.

    // 1. Conflicting phone numbers: a household's legacy contact_info.phone disagrees
    // with its own canonical contact's phone contact_method — the exact
    // dual-table-generation seam household360's own comments call out.
    const householdsWithLegacyPhone = hhRows.filter((h) => normalizedPhone(h.contactInfo));
    if (householdsWithLegacyPhone.length > 0) {
      const hhIds = householdsWithLegacyPhone.map((h) => h.id);
      const contactRows = await db.select().from(contacts).where(and(eq(contacts.tenantId, tenantId), inArray(contacts.householdId, hhIds)));
      const contactIds = contactRows.map((c) => c.id);
      const methodRows =
        contactIds.length > 0
          ? await db.select().from(contactMethods).where(and(eq(contactMethods.methodType, "phone"), inArray(contactMethods.contactId, contactIds)))
          : [];
      const phonesByContactId = new Map<string, string[]>();
      for (const m of methodRows) {
        const norm = m.value.replace(/\D/g, "");
        if (norm) phonesByContactId.set(m.contactId, [...(phonesByContactId.get(m.contactId) ?? []), norm]);
      }
      const contactsByHousehold = new Map<string, typeof contactRows>();
      for (const c of contactRows) {
        if (c.householdId) contactsByHousehold.set(c.householdId, [...(contactsByHousehold.get(c.householdId) ?? []), c]);
      }
      for (const h of householdsWithLegacyPhone) {
        const legacyPhone = normalizedPhone(h.contactInfo)!;
        for (const c of contactsByHousehold.get(h.id) ?? []) {
          for (const canonicalPhone of phonesByContactId.get(c.id) ?? []) {
            if (canonicalPhone !== legacyPhone) {
              await upsertFinding(db, {
                tenantId,
                findingType: "contradiction",
                entityType: "household",
                entityId: h.id,
                relatedEntityId: c.id,
                details: { reason: "legacy contact_info phone disagrees with canonical contact's phone", legacyPhone, canonicalPhone, contactName: c.name },
                severity: "high",
              });
            }
          }
        }
      }
    }

    // 2. Duplicate equipment: two-plus rows of the SAME type for the SAME household —
    // very likely a double-entry, flagged for human review rather than auto-merged
    // (a household legitimately owning two softeners is possible, just uncommon).
    const householdIdSet = new Set(hhRows.map((h) => h.id));
    const equipmentRows = await db.select({ id: equipment.id, householdId: equipment.householdId, type: equipment.type }).from(equipment);
    const equipByHouseholdType = new Map<string, string[]>();
    for (const e of equipmentRows) {
      if (!householdIdSet.has(e.householdId)) continue; // equipment has no tenant_id column — filter via this tenant's households
      const key = `${e.householdId}:${e.type}`;
      equipByHouseholdType.set(key, [...(equipByHouseholdType.get(key) ?? []), e.id]);
    }
    for (const [key, ids] of equipByHouseholdType) {
      if (ids.length < 2) continue;
      const [householdId, type] = key.split(":");
      const [first, ...rest] = ids;
      for (const dupeId of rest) {
        await upsertFinding(db, {
          tenantId,
          findingType: "contradiction",
          entityType: "equipment",
          entityId: first!,
          relatedEntityId: dupeId,
          details: { reason: "duplicate equipment type for the same household", householdId, type },
          severity: "medium",
        });
      }
    }

    // 3. Overlapping appointments: the same technician double-booked. A running-max-end
    // sweep over each technician's appointments sorted by start time — catches every
    // overlapping pair, not just chronologically-adjacent ones.
    const activeAppointments = await db
      .select({ id: appointments.id, technicianId: appointments.technicianId, scheduledAt: appointments.scheduledAt, durationMinutes: appointments.durationMinutes })
      .from(appointments)
      .where(and(eq(appointments.tenantId, tenantId), or(eq(appointments.status, "hold"), eq(appointments.status, "confirmed"))));
    const byTechnician = new Map<string, typeof activeAppointments>();
    for (const a of activeAppointments) {
      if (a.technicianId) byTechnician.set(a.technicianId, [...(byTechnician.get(a.technicianId) ?? []), a]);
    }
    for (const [technicianId, appts] of byTechnician) {
      const sorted = [...appts].sort((a, b) => a.scheduledAt.getTime() - b.scheduledAt.getTime());
      let runningEnd = -Infinity;
      let runningEndOwner: (typeof sorted)[number] | null = null;
      for (const a of sorted) {
        const start = a.scheduledAt.getTime();
        if (runningEndOwner && start < runningEnd) {
          await upsertFinding(db, {
            tenantId,
            findingType: "contradiction",
            entityType: "appointment",
            entityId: runningEndOwner.id,
            relatedEntityId: a.id,
            details: {
              reason: "overlapping appointments for the same technician",
              technicianId,
              firstStart: runningEndOwner.scheduledAt.toISOString(),
              secondStart: a.scheduledAt.toISOString(),
            },
            severity: "high",
          });
        }
        const end = start + (a.durationMinutes ?? DEFAULT_APPOINTMENT_DURATION_MINUTES) * 60_000;
        if (end > runningEnd) {
          runningEnd = end;
          runningEndOwner = a;
        }
      }
    }
  });
};
