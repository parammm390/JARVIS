import {
  IR_SCHEMA_VERSION,
  sealOperationalProgram,
  type Constraint,
  type Effect,
  type EntityRef,
  type Goal,
  type Observation,
  type OperationalProgram,
  type OperationalProgramDraft,
  type Predicate,
  type ProgramNode,
} from "../src/index";

export const FIXED_NOW = "2026-08-30T04:00:00.000Z";
export const FIXED_TENANT_ID = "10000000-0000-4000-8000-000000000001";
export const FIXED_WORK_ID = "20000000-0000-4000-8000-000000000001";
export const FIXED_ACTION_IDS = {
  "effect.send-message": "30000000-0000-4000-8000-000000000001",
  "effect.create-task": "30000000-0000-4000-8000-000000000002",
  "effect.compensate-message": "30000000-0000-4000-8000-000000000003",
} as const;
export const FIXED_HOUSEHOLD_ID = "40000000-0000-4000-8000-000000000001";

export const HOUSEHOLD_REF: EntityRef = {
  kind: "entity_ref",
  semanticId: "entity.household",
  entityType: "household",
  resolution: {
    status: "resolved",
    canonical: { kind: "entity", type: "household", id: FIXED_HOUSEHOLD_ID },
    source: "canonical",
  },
};

export const HOUSEHOLD_RECEIVED_MESSAGE: Predicate = {
  kind: "assertion",
  subject: { kind: "entity", ref: HOUSEHOLD_REF.semanticId },
  path: ["communications", "requiredMessage", "received"],
  operator: "eq",
  expected: true,
};

export const MESSAGE_GOAL: Goal = {
  kind: "goal",
  semanticId: "goal.message-received",
  statement: "The customer has received the required message.",
  predicate: HOUSEHOLD_RECEIVED_MESSAGE,
  subjectRefs: [HOUSEHOLD_REF.semanticId],
};

export const CAPABILITY_CONSTRAINT: Constraint = {
  kind: "constraint",
  semanticId: "constraint.message-capability",
  severity: "HARD",
  category: "capability",
  description: "Use the currently registered send_message capability.",
  predicate: {
    kind: "assertion",
    subject: { kind: "program" },
    path: ["requiredCapabilities"],
    operator: "contains",
    expected: "action:send_message",
  },
  evaluation: "SATISFIED",
  entityRefs: [],
};

export function effectObservation(effectRef: string, semanticId = `observation.${effectRef}`): Observation {
  return {
    kind: "observation",
    semanticId,
    subject: { kind: "effect", ref: effectRef },
    description: `The existing verification substrate verifies ${effectRef}.`,
    strength: "REQUIRED",
    verificationFloor: "EXISTING_OR_STRONGER",
    evidence: { kind: "effect_verification", effectRef, minimumState: "verified" },
  };
}

export function sendMessageEffect(overrides: Partial<Effect> = {}): Effect {
  const semanticId = overrides.semanticId ?? "effect.send-message";
  const observationRef = overrides.expectedObservationRefs?.[0] ?? `observation.${semanticId}`;
  return {
    kind: "effect",
    semanticId,
    operation: "send_message",
    arguments: {
      householdId: FIXED_HOUSEHOLD_ID,
      channel: "email",
      body: "Your service visit is confirmed.",
    },
    targets: [{ entityRef: HOUSEHOLD_REF.semanticId, payloadPath: "householdId" }],
    intendedState: HOUSEHOLD_RECEIVED_MESSAGE,
    requiredCapability: "action:send_message",
    consequential: true,
    expectedObservationRefs: [observationRef],
    dependsOn: [],
    domainActionCompatibility: {
      compiledGraph: { kind: "single_action", commandType: "send_message", requiresConfirmation: true, autoApprove: false },
      groundedPayload: [{ field: "householdId", status: "verified" }],
    },
    ...overrides,
  };
}

export function createTaskEffect(overrides: Partial<Effect> = {}): Effect {
  const semanticId = overrides.semanticId ?? "effect.create-task";
  const observationRef = overrides.expectedObservationRefs?.[0] ?? `observation.${semanticId}`;
  return {
    kind: "effect",
    semanticId,
    operation: "create_task",
    arguments: {
      householdId: FIXED_HOUSEHOLD_ID,
      title: "Confirm service visit receipt",
    },
    targets: [{ entityRef: HOUSEHOLD_REF.semanticId, payloadPath: "householdId" }],
    intendedState: {
      kind: "assertion",
      subject: { kind: "entity", ref: HOUSEHOLD_REF.semanticId },
      path: ["tasks", "confirmationFollowup", "exists"],
      operator: "eq",
      expected: true,
    },
    requiredCapability: "action:create_task",
    consequential: true,
    expectedObservationRefs: [observationRef],
    dependsOn: [],
    domainActionCompatibility: {
      compiledGraph: { kind: "single_action", commandType: "create_task", requiresConfirmation: true, autoApprove: false },
      groundedPayload: [{ field: "householdId", status: "verified" }],
    },
    ...overrides,
  };
}

