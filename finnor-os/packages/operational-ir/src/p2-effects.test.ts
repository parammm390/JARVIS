import { describe, expect, it } from "vitest";
import fc from "fast-check";
import type { BusinessEffectSet, DomainAction } from "@finnor/shared-types";
import {
  EFFECT_DIMENSIONS,
  INFORMATION_CLASSIFICATIONS,
  IR_RUNTIME_MAPPING_MATRIX,
  authorizedRequirementManifest,
  checkOperationalProgramAdmissibility,
  compareP2EffectsToExistingRuntime,
  composeOperationalProgramEffects,
  evaluateInformationFlow,
  informationCanFlowToClassification,
  inferExecutableNodeEffects,
  joinInformationClassifications,
  lowerStaticallyAdmissibleOperationalProgram,
  projectP2RequirementsToExistingRuntime,
} from "./index";
import {
  FIXED_ACTION_IDS,
  FIXED_NOW,
  FIXED_TENANT_ID,
  FIXED_WORK_ID,
  atomicProgram,
  branchProgram,
  queryProgram,
  reseal,
  sequenceProgram,
  waitProgram,
} from "../fixtures/programs";
import {
  computerWriteProgram,
  declaredCommunicationProgram,
  externalSpendProgram,
  financialWriteProgram,
  internalCanonicalWriteProgram,
  parallelConflictingWritesProgram,
  piiResearchExportProgram,
  staticResolutionContext,
  validCompensationProgram,
} from "../fixtures/p2-programs";

function loweringContext() {
  return {
    tenantId: FIXED_TENANT_ID,
    createdAt: FIXED_NOW,
    workId: FIXED_WORK_ID,
    domainActionIds: { ...FIXED_ACTION_IDS },
  };
}

describe("P2 effect taxonomy and information lattice", () => {
  it("defines every required effect dimension without replacing BusinessEffect", () => {
    expect(EFFECT_DIMENSIONS).toEqual([
      "READ", "WRITE", "PII", "COMMUNICATION", "FINANCIAL", "EXTERNAL", "COMPUTER", "AUTHORITY", "REVERSIBILITY", "OBSERVATION",
    ]);
    expect(INFORMATION_CLASSIFICATIONS).toEqual([
      "PUBLIC", "TENANT_INTERNAL", "CUSTOMER_DATA", "PII", "FINANCIAL", "CREDENTIAL_BOUND", "SECRET", "UNCLASSIFIED",
    ]);
  });

  it("keeps UNCLASSIFIED outside the safe lattice and joins incomparable branches conservatively", () => {
    expect(informationCanFlowToClassification("PUBLIC", "PII")).toBe(true);
    expect(informationCanFlowToClassification("PII", "PUBLIC")).toBe(false);
    expect(informationCanFlowToClassification("UNCLASSIFIED", "SECRET")).toBe(false);
    expect(joinInformationClassifications("PII", "FINANCIAL")).toBe("SECRET");
    expect(joinInformationClassifications("PII", "UNCLASSIFIED")).toBe("UNCLASSIFIED");
  });

  it("makes declared effect semantics participate in the deterministic IR hash", () => {
    expect(declaredCommunicationProgram().irSemanticHash).not.toBe(atomicProgram().irSemanticHash);
    expect(declaredCommunicationProgram().irSemanticHash).toBe(declaredCommunicationProgram().irSemanticHash);
  });
});

