import { describe, expect, it } from "vitest";
import { createInstructionTraceResultEnvelope, isReadOnlyAnswerAction } from "./instruction-trace";

describe("instruction trace answer envelope", () => {
  it("keeps the grounded payload out of the browser result", () => {
    const envelope = createInstructionTraceResultEnvelope("action-1", {
      spokenSummary: "Inventory count is 4; call 555-010-1234 for help.",
      displaySafe: {
        inventory: { totalItems: 1, items: [{ sku: "FILTER-1", quantity: 4 }] },
        groundedOn: { secret: "raw memory" },
        semanticSnippets: ["private transcript"],
      },
      groundedOn: { business_overview: { secret: "raw memory" } },
    });

    expect(envelope).toEqual({
      actionId: "action-1",
      result: {
        kind: "answer",
        spokenSummary: "Inventory count is 4; call [PHONE_1] for help.",
        display: { inventory: { totalItems: 1, items: [{ sku: "FILTER-1", quantity: 4 }] } },
      },
    });
    expect(JSON.stringify(envelope)).not.toContain("raw memory");
    expect(JSON.stringify(envelope)).not.toContain("private transcript");
  });

  it("still produces an answer-shaped summary for a read-only inventory result without one", () => {
    const envelope = createInstructionTraceResultEnvelope("inventory-action", {
      items: [{ sku: "FILTER-1", quantity: 4 }],
      groundedOn: { inventory_snapshot: [{ sku: "FILTER-1", quantity: 4 }] },
    });

    expect(envelope).toMatchObject({
      actionId: "inventory-action",
      result: { kind: "answer", spokenSummary: "I found 1 inventory item." },
    });
    expect((envelope.result as Record<string, unknown>).groundedOn).toBeUndefined();
  });

  it("never classifies a confirmation-gated answer action as browser-answer eligible", () => {
    expect(isReadOnlyAnswerAction("answer_customer_question", { answered: true }, true)).toBe(false);
    expect(isReadOnlyAnswerAction("answer_customer_question", { answered: true }, false)).toBe(true);
  });
});
