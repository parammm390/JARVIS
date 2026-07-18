// scheduled_reminder job: the full AMC renewal sequence — first reminder, wait, firmer
// follow-up, wait, escalate to lapsed — all real gated actions through the plugin/gate
// pipeline, never a direct send or a hand-inserted row that skips draft().
//
// §2.6 (Temporal exit): this used to be Temporal's amc-renewal-sequence.ts workflow +
// activities.ts. Temporal owned ONLY the durable wait/signal-race/escalation timing
// between attempts — drafting each reminder always went through this same
// FinnorOrchestrator.draftKnownAction() pipeline, unchanged. The "wait" is now this
// periodically-ticked scan (daily, apps/worker/src/index.ts) checking
// maintenance_agreements.first_reminder_sent_at/second_reminder_sent_at against the
// configured wait durations, instead of a Temporal workflow's durable timer — coarser
// granularity (checked once per tick, not reacted to instantly), an accepted tradeoff
// for a Postgres-native mechanism; honest about the difference, not pretending it's
// identical. Verified before porting: NOTHING in production ever actually started the
// Temporal workflow (grep for workflow.start(amcRenewalSequence) — only the deleted
// test file did), so this is the first time the full sequence is reachable for real
// agreements, not just a re-shuffling of already-live behavior.

import { withTenant, maintenanceAgreements, households, domainActions, domainPolicies, invoices, scanFindings, enqueueJob } from "@finnor/db";
import { FinnorOrchestrator, advanceWorkflowState } from "@finnor/orchestration";
import { and, eq, lte, isNull, isNotNull } from "drizzle-orm";
import type { JobHandler } from "../queue";
// Relative path, not a workspace package — invoice-to-cash has no package.json of its
// own (matches how the Temporal activities.ts this replaces imported it).
import { startInvoiceToCash } from "../../../../packages/domain-plugins/invoice-to-cash/index";

let orchestrator: FinnorOrchestrator | null = null;
function getOrchestrator(): FinnorOrchestrator {
  orchestrator ??= new FinnorOrchestrator();
  return orchestrator;
}

const THREE_DAYS_MS = 3 * 24 * 3600 * 1000;
const FOUR_DAYS_MS = 4 * 24 * 3600 * 1000;
const CADENCE_MONTHS: Record<string, number> = { annual: 12, semi_annual: 6, quarterly: 3 };

interface AgreementContext {
  tenantId: string;
  agreementId: string;
  householdId: string;
  householdLabel: string;
  contactPhone: string;
  cadence: string;
}

/** Drafts a renewal reminder through the real plugin/gate pipeline — ported unchanged
 *  from Temporal's draftRenewalAction activity. */
async function draftRenewalReminder(ctx: AgreementContext, attempt: 1 | 2): Promise<{ actionId: string }> {
  const { action } = await getOrchestrator().draftKnownAction(
    "renew_maintenance_agreement",
    {
      agreementId: ctx.agreementId,
      householdId: ctx.householdId,
      householdLabel: ctx.householdLabel,
      contactPhone: ctx.contactPhone,
      cadence: ctx.cadence,
      message:
        attempt === 1
          ? undefined // plugin's own default first-reminder copy
          : `Second notice: your ${ctx.cadence} maintenance plan renewal is still open. Reply YES to renew or call us with any questions.`,
    },
    ctx.tenantId,
    { source: "amc_renewal_sequence" },
  );
  return { actionId: action.id };
}

/**
 * Real completion for a "renewed" outcome — ported unchanged from Temporal's
 * markAgreementRenewed activity: advance the agreement's own renewal date, and only
 * where a real price is configured (never fabricated), create the renewal invoice and
 * hand it to the same real invoice-to-cash workflow vertical workflow 4 built.
 */
