// owner_digest job: once daily, compiles undigested scan_findings (low inventory,
// service-due — the categories with no mutating action to gate into) plus a count of
// fresh scan-drafted actions now sitting in the confirmation queue (renewal, win-back
// — the categories that DO have one), into ONE real outbound call. Deliberately one
// call, not one per scan — four separate proactive calls a day would be the opposite
// of a smooth experience. Deterministic template text, no LLM call: this job runs on
// a timer regardless of whether there's anything to say, and a model call on every
// empty tick would be pure wasted spend against a fixed budget.

import { getPool, withTenant, scanFindings, domainActions } from "@finnor/db";
import { and, eq, gte, isNull } from "drizzle-orm";
import { placeVapiCall, VOICE_PERSONAS } from "@finnor/tools";
import { followUpDebt, cashCollections, slaBreaches } from "@finnor/read-models";
import type { JobHandler } from "../queue";

export const ownerDigest: JobHandler = async (payload) => {
  const tenantId = String(payload.tenantId ?? "");
  if (!tenantId) throw new Error("owner_digest requires tenantId");

  const findings = await withTenant(tenantId, (db) =>
    db.select().from(scanFindings).where(and(eq(scanFindings.tenantId, tenantId), isNull(scanFindings.digestedAt))),
  );

  const since = new Date(Date.now() - 25 * 3600 * 1000); // slightly over a day, covers tick jitter
  const freshDrafts = await withTenant(tenantId, (db) =>
    db
      .select({ actionType: domainActions.actionType })
      .from(domainActions)
      .where(and(eq(domainActions.tenantId, tenantId), eq(domainActions.status, "pending"), gte(domainActions.createdAt, since))),
  );
  const scanDraftTypes = new Set(["renew_maintenance_agreement", "bulk_notify_existing_customers"]);
  const freshScanDrafts = freshDrafts.filter((d) => scanDraftTypes.has(d.actionType));

  // Vertical workflow 6 (recurring "daily owner operating loop", docs/jarvis-90-
  // execution-blueprint.md §5): the same one-call-a-day digest now also carries the
  // Phase 6 read-models' operational signals a dealer actually asks about — cash
  // still owed, leads/quotes nobody's followed up on, and workflows stuck mid-flight.
  // Additive only: if none of these have anything to say either, the no-op stays a
  // true no-op — never a call placed just because these queries ran.
  const [debt, cash, sla] = await Promise.all([followUpDebt(tenantId), cashCollections(tenantId), slaBreaches(tenantId)]);
  const overdueUsd = cash.invoicesByStatus.find((s) => s.status === "overdue")?.totalUsd ?? 0;

  if (findings.length === 0 && freshScanDrafts.length === 0 && debt.length === 0 && overdueUsd === 0 && sla.stuckWorkflowRuns === 0) {
    return; // nothing to say, no call placed
  }

  const parts: string[] = [];
  if (freshScanDrafts.length > 0) {
    parts.push(
      `${freshScanDrafts.length} new item${freshScanDrafts.length === 1 ? "" : "s"} waiting in your approval queue from today's automatic scans.`,
    );
  }
  // Phase 12: a finding with draftedActionId already has its action counted in the
  // "waiting in your approval queue" line above (freshScanDrafts) — say so as a short
  // pointer instead of just reading the finding out cold, so it's clear the two are
  // the same item, not two separate things.
  for (const f of findings) {
    parts.push(f.draftedActionId ? `${f.summary} Already drafted for your approval.` : f.summary);
  }
  if (overdueUsd > 0) parts.push(`$${overdueUsd.toFixed(2)} is overdue across unpaid invoices.`);
  if (debt.length > 0) parts.push(`${debt.length} lead${debt.length === 1 ? "" : "s"} or quote${debt.length === 1 ? "" : "s"} haven't been followed up on in a while.`);
  if (sla.stuckWorkflowRuns > 0) parts.push(`${sla.stuckWorkflowRuns} in-progress workflow${sla.stuckWorkflowRuns === 1 ? "" : "s"} appear stuck and may need a look.`);
  const message = `Hi, this is Finnor with your daily update. ${parts.join(" ")}`;

  const { rows } = await getPool().query(`SELECT owner_phone FROM tenants WHERE id = $1`, [tenantId]);
  const ownerPhone = rows[0]?.owner_phone as string | null | undefined;

  if (ownerPhone && ownerPhone !== "PLACEHOLDER_NEEDS_REAL_VALUE") {
    const result = await placeVapiCall({
      customerNumber: ownerPhone,
      firstMessage: message,
      metadata: { tenantId, purpose: "owner_digest" },
      assistantId: VOICE_PERSONAS.main,
    });
    if (!result.ok) {
      // Don't dead-letter a daily digest over a transient call failure — the findings
      // stay undigested and roll into tomorrow's call instead of being lost.
      console.error(`[owner_digest] call failed for tenant ${tenantId}: ${result.error}`);
      return;
    }
  } else {
    // No phone configured — the findings are still real and still queryable (via
    // get_business_overview / a future insights view), just not spoken proactively.
    console.log(`[owner_digest] tenant ${tenantId} has no owner_phone set — findings recorded, not called out.`);
  }

  if (findings.length > 0) {
    await withTenant(tenantId, (db) =>
      db
        .update(scanFindings)
        .set({ digestedAt: new Date() })
        .where(and(eq(scanFindings.tenantId, tenantId), isNull(scanFindings.digestedAt))),
    );
  }
};
