import { describe, expect, it } from "vitest";
import { inactiveCustomerDays } from "../../packages/domain-plugins/ops-overview/index";
import {
  BulkNotifyPayloadSchema,
  composeCallOpening,
  experienceContext,
  relationshipContext,
  type ConsentedTarget,
} from "../../packages/domain-plugins/bulk-notify/index";
import { localDayRange, nextCallingWindow } from "../../packages/domain-plugins/shared/time";

const target: ConsentedTarget = {
  householdId: "household-daniel",
  label: "Daniel Beckham",
  phone: "+13195550142",
  dealerName: "Clear Water Iowa",
  dealerTimezone: "America/Chicago",
  equipmentSummary: "water softener",
  equipmentModel: "WS-900",
  installedAt: "2023-04-12T15:00:00.000Z",
  lastInteractionAt: "2025-12-10T17:30:00.000Z",
  daysInactive: 243,
  lastService: {
    type: "annual maintenance",
    completedAt: "2025-12-10T17:30:00.000Z",
    note: "Daniel said the water quality has been excellent after the resin replacement.",
  },
  lastCommunication: {
    channel: "call",
    direction: "inbound",
    at: "2025-12-10T17:30:00.000Z",
    note: "Very happy with the technician; asked about a future filter check.",
  },
};

describe("customer cohort and campaign contracts", () => {
  it("preserves an exact 90-day cohort instead of rounding to three months", () => {
    expect(inactiveCustomerDays("Find every customer who has not interacted with us for more than 90 days")).toBe(90);
    expect(BulkNotifyPayloadSchema.parse({ channel: "call", discountPercent: 15, minDaysInactive: 90 }).minDaysInactive).toBe(90);
  });

  it("keeps the call opening human while making exact relationship and experience facts available", () => {
    const opening = composeCallOpening(target);
    expect(opening).toContain("How have you been?");
    expect(opening).toContain("water softener");
    expect(opening).not.toContain("2023-04-12");
    expect(relationshipContext(target)).toContain("2023-04-12");
    expect(relationshipContext(target)).toContain("2025-12-10");
    expect(experienceContext(target)).toContain("water quality has been excellent");
  });

  it("builds dealer-local calendar ranges and skips weekend campaign starts", () => {
    const monday = new Date("2026-08-10T14:00:00.000Z"); // 09:00 in Chicago
    const range = localDayRange("2026-08-10", "America/Chicago");
    expect(range.start.toISOString()).toBe("2026-08-10T05:00:00.000Z");
    expect(range.end.toISOString()).toBe("2026-08-11T05:00:00.000Z");
    const fridayAfterHours = new Date("2026-08-07T23:30:00.000Z");
    const window = nextCallingWindow("America/Chicago", fridayAfterHours, 0);
    expect(window.localDate).toBe("2026-08-10");
    expect(nextCallingWindow("America/Chicago", fridayAfterHours, 1).localDate).toBe("2026-08-11");
    expect(nextCallingWindow("America/Chicago", monday, 1).localDate).toBe("2026-08-11");
  });
});