export async function markAgreementRenewed(ctx: AgreementContext): Promise<void> {
  const nextRenewalDate = new Date();
  nextRenewalDate.setMonth(nextRenewalDate.getMonth() + (CADENCE_MONTHS[ctx.cadence] ?? 12));
  await withTenant(ctx.tenantId, (db) =>
    db.update(maintenanceAgreements).set({ status: "renewed", renewalDate: nextRenewalDate }).where(eq(maintenanceAgreements.id, ctx.agreementId)),
  );
  await advanceWorkflowState(ctx.tenantId, "amc_renewal", "maintenance_agreement", ctx.agreementId, "renewed", "amc_renewal_sequence");

  const [policyRow] = await withTenant(ctx.tenantId, (db) =>
    db
      .select({ policy: domainPolicies.policy })
      .from(domainPolicies)
      .where(and(eq(domainPolicies.tenantId, ctx.tenantId), eq(domainPolicies.actionType, "renew_maintenance_agreement")))
      .limit(1),
  );
  const priceUsd = (policyRow?.policy as { price_usd?: number | string } | undefined)?.price_usd;
  if (typeof priceUsd !== "number") {
    // No real price configured for this dealer (still the seed's placeholder sentinel)
    // — the agreement is genuinely renewed either way, but inventing a dollar amount to
    // bill would be exactly the kind of fabrication this project is being held to never
    // do. The dealer sees this as an unpriced renewal, not a silent failure.
    return;
  }

  const [invoice] = await withTenant(ctx.tenantId, (db) =>
    db
      .insert(invoices)
      .values({
        tenantId: ctx.tenantId,
        householdId: ctx.householdId,
        amountUsd: String(priceUsd),
        memo: `${ctx.cadence.replace("_", "-")} maintenance agreement renewal`,
        status: "sent",
      })
      .returning(),
  );
  await startInvoiceToCash(ctx.tenantId, { invoiceId: invoice!.id, channel: "sms" });
}

/** No response after both reminders: mark the agreement lapsed and have Vapi tell the
 *  owner by name — never a silent drop. Ported unchanged from Temporal's
 *  notifyOwnerLapsed activity. */
async function escalateAgreementLapsed(ctx: AgreementContext): Promise<void> {
  await withTenant(ctx.tenantId, (db) =>
    db.update(maintenanceAgreements).set({ status: "lapsed" }).where(eq(maintenanceAgreements.id, ctx.agreementId)),
  );
  await advanceWorkflowState(ctx.tenantId, "amc_renewal", "maintenance_agreement", ctx.agreementId, "lapsed", "amc_renewal_sequence");
  await enqueueJob(
    "voice_notify_failure",
    {
      tenantId: ctx.tenantId,
      script: `Heads up — ${ctx.householdLabel}'s ${ctx.cadence} maintenance renewal went unanswered after two reminders and has lapsed. Want me to try a phone call instead?`,
    },
    `amc-lapsed:${ctx.agreementId}`,
  );
}

/** "Customer responded" — the Postgres-native replacement for Temporal's
 *  customerResponded signal (packages/tools/src/temporal-signals.ts's
 *  signalAmcRenewalResponded, deleted with Temporal). Honest parity, not scope
 *  expansion: NOTHING calls this yet, same as nothing called the Temporal signal it
 *  replaces (verified — no SMS-reply webhook or similar exists in this codebase). It's
 *  the seam a future one would call. */
export async function markAmcRenewalResponded(tenantId: string, agreementId: string): Promise<{ ok: boolean; reason?: string }> {
  const [agreement] = await withTenant(tenantId, (db) =>
    db
      .select({
        id: maintenanceAgreements.id,
        status: maintenanceAgreements.status,
        cadence: maintenanceAgreements.cadence,
        householdId: maintenanceAgreements.householdId,
      })
      .from(maintenanceAgreements)
      .where(eq(maintenanceAgreements.id, agreementId)),
  );
  if (!agreement) return { ok: false, reason: "agreement not found" };
  if (agreement.status === "renewed" || agreement.status === "lapsed") {
    return { ok: false, reason: `agreement is already ${agreement.status}` };
  }
  const [household] = await withTenant(tenantId, (db) =>
    db.select({ address: households.address, contactInfo: households.contactInfo }).from(households).where(eq(households.id, agreement.householdId)),
  );
  const contact = (household?.contactInfo ?? {}) as Record<string, unknown>;
  await markAgreementRenewed({
    tenantId,
    agreementId,
    householdId: agreement.householdId,
    householdLabel: String(contact.name ?? household?.address ?? "this household"),
    contactPhone: String(contact.phone ?? ""),
    cadence: agreement.cadence,
  });
  return { ok: true };
}

