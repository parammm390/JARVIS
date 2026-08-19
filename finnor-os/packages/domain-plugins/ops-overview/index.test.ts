import { describe, expect, it } from "vitest";
import { isCapabilityQuestion, isInventoryQuestion, opsOverviewPlugin, requestsSemanticBusinessContext } from "./index";

describe("ops-overview answer actions", () => {
  it("recognizes capability and inventory questions as answer requests", () => {
    expect(isCapabilityQuestion("What can you do for me?")).toBe(true);
    expect(isCapabilityQuestion("Hey, what all can you do?")).toBe(true);
    expect(isInventoryQuestion("How much inventory do we have on hand?")).toBe(true);
  });

  it("keeps semantic context opt-in for explicit memory/history requests", () => {
    expect(requestsSemanticBusinessContext("How many leads are on file right now?")).toBe(false);
    expect(requestsSemanticBusinessContext("What did we discuss about the iron filter last time?")).toBe(true);
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
      spokenSummary: expect.stringContaining("live business records"),
      displaySafe: { topic: "capabilities" },
    });
    expect(result.output).not.toHaveProperty("groundedOn");
  });
});
