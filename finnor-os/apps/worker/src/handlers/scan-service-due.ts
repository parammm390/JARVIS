// scan_service_due job: finds equipment whose filter/membrane service is due, using
// the real isReminderDue() logic from the service-reminders plugin — previously only
// reachable by a caller (voice/text) naming a specific piece of equipment, never run
// proactively across the whole install base.
//
// Real data-model limitation, stated plainly rather than hidden: service_visits links
// to a household, not to a specific equipment row, so there's no per-equipment visit
// history to query. "Last serviced" is approximated as the household's most recent
// completed service visit of any kind, falling back to the equipment's install_date
// if it has never had one. This is an honest approximation, not exact tracking — good
// enough to flag "probably due," not precise enough to promise an exact date.
//
// Like low-inventory, there's no existing mutating action_type to draft into (the
// equipment/visit shape doesn't cleanly map to schedule_water_test's household-level
// payload), so this feeds the owner digest instead of drafting.

import { withTenant, equipment, households, serviceVisits, scanFindings } from "@finnor/db";
import { eq, and, isNotNull, desc } from "drizzle-orm";
import { isReminderDue, ReminderPolicySchema } from "@finnor/plugin-service-reminders";
import type { JobHandler } from "../queue";

const REMINDER_EQUIPMENT_TYPES = new Set(["sediment_filter", "carbon_filter", "ro_membrane", "water_softener"]);

export const scanServiceDue: JobHandler = async (payload) => {
  const tenantId = String(payload.tenantId ?? "");
  if (!tenantId) throw new Error("scan_service_due requires tenantId");
  const policy = ReminderPolicySchema.parse({}); // defaults; per-dealer overrides are a future policy read, same as the on-demand path

  const due: Array<{ label: string; equipmentType: string; monthsElapsed: number }> = await withTenant(
    tenantId,
    async (db) => {
      // equipment has no tenant_id column of its own (scoped via household_id) — join
      // and filter explicitly rather than relying only on RLS (see scan-low-inventory's
      // comment on why: a table-owner role, as local dev connections typically are,
      // bypasses RLS regardless of FORCE ROW LEVEL SECURITY).
      const items = await db
        .select({ id: equipment.id, type: equipment.type, householdId: equipment.householdId, installDate: equipment.installDate })
        .from(equipment)
        .innerJoin(households, eq(equipment.householdId, households.id))
        .where(eq(households.tenantId, tenantId));
      const results: Array<{ label: string; equipmentType: string; monthsElapsed: number }> = [];
      for (const item of items) {
        if (!REMINDER_EQUIPMENT_TYPES.has(item.type)) continue;
        const [lastVisit] = await db
          .select({ completedAt: serviceVisits.completedAt })
          .from(serviceVisits)
          .where(and(eq(serviceVisits.householdId, item.householdId), isNotNull(serviceVisits.completedAt)))
          .orderBy(desc(serviceVisits.completedAt))
          .limit(1);
        const lastServicedAt = lastVisit?.completedAt ?? item.installDate;
        if (!lastServicedAt) continue; // no history and never installed-dated — nothing to compare against
        const result = isReminderDue(item.type, lastServicedAt.toISOString(), policy);
        if (result.due) {
          results.push({ label: `${item.type.replaceAll("_", " ")} (household ${item.householdId.slice(0, 8)})`, equipmentType: item.type, monthsElapsed: result.monthsElapsed });
        }
      }
      return results;
    },
  );
  if (due.length === 0) return;

  await withTenant(tenantId, (db) =>
    db.insert(scanFindings).values({
      tenantId,
      scanType: "service_due",
      summary: `${due.length} item${due.length === 1 ? "" : "s"} likely due for service: ${due
        .slice(0, 5)
        .map((d) => d.label)
        .join(", ")}${due.length > 5 ? ", and more" : ""}.`,
      details: { items: due },
    }),
  );
};
