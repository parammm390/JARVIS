// scheduled_reminder job: finds maintenance agreements entering their renewal window
// and drafts renewal actions through the real plugin/gate pipeline — never a direct
// send, and never a hand-inserted row that skips draft() (which is what rendered the
// confirmation_template summary and, previously, produced blank "No summary drafted."
// cards with no voice confirmation, unlike every other gated action).

import { withTenant, maintenanceAgreements, households, domainActions, scanFindings } from "@finnor/db";
import { FinnorOrchestrator } from "@finnor/orchestration";
import { and, eq, lte } from "drizzle-orm";
import type { JobHandler } from "../queue";

let orchestrator: FinnorOrchestrator | null = null;

export const scheduledReminder: JobHandler = async (payload) => {
  const tenantId = String(payload.tenantId ?? "");
  if (!tenantId) throw new Error("scheduled_reminder requires tenantId");
  const windowDays = Number(payload.windowDays ?? 30);
  const cutoff = new Date(Date.now() + windowDays * 24 * 3600 * 1000);
  orchestrator ??= new FinnorOrchestrator();

  const due = await withTenant(tenantId, (db) =>
    db
      .select({
        agreementId: maintenanceAgreements.id,
        cadence: maintenanceAgreements.cadence,
        householdId: households.id,
        address: households.address,
        contactInfo: households.contactInfo,
      })
      .from(maintenanceAgreements)
      .innerJoin(households, eq(maintenanceAgreements.householdId, households.id))
      .where(and(eq(households.tenantId, tenantId), eq(maintenanceAgreements.status, "active"), lte(maintenanceAgreements.renewalDate, cutoff))),
  );
  if (due.length === 0) return;

  // Idempotency: one query for every pending renewal, scoped to THIS agreement id
  // via its payload — not "any pending renewal anywhere" (the previous version's
  // global check meant one pending renewal silently skipped every other agreement
  // in the same run). Fetched once, not once per agreement. Explicit tenantId filter
  // (not just RLS) — see scan-low-inventory's comment for why.
  const pendingRenewals = await withTenant(tenantId, (db) =>
    db
      .select({ payload: domainActions.payload })
      .from(domainActions)
      .where(and(eq(domainActions.tenantId, tenantId), eq(domainActions.actionType, "renew_maintenance_agreement"), eq(domainActions.status, "pending"))),
  );
  const alreadyPendingAgreementIds = new Set(
    pendingRenewals.map((r) => (r.payload as Record<string, unknown>)?.agreementId).filter(Boolean),
  );

  for (const row of due) {
    if (alreadyPendingAgreementIds.has(row.agreementId)) continue;
    const contact = (row.contactInfo ?? {}) as Record<string, unknown>;

    const { action } = await orchestrator.draftKnownAction(
      "renew_maintenance_agreement",
      {
        agreementId: row.agreementId,
        householdId: row.householdId,
        householdLabel: String(contact.name ?? row.address),
        contactPhone: String(contact.phone ?? ""),
        cadence: row.cadence,
      },
      tenantId,
      { source: "scan_maintenance_renewal" },
    );
    // Phase 12: every drafting scan also records a finding pointing at what it
    // drafted, so the digest can say "already queued" instead of double-reporting.
    await withTenant(tenantId, (db) =>
      db.insert(scanFindings).values({
        tenantId,
        scanType: "maintenance_renewal",
        severity: "info",
        summary: `${String(contact.name ?? row.address)}'s maintenance agreement is entering its renewal window.`,
        details: { agreementId: row.agreementId, householdId: row.householdId, cadence: row.cadence },
        draftedActionId: action.id,
      }),
    );
  }
};
