import { describe, it, expect } from "vitest";
import { isReminderDue, ReminderPolicySchema, DEFAULT_INTERVALS } from "../../packages/domain-plugins/service-reminders/index";

const policy = ReminderPolicySchema.parse({});

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
