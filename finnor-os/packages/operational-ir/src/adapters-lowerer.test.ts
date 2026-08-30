import { describe, expect, it } from "vitest";
import type { BusinessEffectSet, DomainAction } from "@finnor/shared-types";
import {
  adaptBusinessEffectSetForComparison,
  adaptCompiledHumanOperation,
  adaptDomainActionToEffect,
  adaptInstructionRouteDecision,
  adaptExistingPlanningCandidateToProgram,
  adaptObjectiveDecisionToNode,
  adaptOperationalQueryRequestToQuery,
  lowerOperationalProgram,
  lowerQueryToOperationalQueryRequest,
  LOWERING_GUARANTEES,
  OPERATIONAL_IR_ADAPTER_MATRIX,
  type OperationalProgram,
  type OperationalProgramSemanticEnvelope,
} from "./index";
import {
  atomicProgram,
  branchProgram,
  compensationProgram,
  FIXED_ACTION_IDS,
  FIXED_HOUSEHOLD_ID,
  FIXED_NOW,
  FIXED_TENANT_ID,
  FIXED_WORK_ID,
  HOUSEHOLD_RECEIVED_MESSAGE,
  knownActionProgram,
  parallelProgram,
  queryProgram,
  reseal,
  sequenceProgram,
  waitProgram,
} from "../fixtures/programs";

const DOMAIN_ACTION: DomainAction = {
  id: FIXED_ACTION_IDS["effect.send-message"],
  tenantId: FIXED_TENANT_ID,
  actionType: "send_message",
  payload: { householdId: FIXED_HOUSEHOLD_ID, channel: "email", body: "Your service visit is confirmed." },
  policyId: null,
  status: "draft",
  createdAt: FIXED_NOW,
  workId: FIXED_WORK_ID,
  groundedPayload: [{ field: "householdId", status: "verified" }],
  compiledGraph: { kind: "single_action", commandType: "send_message", requiresConfirmation: true, autoApprove: false },
};

function loweringContext() {
  return {
    tenantId: FIXED_TENANT_ID,
    createdAt: FIXED_NOW,
    domainActionIds: { ...FIXED_ACTION_IDS },
    workId: FIXED_WORK_ID,
    policyByEffect: { "effect.send-message": { policyId: null, policyVersion: null } },
  } as const;
}

function envelopeOf(program: OperationalProgram): OperationalProgramSemanticEnvelope {
  const { irSemanticHash: _hash, executionModel: _executionModel, body: _body, ...envelope } = structuredClone(program);
  return envelope;
}

function businessEffect(): BusinessEffectSet {
  return {
    id: "50000000-0000-4000-8000-000000000001",
    schemaVersion: 1,
    semanticHash: "a".repeat(64),
    scopeHash: "b".repeat(64),
    source: { domainActionId: DOMAIN_ACTION.id, actionType: "send_message", workId: FIXED_WORK_ID, objectiveStepId: null },
    mode: "consequential",
    operation: { name: "send_message", class: "external_side_effect", external: true },
    targets: [{ kind: "entity", type: "household", id: FIXED_HOUSEHOLD_ID, sourcePath: "householdId" }],
    bindings: [{ selection: "policy_resolved", provider: "resend" }],
    preconditions: [],
    before: [],
    delta: { operation: "send_message", values: DOMAIN_ACTION.payload },
    expected: { observation: "provider_delivery", state: null },
    exposure: null,
    authority: { capability: "action:send_message", risk: "high", policyId: null, policyVersion: null },
    approval: { required: true, typedConfirmation: false, summary: "Send the approved message." },
    reversibility: { classification: "unknown_provider_dependent", compensationCapability: null },
    uncertainty: { unknownOutcome: "reconcile_before_retry", stalePrecondition: "block_and_recompile" },
    provenance: { compiler: "finnor_effect_compiler", compilerVersion: 1, compiledAt: FIXED_NOW, replacementForEffectId: null, compensationForEffectId: null },
  };
}

