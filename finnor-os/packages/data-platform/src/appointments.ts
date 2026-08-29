import { appointments, type Db } from "@finnor/db";
import { and, eq } from "drizzle-orm";
import { recordBusinessEvent } from "./events";

export interface CreateAppointmentParams {
  tenantId: string;
  subjectType: string;
  subjectId: string;
  scheduledAt: Date;
  technicianId?: string;
  durationMinutes?: number;
  holdExpiresAt?: Date;
  notes?: string;
}

export async function createAppointment(
  db: Db,
  params: CreateAppointmentParams,
): Promise<{ appointmentId: string }> {
  const [appt] = await db
    .insert(appointments)
    .values({
      tenantId: params.tenantId,
      subjectType: params.subjectType,
      subjectId: params.subjectId,
      scheduledAt: params.scheduledAt,
      technicianId: params.technicianId ?? null,
      durationMinutes: params.durationMinutes ?? null,
      holdExpiresAt: params.holdExpiresAt ?? null,
      notes: params.notes ?? null,
    })
    .returning();
  await recordBusinessEvent(db, {
    tenantId: params.tenantId,
    entityType: "appointment",
    entityId: appt!.id,
    eventType: "appointment_created",
  });
  return { appointmentId: appt!.id };
}

export async function updateAppointmentStatus(
  db: Db,
  params: {
    tenantId: string;
    appointmentId: string;
    status: "hold" | "confirmed" | "completed" | "canceled" | "no_show";
    eventType?: string;
    eventPayload?: Record<string, unknown>;
  },
): Promise<boolean> {
  const [updated] = await db
    .update(appointments)
    .set({ status: params.status })
    .where(and(eq(appointments.tenantId, params.tenantId), eq(appointments.id, params.appointmentId)))
    .returning({ id: appointments.id });
  if (!updated) return false;
  await recordBusinessEvent(db, {
    tenantId: params.tenantId,
    entityType: "appointment",
    entityId: params.appointmentId,
    eventType: params.eventType ?? "appointment_status_changed",
    payload: { status: params.status, ...(params.eventPayload ?? {}) },
  });
  return true;
}

export async function assignAppointment(
  db: Db,
  params: { tenantId: string; appointmentId: string; technicianId: string },
): Promise<typeof appointments.$inferSelect | null> {
  const [appointment] = await db.update(appointments).set({ technicianId: params.technicianId }).where(and(
    eq(appointments.tenantId, params.tenantId), eq(appointments.id, params.appointmentId),
  )).returning();
  if (!appointment) return null;
  await recordBusinessEvent(db, {
    tenantId: params.tenantId,
    entityType: "appointment",
    entityId: params.appointmentId,
    eventType: "appointment_assigned",
    payload: { technicianId: params.technicianId },
  });
  return appointment;
}
