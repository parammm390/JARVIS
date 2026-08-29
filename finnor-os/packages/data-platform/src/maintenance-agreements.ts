import { households, maintenanceAgreements, type Db } from "@finnor/db";
import { and, eq } from "drizzle-orm";
import { recordBusinessEvent } from "./events";

export async function ensureMaintenanceAgreement(
  db: Db,
  params: {
    tenantId: string;
    householdId: string;
    cadence: string;
    terms?: Record<string, unknown>;
    status?: "active" | "renewal_window" | "renewal_sent" | "renewed" | "lapsed";
    renewalDate?: Date | null;
    source?: string;
  },
): Promise<{ agreement: typeof maintenanceAgreements.$inferSelect; created: boolean }> {
  const [household] = await db.select({ id: households.id }).from(households).where(and(
    eq(households.tenantId, params.tenantId), eq(households.id, params.householdId),
  )).limit(1);
  if (!household) throw new Error("Maintenance agreement household does not belong to this tenant");
  const [existing] = await db.select().from(maintenanceAgreements).where(and(
    eq(maintenanceAgreements.tenantId, params.tenantId),
    eq(maintenanceAgreements.householdId, params.householdId),
    eq(maintenanceAgreements.cadence, params.cadence),
  )).limit(1);
  if (existing) return { agreement: existing, created: false };
  const [created] = await db.insert(maintenanceAgreements).values({
    tenantId: params.tenantId,
    householdId: params.householdId,
    cadence: params.cadence,
    terms: params.terms ?? {},
    status: params.status ?? "active",
    renewalDate: params.renewalDate ?? null,
  }).returning();
  await recordBusinessEvent(db, {
    tenantId: params.tenantId,
    entityType: "maintenance_agreement",
    entityId: created!.id,
    eventType: "maintenance_agreement_created",
    source: params.source ?? "maintenance_agreement",
  });
  return { agreement: created!, created: true };
}

export async function updateMaintenanceAgreement(
  db: Db,
  params: {
    tenantId: string;
    agreementId: string;
    patch: {
      status?: "active" | "renewal_window" | "renewal_sent" | "renewed" | "lapsed";
      renewalDate?: Date | null;
      firstReminderSentAt?: Date | null;
      secondReminderSentAt?: Date | null;
    };
    eventType: string;
    eventPayload?: Record<string, unknown>;
  },
): Promise<typeof maintenanceAgreements.$inferSelect | null> {
  const [agreement] = await db.update(maintenanceAgreements).set(params.patch).where(and(
    eq(maintenanceAgreements.tenantId, params.tenantId), eq(maintenanceAgreements.id, params.agreementId),
  )).returning();
  if (!agreement) return null;
  await recordBusinessEvent(db, {
    tenantId: params.tenantId,
    entityType: "maintenance_agreement",
    entityId: params.agreementId,
    eventType: params.eventType,
    payload: params.eventPayload ?? {},
  });
  return agreement;
}