describe("P2 inference and complete-program composition", () => {
  it("infers a read-only Operational Query with typed canonical reads and PII", () => {
    const summary = composeOperationalProgramEffects(queryProgram());
    expect(summary.dimensions).toEqual(["AUTHORITY", "OBSERVATION", "PII", "READ", "REVERSIBILITY"]);
    expect(summary.possible.some(({ effect }) => effect.dimension === "READ" && effect.access.resource.type === "household")).toBe(true);
    expect(summary.possible.some(({ effect }) => effect.dimension === "PII")).toBe(true);
    expect(summary.possible.some(({ effect }) => effect.dimension === "WRITE")).toBe(false);
  });

  it("composes Sequence by unioning all possible and guaranteed effects", () => {
    const summary = composeOperationalProgramEffects(sequenceProgram());
    expect(new Set(summary.possible.map(({ effect }) => effect.nodeId))).toEqual(new Set(["effect.send-message", "effect.create-task"]));
    expect(new Set(summary.guaranteed.map((effect) => effect.nodeId))).toEqual(new Set(["effect.send-message", "effect.create-task"]));
  });

  it("composes Branch as a possible union with preserved conditions and no false guarantee", () => {
    const summary = composeOperationalProgramEffects(branchProgram());
    expect(new Set(summary.possible.map(({ effect }) => effect.nodeId))).toEqual(new Set(["effect.email-message", "effect.manual-task"]));
    expect(summary.possible.every((entry) => entry.conditions.some((condition) => condition.branchId === "branch.delivery-route"))).toBe(true);
    expect(summary.guaranteed).toEqual([]);
  });

  it("detects statically knowable Parallel write conflicts deterministically", () => {
    const program = parallelConflictingWritesProgram();
    const summary = composeOperationalProgramEffects(program);
    expect(summary.conflicts).toEqual([expect.objectContaining({
      code: "PARALLEL_WRITE_CONFLICT",
      parallelNodeId: "parallel.conflicting-task-writes",
      leftNodeId: "effect.create-task-a",
      rightNodeId: "effect.create-task-b",
      resource: expect.objectContaining({ type: "task", selector: "NEW" }),
    })]);
  });

  it("links Compensation without changing the original irreversible classification", () => {
    const summary = composeOperationalProgramEffects(validCompensationProgram());
    expect(summary.compensationLinks).toEqual([{
      compensationNodeId: "compensation.message",
      originalEffectId: "effect.send-message",
      compensationEffectId: "effect.compensate-message",
      trigger: "ON_FAILURE",
    }]);
    const original = summary.possible.find(({ effect }) => effect.nodeId === "effect.send-message" && effect.dimension === "REVERSIBILITY");
    expect(original?.effect).toMatchObject({ classification: "IRREVERSIBLE" });
  });

  it("models Wait as an observation requirement and read-only state", () => {
    const summary = composeOperationalProgramEffects(waitProgram());
    expect(summary.dimensions).toEqual(["OBSERVATION", "REVERSIBILITY"]);
    expect(summary.possible).toEqual(expect.arrayContaining([
      expect.objectContaining({ effect: expect.objectContaining({ dimension: "OBSERVATION", observationRef: "wait.vendor-response" }) }),
      expect.objectContaining({ effect: expect.objectContaining({ dimension: "REVERSIBILITY", classification: "READ_ONLY" }) }),
    ]));
  });

  it("is invariant to Parallel branch order under a fixed seed", () => {
    fc.assert(fc.property(fc.boolean(), (swap) => {
      const first = parallelConflictingWritesProgram();
      const second = reseal(first, (draft) => {
        if (draft.body.kind !== "parallel") throw new Error("fixture drift");
        if (swap) draft.body.branches.reverse();
      });
      expect(composeOperationalProgramEffects(second)).toEqual(composeOperationalProgramEffects(first));
    }), { seed: 20260830, numRuns: 32 });
  });
});