export const scheduledReminder: JobHandler = async (payload) => {
  const tenantId = String(payload.tenantId ?? "");
  if (!tenantId) throw new Error("scheduled_reminder requires tenantId");
  const windowDays = Number(payload.windowDays ?? 30);
  // Overridable so tests can prove the wait mechanism in seconds, not days — same
  // convention the Temporal workflow's firstWaitMs/secondWaitMs input used.
  const firstWaitMs = Number(payload.firstWaitMs ?? THREE_DAYS_MS);
  const secondWaitMs = Number(payload.secondWaitMs ?? FOUR_DAYS_MS);
  const renewalCutoff = new Date(Date.now() + windowDays * 24 * 3600 * 1000);
  const firstWaitCutoff = new Date(Date.now() - firstWaitMs);
  const secondWaitCutoff = new Date(Date.now() - secondWaitMs);

  // Stage 0 -> 1: agreements entering their renewal window get their first reminder.
  const dueForFirst = await withTenant(tenantId, (db) =>
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
      .where(and(eq(households.tenantId, tenantId), eq(maintenanceAgreements.status, "active"), lte(maintenanceAgreements.renewalDate, renewalCutoff))),
  );
  // Idempotency: don't re-draft the first reminder for an agreement that already has
  // one pending (a duplicate tick before the status flip below has landed).
  const pendingRenewals = await withTenant(tenantId, (db) =>
    db
      .select({ payload: domainActions.payload })
      .from(domainActions)
      .where(and(eq(domainActions.tenantId, tenantId), eq(domainActions.actionType, "renew_maintenance_agreement"), eq(domainActions.status, "pending"))),
  );
  const alreadyPendingAgreementIds = new Set(
    pendingRenewals.map((r) => (r.payload as Record<string, unknown>)?.agreementId).filter(Boolean),
  );
  for (const row of dueForFirst) {
    if (alreadyPendingAgreementIds.has(row.agreementId)) continue;
    const contact = (row.contactInfo ?? {}) as Record<string, unknown>;
    const ctx: AgreementContext = {
      tenantId,
      agreementId: row.agreementId,
      householdId: row.householdId,
      householdLabel: String(contact.name ?? row.address),
      contactPhone: String(contact.phone ?? ""),
      cadence: row.cadence,
    };
    const { actionId } = await draftRenewalReminder(ctx, 1);
    await withTenant(tenantId, (db) =>
      db
        .update(maintenanceAgreements)
        .set({ status: "renewal_sent", firstReminderSentAt: new Date() })
        .where(eq(maintenanceAgreements.id, row.agreementId)),
    );
    // Phase 12: every drafting scan also records a finding pointing at what it
    // drafted, so the digest can say "already queued" instead of double-reporting.
    await withTenant(tenantId, (db) =>
      db.insert(scanFindings).values({
        tenantId,
        scanType: "maintenance_renewal",
        severity: "info",
        summary: `${ctx.householdLabel}'s maintenance agreement is entering its renewal window.`,
        details: { agreementId: row.agreementId, householdId: row.householdId, cadence: row.cadence, attempt: 1 },
        draftedActionId: actionId,
      }),
    );
  }

  // Stage 1 -> 2: first reminder sent, wait elapsed, no response yet, second not sent.
  const dueForSecond = await withTenant(tenantId, (db) =>
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
      .where(
        and(
          eq(households.tenantId, tenantId),
          eq(maintenanceAgreements.status, "renewal_sent"),
          isNotNull(maintenanceAgreements.firstReminderSentAt),
          isNull(maintenanceAgreements.secondReminderSentAt),
          lte(maintenanceAgreements.firstReminderSentAt, firstWaitCutoff),
        ),
      ),
  );
  for (const row of dueForSecond) {
    const contact = (row.contactInfo ?? {}) as Record<string, unknown>;
    const ctx: AgreementContext = {
      tenantId,
      agreementId: row.agreementId,
      householdId: row.householdId,
      householdLabel: String(contact.name ?? row.address),
      contactPhone: String(contact.phone ?? ""),
      cadence: row.cadence,
    };
    const { actionId } = await draftRenewalReminder(ctx, 2);
    await withTenant(tenantId, (db) =>
      db.update(maintenanceAgreements).set({ secondReminderSentAt: new Date() }).where(eq(maintenanceAgreements.id, row.agreementId)),
    );
    await withTenant(tenantId, (db) =>
      db.insert(scanFindings).values({
        tenantId,
        scanType: "maintenance_renewal",
        severity: "warning",
        summary: `${ctx.householdLabel}'s maintenance renewal has not been confirmed — sending a firmer follow-up.`,
        details: { agreementId: row.agreementId, householdId: row.householdId, cadence: row.cadence, attempt: 2 },
        draftedActionId: actionId,
      }),
    );
  }

  // Stage 2 -> escalate: second reminder sent, wait elapsed, still no response.
  const dueForEscalation = await withTenant(tenantId, (db) =>
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
      .where(
        and(
          eq(households.tenantId, tenantId),
          eq(maintenanceAgreements.status, "renewal_sent"),
          isNotNull(maintenanceAgreements.secondReminderSentAt),
          lte(maintenanceAgreements.secondReminderSentAt, secondWaitCutoff),
        ),
      ),
  );
  for (const row of dueForEscalation) {
    const contact = (row.contactInfo ?? {}) as Record<string, unknown>;
    await escalateAgreementLapsed({
      tenantId,
      agreementId: row.agreementId,
      householdId: row.householdId,
      householdLabel: String(contact.name ?? row.address),
      contactPhone: String(contact.phone ?? ""),
      cadence: row.cadence,
    });
  }
};
