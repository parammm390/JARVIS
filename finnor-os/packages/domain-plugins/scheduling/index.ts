// Scheduling domain plugin — REAL, native: service_visits + technicians are the calendar.

import type { DomainEnginePlugin } from "../shared/plugin-interface";
import type { DraftAction, ExecutionResult, ValidationResult, DomainPolicy } from "@finnor/shared-types";
import { withTenant, serviceVisits, technicians, households, technicianCapacity, technicianDispatchProfiles } from "@finnor/db";
import { geocodeAddress } from "@finnor/tools";
import { osrmDurationMatrix, recommendSlots, type RoutePoint } from "@finnor/read-models";
import { recordBusinessEvent } from "@finnor/data-platform";
import { findTechnician } from "../shared/db-helpers";
import { and, eq, gte, isNull, lte, or } from "drizzle-orm";
import { z } from "zod";

const opt = <T extends z.ZodTypeAny>(t: T) => t.nullish().transform((v: unknown) => v ?? undefined);

export const AssignTechSchema = z.object({
  visitId: z.string().uuid(),
  technicianId: opt(z.string().uuid()),
  technicianName: opt(z.string()),
});
export const AvailabilitySchema = z.object({
  technicianId: opt(z.string().uuid()),
  technicianName: opt(z.string()),
  date: z.string(), // ISO date
  address: opt(z.string().min(1)),
  slaDueAt: opt(z.string().datetime()),
});
export const RescheduleSchema = z.object({
  visitId: z.string().uuid(),
  newTime: z.string(), // ISO datetime
  reason: opt(z.string().max(500)),
});

const SCHEMAS: Record<string, z.ZodTypeAny> = {
  assign_technician_to_visit: AssignTechSchema,
  check_technician_availability: AvailabilitySchema,
  reschedule_visit: RescheduleSchema,
};