describe("P2 deterministic information flow", () => {
  it("rejects PII sent to arbitrary external research without declassification", async () => {
    const result = await checkOperationalProgramAdmissibility(piiResearchExportProgram(false), { resolution: staticResolutionContext() });
    expect(result.status).toBe("REJECTED");
    expect(result.reasonCodes).toContain("FORBIDDEN_INFORMATION_FLOW");
    expect(result.informationFlows).toEqual(expect.arrayContaining([
      expect.objectContaining({ decision: "REJECTED", reasonCodes: expect.arrayContaining(["PII_EXTERNAL_RESEARCH_REQUIRES_DECLASSIFICATION"]) }),
    ]));
  });

  it("does not treat redaction as declassification without an exact verified export contract", () => {
    const program = piiResearchExportProgram(false);
    if (program.body.kind !== "effect" || !program.body.effectDeclaration) throw new Error("fixture drift");
    const flow = structuredClone(program.body.effectDeclaration.informationFlows[0]!);
    flow.transformation = {
      kind: "REDACTION",
      outputClassification: "PUBLIC",
      removedFields: ["body"],
      proof: { kind: "EXACT_FIELD_PROJECTION", proofRef: "redactor:v1", verifiedOutputClassification: "PUBLIC" },
    };
    expect(evaluateInformationFlow(flow, program.body.effectDeclaration.authorityRequirements)).toMatchObject({
      decision: "REJECTED",
      reasonCodes: expect.arrayContaining(["REDACTION_IS_NOT_DECLASSIFICATION"]),
    });
  });

  it("admits only an exact proved declassification linked to explicit export authority", async () => {
    const result = await checkOperationalProgramAdmissibility(piiResearchExportProgram(true), { resolution: staticResolutionContext() });
    expect(result.informationFlows).toEqual(expect.arrayContaining([
      expect.objectContaining({ decision: "LEGAL", effectiveClassification: "PUBLIC" }),
    ]));
    expect(result.reasonCodes).not.toContain("FORBIDDEN_INFORMATION_FLOW");
  });

  it("rejects unclassified content at an external communication boundary", async () => {
    const result = await checkOperationalProgramAdmissibility(atomicProgram(), { resolution: staticResolutionContext() });
    expect(result.status).toBe("REJECTED");
    expect(result.reasonCodes).toContain("UNCLASSIFIED_SENSITIVE_EXPORT");
    const unproven = reseal(declaredCommunicationProgram(), (draft) => {
      if (draft.body.kind !== "effect" || !draft.body.effectDeclaration) throw new Error("fixture drift");
      for (const flow of draft.body.effectDeclaration.informationFlows) delete flow.information.evidenceRef;
      for (const communication of draft.body.effectDeclaration.communications) delete communication.information.evidenceRef;
    });
    expect(await checkOperationalProgramAdmissibility(unproven, { resolution: staticResolutionContext() })).toMatchObject({
      status: "REJECTED",
      reasonCodes: expect.arrayContaining(["UNPROVEN_INFORMATION_CLASSIFICATION"]),
    });
  });
});