describe("existing representation adapters", () => {
  it("maps the actual InstructionRouteDecision without inventing intent", () => {
    expect(adaptInstructionRouteDecision({ version: 1, route: "ATOMIC_ACTION", reasonCodes: ["strict_single_action_candidate"] })).toMatchObject({
      classification: "LOSSLESS",
      value: { executionModel: "ATOMIC_ACTION", policyVersion: 1, reasonCodes: ["strict_single_action_candidate"] },
    });
    expect(adaptInstructionRouteDecision({
      version: 1,
      route: "QUERY",
      reasonCodes: ["deterministic_canonical_read"],
      queryDecision: { route: "fast_read", request: { intent: "business_state" } },
    })).toMatchObject({ classification: "LOSSY", omitted: ["queryDecision"] });
    for (const route of ["CONVERSATION", "OBJECTIVE", "CLARIFY"] as const) {
      expect(adaptInstructionRouteDecision({ version: 1, route, reasonCodes: [`fixture_${route.toLowerCase()}`] })).toMatchObject({
        classification: "LOSSLESS",
        value: { executionModel: route },
      });
    }
  });

  it("adapts the actual CompiledHumanOperation without fabricating desired-state semantics", () => {
    const adapted = adaptCompiledHumanOperation({
      version: 1,
      route: "ATOMIC_ACTION",
      capability: "action:send_message",
      target: { scope: "canonical", values: { householdId: FIXED_HOUSEHOLD_ID } },
      date: { scope: "current", values: {} },
      payload: DOMAIN_ACTION.payload,
      reasonCodes: ["strict_single_action_candidate"],
    });
    expect(adapted).toMatchObject({
      classification: "LOSSY",
      value: {
        executionModel: "ATOMIC_ACTION",
        capability: "action:send_message",
        target: { scope: "canonical", values: { householdId: FIXED_HOUSEHOLD_ID } },
      },
      omitted: ["Goal", "dependencies", "observations", "success condition"],
    });
    expect(OPERATIONAL_IR_ADAPTER_MATRIX.find((row) => row.representation === "CompiledHumanOperation")).toMatchObject({
      actualAtBaseline: true,
      toIr: "LOSSY",
      fromIr: "NOT_APPLICABLE",
    });
  });

  it("refuses to fabricate a Goal from DomainAction alone", () => {
    const adapted = adaptDomainActionToEffect(DOMAIN_ACTION);
    expect(adapted.classification).toBe("UNSUPPORTED");
    expect(adapted).not.toHaveProperty("value");
  });

  it("adapts DomainAction with explicit same-candidate semantics and classifies the boundary LOSSY", () => {
    const adapted = adaptDomainActionToEffect(DOMAIN_ACTION, {
      semanticId: "effect.send-message",
      targets: [{ entityRef: "entity.household", payloadPath: "householdId" }],
      intendedState: HOUSEHOLD_RECEIVED_MESSAGE,
      requiredCapability: "action:send_message",
      expectedObservationRefs: ["observation.effect.send-message"],
      dependsOn: [],
    });
    expect(adapted).toMatchObject({ classification: "LOSSY", value: { operation: "send_message", arguments: DOMAIN_ACTION.payload } });
    expect(adapted.value).not.toHaveProperty("tenantId");
    expect(adapted.value).not.toHaveProperty("businessEffectId");
  });

  it("adapts OperationalQueryRequest losslessly in both directions", () => {
    const adapted = adaptOperationalQueryRequestToQuery({ request: { intent: "customer_lookup", householdId: FIXED_HOUSEHOLD_ID }, semanticId: "query.customer", purpose: "Find exact customer" });
    expect(adapted.classification).toBe("LOSSLESS");
    expect(lowerQueryToOperationalQueryRequest(adapted.value!)).toMatchObject({ classification: "LOSSLESS", value: { intent: "customer_lookup", householdId: FIXED_HOUSEHOLD_ID } });
  });

  it("projects BusinessEffect only for comparison and never as an IR identity", () => {
    const adapted = adaptBusinessEffectSetForComparison(businessEffect());
    expect(adapted).toMatchObject({ classification: "LOSSY", value: { operation: "send_message", consequential: true, requiredCapability: "action:send_message" } });
    expect(adapted.value).not.toHaveProperty("id");
    expect(adapted.value).not.toHaveProperty("semanticHash");
    expect(OPERATIONAL_IR_ADAPTER_MATRIX.find((row) => row.representation === "BusinessEffectSet")?.fromIr).toBe("NOT_APPLICABLE");
  });

  it("adapts query/action/wait Objective decisions only with explicit missing semantics", () => {
    const query = adaptObjectiveDecisionToNode({ kind: "query", request: { intent: "business_state" }, reason: "Inspect current state" }, { semanticId: "query.state" });
    expect(query).toMatchObject({ classification: "LOSSY", value: { kind: "query" } });
    const actionMissing = adaptObjectiveDecisionToNode({ kind: "action", actionType: "send_message", payload: DOMAIN_ACTION.payload, reason: "Send" }, { semanticId: "effect.send" });
    expect(actionMissing.classification).toBe("UNSUPPORTED");
    const action = adaptObjectiveDecisionToNode({ kind: "action", actionType: "send_message", payload: DOMAIN_ACTION.payload, reason: "Send" }, {
      semanticId: "effect.send",
      action: { targets: [{ entityRef: "entity.household", payloadPath: "householdId" }], intendedState: HOUSEHOLD_RECEIVED_MESSAGE, requiredCapability: "action:send_message", expectedObservationRefs: ["observation.send"] },
    });
    expect(action).toMatchObject({ classification: "LOSSY", value: { kind: "effect", operation: "send_message" } });
    const waitMissing = adaptObjectiveDecisionToNode({ kind: "wait", waitFor: { eventType: "vendor.reply" }, reason: "Wait" }, { semanticId: "wait.vendor" });
    expect(waitMissing.classification).toBe("UNSUPPORTED");
    const complete = adaptObjectiveDecisionToNode({ kind: "complete", outcome: {}, reason: "Done" }, { semanticId: "complete" });
    expect(complete.classification).toBe("NOT_APPLICABLE");
  });

  it("assembles the exact Query program from the same existing route candidate", () => {
    const expected = queryProgram();
    const adapted = adaptExistingPlanningCandidateToProgram({
      candidate: {
        kind: "instruction_route",
        decision: { version: 1, route: "QUERY", reasonCodes: ["deterministic_canonical_read"], queryDecision: { route: "fast_read" } },
        query: { request: expected.body.kind === "query" ? expected.body.request : { intent: "business_state" }, semanticId: "query.customer", purpose: "The requested canonical customer record has been acquired." },
      },
      envelope: envelopeOf(expected),
    });
    expect(adapted).toMatchObject({ classification: "LOSSLESS", value: { irSemanticHash: expected.irSemanticHash, executionModel: "QUERY" } });
  });

  it("assembles atomic DomainAction IR only when same-candidate desired-state semantics are explicit", () => {
    const missing = adaptExistingPlanningCandidateToProgram({
      candidate: { kind: "domain_action", executionModel: "ATOMIC_ACTION", action: DOMAIN_ACTION },
      envelope: envelopeOf(atomicProgram()),
    });
    expect(missing.classification).toBe("UNSUPPORTED");

    const adapted = adaptExistingPlanningCandidateToProgram({
      candidate: {
        kind: "domain_action",
        executionModel: "ATOMIC_ACTION",
        action: DOMAIN_ACTION,
        semantics: {
          semanticId: "effect.send-message",
          targets: [{ entityRef: "entity.household", payloadPath: "householdId" }],
          intendedState: HOUSEHOLD_RECEIVED_MESSAGE,
          requiredCapability: "action:send_message",
          expectedObservationRefs: ["observation.effect.send-message"],
          dependsOn: [],
        },
      },
      envelope: envelopeOf(atomicProgram()),
    });
    expect(adapted).toMatchObject({ classification: "LOSSY", value: { executionModel: "ATOMIC_ACTION", irSemanticHash: atomicProgram().irSemanticHash } });
  });

  it("keeps conversation and missing route computations explicit instead of fabricating programs", () => {
    const envelope = envelopeOf(queryProgram());
    expect(adaptExistingPlanningCandidateToProgram({
      candidate: { kind: "instruction_route", decision: { version: 1, route: "CONVERSATION", reasonCodes: ["non_business_conversation"] } },
      envelope,
    }).classification).toBe("NOT_APPLICABLE");
    expect(adaptExistingPlanningCandidateToProgram({
      candidate: { kind: "instruction_route", decision: { version: 1, route: "CLARIFY", reasonCodes: ["clarification_required"] } },
      envelope,
    }).classification).toBe("NOT_APPLICABLE");
    expect(adaptExistingPlanningCandidateToProgram({
      candidate: { kind: "instruction_route", decision: { version: 1, route: "ATOMIC_ACTION", reasonCodes: ["strict_single_action_candidate"] } },
      envelope,
    }).classification).toBe("UNSUPPORTED");
  });
});