export const schedulingPlugin: DomainEnginePlugin = {
  name: "scheduling",
  actionTypes: Object.keys(SCHEMAS),
  payloadSchemas: SCHEMAS,
  canHandle(t) {
    return t in SCHEMAS;
  },

  validate(actionType, payload): ValidationResult {
    const schema = SCHEMAS[actionType];
    if (!schema) return { valid: false, errors: [`unhandled action ${actionType}`] };
    const p = schema.safeParse(payload);
    return p.success
      ? { valid: true, errors: [] }
      : { valid: false, errors: p.error.issues.map((i) => `payload.${i.path.join(".")}: ${i.message}`) };
  },

  draft(actionType, payload, policy: DomainPolicy): DraftAction {
    const p = SCHEMAS[actionType]!.parse(payload) as Record<string, unknown>;
    const summaries: Record<string, string> = {
      assign_technician_to_visit: `Assign ${p.technicianName ?? p.technicianId} to visit ${String(p.visitId).slice(0, 8)}.`,
      check_technician_availability: `Check ${p.technicianName ?? p.technicianId ?? "technician"} availability on ${String(p.date).slice(0, 10)}.`,
      reschedule_visit: `Reschedule visit ${String(p.visitId).slice(0, 8)} to ${p.newTime}${p.reason ? ` (${p.reason})` : ""}.`,
    };
    return {
      actionType,
      summary: summaries[actionType]!,
      payload: { ...p, tenantId: policy.tenantId },
      requiresConfirmation: policy.requiresConfirmation,
    };
  },

  async simulate(actionType, payload, policy) {
    const p = SCHEMAS[actionType]!.parse(payload) as Record<string, unknown>;
    const tenantId = policy.tenantId;
    if (actionType === "assign_technician_to_visit") {
      const [visit, technician] = await Promise.all([
        withTenant(tenantId, async (db) => (await db.select().from(serviceVisits).where(eq(serviceVisits.id, String(p.visitId))))[0] ?? null),
        findTechnician(tenantId, { technicianId: p.technicianId ? String(p.technicianId) : undefined, name: p.technicianName ? String(p.technicianName) : undefined }),
      ]);
      return {
        mode: "dry_run" as const,
        summary: visit && technician ? `Dry run: ${technician.name} would be assigned; the visit was not changed.` : "Dry run: assignment cannot be predicted because the visit or technician was not found.",
        predicted: { visitId: p.visitId, visitFound: Boolean(visit), technician: technician?.name ?? null, fieldChanges: technician ? [{ field: "technicianId", from: visit?.technicianId ?? null, to: technician.id }] : [], expectedResult: visit && technician ? { visitId: visit.id, technician: technician.name } : undefined },
      };
    }
    if (actionType === "reschedule_visit") {
      const [visit] = await withTenant(tenantId, (db) => db.select().from(serviceVisits).where(eq(serviceVisits.id, String(p.visitId))));
      const when = new Date(String(p.newTime));
      return {
        mode: "dry_run" as const,
        summary: visit && !Number.isNaN(when.getTime()) ? `Dry run: the visit would move to ${when.toISOString()}; no calendar row was changed.` : "Dry run: reschedule cannot be predicted because the visit or requested time is invalid.",
        predicted: { visitId: p.visitId, visitFound: Boolean(visit), fieldChanges: visit && !Number.isNaN(when.getTime()) ? [{ field: "scheduledAt", from: visit.scheduledAt?.toISOString() ?? null, to: when.toISOString() }] : [], expectedResult: visit && !Number.isNaN(when.getTime()) ? { visitId: visit.id, scheduledAt: when.toISOString() } : undefined },
      };
    }
    return { mode: "dry_run" as const, summary: `Dry run: availability will be read for ${String(p.date)}; no calendar row will change.`, predicted: { date: p.date, fieldChanges: [] } };
  },

  async execute(draft: DraftAction): Promise<ExecutionResult> {
    const tenantId = String(draft.payload.tenantId ?? "");
    const p = draft.payload;

    if (draft.actionType === "check_technician_availability") {
      // B3.T2: an address + actual SLA deadline asks for a ranked proposal. Without
      // either, retain the existing single-technician availability answer rather than
      // invent a travel or urgency input.
      if (p.address && p.slaDueAt) {
        const dueAt = new Date(String(p.slaDueAt));
        const dayStart = new Date(`${String(p.date).slice(0, 10)}T00:00:00`);
        const dayEnd = new Date(dayStart.getTime() + 24 * 3600 * 1000);
        const weekday = dayStart.getDay();
        const [profiles, capacityRows, bookedRows] = await withTenant(tenantId, async (db) =>
          Promise.all([
            db.select({ technicianId: technicianDispatchProfiles.technicianId, name: technicians.name, baseAddress: technicianDispatchProfiles.baseAddress, slaMinutes: technicianDispatchProfiles.defaultSlaMinutes })
              .from(technicianDispatchProfiles).innerJoin(technicians, eq(technicians.id, technicianDispatchProfiles.technicianId))
              .where(eq(technicianDispatchProfiles.tenantId, tenantId)),
            db.select({ technicianId: technicianCapacity.technicianId, max: technicianCapacity.maxConcurrentJobs }).from(technicianCapacity)
              .where(and(eq(technicianCapacity.tenantId, tenantId), or(eq(technicianCapacity.dayOfWeek, weekday), isNull(technicianCapacity.dayOfWeek)))),
            db.select({ technicianId: serviceVisits.technicianId }).from(serviceVisits)
              .where(and(gte(serviceVisits.scheduledAt, dayStart), lte(serviceVisits.scheduledAt, dayEnd), isNull(serviceVisits.completedAt))),
          ]),
        );
        const configured = profiles.filter((profile) => profile.baseAddress && profile.slaMinutes);
        const geocoded: RoutePoint[] = [{ id: "request", label: String(p.address), ...(await geocodeAddress(String(p.address))) }];
        for (const profile of configured) {
          const point = await geocodeAddress(profile.baseAddress!);
          geocoded.push({ id: profile.technicianId, label: profile.baseAddress!, ...point });
        }
        const durations = geocoded.length > 1 ? await osrmDurationMatrix(geocoded) : [];
        const capacityByTech = new Map(capacityRows.map((row) => [row.technicianId, row.max]));
        const bookedByTech = new Map<string, number>();
        for (const row of bookedRows) if (row.technicianId) bookedByTech.set(row.technicianId, (bookedByTech.get(row.technicianId) ?? 0) + 1);
        const minutesUntilSla = Math.round((dueAt.getTime() - Date.now()) / 60_000);
        const recommendations = recommendSlots(profiles.map((profile) => {
          const index = geocoded.findIndex((point) => point.id === profile.technicianId);
          return {
            technicianId: profile.technicianId,
            technicianName: profile.name,
            driveMinutes: index > 0 ? Math.round(durations[0]![index]! / 60) : null,
            bookedJobs: bookedByTech.get(profile.technicianId) ?? 0,
            maxConcurrentJobs: capacityByTech.get(profile.technicianId) ?? null,
            minutesUntilSla: profile.slaMinutes ? Math.min(minutesUntilSla, profile.slaMinutes) : null,
          };
        }));
        return { status: "success", output: { requestedAddress: p.address, slaDueAt: p.slaDueAt, recommendations, heuristic: "Scores are a transparent drive-time + load + SLA-risk heuristic, not a promise of availability." }, expected: { answered: true } };
      }
      const tech = await findTechnician(tenantId, {
        technicianId: p.technicianId ? String(p.technicianId) : undefined,
        name: p.technicianName ? String(p.technicianName) : undefined,
      });
      if (!tech) return { status: "failure", output: {}, error: "No technician found by that name or id.", errorKind: "validation" };
      const dayStart = new Date(`${String(p.date).slice(0, 10)}T00:00:00`);
      const dayEnd = new Date(dayStart.getTime() + 24 * 3600 * 1000);
      const booked = await withTenant(tenantId, (db) =>
        db
          .select({ id: serviceVisits.id, scheduledAt: serviceVisits.scheduledAt, type: serviceVisits.type, address: households.address })
          .from(serviceVisits)
          .innerJoin(households, eq(serviceVisits.householdId, households.id))
          .where(
            and(
              eq(serviceVisits.technicianId, tech.id),
              gte(serviceVisits.scheduledAt, dayStart),
              lte(serviceVisits.scheduledAt, dayEnd),
            ),
          ),
      );
      return {
        status: "success",
        output: {
          technician: tech.name,
          workingHours: tech.availability,
          bookedThatDay: booked.map((b) => ({ at: b.scheduledAt?.toISOString(), type: b.type, address: b.address })),
          openForBooking: booked.length < 6, // simple capacity heuristic, overridable via policy later
        },
        expected: { answered: true },
      };
    }

    // Both remaining actions mutate a visit — load it first.
    const visit = await withTenant(tenantId, async (db) => {
      const [row] = await db.select().from(serviceVisits).where(eq(serviceVisits.id, String(p.visitId)));
      return row ?? null;
    });
    if (!visit) return { status: "failure", output: {}, error: "That visit doesn't exist.", errorKind: "validation" };

    if (draft.actionType === "assign_technician_to_visit") {
      const tech = await findTechnician(tenantId, {
        technicianId: p.technicianId ? String(p.technicianId) : undefined,
        name: p.technicianName ? String(p.technicianName) : undefined,
      });
      if (!tech) return { status: "failure", output: {}, error: "No technician found by that name or id.", errorKind: "validation" };
      await withTenant(tenantId, async (db) => {
        await db.update(serviceVisits).set({ technicianId: tech.id }).where(eq(serviceVisits.id, visit.id));
        await recordBusinessEvent(db, {
          tenantId,
          entityType: "service_visit",
          entityId: visit.id,
          eventType: "technician_assigned",
          payload: { technicianId: tech.id },
        });
      });
      return { status: "success", output: { visitId: visit.id, technician: tech.name }, expected: { assigned: true } };
    }

    // reschedule_visit
    const when = new Date(String(p.newTime));
    if (Number.isNaN(when.getTime())) return { status: "failure", output: {}, error: "That new time isn't a valid date.", errorKind: "validation" };
    await withTenant(tenantId, async (db) => {
      await db
        .update(serviceVisits)
        .set({
          scheduledAt: when,
          notes: [visit.notes, `Rescheduled${p.reason ? `: ${p.reason}` : ""}`].filter(Boolean).join(" | "),
        })
        .where(eq(serviceVisits.id, visit.id));
      await recordBusinessEvent(db, {
        tenantId,
        entityType: "service_visit",
        entityId: visit.id,
        eventType: "rescheduled",
        payload: { scheduledAt: when.toISOString(), reason: p.reason ?? null },
      });
    });
    return { status: "success", output: { visitId: visit.id, scheduledAt: when.toISOString() }, expected: { rescheduled: true } };
  },
};

export default schedulingPlugin;
