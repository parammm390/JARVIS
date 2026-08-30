import type { StaticResolutionContext, StaticResolutionProvider } from "../src/resolution";
import type { Effect, EffectDeclaration, EntityRef, OperationalProgram, Predicate } from "../src/index";
import { inferExecutableNodeEffects } from "../src/effect-inference";
import {
  FIXED_HOUSEHOLD_ID,
  FIXED_TENANT_ID,
  HOUSEHOLD_REF,
  atomicProgram,
  compensationProgram,
  createTaskEffect,
  effectObservation,
  reseal,
  sendMessageEffect,
} from "./programs";

export const FIXED_INVOICE_ID = "50000000-0000-4000-8000-000000000001";

export const INVOICE_REF: EntityRef = {
  kind: "entity_ref",
  semanticId: "entity.invoice",
  entityType: "invoice",
  resolution: {
    status: "resolved",
    canonical: { kind: "entity", type: "invoice", id: FIXED_INVOICE_ID },
    source: "canonical",
  },
};

function exactDeclaration(program: OperationalProgram, effect: Effect): EffectDeclaration {
  const inferred = inferExecutableNodeEffects(effect, program);
  if (!inferred.declaration) throw new Error(`fixture inference unavailable: ${inferred.reasonCodes.join(",")}`);
  return structuredClone(inferred.declaration);
}

function atomicWith(input: {
  semanticId: string;
  effect: Effect;
  entity: EntityRef;
  goalPredicate: Predicate;
}): OperationalProgram {
  return reseal(atomicProgram(), (draft) => {
    draft.semanticId = input.semanticId;
    draft.body = input.effect;
    draft.entities = [input.entity];
    draft.scope.semanticId = `scope.${input.semanticId}`;
    draft.scope.includeEntityRefs = [input.entity.semanticId];
    draft.scope.excludeEntityRefs = [];
    draft.goal = {
      kind: "goal",
      semanticId: `goal.${input.semanticId}`,
      statement: `The intended state for ${input.effect.operation} is verified.`,
      predicate: input.goalPredicate,
      subjectRefs: [input.entity.semanticId],
    };
    const observation = effectObservation(input.effect.semanticId);
    draft.observations = [observation];
    draft.successCondition = {
      kind: "success_condition",
      semanticId: `success.${input.semanticId}`,
      statement: draft.goal.statement,
      mode: "ALL",
      criteria: [{ kind: "observation", observationRef: observation.semanticId }],
    };
    draft.constraints = [];
    if (draft.budget) {
      draft.budget.semanticId = `budget.${input.semanticId}`;
      draft.budget.maxEffects = 1;
      draft.budget.maxQueries = 0;
      draft.budget.maxWaits = 0;
    }
  });
}

export function internalCanonicalWriteProgram(): OperationalProgram {
  const effect = createTaskEffect();
  return atomicWith({ semanticId: "program.p2-internal-write", effect, entity: HOUSEHOLD_REF, goalPredicate: effect.intendedState });
}

export function declaredCommunicationProgram(): OperationalProgram {
  const base = atomicProgram();
  if (base.body.kind !== "effect") throw new Error("fixture drift");
  const declaration = exactDeclaration(base, base.body);
  const pii = { classification: "PII" as const, fields: ["body", "subject"], basis: "IR_DECLARED" as const, evidenceRef: "capability:communication:pii-allowlist:v1" };
  declaration.source = "IR_DECLARED";
  declaration.communications = declaration.communications.map((communication) => ({ ...communication, information: pii }));
  declaration.informationFlows = declaration.informationFlows.map((flow) => ({ ...flow, information: pii }));
  return reseal(base, (draft) => {
    if (draft.body.kind !== "effect") throw new Error("fixture drift");
    draft.semanticId = "program.p2-declared-communication";
    draft.body.effectDeclaration = declaration;
  });
}

