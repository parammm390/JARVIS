// AMC renewal sequence — the Temporal proof slice (Part 2 of the engine-upgrade plan).
// Genuinely greenfield: nothing in the codebase previously advanced a maintenance
// agreement past "renewal_sent" (see packages/domain-plugins/shared/workflow.ts's
// amc_renewal state machine) — reminder -> durable wait -> firmer follow-up -> durable
// wait -> escalate to the owner. Temporal owns ONLY the waiting/escalating between
// attempts; drafting each reminder goes through the real, unchanged
// FinnorOrchestrator.draftKnownAction() pipeline (plan -> gate -> voice-confirm), the
// exact same primitive apps/worker's scheduled_reminder handler already uses.
//
// Wait durations are inputs, not hardcoded literals, specifically so tests can prove
// the signal-races-timer mechanism in seconds instead of actually waiting days.

import { proxyActivities, defineSignal, setHandler, condition } from "@temporalio/workflow";
import type * as activities from "../activities";

const { draftRenewalAction, notifyOwnerLapsed, markAgreementRenewed } = proxyActivities<typeof activities>({
  startToCloseTimeout: "2 minutes",
  retry: { maximumAttempts: 5, initialInterval: "30 seconds", backoffCoefficient: 2 },
});

export interface AmcRenewalInput {
  tenantId: string;
  agreementId: string;
  householdId: string;
  householdLabel: string;
  contactPhone: string;
  cadence: string;
  /** Defaults to 3 days in production; tests override with a few seconds. */
  firstWaitMs?: number;
  /** Defaults to 4 days in production; tests override with a few seconds. */
  secondWaitMs?: number;
}

export const customerRespondedSignal = defineSignal<[]>("customerResponded");

const THREE_DAYS_MS = 3 * 24 * 3600 * 1000;
const FOUR_DAYS_MS = 4 * 24 * 3600 * 1000;

export async function amcRenewalSequence(input: AmcRenewalInput): Promise<{ outcome: "renewed" | "lapsed" }> {
  let responded = false;
  setHandler(customerRespondedSignal, () => {
    responded = true;
  });

  await draftRenewalAction(input, 1); // day 0: first reminder
  if (await condition(() => responded, input.firstWaitMs ?? THREE_DAYS_MS)) {
    await markAgreementRenewed(input);
    return { outcome: "renewed" };
  }

  await draftRenewalAction(input, 2); // day 3: firmer follow-up
  if (await condition(() => responded, input.secondWaitMs ?? FOUR_DAYS_MS)) {
    await markAgreementRenewed(input);
    return { outcome: "renewed" };
  }

  await notifyOwnerLapsed(input); // day 7: mark lapsed, tell the owner
  return { outcome: "lapsed" };
}
