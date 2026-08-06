import { beforeEach, describe, expect, it, vi } from "vitest";

const sandboxMocks = vi.hoisted(() => ({
  upsertHouseholdByPhone: vi.fn(),
  recordOutbound: vi.fn(),
  resolveSmsDestination: vi.fn(),
  bookServiceVisit: vi.fn(),
}));

vi.mock("../../packages/tools/src/sandbox", () => sandboxMocks);

import {
  sendMessageNativeBinding,
  type SendMessageInput,
} from "../../packages/tools/src/capabilities/crm";

const INPUT: SendMessageInput = {
  tenantId: "00000000-0000-4000-8000-000000000001",
  contactId: "11111111-1111-4111-8111-111111111111",
  message: "Your appointment is confirmed.",
  idempotencyKey: "sms-test-1",
};

describe("native CRM SMS contract", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    sandboxMocks.resolveSmsDestination.mockResolvedValue({
      householdId: "22222222-2222-4222-8222-222222222222",
      phoneNumber: "+15555550100",
    });
    sandboxMocks.recordOutbound.mockResolvedValue(undefined);
  });

  it("records the resolved phone, never the contact UUID", async () => {
    await sendMessageNativeBinding.call(INPUT);

    expect(sandboxMocks.resolveSmsDestination).toHaveBeenCalledWith(INPUT.tenantId, INPUT.contactId);
    expect(sandboxMocks.recordOutbound).toHaveBeenCalledWith(
      INPUT.tenantId,
      "22222222-2222-4222-8222-222222222222",
      "sms",
      "+15555550100",
      INPUT.message,
    );
    expect(sandboxMocks.recordOutbound).not.toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      "sms",
      INPUT.contactId,
      expect.anything(),
    );
  });

});
