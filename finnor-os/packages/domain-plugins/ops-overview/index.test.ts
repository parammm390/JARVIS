import { describe, expect, it } from "vitest";
import { isCapabilityQuestion, isInventoryQuestion, opsOverviewPlugin } from "./index";

describe("ops-overview answer actions", () => {
  it("recognizes capability and inventory questions as answer requests", () => {
    expect(isCapabilityQuestion("What can you do for me?")).toBe(true);
    expect(isInventoryQuestion("How much inventory do we have on hand?")).toBe(true);
  });

  it("answers a capability question as an ungated, grounded answer result", async () => {
    const policy = {
      id: "policy-1",
      tenantId: "tenant-1",
      actionType: "answer_business_question",
      policy: {},
      requiresConfirmation: true,
      confirmationTemplate: null,
      version: 1,
    } as const;
    const draft = await opsOverviewPlugin.draft("answer_business_question", { question: "What can you do?" }, policy);
    const result = await opsOverviewPlugin.execute(draft, undefined as never);

    expect(draft.requiresConfirmation).toBe(false);
    expect(result).toMatchObject({ status: "success", expected: { answered: true } });
    expect(result.output).toMatchObject({
      spokenSummary: expect.stringContaining("live business overview"),
      displaySafe: { topic: "capabilities" },
    });
    expect(result.output).not.toHaveProperty("groundedOn");
  });
});