function baseDraft(input: {
  semanticId: string;
  executionModel: OperationalProgramDraft["executionModel"];
  goal: Goal;
  body: ProgramNode;
  observations: Observation[];
  constraints?: Constraint[];
  entities?: EntityRef[];
  successObservationRefs?: string[];
  successPredicate?: Predicate;
  maxSteps?: number;
}): OperationalProgramDraft {
  const criteria = input.successObservationRefs?.map((observationRef) => ({ kind: "observation" as const, observationRef }))
    ?? [{ kind: "predicate" as const, predicate: input.successPredicate ?? input.goal.predicate }];
  return {
    kind: "operational_program",
    semanticId: input.semanticId,
    irSchemaVersion: IR_SCHEMA_VERSION,
    compilerVersion: "p1-fixture-compiler/1.0.0",
    provenance: {
      representation: "deterministic_fixture",
      sourceRefs: [{ kind: "fixture", id: input.semanticId }],
      compiledAt: FIXED_NOW,
      traceId: `trace:${input.semanticId}`,
    },
    nonSemantic: { artifactId: `artifact:${input.semanticId}`, runtimeTimestamp: FIXED_NOW, traceIds: [`trace:${input.semanticId}`] },
    executionModel: input.executionModel,
    goal: input.goal,
    constraints: input.constraints ?? [],
    entities: input.entities ?? [],
    scope: {
      kind: "scope",
      semanticId: `scope.${input.semanticId}`,
      includeEntityRefs: input.entities?.filter((entity) => entity.resolution.status === "resolved").map((entity) => entity.semanticId) ?? [],
      excludeEntityRefs: [],
      bounded: true,
    },
    body: input.body,
    observations: input.observations,
    successCondition: {
      kind: "success_condition",
      semanticId: `success.${input.semanticId}`,
      statement: input.goal.statement,
      mode: "ALL",
      criteria,
    },
    budget: {
      kind: "budget",
      semanticId: `budget.${input.semanticId}`,
      maxSteps: input.maxSteps ?? 10,
      deadlineAt: "2026-08-31T04:00:00.000Z",
    },
  };
}

export function atomicProgram(): OperationalProgram {
  const effect = sendMessageEffect();
  const observation = effectObservation(effect.semanticId);
  return sealOperationalProgram(baseDraft({
    semanticId: "program.atomic-message",
    executionModel: "ATOMIC_ACTION",
    goal: MESSAGE_GOAL,
    body: effect,
    observations: [observation],
    constraints: [CAPABILITY_CONSTRAINT],
    entities: [HOUSEHOLD_REF],
    successObservationRefs: [observation.semanticId],
    maxSteps: 1,
  }));
}

export function knownActionProgram(): OperationalProgram {
  const atomic = atomicProgram();
  const { irSemanticHash: _hash, ...draft } = atomic;
  return sealOperationalProgram({ ...draft, semanticId: "program.known-message", executionModel: "ATOMIC_ACTION" });
}

export function queryProgram(): OperationalProgram {
  const queryId = "query.customer";
  const goal: Goal = {
    kind: "goal",
    semanticId: "goal.customer-known",
    statement: "The requested canonical customer record has been acquired.",
    predicate: { kind: "assertion", subject: { kind: "query", ref: queryId }, path: ["status"], operator: "eq", expected: "ok" },
    subjectRefs: [],
  };
  const observation: Observation = {
    kind: "observation",
    semanticId: "observation.customer-query",
    subject: { kind: "goal", ref: goal.semanticId },
    description: "The canonical query returns an exact customer record.",
    strength: "REQUIRED",
    verificationFloor: "EXISTING_OR_STRONGER",
    evidence: { kind: "canonical_query", queryRef: queryId, assertion: goal.predicate },
  };
  return sealOperationalProgram(baseDraft({
    semanticId: "program.customer-query",
    executionModel: "QUERY",
    goal,
    body: { kind: "query", semanticId: queryId, request: { intent: "customer_lookup", householdId: FIXED_HOUSEHOLD_ID }, purpose: goal.statement, entityRefs: [], dependsOn: [] },
    observations: [observation],
    successObservationRefs: [observation.semanticId],
    maxSteps: 1,
  }));
}

export function sequenceProgram(): OperationalProgram {
  const first = sendMessageEffect();
  const second = createTaskEffect();
  const firstObservation = effectObservation(first.semanticId);
  const secondObservation = effectObservation(second.semanticId);
  return sealOperationalProgram(baseDraft({
    semanticId: "program.sequence",
    executionModel: "OBJECTIVE",
    goal: MESSAGE_GOAL,
    body: { kind: "sequence", semanticId: "sequence.message-then-task", steps: [first, second] },
    observations: [firstObservation, secondObservation],
    constraints: [CAPABILITY_CONSTRAINT],
    entities: [HOUSEHOLD_REF],
    successObservationRefs: [firstObservation.semanticId, secondObservation.semanticId],
    maxSteps: 2,
  }));
}