describe("P2 static admissibility and requirement manifest", () => {
  it("admits an audited internal canonical write with tenant and capability proof", async () => {
    const result = await checkOperationalProgramAdmissibility(internalCanonicalWriteProgram(), { resolution: staticResolutionContext() });
    expect(result.status).toBe("ADMISSIBLE");
    expect(result.issues).toEqual([]);
    expect(result.manifest).toMatchObject({
      runtimeAuthorityReevaluationRequired: true,
      businessEffectCompilationRequired: true,
      executionPreconditionRevalidationRequired: true,
    });
  });

  it("admits a governed PII communication but never grants runtime authority", async () => {
    const result = await checkOperationalProgramAdmissibility(declaredCommunicationProgram(), { resolution: staticResolutionContext() });
    expect(result.status).toBe("ADMISSIBLE");
    expect(result.manifest?.requirements).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: "REQUIRES_CAPABILITY", capability: "action:send_message" }),
      expect.objectContaining({ kind: "REQUIRES_APPROVAL" }),
      expect.objectContaining({ kind: "REQUIRES_RESOURCE_SCOPE" }),
    ]));
    expect(JSON.stringify(result.manifest)).not.toMatch(/outcome|allowed|decisionId|employeeId/);
  });

  it("admits audited financial write and spend requirements with exact amounts", async () => {
    const financial = await checkOperationalProgramAdmissibility(financialWriteProgram(), { resolution: staticResolutionContext() });
    const spend = await checkOperationalProgramAdmissibility(externalSpendProgram(), { resolution: staticResolutionContext() });
    expect(financial.status).toBe("ADMISSIBLE");
    expect(spend.status).toBe("ADMISSIBLE");
    expect(spend.manifest?.requirements).toContainEqual(expect.objectContaining({
      kind: "REQUIRES_SPEND_AUTHORITY",
      amount: 250,
      currency: "USD",
    }));
    const base = externalSpendProgram();
    if (base.body.kind !== "effect") throw new Error("fixture drift");
    const inferred = inferExecutableNodeEffects(base.body, base);
    if (!inferred.declaration) throw new Error("fixture drift");
    const mismatch = reseal(base, (draft) => {
      if (draft.body.kind !== "effect") throw new Error("fixture drift");
      draft.body.effectDeclaration = structuredClone(inferred.declaration!);
      draft.body.arguments.budgetUsd = 999;
    });
    expect(await checkOperationalProgramAdmissibility(mismatch, { resolution: staticResolutionContext() })).toMatchObject({
      status: "REJECTED",
      reasonCodes: expect.arrayContaining(["DECLARATION_ARGUMENT_MISMATCH"]),
    });
  });

  it("admits an exact declared computer mutation and rejects unknown computer data", async () => {
    const declared = await checkOperationalProgramAdmissibility(computerWriteProgram(true), { resolution: staticResolutionContext() });
    const inferred = await checkOperationalProgramAdmissibility(computerWriteProgram(false), { resolution: staticResolutionContext() });
    expect(declared.status).toBe("ADMISSIBLE");
    expect(declared.summary?.dimensions).toEqual(expect.arrayContaining(["COMPUTER", "EXTERNAL", "WRITE", "OBSERVATION"]));
    expect(inferred.status).toBe("REJECTED");
    expect(inferred.reasonCodes).toContain("UNCLASSIFIED_SENSITIVE_EXPORT");
    const mismatch = reseal(computerWriteProgram(true), (draft) => {
      if (draft.body.kind !== "effect") throw new Error("fixture drift");
      const authorized = draft.body.arguments.authorizedEffect as Record<string, unknown>;
      authorized.operation = "void_invoice";
    });
    expect(await checkOperationalProgramAdmissibility(mismatch, { resolution: staticResolutionContext() })).toMatchObject({
      status: "REJECTED",
      reasonCodes: expect.arrayContaining(["DECLARATION_ARGUMENT_MISMATCH"]),
    });
  });

  it("rejects cross-tenant and missing canonical targets", async () => {
    const crossTenant = await checkOperationalProgramAdmissibility(internalCanonicalWriteProgram(), { resolution: staticResolutionContext({ entity: "CROSS_TENANT" }) });
    const missing = await checkOperationalProgramAdmissibility(internalCanonicalWriteProgram(), { resolution: staticResolutionContext({ entity: "MISSING" }) });
    expect(crossTenant).toMatchObject({ status: "REJECTED", reasonCodes: expect.arrayContaining(["ENTITY_RESOLUTION_FAILED"]) });
    expect(crossTenant.resolution?.issues).toEqual(expect.arrayContaining([expect.objectContaining({ reasonCode: "CROSS_TENANT_REFERENCE" })]));
    expect(missing).toMatchObject({ status: "REJECTED", reasonCodes: expect.arrayContaining(["ENTITY_RESOLUTION_FAILED"]) });
  });

  it("rejects stale canonical target evidence", async () => {
    const stale = await checkOperationalProgramAdmissibility(internalCanonicalWriteProgram(), { resolution: staticResolutionContext({ entity: "STALE" }) });
    expect(stale).toMatchObject({ status: "REJECTED", reasonCodes: expect.arrayContaining(["ENTITY_RESOLUTION_FAILED"]) });
    expect(stale.resolution?.issues).toEqual(expect.arrayContaining([expect.objectContaining({ reasonCode: "ENTITY_STALE" })]));
  });

  it("rejects entity type mismatch and unconfigured governed bindings", async () => {
    const mismatch = staticResolutionContext();
    mismatch.provider.resolveEntity = async () => ({ status: "TYPE_MISMATCH", actualType: "payment" });
    const mismatched = await checkOperationalProgramAdmissibility(internalCanonicalWriteProgram(), { resolution: mismatch });
    expect(mismatched.status).toBe("REJECTED");
    expect(mismatched.resolution?.issues).toEqual(expect.arrayContaining([
      expect.objectContaining({ reasonCode: "ENTITY_TYPE_MISMATCH", decision: "REJECTED" }),
    ]));

    const unconfigured = await checkOperationalProgramAdmissibility(declaredCommunicationProgram(), {
      resolution: staticResolutionContext({ configured: false }),
    });
    expect(unconfigured.status).toBe("REJECTED");
    expect(unconfigured.resolution?.issues).toEqual(expect.arrayContaining([
      expect.objectContaining({ reasonCode: "REQUIRED_BINDING_NOT_CONFIGURED", decision: "REJECTED" }),
    ]));
  });

  it("passes exact computer application hints from IR to tenant-scoped capability resolution", async () => {
    const requests: Array<{ externalSystems: string[]; computerApplications: string[]; requiredDimensions: string[] }> = [];
    const resolution = staticResolutionContext();
    const base = resolution.provider.resolveCapability;
    resolution.provider.resolveCapability = async (request) => {
      requests.push({
        externalSystems: request.externalSystems,
        computerApplications: request.computerApplications,
        requiredDimensions: request.requiredDimensions,
      });
      return base(request);
    };
    const result = await checkOperationalProgramAdmissibility(computerWriteProgram(true), { resolution });
    expect(result.status).toBe("ADMISSIBLE");
    expect(requests).toEqual([{
      externalSystems: ["accounting_app"],
      computerApplications: ["accounting_app"],
      requiredDimensions: ["AUTHORITY", "COMPUTER", "EXTERNAL", "OBSERVATION", "READ", "REVERSIBILITY", "WRITE"],
    }]);
  });

  it("rejects missing and incompatible capabilities", async () => {
    const missing = await checkOperationalProgramAdmissibility(internalCanonicalWriteProgram(), { resolution: staticResolutionContext({ capability: "MISSING" }) });
    const mismatch = await checkOperationalProgramAdmissibility(internalCanonicalWriteProgram(), { resolution: staticResolutionContext({ capability: "INCOMPATIBLE" }) });
    expect(missing).toMatchObject({ status: "REJECTED", reasonCodes: expect.arrayContaining(["CAPABILITY_RESOLUTION_FAILED"]) });
    expect(mismatch).toMatchObject({ status: "REJECTED", reasonCodes: expect.arrayContaining(["CAPABILITY_RESOLUTION_FAILED"]) });
  });

  it("rejects missing observation, capability mismatch, and illegal resource writes", async () => {
    const base = internalCanonicalWriteProgram();
    if (base.body.kind !== "effect") throw new Error("fixture drift");
    const inferred = inferExecutableNodeEffects(base.body, base);
    if (!inferred.declaration) throw new Error("fixture drift");
    const missingObservation = reseal(base, (draft) => {
      if (draft.body.kind !== "effect") throw new Error("fixture drift");
      draft.body.effectDeclaration = structuredClone(inferred.declaration!);
      draft.body.effectDeclaration.contract.observes = [];
    });
    const capabilityMismatch = reseal(base, (draft) => {
      if (draft.body.kind !== "effect") throw new Error("fixture drift");
      draft.body.effectDeclaration = structuredClone(inferred.declaration!);
      const capability = draft.body.effectDeclaration.authorityRequirements.find((entry) => entry.kind === "REQUIRES_CAPABILITY");
      if (!capability || capability.kind !== "REQUIRES_CAPABILITY") throw new Error("fixture drift");
      capability.capability = "action:send_message";
    });
    const illegalWrite = reseal(base, (draft) => {
      if (draft.body.kind !== "effect") throw new Error("fixture drift");
      draft.body.effectDeclaration = structuredClone(inferred.declaration!);
      draft.body.effectDeclaration.contract.writes[0]!.resource.type = "invoice";
    });
    const communication = declaredCommunicationProgram();
    const missingFlow = reseal(communication, (draft) => {
      if (draft.body.kind !== "effect" || !draft.body.effectDeclaration) throw new Error("fixture drift");
      draft.body.effectDeclaration.informationFlows = [];
    });
    expect(await checkOperationalProgramAdmissibility(missingObservation, { resolution: staticResolutionContext() })).toMatchObject({ status: "REJECTED", reasonCodes: expect.arrayContaining(["MISSING_MANDATORY_OBSERVATION"]) });
    expect(await checkOperationalProgramAdmissibility(capabilityMismatch, { resolution: staticResolutionContext() })).toMatchObject({ status: "REJECTED", reasonCodes: expect.arrayContaining(["CAPABILITY_DECLARATION_MISMATCH"]) });
    expect(await checkOperationalProgramAdmissibility(illegalWrite, { resolution: staticResolutionContext() })).toMatchObject({ status: "REJECTED", reasonCodes: expect.arrayContaining(["ILLEGAL_RESOURCE_WRITE"]) });
    expect(await checkOperationalProgramAdmissibility(missingFlow, { resolution: staticResolutionContext() })).toMatchObject({ status: "REJECTED", reasonCodes: expect.arrayContaining(["MISSING_INFORMATION_FLOW_DECLARATION"]) });
  });

  it("rejects malformed preconditions, postconditions, and authority requirements", async () => {
    const base = internalCanonicalWriteProgram();
    if (base.body.kind !== "effect") throw new Error("fixture drift");
    const inferred = inferExecutableNodeEffects(base.body, base);
    if (!inferred.declaration) throw new Error("fixture drift");
    const badConditions = reseal(base, (draft) => {
      if (draft.body.kind !== "effect") throw new Error("fixture drift");
      draft.body.effectDeclaration = structuredClone(inferred.declaration!);
      draft.body.effectDeclaration.contract.requires = [];
      draft.body.effectDeclaration.contract.ensures = [];
    });
    const malformedAuthority = structuredClone(declaredCommunicationProgram()) as unknown as Record<string, unknown>;
    const body = malformedAuthority.body as { effectDeclaration: { authorityRequirements: Array<Record<string, unknown>> } };
    body.effectDeclaration.authorityRequirements.push({ requirementId: "authority.bad-spend", kind: "REQUIRES_SPEND_AUTHORITY", amount: -1, currency: "usd" });
    const conditions = await checkOperationalProgramAdmissibility(badConditions, { resolution: staticResolutionContext() });
    expect(conditions.reasonCodes).toEqual(expect.arrayContaining(["MALFORMED_PRECONDITION", "MALFORMED_POSTCONDITION"]));
    expect(await checkOperationalProgramAdmissibility(malformedAuthority, { resolution: staticResolutionContext() })).toMatchObject({ status: "REJECTED", reasonCodes: ["MALFORMED_OPERATIONAL_IR"] });
  });

  it("keeps absent DB proof UNRESOLVED and never silently ADMISSIBLE", async () => {
    const result = await checkOperationalProgramAdmissibility(internalCanonicalWriteProgram());
    expect(result.status).toBe("UNRESOLVED");
    expect(result.reasonCodes).toEqual(expect.arrayContaining(["ENTITY_RESOLUTION_UNRESOLVED", "CAPABILITY_RESOLUTION_UNRESOLVED"]));
  });

  it("rejects forbidden irreversible effects and required compensation omissions", async () => {
    const forbidden = await checkOperationalProgramAdmissibility(declaredCommunicationProgram(), {
      resolution: staticResolutionContext(),
      policy: { forbiddenIrreversibleOperations: ["send_message"] },
    });
    const missingCompensation = await checkOperationalProgramAdmissibility(declaredCommunicationProgram(), {
      resolution: staticResolutionContext(),
      policy: { compensationRequiredOperations: ["send_message"] },
    });
    expect(forbidden.reasonCodes).toContain("FORBIDDEN_IRREVERSIBLE_EFFECT");
    expect(missingCompensation.reasonCodes).toContain("MISSING_COMPENSATION_REQUIREMENT");
  });

  it("accepts valid compensation linkage while preserving unsupported lowering as UNRESOLVED", async () => {
    const result = await checkOperationalProgramAdmissibility(validCompensationProgram(), { resolution: staticResolutionContext() });
    expect(result.status).toBe("UNRESOLVED");
    expect(result.reasonCodes).toContain("UNSUPPORTED_EFFECT_LOWERING");
    expect(result.reasonCodes).not.toContain("INVALID_COMPENSATION_LINKAGE");
  });

  it("rejects invalid compensation linkage", async () => {
    const invalid = reseal(validCompensationProgram(), (draft) => {
      if (draft.body.kind !== "sequence") throw new Error("fixture drift");
      const compensation = draft.body.steps[1];
      if (compensation?.kind !== "compensation" || !compensation.effect.effectDeclaration) throw new Error("fixture drift");
      compensation.effect.effectDeclaration.contract.compensates = "effect.create-task";
    });
    const result = await checkOperationalProgramAdmissibility(invalid, { resolution: staticResolutionContext() });
    expect(result.status).toBe("REJECTED");
    expect(result.reasonCodes).toContain("INVALID_COMPENSATION_LINKAGE");
  });

  it("rejects contradictory HARD effect constraints", async () => {
    const program = reseal(internalCanonicalWriteProgram(), (draft) => {
      draft.constraints.push({
        kind: "constraint",
        semanticId: "constraint.false-capability",
        severity: "HARD",
        category: "capability",
        description: "Contradictory capability assertion.",
        predicate: { kind: "assertion", subject: { kind: "program" }, path: ["requiredCapabilities"], operator: "contains", expected: "action:send_message" },
        evaluation: "SATISFIED",
        entityRefs: [],
      });
    });
    const result = await checkOperationalProgramAdmissibility(program, { resolution: staticResolutionContext() });
    expect(result.reasonCodes).toContain("CONTRADICTORY_HARD_EFFECT_CONSTRAINT");
  });

  it("classifies unsupported inference and lowering explicitly", async () => {
    const unsupported = reseal(internalCanonicalWriteProgram(), (draft) => {
      if (draft.body.kind !== "effect") throw new Error("fixture drift");
      draft.body.operation = "not_a_registered_action";
      draft.body.requiredCapability = "action:not_a_registered_action";
    });
    expect(await checkOperationalProgramAdmissibility(unsupported, { resolution: staticResolutionContext() })).toMatchObject({
      status: "UNRESOLVED",
      reasonCodes: expect.arrayContaining(["UNSUPPORTED_EFFECT_INFERENCE"]),
    });
    expect(await checkOperationalProgramAdmissibility(sequenceProgram(), { resolution: staticResolutionContext() })).toMatchObject({
      status: "REJECTED",
      reasonCodes: expect.arrayContaining(["UNSUPPORTED_EFFECT_LOWERING", "UNCLASSIFIED_SENSITIVE_EXPORT"]),
    });
  });

  it("fail-closes the P2 lowerer before the existing lowerer and preserves downstream gates", async () => {
    const admissible = await lowerStaticallyAdmissibleOperationalProgram(internalCanonicalWriteProgram(), loweringContext(), { resolution: staticResolutionContext() });
    const illegal = await lowerStaticallyAdmissibleOperationalProgram(atomicProgram(), loweringContext(), { resolution: staticResolutionContext() });
    expect(admissible).toMatchObject({
      status: "LOWERED",
      lowering: { status: "LOWERED", value: { kind: "domain_action_plan" } },
      admissibility: { manifest: { runtimeAuthorityReevaluationRequired: true, businessEffectCompilationRequired: true } },
    });
    expect(illegal).toMatchObject({ status: "REJECTED", admissibility: { status: "REJECTED" } });
  });
});

