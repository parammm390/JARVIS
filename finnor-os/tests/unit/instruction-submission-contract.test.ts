import { describe, expect, it } from "vitest";
import { InstructionSubmissionResponseSchema } from "@finnor/policy-schema";

const common = {
  workId: "11111111-1111-4111-8111-111111111111",
  workInputId: "22222222-2222-4222-8222-222222222222",
  instructionId: "33333333-3333-4333-8333-333333333333",
  threadId: "44444444-4444-4444-8444-444444444444",
  assistantMessage: {
    id: "55555555-5555-4555-8555-555555555555",
    originalText: "Canonical response",
    createdAt: "2026-08-26T00:00:00.000Z",
    semanticKind: "ACKNOWLEDGEMENT" as const,
  },
};

describe("canonical instruction submission response", () => {
  it.each([
    { executionModel: "QUERY", actions: [], query: { request: {}, result: {} }, ...common, assistantMessage: { ...common.assistantMessage, semanticKind: "ANSWER" } },
    { executionModel: "CONVERSATION", actions: [], answer: { kind: "answer", spokenSummary: "Hello" }, ...common, assistantMessage: { ...common.assistantMessage, semanticKind: "ANSWER" } },
    { executionModel: "ATOMIC_ACTION", actions: [{ id: "action" }], ...common },
    { executionModel: "OBJECTIVE", actions: [], objectiveLoopId: "66666666-6666-4666-8666-666666666666", objectiveState: "continue", ...common },
    { executionModel: "CLARIFY", actions: [{ id: "clarification", actionType: "clarification_request" }], ...common, assistantMessage: { ...common.assistantMessage, semanticKind: "CLARIFICATION" } },
  ])("accepts the $executionModel branch", (value) => {
    expect(InstructionSubmissionResponseSchema.safeParse(value).success).toBe(true);
  });

  it("rejects an Objective without durable identity and a Conversation without an Answer", () => {
    expect(InstructionSubmissionResponseSchema.safeParse({ executionModel: "OBJECTIVE", actions: [], objectiveState: "continue", ...common }).success).toBe(false);
    expect(InstructionSubmissionResponseSchema.safeParse({ executionModel: "CONVERSATION", actions: [], ...common }).success).toBe(false);
    expect(InstructionSubmissionResponseSchema.safeParse({ executionModel: "CLARIFY", actions: [], ...common }).success).toBe(false);
  });
});
