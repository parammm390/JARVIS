import { describe, it, expect } from "vitest";
import {
  isReminderDue,
  ReminderPolicySchema,
  DEFAULT_INTERVALS,
  serviceRemindersPlugin,
} from "../../packages/domain-plugins/service-reminders/index";
import type { DomainPolicy } from "@finnor/shared-types";

const policy = ReminderPolicySchema.parse({});

function fakePolicy(overrides: Record<string, unknown>): DomainPolicy {
  return {
    id: "policy-1",
    tenantId: "tenant-1",
    actionType: "check_reminder_due",
    policy: overrides,
    requiresConfirmation: false,
    confirmationTemplate: null,
  };
}

describe("check_reminder_due — real published intervals, conservative bound", () => {
  it("ships the standard defaults", () => {
    expect(policy.sediment_filter_months).toBe(DEFAULT_INTERVALS.sediment_filter_months);
  });
  it("sediment filter serviced 4 months ago is due (3-6 month interval, earliest bound)", () => {
    const past = new Date(Date.now() - 4 * 30.44 * 24 * 3600 * 1000).toISOString();
    expect(isReminderDue("sediment_filter", past, policy).due).toBe(true);
  });
  it("RO membrane serviced 1 year ago is not due (2-3 year interval)", () => {
    const past = new Date(Date.now() - 12 * 30.44 * 24 * 3600 * 1000).toISOString();
    const r = isReminderDue("ro_membrane", past, policy);
    expect(r.due).toBe(false);
    expect(r.dueAtMonths).toBe(24);
  });
});

describe("check_reminder_due — dealer policy override flows draft() -> execute()", () => {
  it("uses the dealer-configured interval, not the published default", async () => {
    const dealerPolicy = fakePolicy({ sediment_filter_months: "1-2" });
    const payload = {
      equipmentType: "sediment_filter",
      lastServicedAt: new Date(Date.now() - 1.5 * 30.44 * 24 * 3600 * 1000).toISOString(),
    };
    const draft = await serviceRemindersPlugin.draft("check_reminder_due", payload, dealerPolicy);
    const result = await serviceRemindersPlugin.execute(draft, undefined as never);
    // Default interval (3-6 months) would say NOT due yet at 1.5 months elapsed;
    // the dealer's override (1-2 months) must make it due instead.
    expect(result.output.dueAtMonths).toBe(1);
    expect(result.output.due).toBe(true);
  });
});
