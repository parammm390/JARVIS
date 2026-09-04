import { describe, expect, it } from "vitest";
import type { DomainAction } from "@finnor/shared-types";
import { classifyInstructionRoute, compileDeterministicAtomicAction, finalizeInstructionRoute } from "@finnor/orchestration";

const planner = { route: "planner", reason: "mutation_or_advice" } as const;
const query = {
  route: "fast_read",
  confidence: "high",
  request: { intent: "money_summary" },
} as const;

function action(overrides: Partial<DomainAction> = {}): DomainAction {
  return {
    id: "00000000-0000-4000-8000-000000000011",
    tenantId: "00000000-0000-4000-8000-000000000012",
    actionType: "send_follow_up",
    payload: { householdId: "00000000-0000-4000-8000-000000000013" },
    policyId: null,
    status: "draft",
    createdAt: new Date(0).toISOString(),
    compiledGraph: { kind: "single_action", commandType: "send_follow_up", requiresConfirmation: true, autoApprove: false },
    ...overrides,
  };
}

describe("objective-first instruction-routing policy", () => {
  it("preserves deterministic Operational Query Plane reads", () => {
    expect(classifyInstructionRoute({ instruction: "How much is overdue?", fastReadDecision: query })).toMatchObject({
      route: "QUERY",
      reasonCodes: ["deterministic_canonical_read"],
    });
  });

  it("keeps an unsupported non-business question off the heavy objective planner", () => {
    expect(classifyInstructionRoute({ instruction: "What time is it?", fastReadDecision: { route: "planner", reason: "unsupported" } })).toMatchObject({
      route: "CONVERSATION",
      reasonCodes: ["lightweight_informational_question"],
    });
  });

  it("keeps an unsupported business question out of generic conversation", () => {
    expect(classifyInstructionRoute({
      instruction: "Tell me about technician availability",
      fastReadDecision: { route: "planner", reason: "unsupported" },
    }).route).toBe("OBJECTIVE");
  });

  it("reserves the atomic route for an exact one-effect candidate", () => {
    const preliminary = classifyInstructionRoute({
      instruction: "Send this exact message to casey@example.test",
      fastReadDecision: planner,
    });
    expect(preliminary.route).toBe("ATOMIC_ACTION");
    expect(finalizeInstructionRoute(preliminary, [action({ actionType: "send_customer_message" })])).toMatchObject({
      route: "ATOMIC_ACTION",
      reasonCodes: ["strict_single_action_candidate", "one_independent_effect_set"],
    });
  });

  it("compiles direct email wording deterministically instead of sampling an empty plan", () => {
    const candidate = compileDeterministicAtomicAction("Send this exact certification message to certification@example.invalid: Product Truth atomic email 3-abc");
    expect(candidate).toEqual({
      action_type: "send_customer_message",
      payload: {
        email: "certification@example.invalid",
        channel: "email",
        message: "Product Truth atomic email 3-abc",
      },
    });
  });

  it("compiles the bounded CRM marker wording as one internal interaction", () => {
    const candidate = compileDeterministicAtomicAction("Update the CRM record for certification@example.invalid with marker 4-abc");
    expect(candidate).toEqual({
      action_type: "log_interaction",
      payload: {
        email: "certification@example.invalid",
        channel: "email",
        direction: "outbound",
        content: "with marker 4-abc",
      },
    });
  });

  it("does not compile a continuation or a multi-target instruction", () => {
    expect(compileDeterministicAtomicAction("Send this exact message to one@example.invalid and then call +15550101010")).toBeNull();
    expect(compileDeterministicAtomicAction("Send this exact message to one@example.invalid and two@example.invalid")).toBeNull();
  });

  it("routes a consequential resolver ambiguity only to CLARIFY", () => {
    expect(classifyInstructionRoute({
      instruction: "Email Alex the invoice",
      fastReadDecision: planner,
      clarificationRequired: true,
    })).toMatchObject({ route: "CLARIFY", reasonCodes: ["consequential_target_or_sender_unresolved"] });
    expect(finalizeInstructionRoute(
      classifyInstructionRoute({ instruction: "Email Alex the invoice", fastReadDecision: planner }),
      [action({ actionType: "clarification_request", payload: { question: "Which Alex?", missingFields: ["target"] } })],
    ).route).toBe("CLARIFY");
  });

  it.each([
    "Resolve Peterson's installation and keep going until it is operational",
    "Message the vendor, wait for their reply, then reschedule the visit",
    "Delegate this to Mario and finish after he confirms completion",
    "Use the browser and then update the canonical customer record",
  ])("defaults meaningful continuation work to Objective: %s", (instruction) => {
    expect(classifyInstructionRoute({ instruction, fastReadDecision: planner }).route).toBe("OBJECTIVE");
  });

  it("rejects a nominally atomic instruction when the typed plan reveals a workflow or dependency", () => {
    const preliminary = classifyInstructionRoute({ instruction: "Send this exact message to +15550101010", fastReadDecision: planner });
    expect(finalizeInstructionRoute(preliminary, [action({ compiledGraph: { kind: "workflow", commandType: "send_follow_up", requiresConfirmation: true, autoApprove: false } })]).route).toBe("OBJECTIVE");
    expect(finalizeInstructionRoute(preliminary, [action(), action({ id: "00000000-0000-4000-8000-000000000014" })]).route).toBe("OBJECTIVE");
  });

  it("fails closed when an atomic candidate has no typed actions", () => {
    const preliminary = classifyInstructionRoute({ instruction: "Email this exact message to +15550101010", fastReadDecision: planner });
    expect(() => finalizeInstructionRoute(preliminary, [])).not.toThrow();
    expect(finalizeInstructionRoute(preliminary, []).route).toBe("OBJECTIVE");
  });
});
