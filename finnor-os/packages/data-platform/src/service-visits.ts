import { households, serviceVisits, technicians, type Db } from "@finnor/db";
import { and, eq, isNull } from "drizzle-orm";
import { recordBusinessEvent } from "./events";

export interface CreateServiceVisitParams {
  tenantId: string;
  householdId: string;
  technicianId?: string;
  type: string;
  scheduledAt?: Date | null;
  completedAt?: Date | null;
  notes?: string | null;
  eventType?: string;
  eventPayload?: Record<string, unknown>;
}

async function assertVisitRelationships(db: Db, params: { tenantId: string; householdId: string; technicianId?: string }): Promise<void> {
  const [household] = await db.select({ id: households.id }).from(households).where(and(
    eq(households.tenantId, params.tenantId), eq(households.id, params.householdId),
  )).limit(1);
  if (!household) throw new Error("Service visit household does not belong to this tenant");
  if (params.technicianId) {
    const [technician] = await db.select({ id: technicians.id }).from(technicians).where(and(
      eq(technicians.tenantId, params.tenantId), eq(technicians.id, params.technicianId),
    )).limit(1);
    if (!technician) throw new Error("Service visit technician does not belong to this tenant");
  }
}

export async function createServiceVisit(db: Db, params: CreateServiceVisitParams): Promise<typeof serviceVisits.$inferSelect> {
  await assertVisitRelationships(db, params);
  const [visit] = await db.insert(serviceVisits).values({
    tenantId: params.tenantId,
    householdId: params.householdId,
    technicianId: params.technicianId ?? null,
    type: params.type,
    scheduledAt: params.scheduledAt ?? null,
    completedAt: params.completedAt ?? null,
    notes: params.notes ?? null,
  }).returning();
  await recordBusinessEvent(db, {
    tenantId: params.tenantId,
    entityType: "service_visit",
    entityId: visit!.id,
    eventType: params.eventType ?? "service_visit_created",
    payload: params.eventPayload ?? {},
  });
  return visit!;
}

export interface UpdateServiceVisitParams {
  tenantId: string;
  visitId: string;
  patch: {
    technicianId?: string | null;
    scheduledAt?: Date | null;
    completedAt?: Date | null;
    notes?: string | null;
  };
  eventType: string;
  eventPayload?: Record<string, unknown>;
  expectedTechnicianId?: string;
  requireIncomplete?: boolean;
}

export async function updateServiceVisit(db: Db, params: UpdateServiceVisitParams): Promise<typeof serviceVisits.$inferSelect | null> {
  if (params.patch.technicianId) {
    const [technician] = await db.select({ id: technicians.id }).from(technicians).where(and(
      eq(technicians.tenantId, params.tenantId), eq(technicians.id, params.patch.technicianId),
    )).limit(1);
    if (!technician) throw new Error("Service visit technician does not belong to this tenant");
  }
  const conditions = [eq(serviceVisits.tenantId, params.tenantId), eq(serviceVisits.id, params.visitId)];
  if (params.expectedTechnicianId) conditions.push(eq(serviceVisits.technicianId, params.expectedTechnicianId));
  if (params.requireIncomplete) conditions.push(isNull(serviceVisits.completedAt));
  const [visit] = await db.update(serviceVisits).set(params.patch).where(and(...conditions)).returning();
  if (!visit) return null;
  await recordBusinessEvent(db, {
    tenantId: params.tenantId,
    entityType: "service_visit",
    entityId: visit.id,
    eventType: params.eventType,
    payload: params.eventPayload ?? {},
  });
  return visit;
}

export async function assignServiceVisit(db: Db, params: { tenantId: string; visitId: string; technicianId: string }): Promise<typeof serviceVisits.$inferSelect | null> {
  return updateServiceVisit(db, {
    tenantId: params.tenantId,
    visitId: params.visitId,
    patch: { technicianId: params.technicianId },
    eventType: "service_visit_assigned",
    eventPayload: { technicianId: params.technicianId },
  });
}

export async function completeServiceVisit(db: Db, params: { tenantId: string; visitId: string; technicianId?: string; notes?: string }): Promise<typeof serviceVisits.$inferSelect | null> {
  return updateServiceVisit(db, {
    tenantId: params.tenantId,
    visitId: params.visitId,
    patch: { completedAt: new Date(), ...(params.notes !== undefined ? { notes: params.notes } : {}) },
    eventType: "service_visit_completed",
    ...(params.technicianId ? { expectedTechnicianId: params.technicianId } : {}),
    requireIncomplete: true,
  });
}
