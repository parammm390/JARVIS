// scan_appointment_no_shows job: closes out vertical workflow 1's last step (blueprint
// §4.1: "...confirmation, reminder and no-show"). A confirmed appointment whose
// scheduled time has passed with no completion is marked no_show, a business_event is
// recorded, and a follow-up task is created (data-platform's createTask) so a human
// sees it — never silently dropped.

import { withTenant, appointments } from "@finnor/db";
import { and, eq, lt } from "drizzle-orm";
import { createTask, updateAppointmentStatus } from "@finnor/data-platform";
import type { JobHandler } from "../queue";

const GRACE_PERIOD_MS = 60 * 60 * 1000; // an hour past the scheduled time before calling it a no-show

export const scanAppointmentNoShows: JobHandler = async (payload) => {
  const tenantId = String(payload.tenantId ?? "");
  if (!tenantId) throw new Error("scan_appointment_no_shows requires tenantId");

  const cutoff = new Date(Date.now() - GRACE_PERIOD_MS);
  const overdue = await withTenant(tenantId, (db) =>
    db
      .select()
      .from(appointments)
      .where(and(eq(appointments.tenantId, tenantId), eq(appointments.status, "confirmed"), lt(appointments.scheduledAt, cutoff))),
  );

  for (const appt of overdue) {
    await withTenant(tenantId, async (db) => {
      await updateAppointmentStatus(db, {
        tenantId,
        appointmentId: appt.id,
        status: "no_show",
        eventType: "appointment_no_show",
        eventPayload: { subjectType: appt.subjectType, subjectId: appt.subjectId, scheduledAt: appt.scheduledAt.toISOString() },
      });
      await createTask(db, {
        tenantId,
        subjectType: "appointment",
        subjectId: appt.id,
        title: `No-show: follow up on missed appointment for ${appt.subjectType} ${appt.subjectId}`,
        priority: "high",
      });
    });
  }
};
