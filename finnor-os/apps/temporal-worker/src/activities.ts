// Temporal Activities for the AMC renewal sequence — thin wrappers around the
// existing, unchanged FinnorOrchestrator/@finnor/db primitives. Temporal owns
// durability (retries, durable waits); these functions own nothing but a single call
// each into code that already exists and is already tested.

import { FinnorOrchestrator, advanceWorkflowState } from "@finnor/orchestration";
import { withTenant, maintenanceAgreements, enqueueJob } from "@finnor/db";
import { eq } from "drizzle-orm";
import type { AmcRenewalInput } from "./workflows/amc-renewal-sequence";

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
