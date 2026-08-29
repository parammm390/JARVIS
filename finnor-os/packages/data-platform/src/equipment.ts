import { equipment, households, type Db } from "@finnor/db";
import { and, eq } from "drizzle-orm";
import { recordBusinessEvent } from "./events";

export interface EnsureEquipmentParams {
  tenantId: string;
  householdId: string;
  type: string;
  model?: string | null;
  installDate?: Date | null;
  source?: "finnor" | "competitor";
  eventSource?: string;
}

/** Idempotent canonical boundary used by imports/reconcilers for installed equipment. */
export async function ensureEquipment(
  db: Db,
  params: EnsureEquipmentParams,
): Promise<{ equipment: typeof equipment.$inferSelect; created: boolean }> {
  const [household] = await db.select({ id: households.id }).from(households).where(and(
    eq(households.tenantId, params.tenantId), eq(households.id, params.householdId),
  )).limit(1);
  if (!household) throw new Error("Equipment household does not belong to this tenant");
  const [existing] = await db.select().from(equipment).where(and(
    eq(equipment.tenantId, params.tenantId),
    eq(equipment.householdId, params.householdId),
    eq(equipment.type, params.type),
  )).limit(1);
  if (existing) return { equipment: existing, created: false };
  const [created] = await db.insert(equipment).values({
    tenantId: params.tenantId,
    householdId: params.householdId,
    type: params.type,
    model: params.model ?? null,
    installDate: params.installDate ?? null,
    source: params.source ?? "finnor",
  }).returning();
  await recordBusinessEvent(db, {
    tenantId: params.tenantId,
    entityType: "equipment",
    entityId: created!.id,
    eventType: "equipment_created",
    source: params.eventSource ?? "equipment",
  });
  return { equipment: created!, created: true };
}