export function piiResearchExportProgram(declassified = false): OperationalProgram {
  const base = declaredCommunicationProgram();
  return reseal(base, (draft) => {
    if (draft.body.kind !== "effect" || !draft.body.effectDeclaration) throw new Error("fixture drift");
    draft.semanticId = declassified ? "program.p2-declassified-export" : "program.p2-forbidden-pii-export";
    const requirementId = `authority.${draft.body.semanticId}.declassification`;
    draft.body.effectDeclaration.informationFlows = draft.body.effectDeclaration.informationFlows.map((flow) => ({
      ...flow,
      destination: { kind: "EXTERNAL_RESEARCH", toolClass: "bounded_research" },
      ...(declassified ? {
        transformation: {
          kind: "DECLASSIFICATION" as const,
          outputClassification: "PUBLIC" as const,
          authorityRequirementId: requirementId,
          proof: {
            kind: "EXACT_FIELD_PROJECTION" as const,
            proofRef: "p2-fixture:public-status-only",
            verifiedOutputClassification: "PUBLIC" as const,
          },
        },
        declassificationRequirementId: requirementId,
      } : { transformation: { kind: "IDENTITY" as const } }),
    }));
    if (declassified) draft.body.effectDeclaration.authorityRequirements.push({
      requirementId,
      kind: "REQUIRES_DECLASSIFICATION_AUTHORITY",
      sourceClassification: "PII",
      outputClassification: "PUBLIC",
      destinationKind: "EXTERNAL_RESEARCH",
    });
  });
}

export function financialWriteProgram(): OperationalProgram {
  const intendedState: Predicate = {
    kind: "assertion",
    subject: { kind: "entity", ref: INVOICE_REF.semanticId },
    path: ["status"],
    operator: "eq",
    expected: "paid",
  };
  const effect: Effect = {
    kind: "effect",
    semanticId: "effect.record-payment",
    operation: "record_payment",
    arguments: { invoiceId: FIXED_INVOICE_ID, amountUsd: 125, currency: "USD" },
    targets: [{ entityRef: INVOICE_REF.semanticId, payloadPath: "invoiceId" }],
    intendedState,
    requiredCapability: "action:record_payment",
    consequential: true,
    expectedObservationRefs: ["observation.effect.record-payment"],
    dependsOn: [],
    domainActionCompatibility: {
      compiledGraph: { kind: "single_action", commandType: "record_payment", requiresConfirmation: true, autoApprove: false },
      groundedPayload: [{ field: "invoiceId", status: "verified" }],
    },
  };
  return atomicWith({ semanticId: "program.p2-financial-write", effect, entity: INVOICE_REF, goalPredicate: intendedState });
}

export function externalSpendProgram(): OperationalProgram {
  const intendedState: Predicate = {
    kind: "assertion",
    subject: { kind: "entity", ref: HOUSEHOLD_REF.semanticId },
    path: ["marketing", "campaign", "launched"],
    operator: "eq",
    expected: true,
  };
  const effect: Effect = {
    kind: "effect",
    semanticId: "effect.launch-campaign",
    operation: "launch_ad_campaign",
    arguments: { householdId: FIXED_HOUSEHOLD_ID, budgetUsd: 250, currency: "USD" },
    targets: [{ entityRef: HOUSEHOLD_REF.semanticId, payloadPath: "householdId" }],
    intendedState,
    requiredCapability: "action:launch_ad_campaign",
    consequential: true,
    expectedObservationRefs: ["observation.effect.launch-campaign"],
    dependsOn: [],
    domainActionCompatibility: {
      compiledGraph: { kind: "single_action", commandType: "launch_ad_campaign", requiresConfirmation: true, autoApprove: false },
      groundedPayload: [{ field: "householdId", status: "verified" }],
    },
  };
  return atomicWith({ semanticId: "program.p2-external-spend", effect, entity: HOUSEHOLD_REF, goalPredicate: intendedState });
}

export function computerWriteProgram(declared = true): OperationalProgram {
  const intendedState: Predicate = {
    kind: "assertion",
    subject: { kind: "entity", ref: INVOICE_REF.semanticId },
    path: ["status"],
    operator: "eq",
    expected: "sent",
  };
  const effect: Effect = {
    kind: "effect",
    semanticId: "effect.computer-invoice",
    operation: "computer_task",
    arguments: {
      invoiceId: FIXED_INVOICE_ID,
      application: "accounting_app",
      mode: "WRITE",
      authorizedEffect: {
        operation: "update_invoice",
        target: { kind: "invoice", identifier: FIXED_INVOICE_ID },
        changes: { status: "sent" },
      },
    },
    targets: [{ entityRef: INVOICE_REF.semanticId, payloadPath: "invoiceId" }],
    intendedState,
    requiredCapability: "action:computer_task",
    consequential: true,
    expectedObservationRefs: ["observation.effect.computer-invoice"],
    dependsOn: [],
    domainActionCompatibility: {
      compiledGraph: { kind: "single_action", commandType: "computer_task", requiresConfirmation: true, autoApprove: false },
      groundedPayload: [{ field: "invoiceId", status: "verified" }],
    },
  };
  let program = atomicWith({ semanticId: "program.p2-computer-write", effect, entity: INVOICE_REF, goalPredicate: intendedState });
  if (!declared || program.body.kind !== "effect") return program;
  const declaration = exactDeclaration(program, program.body);
  declaration.source = "IR_DECLARED";
  const financial = { classification: "FINANCIAL" as const, fields: ["status"], basis: "IR_DECLARED" as const, evidenceRef: "canonical:invoice:financial:v1" };
  declaration.contract.writes = declaration.contract.writes.map((write) => ({ ...write, information: financial }));
  declaration.informationFlows = declaration.informationFlows.map((flow) => ({ ...flow, information: financial }));
  program = reseal(program, (draft) => {
    if (draft.body.kind !== "effect") throw new Error("fixture drift");
    draft.body.effectDeclaration = declaration;
  });
  return program;
}

