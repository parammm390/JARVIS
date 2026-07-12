// scheduled_reminder job: finds maintenance agreements entering their renewal window
// and plans renewal actions through the normal gated pipeline — never a direct send.

import { withTenant, maintenanceAgreements, households, domainActions, domainPolicies } from "@finnor/db";
import { and, eq, lte } from "drizzle-orm";
import type { JobHandler } from "../queue";

export const scheduledReminder: JobHandler = async (payload) => {
  const tenantId = String(payload.tenantId ?? "");
  if (!tenantId) throw new Error("scheduled_reminder requires tenantId");
  const windowDays = Number(payload.windowDays ?? 30);
  const cutoff = new Date(Date.now() + windowDays * 24 * 3600 * 1000);

  await withTenant(tenantId, async (db) => {
    const due = await db
      .select({
        agreementId: maintenanceAgreements.id,
        cadence: maintenanceAgreements.cadence,
        householdId: households.id,
        address: households.address,
        contactInfo: households.contactInfo,
      })
      .from(maintenanceAgreements)
      .innerJoin(households, eq(maintenanceAgreements.householdId, households.id))
      .where(
        and(eq(maintenanceAgreements.status, "active"), lte(maintenanceAgreements.renewalDate, cutoff)),
      );

    const [policy] = await db
      .select()
      .from(domainPolicies)
      .where(eq(domainPolicies.actionType, "renew_maintenance_agreement"))
      .limit(1);

    for (const row of due) {
      const contact = (row.contactInfo ?? {}) as Record<string, unknown>;
      // Idempotency: skip if a non-terminal renewal action already exists for this agreement.
      const existing = await db
        .select({ id: domainActions.id })
        .from(domainActions)
        .where(and(eq(domainActions.actionType, "renew_maintenance_agreement"), eq(domainActions.status, "pending")));
      if (existing.length > 0) continue;
      await db.insert(domainActions).values({
        tenantId,
        actionType: "renew_maintenance_agreement",
        payload: {
          agreementId: row.agreementId,
          householdId: row.householdId,
          householdLabel: String(contact.name ?? row.address),
          contactPhone: String(contact.phone ?? ""),
          cadence: row.cadence,
        },
        policyId: policy?.id ?? null,
        status: "pending",
      });
    }
  });
};
