// Scheduling domain plugin — REAL, native: service_visits + technicians are the calendar.

import type { DomainEnginePlugin } from "../shared/plugin-interface";
import type { DraftAction, ExecutionResult, ValidationResult, DomainPolicy } from "@finnor/shared-types";
import { withTenant, serviceVisits, technicians, households } from "@finnor/db";
import { recordBusinessEvent } from "@finnor/data-platform";
import { findTechnician } from "../shared/db-helpers";
import { and, eq, gte, lte } from "drizzle-orm";
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

  async execute(draft: DraftAction): Promise<ExecutionResult> {
    const tenantId = String(draft.payload.tenantId ?? "");
    const p = draft.payload;

    if (draft.actionType === "check_technician_availability") {
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
