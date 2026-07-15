// Temporal Activities for the AMC renewal sequence — thin wrappers around the
// existing, unchanged FinnorOrchestrator/@finnor/db primitives. Temporal owns
// durability (retries, durable waits); these functions own nothing but a single call
// each into code that already exists and is already tested.

import { FinnorOrchestrator, advanceWorkflowState } from "@finnor/orchestration";
import { withTenant, maintenanceAgreements, invoices, domainPolicies, enqueueJob } from "@finnor/db";
import { and, eq } from "drizzle-orm";
import { startInvoiceToCash } from "../../../packages/domain-plugins/invoice-to-cash/index";
import type { AmcRenewalInput } from "./workflows/amc-renewal-sequence";

const CADENCE_MONTHS: Record<string, number> = { annual: 12, semi_annual: 6, quarterly: 3 };

let orchestrator: FinnorOrchestrator | null = null;
function getOrchestrator(): FinnorOrchestrator {
  orchestrator ??= new FinnorOrchestrator();
  return orchestrator;
}

/** Drafts a renewal reminder through the real plugin/gate pipeline — same primitive
 *  apps/worker's scheduled_reminder handler uses for the initial (non-sequenced) case. */
export async function draftRenewalAction(input: AmcRenewalInput, attempt: number): Promise<void> {
  await getOrchestrator().draftKnownAction(
    "renew_maintenance_agreement",
    {
      agreementId: input.agreementId,
      householdId: input.householdId,
      householdLabel: input.householdLabel,
      contactPhone: input.contactPhone,
      cadence: input.cadence,
      message:
        attempt === 1
          ? undefined // plugin's own default first-reminder copy
          : `Second notice: your ${input.cadence} maintenance plan renewal is still open. Reply YES to renew or call us with any questions.`,
    },
    input.tenantId,
    { source: "amc_renewal_sequence" },
  );
}

/**
 * Vertical workflow 5 (recurring revenue, docs/jarvis-90-execution-blueprint.md §5):
 * closes the gap the Temporal sequence previously left open — a "renewed" outcome was
 * only ever a string returned to the workflow caller, with nothing durable recorded
 * (unlike the "lapsed" branch, which does update the row and notify the owner). This
 * activity is the real completion: advance the agreement's own renewal date, and only
 * where a real price is configured (never fabricated), create the renewal invoice and
 * hand it to the same real invoice-to-cash workflow vertical workflow 4 built.
 */
export async function markAgreementRenewed(input: AmcRenewalInput): Promise<void> {
  const nextRenewalDate = new Date();
  nextRenewalDate.setMonth(nextRenewalDate.getMonth() + (CADENCE_MONTHS[input.cadence] ?? 12));
  await withTenant(input.tenantId, (db) =>
    db
      .update(maintenanceAgreements)
      .set({ status: "renewed", renewalDate: nextRenewalDate })
      .where(eq(maintenanceAgreements.id, input.agreementId)),
  );
  await advanceWorkflowState(input.tenantId, "amc_renewal", "maintenance_agreement", input.agreementId, "renewed", "amc_renewal_sequence");

  const [policyRow] = await withTenant(input.tenantId, (db) =>
    db
      .select({ policy: domainPolicies.policy })
      .from(domainPolicies)
      .where(and(eq(domainPolicies.tenantId, input.tenantId), eq(domainPolicies.actionType, "renew_maintenance_agreement")))
      .limit(1),
  );
  const priceUsd = (policyRow?.policy as { price_usd?: number | string } | undefined)?.price_usd;
  if (typeof priceUsd !== "number") {
    // No real price configured for this dealer (still the seed's placeholder sentinel)
    // — the agreement is genuinely renewed either way, but inventing a dollar amount
    // to bill would be exactly the kind of fabrication this project is being held to
    // never do. The dealer sees this as an unpriced renewal, not a silent failure.
    return;
  }

  const [invoice] = await withTenant(input.tenantId, (db) =>
    db
      .insert(invoices)
      .values({
        tenantId: input.tenantId,
        householdId: input.householdId,
        amountUsd: String(priceUsd),
        memo: `${input.cadence.replace("_", "-")} maintenance agreement renewal`,
        status: "sent",
      })
      .returning(),
  );
  await startInvoiceToCash(input.tenantId, { invoiceId: invoice!.id, channel: "sms" });
}

/** Day 7, no response: mark the agreement lapsed and have Vapi tell the owner by name — never a silent drop. */
export async function notifyOwnerLapsed(input: AmcRenewalInput): Promise<void> {
  await withTenant(input.tenantId, (db) =>
    db.update(maintenanceAgreements).set({ status: "lapsed" }).where(eq(maintenanceAgreements.id, input.agreementId)),
  );
  await advanceWorkflowState(input.tenantId, "amc_renewal", "maintenance_agreement", input.agreementId, "lapsed", "amc_renewal_sequence");
  await enqueueJob(
    "voice_notify_failure",
    {
      tenantId: input.tenantId,
      script: `Heads up — ${input.householdLabel}'s ${input.cadence} maintenance renewal went unanswered after two reminders and has lapsed. Want me to try a phone call instead?`,
    },
    `amc-lapsed:${input.agreementId}`,
  );
}
