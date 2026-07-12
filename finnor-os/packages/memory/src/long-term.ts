// Long-term memory: the existing two-year household model in Postgres (§10).
// Read-only aggregation of a household's profile, equipment, visits, and agreements.

import { withTenant, households, equipment, serviceVisits, maintenanceAgreements, communicationsLog } from "@finnor/db";
import { eq, desc } from "drizzle-orm";

export interface HouseholdMemory {
  household: Record<string, unknown>;
  equipment: Array<Record<string, unknown>>;
  recentVisits: Array<Record<string, unknown>>;
  agreements: Array<Record<string, unknown>>;
  recentCommunications: Array<Record<string, unknown>>;
}

export async function readHouseholdMemory(
  tenantId: string,
  householdId: string,
): Promise<HouseholdMemory | null> {
  return withTenant(tenantId, async (db) => {
    const [hh] = await db.select().from(households).where(eq(households.id, householdId));
    if (!hh) return null;
    const [eq_, visits, agmts, comms] = await Promise.all([
      db.select().from(equipment).where(eq(equipment.householdId, householdId)),
      db
        .select()
        .from(serviceVisits)
        .where(eq(serviceVisits.householdId, householdId))
        .orderBy(desc(serviceVisits.scheduledAt))
        .limit(10),
      db
        .select()
        .from(maintenanceAgreements)
        .where(eq(maintenanceAgreements.householdId, householdId)),
      db
        .select()
        .from(communicationsLog)
        .where(eq(communicationsLog.householdId, householdId))
        .orderBy(desc(communicationsLog.timestamp))
        .limit(20),
    ]);
    return {
      household: hh as Record<string, unknown>,
      equipment: eq_ as Array<Record<string, unknown>>,
      recentVisits: visits as Array<Record<string, unknown>>,
      agreements: agmts as Array<Record<string, unknown>>,
      recentCommunications: comms as Array<Record<string, unknown>>,
    };
  });
}