describe("compatibility lowerer", () => {
  it("lowers atomic IR into a draft DomainAction without authority/effect/idempotency identity", () => {
    const lowered = lowerOperationalProgram(atomicProgram(), loweringContext());
    expect(lowered.status).toBe("LOWERED");
    if (lowered.status !== "LOWERED" || lowered.value.kind !== "domain_action_plan") throw new Error("unexpected lowering");
    expect(lowered.value.actions).toHaveLength(1);
    expect(lowered.value.actions[0]).toMatchObject({
      irEffectSemanticId: "effect.send-message",
      dependsOnDomainActionIds: [],
      requiresCurrentGrounding: false,
      domainAction: {
        id: FIXED_ACTION_IDS["effect.send-message"],
        tenantId: FIXED_TENANT_ID,
        actionType: "send_message",
        status: "draft",
        businessEffectId: null,
        authorityDecisionId: null,
      },
    });
    expect(lowered.retained.irSemanticHash).toBe(atomicProgram().irSemanticHash);
    expect(lowered.guarantees).toEqual(LOWERING_GUARANTEES);
  });

  it("takes tenant identity only from trusted lowering context", () => {
    const lowered = lowerOperationalProgram(atomicProgram(), { ...loweringContext(), tenantId: "90000000-0000-4000-8000-000000000001" });
    expect(lowered.status).toBe("LOWERED");
    if (lowered.status !== "LOWERED" || lowered.value.kind !== "domain_action_plan") throw new Error("unexpected lowering");
    expect(lowered.value.actions[0]!.domainAction.tenantId).toBe("90000000-0000-4000-8000-000000000001");
    expect(JSON.stringify(atomicProgram())).not.toContain("90000000-0000-4000-8000-000000000001");
  });

  it("is deterministic for a fixed trusted context", () => {
    expect(lowerOperationalProgram(atomicProgram(), loweringContext())).toEqual(lowerOperationalProgram(atomicProgram(), loweringContext()));
  });

  it("never reuses the IR hash as DomainAction, Work, BusinessEffect, or idempotency identity", () => {
    const program = atomicProgram();
    const lowered = lowerOperationalProgram(program, loweringContext());
    expect(lowered.status).toBe("LOWERED");
    if (lowered.status !== "LOWERED" || lowered.value.kind !== "domain_action_plan") throw new Error("unexpected lowering");
    const action = lowered.value.actions[0]!.domainAction;
    expect(program.irSemanticHash).toMatch(/^ir:sha256:[0-9a-f]{64}$/);
    expect(action.id).toBe(FIXED_ACTION_IDS["effect.send-message"]);
    expect(action.workId).toBe(FIXED_WORK_ID);
    expect(action.businessEffectId).toBeNull();
    expect(JSON.stringify(lowered)).not.toContain("idempotencyKey");
    expect([action.id, action.workId, action.businessEffectId]).not.toContain(program.irSemanticHash);
    expect(businessEffect().semanticHash).toMatch(/^[0-9a-f]{64}$/);
    expect(businessEffect().semanticHash).not.toBe(program.irSemanticHash);
  });

  it("requires current grounding when audited grounded output is absent", () => {
    const program = reseal(atomicProgram(), (draft) => { if (draft.body.kind === "effect") delete draft.body.domainActionCompatibility!.groundedPayload; });
    const lowered = lowerOperationalProgram(program, loweringContext());
    expect(lowered.status).toBe("LOWERED");
    if (lowered.status !== "LOWERED" || lowered.value.kind !== "domain_action_plan") throw new Error("unexpected lowering");
    expect(lowered.value.actions[0]!.requiresCurrentGrounding).toBe(true);
    expect(lowered.value.actions[0]!.domainAction.groundedPayload).toBeNull();
  });

  it("refuses to invent missing current compiledGraph output", () => {
    const program = reseal(atomicProgram(), (draft) => { if (draft.body.kind === "effect") delete draft.body.domainActionCompatibility; });
    expect(lowerOperationalProgram(program, loweringContext())).toMatchObject({ status: "UNSUPPORTED", classification: "UNSUPPORTED" });
  });

  it("lowers Query to the existing Operational Query request", () => {
    expect(lowerOperationalProgram(queryProgram())).toMatchObject({ status: "LOWERED", classification: "LOSSLESS", value: { kind: "operational_query", request: { intent: "customer_lookup" } } });
  });

  it("lowers a system-known-action fixture through the canonical ATOMIC_ACTION model", () => {
    const lowered = lowerOperationalProgram(knownActionProgram(), loweringContext());
    expect(lowered).toMatchObject({ status: "LOWERED", target: "domain_action_plan", value: { kind: "domain_action_plan" } });
  });

  it("lowers one Objective action or Wait to one current ObjectiveDecision", () => {
    const objectiveAction = reseal(atomicProgram(), (draft) => { draft.executionModel = "OBJECTIVE"; });
    expect(lowerOperationalProgram(objectiveAction)).toMatchObject({ status: "LOWERED", value: { kind: "objective_decision", decision: { kind: "action", actionType: "send_message" } } });
    expect(lowerOperationalProgram(waitProgram())).toMatchObject({ status: "LOWERED", value: { kind: "objective_decision", decision: { kind: "wait", waitFor: { eventType: "vendor.response.received" } } } });
  });

  it("classifies static multi-step/branch/compensation Objective lowering as unsupported P4 semantics", () => {
    for (const program of [sequenceProgram(), parallelProgram(), branchProgram(), compensationProgram()]) {
      expect(lowerOperationalProgram(program), program.semanticId).toMatchObject({ status: "UNSUPPORTED", classification: "UNSUPPORTED" });
    }
  });

  it("rejects invalid IR before lowering", () => {
    const invalid = { ...atomicProgram(), irSemanticHash: `ir:sha256:${"0".repeat(64)}` };
    expect(lowerOperationalProgram(invalid, loweringContext())).toMatchObject({ status: "INVALID", classification: "UNSUPPORTED" });
  });
});