export function parallelProgram(): OperationalProgram {
  const first = sendMessageEffect();
  const second = createTaskEffect();
  return sealOperationalProgram(baseDraft({
    semanticId: "program.parallel",
    executionModel: "OBJECTIVE",
    goal: MESSAGE_GOAL,
    body: { kind: "parallel", semanticId: "parallel.message-and-task", branches: [first, second] },
    observations: [effectObservation(first.semanticId), effectObservation(second.semanticId)],
    constraints: [CAPABILITY_CONSTRAINT],
    entities: [HOUSEHOLD_REF],
    successPredicate: MESSAGE_GOAL.predicate,
    maxSteps: 2,
  }));
}

export function branchProgram(): OperationalProgram {
  const email = sendMessageEffect({ semanticId: "effect.email-message", expectedObservationRefs: ["observation.effect.email-message"] });
  const task = createTaskEffect({ semanticId: "effect.manual-task", expectedObservationRefs: ["observation.effect.manual-task"] });
  return sealOperationalProgram(baseDraft({
    semanticId: "program.branch",
    executionModel: "OBJECTIVE",
    goal: MESSAGE_GOAL,
    body: {
      kind: "branch",
      semanticId: "branch.delivery-route",
      evaluation: "FIRST_MATCH",
      cases: [{
        caseId: "case.email-available",
        when: { kind: "assertion", subject: { kind: "program" }, path: ["capabilities", "email"], operator: "eq", expected: true },
        then: email,
      }],
      otherwise: task,
    },
    observations: [effectObservation(email.semanticId), effectObservation(task.semanticId)],
    constraints: [CAPABILITY_CONSTRAINT],
    entities: [HOUSEHOLD_REF],
    successPredicate: MESSAGE_GOAL.predicate,
    maxSteps: 2,
  }));
}

export function waitProgram(): OperationalProgram {
  const condition: Predicate = { kind: "assertion", subject: { kind: "program" }, path: ["vendor", "responded"], operator: "eq", expected: true };
  const goal: Goal = { kind: "goal", semanticId: "goal.vendor-response", statement: "The exact vendor response has arrived.", predicate: condition, subjectRefs: [] };
  const observation: Observation = {
    kind: "observation",
    semanticId: "observation.vendor-response",
    subject: { kind: "goal", ref: goal.semanticId },
    description: "A matched integration event satisfies the exact wait.",
    strength: "REQUIRED",
    verificationFloor: "EXISTING_OR_STRONGER",
    evidence: { kind: "matched_event", eventType: "vendor.response.received", subjectRefs: [] },
  };
  return sealOperationalProgram(baseDraft({
    semanticId: "program.wait",
    executionModel: "OBJECTIVE",
    goal,
    body: { kind: "wait", semanticId: "wait.vendor-response", condition, event: { eventType: "vendor.response.received", refs: [] }, deadlineAt: "2026-08-31T04:00:00.000Z", dependsOn: [] },
    observations: [observation],
    successObservationRefs: [observation.semanticId],
    maxSteps: 1,
  }));
}

export function compensationProgram(): OperationalProgram {
  const original = sendMessageEffect();
  const compensation = createTaskEffect({
    semanticId: "effect.compensate-message",
    operation: "create_task",
    arguments: { householdId: FIXED_HOUSEHOLD_ID, title: "Recover failed message delivery" },
    expectedObservationRefs: ["observation.effect.compensate-message"],
    domainActionCompatibility: { compiledGraph: { kind: "single_action", commandType: "create_task", requiresConfirmation: true, autoApprove: false }, groundedPayload: [{ field: "householdId", status: "verified" }] },
  });
  return sealOperationalProgram(baseDraft({
    semanticId: "program.compensation",
    executionModel: "OBJECTIVE",
    goal: MESSAGE_GOAL,
    body: {
      kind: "sequence",
      semanticId: "sequence.with-compensation",
      steps: [original, { kind: "compensation", semanticId: "compensation.message", forEffectId: original.semanticId, trigger: "ON_FAILURE", effect: compensation, dependsOn: [] }],
    },
    observations: [effectObservation(original.semanticId), effectObservation(compensation.semanticId)],
    constraints: [CAPABILITY_CONSTRAINT],
    entities: [HOUSEHOLD_REF],
    successObservationRefs: [`observation.${original.semanticId}`],
    maxSteps: 2,
  }));
}

export function reseal(program: OperationalProgram, mutate: (draft: OperationalProgramDraft) => void): OperationalProgram {
  const { irSemanticHash: _hash, ...draft } = structuredClone(program);
  mutate(draft);
  return sealOperationalProgram(draft);
}