export function parallelConflictingWritesProgram(): OperationalProgram {
  const first = createTaskEffect({ semanticId: "effect.create-task-a", expectedObservationRefs: ["observation.effect.create-task-a"] });
  const second = createTaskEffect({ semanticId: "effect.create-task-b", expectedObservationRefs: ["observation.effect.create-task-b"] });
  return reseal(internalCanonicalWriteProgram(), (draft) => {
    draft.semanticId = "program.p2-parallel-conflict";
    draft.executionModel = "OBJECTIVE";
    draft.body = { kind: "parallel", semanticId: "parallel.conflicting-task-writes", branches: [first, second] };
    draft.observations = [effectObservation(first.semanticId), effectObservation(second.semanticId)];
    draft.successCondition.criteria = draft.observations.map((observation) => ({ kind: "observation" as const, observationRef: observation.semanticId }));
    if (draft.budget) {
      draft.budget.maxSteps = 2;
      draft.budget.maxEffects = 2;
    }
  });
}

export function validCompensationProgram(): OperationalProgram {
  let program = compensationProgram();
  if (program.body.kind !== "sequence") throw new Error("fixture drift");
  const original = program.body.steps[0];
  const compensation = program.body.steps[1];
  if (original?.kind !== "effect" || compensation?.kind !== "compensation") throw new Error("fixture drift");
  const originalDeclaration = exactDeclaration(program, original);
  const pii = { classification: "PII" as const, fields: ["body", "subject"], basis: "IR_DECLARED" as const, evidenceRef: "capability:communication:pii-allowlist:v1" };
  originalDeclaration.source = "IR_DECLARED";
  originalDeclaration.communications = originalDeclaration.communications.map((entry) => ({ ...entry, information: pii }));
  originalDeclaration.informationFlows = originalDeclaration.informationFlows.map((flow) => ({ ...flow, information: pii }));
  const compensationDeclaration = exactDeclaration(program, compensation.effect);
  compensationDeclaration.source = "IR_DECLARED";
  compensationDeclaration.contract.compensates = original.semanticId;
  program = reseal(program, (draft) => {
    if (draft.body.kind !== "sequence") throw new Error("fixture drift");
    const draftOriginal = draft.body.steps[0];
    const draftCompensation = draft.body.steps[1];
    if (draftOriginal?.kind !== "effect" || draftCompensation?.kind !== "compensation") throw new Error("fixture drift");
    draftOriginal.effectDeclaration = originalDeclaration;
    draftCompensation.effect.effectDeclaration = compensationDeclaration;
  });
  return program;
}

export function staticResolutionContext(overrides: {
  entity?: "EXISTS" | "MISSING" | "CROSS_TENANT" | "STALE" | "UNRESOLVED";
  capability?: "EXISTS" | "MISSING" | "INCOMPATIBLE" | "UNRESOLVED";
  configured?: boolean | "NOT_REQUIRED";
} = {}): StaticResolutionContext {
  const provider: StaticResolutionProvider = {
    async resolveEntity(request) {
      const status = overrides.entity ?? "EXISTS";
      if (status === "EXISTS") return { status, tenantId: request.trustedTenantId, type: request.type };
      if (status === "CROSS_TENANT") return { status, tenantId: "90000000-0000-4000-8000-000000000001" };
      return { status };
    },
    async resolveCapability(request) {
      const status = overrides.capability ?? "EXISTS";
      if (status === "EXISTS") return { status, supportedDimensions: request.requiredDimensions, configured: overrides.configured ?? true };
      if (status === "INCOMPATIBLE") return { status, supportedDimensions: ["READ"] };
      return { status };
    },
  };
  return { tenantId: FIXED_TENANT_ID, provider };
}
