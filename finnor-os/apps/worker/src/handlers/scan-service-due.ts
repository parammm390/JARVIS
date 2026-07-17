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
// There's still no mutating action_type that maps cleanly onto "service this
// equipment" (schedule_water_test is household-level, not equipment-level), but a
// dealer who has configured real follow-up copy can have this scan draft a real
// gated send_follow_up per due household — config over code, same rule scan_cold_leads
// uses for its win-back script. Absent that config, this still feeds the owner digest.

import { withTenant, domainActions, domainPolicies, equipment, households, serviceVisits, scanFindings } from "@finnor/db";
import { eq, and, isNotNull, desc } from "drizzle-orm";
import { isReminderDue, ReminderPolicySchema } from "@finnor/plugin-service-reminders";
import { FinnorOrchestrator } from "@finnor/orchestration";
import type { JobHandler } from "../queue";

let orchestrator: FinnorOrchestrator | null = null;

const REMINDER_EQUIPMENT_TYPES = new Set(["sediment_filter", "carbon_filter", "ro_membrane", "water_softener"]);

export const scanServiceDue: JobHandler = async (payload) => {
  const tenantId = String(payload.tenantId ?? "");
  if (!tenantId) throw new Error("scan_service_due requires tenantId");
  orchestrator ??= new FinnorOrchestrator();
  const policy = ReminderPolicySchema.parse({}); // defaults; per-dealer overrides are a future policy read, same as the on-demand path

  const due: Array<{ label: string; equipmentType: string; monthsElapsed: number; householdId: string }> = await withTenant(
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
      const results: Array<{ label: string; equipmentType: string; monthsElapsed: number; householdId: string }> = [];
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
          results.push({
            label: `${item.type.replaceAll("_", " ")} (household ${item.householdId.slice(0, 8)})`,
            equipmentType: item.type,
            monthsElapsed: result.monthsElapsed,
            householdId: item.householdId,
          });
        }
      }
      return results;
    },
  );
  if (due.length === 0) return;

  const [followUpPolicy] = await withTenant(tenantId, (db) =>
    db
      .select()
      .from(domainPolicies)
      .where(and(eq(domainPolicies.tenantId, tenantId), eq(domainPolicies.actionType, "send_follow_up")))
      .limit(1),
  );
  const serviceDueScript = (followUpPolicy?.policy as Record<string, unknown> | undefined)?.serviceDueScript;

  if (typeof serviceDueScript === "string" && serviceDueScript.length > 0) {
    // Dedupe: skip households that already have a pending send_follow_up, same guard
    // shape scheduled-reminder.ts uses for renew_maintenance_agreement — fetched once,
    // not once per household.
    const pendingFollowUps = await withTenant(tenantId, (db) =>
      db
        .select({ payload: domainActions.payload })
        .from(domainActions)
        .where(and(eq(domainActions.tenantId, tenantId), eq(domainActions.actionType, "send_follow_up"), eq(domainActions.status, "pending"))),
    );
    const alreadyPendingHouseholdIds = new Set(
      pendingFollowUps.map((r) => (r.payload as Record<string, unknown>)?.householdId).filter(Boolean),
    );

    const dueHouseholdIds = [...new Set(due.map((d) => d.householdId))];
    for (const householdId of dueHouseholdIds) {
      if (alreadyPendingHouseholdIds.has(householdId)) continue;
      const itemsForHousehold = due.filter((d) => d.householdId === householdId);
      const { action } = await orchestrator.draftKnownAction(
        "send_follow_up",
        { householdId, context: serviceDueScript },
        tenantId,
        { source: "scan_service_due" },
      );
      await withTenant(tenantId, (db) =>
        db.insert(scanFindings).values({
          tenantId,
          scanType: "service_due",
          severity: "warning",
          summary: `${itemsForHousehold.map((i) => i.label).join(", ")} likely due for service.`,
          details: { items: itemsForHousehold },
          draftedActionId: action.id,
        }),
      );
    }
    return;
  }

  await withTenant(tenantId, (db) =>
    db.insert(scanFindings).values({
      tenantId,
      scanType: "service_due",
      severity: "warning",
      summary: `${due.length} item${due.length === 1 ? "" : "s"} likely due for service: ${due
        .slice(0, 5)
        .map((d) => d.label)
        .join(", ")}${due.length > 5 ? ", and more" : ""} — set domain_policies.send_follow_up.policy.serviceDueScript to auto-draft follow-ups.`,
      details: { items: due },
    }),
  );
};