describe("P2 runtime mapping and semantic differential", () => {
  it("classifies every IR to existing runtime mapping without fabricating parity", () => {
    expect(new Set(IR_RUNTIME_MAPPING_MATRIX.map((row) => row.classification))).toEqual(new Set(["LOSSLESS", "LOSSY", "RUNTIME_ONLY"]));
    expect(IR_RUNTIME_MAPPING_MATRIX).toEqual(expect.arrayContaining([
      expect.objectContaining({ p2Semantic: "runtime authority decision", classification: "RUNTIME_ONLY" }),
      expect.objectContaining({ p2Semantic: "computer mutation", runtimeOwner: "ComputerAuthorizedEffect", classification: "LOSSLESS" }),
    ]));
  });

  it("projects requirements downward without BusinessEffect or AuthorityDecision identity", () => {
    const program = computerWriteProgram(true);
    const summary = composeOperationalProgramEffects(program);
    const projection = projectP2RequirementsToExistingRuntime(summary);
    expect(projection).toEqual([expect.objectContaining({
      nodeId: "effect.computer-invoice",
      domainAction: { actionType: "computer_task", classification: "LOSSLESS" },
      businessEffect: expect.objectContaining({ operationClass: "external_side_effect", expectedObservation: "computer_state" }),
      computerAuthorizedEffect: expect.objectContaining({ operation: "update_invoice", changes: { status: "sent" } }),
    })]);
    expect(JSON.stringify(projection)).not.toMatch(/businessEffectId|authorityDecisionId|semanticHash|idempotency/);
    expect(authorizedRequirementManifest(program, summary).runtimeAuthorityReevaluationRequired).toBe(true);
  });

  it("detects an unexplained runtime semantic weakening as REGRESSION", () => {
    const program = internalCanonicalWriteProgram();
    const summary = composeOperationalProgramEffects(program);
    const action: DomainAction = {
      id: "30000000-0000-4000-8000-000000000002",
      tenantId: FIXED_TENANT_ID,
      actionType: "create_task",
      payload: {},
      policyId: null,
      status: "draft",
      createdAt: FIXED_NOW,
    };
    const effect: BusinessEffectSet = {
      id: "60000000-0000-4000-8000-000000000001",
      schemaVersion: 1,
      semanticHash: "a".repeat(64),
      scopeHash: "b".repeat(64),
      source: { domainActionId: action.id, actionType: action.actionType, workId: null, objectiveStepId: null },
      mode: "consequential",
      operation: { name: "create_task", class: "internal_write", external: true },
      targets: [{ kind: "entity", type: "household", id: "40000000-0000-4000-8000-000000000001", sourcePath: "householdId" }],
      bindings: [],
      preconditions: [{ kind: "exists", target: { kind: "entity", type: "household", id: "40000000-0000-4000-8000-000000000001" }, description: "exists" }],
      before: [],
      delta: { operation: "create_task", values: {} },
      expected: { observation: "recorded_result", state: { exists: true } },
      exposure: null,
      authority: { capability: "action:create_task", risk: "medium", policyId: null, policyVersion: null },
      approval: { required: true, typedConfirmation: false, summary: "Create task" },
      reversibility: { classification: "safely_reversible", compensationCapability: null },
      uncertainty: { unknownOutcome: "reconcile_before_retry", stalePrecondition: "block_and_recompile" },
      provenance: { compiler: "finnor_effect_compiler", compilerVersion: 1, compiledAt: FIXED_NOW, replacementForEffectId: null, compensationForEffectId: null },
    };
    const result = compareP2EffectsToExistingRuntime({ summary, nodeId: "effect.create-task", domainAction: action, businessEffect: effect });
    expect(result.classification).toBe("REGRESSION");
    expect(result.reasonCodes).toContain("semantic_mismatch:external_mutation");
    expect(result.fields.map((entry) => entry.field)).toEqual([
      "resource_reads_writes", "pii_exposure", "external_mutation", "communication",
      "financial_exposure", "computer_mutation", "required_capability", "risk_approval",
      "reversibility", "preconditions", "required_observation", "compensation",
    ]);
  });
});
