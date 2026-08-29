import { describe, expect, it } from "vitest";
import { OPERATIONAL_QUERY_INTENTS, type DomainAction } from "@finnor/shared-types";
import {
  assertCompiledHumanOperation,
  compileHumanInstructionRoute,
  compileTypedHumanOperation,
  createDefaultPluginRegistry,
  createUserCapabilityRegistry,
  interactionAwareOperationalDecision,
  interpretOperationalQuery,
} from "@finnor/orchestration";

const queryCorpus: Array<[string, string]> = [
  ["Find the customer record for Alice Johnson", "customer_lookup"],
  ["Find every customer inactive for more than 90 days", "customer_cohort"],
  ["Show the schedule next Friday", "schedule_range"],
  ["How much cash have we collected?", "money_summary"],
  ["What work is open right now?", "work_list"],
  ["Which inventory items are low?", "inventory_status"],
  ["Show agent activity for today", "agent_activity"],
  ["What is the current business state?", "business_state"],
  ["Show the complete customer history for Alice Johnson", "company_context"],
  ["Who is my manager?", "party_lookup"],
  ["Show me the full context for our membrane supplier", "party_context"],
  ["Who is on the installation team?", "team_roster"],
  ["When is Mario Singh available next Friday?", "party_availability"],
];

const heldOutFounderQueries: Array<[string, string]> = [
  ["Pull up John Thompson’s customer account.", "customer_lookup"],
  ["Which clients have been quiet for at least 120 days?", "customer_cohort"],
  ["What appointments are on the calendar next Friday?", "schedule_range"],
  ["How much revenue landed this month?", "money_summary"],
  ["Show anything waiting for approval.", "work_list"],
  ["Which cartridges are below the reorder point?", "inventory_status"],
  ["What have the AI agents done today?", "agent_activity"],
  ["Give me an operating snapshot.", "business_state"],
  ["What do we know about John Thompson across the company?", "company_context"],
  ["Who works in Field Service?", "team_roster"],
];

function action(actionType: string, payload: Record<string, unknown>, groundedPayload: DomainAction["groundedPayload"] = []): DomainAction {
  return {
    id: "11111111-1111-4111-8111-111111111111",
    tenantId: "22222222-2222-4222-8222-222222222222",
    actionType,
    payload,
    policyId: null,
    status: "draft",
    createdAt: "2026-08-29T00:00:00.000Z",
    groundedPayload,
    compiledGraph: { kind: "single_action", commandType: actionType, requiresConfirmation: true, autoApprove: false },
  };
}

