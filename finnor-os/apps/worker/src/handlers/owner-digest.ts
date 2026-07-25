// owner_digest job: once daily, compiles undigested scan_findings (low inventory,
// service-due — the categories with no mutating action to gate into) plus a count of
// fresh scan-drafted actions now sitting in the confirmation queue (renewal, win-back
// — the categories that DO have one), into ONE real outbound call. Deliberately one
// call, not one per scan — four separate proactive calls a day would be the opposite
// of a smooth experience. Deterministic template text, no LLM call: this job runs on
// a timer regardless of whether there's anything to say, and a model call on every
// empty tick would be pure wasted spend against a fixed budget.

import { getPool, withTenant, scanFindings, domainActions, llmCalls, users } from "@finnor/db";
import { and, eq, gte, isNull, sql } from "drizzle-orm";
import { placeVapiCall, VOICE_PERSONAS, logWithTrace, isAllowlistedRecipient, sendResendEmail } from "@finnor/tools";
import { followUpDebt, cashCollections, intelligenceForecasts, routeSavingsBriefing, slaBreaches } from "@finnor/read-models";
import type { JobHandler } from "../queue";

function escapeHtml(value: string): string {
  return value.replace(/[&<>\"']/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;", "'": "&#39;" })[character]!);
}

function digestEmailHtml(parts: string[]): string {
  const items = parts.map((part) => `<li>${escapeHtml(part)}</li>`).join("");
  return `<main><h1>Your Finnor daily operating brief</h1><p>Here is what changed. Nothing has been approved or acted on without you.</p><ul>${items}</ul><p>Open JARVIS to review any pending approvals.</p></main>`;
}

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
  const [llmSpend] = await withTenant(tenantId, (db) => db.select({ spend: sql<number | null>`sum(${llmCalls.costUsd})`, calls: sql<number>`count(*)` }).from(llmCalls).where(and(eq(llmCalls.tenantId, tenantId), gte(llmCalls.createdAt, since))));

  // Vertical workflow 6 (recurring "daily owner operating loop", docs/jarvis-90-
  // execution-blueprint.md §5): the same one-call-a-day digest now also carries the
  // Phase 6 read-models' operational signals a dealer actually asks about — cash
  // still owed, leads/quotes nobody's followed up on, and workflows stuck mid-flight.
  // Additive only: if none of these have anything to say either, the no-op stays a
  // true no-op — never a call placed just because these queries ran.
  const [debt, cash, forecasts, routes, sla] = await Promise.all([followUpDebt(tenantId), cashCollections(tenantId), intelligenceForecasts(tenantId), routeSavingsBriefing(tenantId), slaBreaches(tenantId)]);
  const overdueUsd = cash.invoicesByStatus.find((s) => s.status === "overdue")?.totalUsd ?? 0;

  if (findings.length === 0 && freshScanDrafts.length === 0 && debt.length === 0 && overdueUsd === 0 && routes.proposals === 0 && sla.stuckWorkflowRuns === 0) {
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
  if (routes.proposals > 0) parts.push(`${routes.proposals} route suggestion${routes.proposals === 1 ? "" : "s"} compared ${routes.naiveKm.toFixed(1)} km of existing ordering with ${routes.optimizedKm.toFixed(1)} km optimized, saving ${routes.kmSaved.toFixed(1)} km.`);
  const cashDay14 = forecasts.cashCollections?.[13];
  const visitDay14 = forecasts.visitVolume?.[13];
  if (cashDay14 && visitDay14) parts.push(`The 14-day model estimates $${cashDay14.estimate.toFixed(2)} in collections and ${visitDay14.estimate.toFixed(1)} scheduled visits on day 14; its uncertainty bands are available in the intelligence forecast read model.`);
  if (sla.stuckWorkflowRuns > 0) parts.push(`${sla.stuckWorkflowRuns} in-progress workflow${sla.stuckWorkflowRuns === 1 ? "" : "s"} appear stuck and may need a look.`);
  if (llmSpend?.spend !== null && llmSpend?.spend !== undefined) parts.push(`Model usage today is $${Number(llmSpend.spend).toFixed(4)} across ${Number(llmSpend.calls)} calls.`);
  const message = `Hi, this is Finnor with your daily update. ${parts.join(" ")}`;

  // B8.T2: owners receive the same honest, query-backed operating brief by email.
  // The adapter remains the one enforcement point for recipient allowlisting, budget,
  // and provider circuit state. We pre-filter only to avoid spending a daily-budget
  // claim on a recipient the adapter would necessarily block, and log the omission
  // instead of pretending a personal address was delivered to.
  const owners = await withTenant(tenantId, (db) =>
    db.select({ email: users.email }).from(users).where(and(eq(users.tenantId, tenantId), eq(users.role, "owner"))),
  );
  const emailRecipients = owners.map((owner) => owner.email).filter(isAllowlistedRecipient);
  const skippedOwners = owners.length - emailRecipients.length;
  if (skippedOwners > 0) {
    logWithTrace({ traceId: payload._correlationId as string | undefined, tenantId }).warn(
      { skippedOwners }, "[owner_digest] owner email is outside the Resend pre-launch allowlist — not sent",
    );
  }
  for (const to of emailRecipients) {
    // This is deliberately awaited inside owner_digest: a transient provider failure
    // makes this existing daily job retry through JobQueue, and findings are not marked
    // digested until the real adapter accepts delivery.
    const result = await sendResendEmail({
      tenantId,
      to,
      subject: "Finnor daily operating brief",
      html: digestEmailHtml(parts),
    });
    if (!result.sent) {
      logWithTrace({ traceId: payload._correlationId as string | undefined, tenantId }).warn(
        { reason: result.reason }, "[owner_digest] email was blocked — findings remain available",
      );
      return;
    }
  }

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
      logWithTrace({ traceId: payload._correlationId as string | undefined, tenantId }).error({ err: result.error }, "[owner_digest] call failed");
      return;
    }
  } else {
    // No phone configured — the findings are still real and still queryable (via
    // get_business_overview / a future insights view), just not spoken proactively.
    logWithTrace({ traceId: payload._correlationId as string | undefined, tenantId }).info(
      "[owner_digest] no owner_phone set — findings recorded, not called out",
    );
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