describe("P1 Human Operating Compiler", () => {
  const plugins = createDefaultPluginRegistry();
  const registry = createUserCapabilityRegistry(plugins);

  it("derives every user-facing action and all 13 canonical queries from runtime owners", () => {
    const actionCapabilities = registry.actions().map((row) => row.capability).sort();
    const queryCapabilities = registry.queries().map((row) => row.capability).sort();
    expect(actionCapabilities).toEqual(plugins.actionTypes().sort());
    expect(queryCapabilities).toEqual([...OPERATIONAL_QUERY_INTENTS].sort());
    expect(registry.actions()).toHaveLength(59);
    expect(registry.queries()).toHaveLength(13);
    for (const row of registry.all()) {
      expect(row.exampleUtterance.length).toBeGreaterThan(0);
      expect(row.reachableRoutes.length).toBeGreaterThan(0);
      expect(row.sourceOwner.length).toBeGreaterThan(0);
    }
  });

  it.each(queryCorpus)("compiles English to the typed %s capability envelope", (instruction, capability) => {
    const fastReadDecision = interpretOperationalQuery(instruction);
    const preliminary = compileHumanInstructionRoute({ instruction, fastReadDecision });
    const compiled = compileTypedHumanOperation({ instruction, fastReadDecision, preliminary, registry });
    assertCompiledHumanOperation(compiled);
    expect(compiled).toMatchObject({ route: "QUERY", capability });
    expect(compiled).toHaveProperty("target");
    expect(compiled).toHaveProperty("date");
    expect(compiled).toHaveProperty("payload");
  });

  it.each(heldOutFounderQueries)("compiles an unseen founder paraphrase through the real query intake: %s", (instruction, capability) => {
    const fastReadDecision = interpretOperationalQuery(instruction);
    const preliminary = compileHumanInstructionRoute({ instruction, fastReadDecision });
    const compiled = compileTypedHumanOperation({ instruction, fastReadDecision, preliminary, registry });
    assertCompiledHumanOperation(compiled);
    expect(compiled).toMatchObject({ route: "QUERY", capability });
  });

  it("compiles one exact consequential command to an ATOMIC_ACTION with typed target and payload", () => {
    const instruction = "Send this exact message to casey@example.test";
    const fastReadDecision = interpretOperationalQuery(instruction);
    const preliminary = compileHumanInstructionRoute({ instruction, fastReadDecision });
    const compiled = compileTypedHumanOperation({
      instruction,
      fastReadDecision,
      preliminary,
      registry,
      actions: [action("send_message", { recipient: { address: "casey@example.test" }, channel: "email", body: "exact message" })],
    });
    assertCompiledHumanOperation(compiled);
    expect(compiled).toMatchObject({ route: "ATOMIC_ACTION", capability: "send_message" });
    expect(compiled.target).toBeDefined();
  });

  it("compiles ambiguity to CLARIFY and refuses a missing canonical target as an atomic action", () => {
    const instruction = "Email Alex the invoice";
    const fastReadDecision = interpretOperationalQuery(instruction);
    const conversationContext = {
      version: 1 as const,
      ownerEmployeeId: "33333333-3333-4333-8333-333333333333",
      thread: { id: "44444444-4444-4444-8444-444444444444", title: null, summary: null, revision: 1, activeWorkId: null, activeObjectiveLoopId: null, lastActivityAt: "2026-08-29T00:00:00.000Z", createdAt: "2026-08-29T00:00:00.000Z" },
      exactRecentMessages: [], summary: null, olderRelevantMessages: [], personalMemories: [], zepFacts: [],
      resolution: { status: "clarification_required" as const, originalInstruction: instruction, resolvedReferences: [], candidates: [], unresolvedExpressions: ["Alex"], clarificationQuestion: "Which Alex do you mean?", consequential: true, senderIdentityRef: null, provenance: [] },
    };
    const preliminary = compileHumanInstructionRoute({ instruction, fastReadDecision, conversationContext });
    const compiled = compileTypedHumanOperation({ instruction, fastReadDecision, preliminary, conversationContext, registry });
    expect(compiled).toMatchObject({ route: "CLARIFY", capability: "clarification_request", target: { scope: "ambiguous" } });

    expect(() => compileTypedHumanOperation({
      instruction,
      fastReadDecision,
      preliminary: { version: 1, route: "ATOMIC_ACTION", reasonCodes: ["test"] },
      registry,
      actions: [action("send_message", { householdId: "55555555-5555-4555-8555-555555555555" }, [{ field: "householdId", status: "not_found" }])],
    })).toThrow(/failed canonical grounding/);
  });

  it("binds one selected UI entity into a compatible typed query", () => {
    const householdId = "66666666-6666-4666-8666-666666666666";
    const context = { version: 1 as const, capturedAt: "2026-08-29T00:00:00.000Z", source: "text" as const, focusedEntity: { entityType: "household" as const, entityId: householdId }, selectedEntities: [], excludedEntities: [], surface: { id: "customers" as const }, filters: [] };
    const bound = interactionAwareOperationalDecision(interpretOperationalQuery("Find the customer record for Alice Johnson"), context);
    expect(bound).toMatchObject({ route: "fast_read", request: { intent: "customer_lookup", householdId } });
  });
});
