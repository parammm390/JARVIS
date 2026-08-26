import { describe, expect, it } from "vitest";
import fc from "fast-check";
import { createHash } from "node:crypto";
import { canonicalSerialize, comparePlanningSemantics, computeIrSemanticHash, IR_HASH_NAMESPACE } from "@finnor/planning-ir";
import { IrAdmissibilityCompiler, lowerAdmittedPlanningIr, semanticSnapshotFromArtifact } from "@finnor/orchestration";
import { inventoryPlugin, stockUsageDomainEngine } from "../../packages/domain-plugins/inventory";
import { customerCommPlugin, customerMessageDomainEngine } from "../../packages/domain-plugins/customer-comm";
import { computerTaskPlugin, computerTaskDomainEngine } from "../../packages/domain-plugins/computer-task";
import { PHASE1_CORPUS_SEED, PHASE1_FIXED_CLOCK, PHASE1_LOCKED_CORPUS } from "../phase1/locked-corpus";

const base = () => structuredClone(PHASE1_LOCKED_CORPUS.find((entry) => entry.suite === "ir")!.artifact);
const compiler = () => new IrAdmissibilityCompiler({
  groundPayload: async (payload) => Object.keys(payload).filter((key) => key.endsWith("Id")).map((field) => ({ field, status: "verified" as const })),
  groundRef: async () => "verified",
  hasCapability: (capability) => capability === "action:fixture_action",
  hasActionType: (actionType) => actionType === "fixture_action",
  requiredObservation: () => "canonical_state",
  now: () => new Date(PHASE1_FIXED_CLOCK),
});

describe("Planning IR canonical semantics", () => {
  it("hashes equivalent objects identically across key order and non-semantic runtime metadata", () => {
    const artifact = base();
    const reordered = structuredClone(artifact);
    const payload = reordered.effects[0]!.payload;
    reordered.effects[0]!.payload = Object.fromEntries(Object.entries(payload).reverse());
    reordered.metadata.provenance.createdAt = "2099-01-01T00:00:00.000Z";
    reordered.metadata.provenance.traceId = "different-trace";
    reordered.intent.provenance.createdAt = "2099-01-01T00:00:00.000Z";
    reordered.intent.provenance.traceId = "different-trace";
    expect(computeIrSemanticHash(reordered)).toBe(artifact.metadata.irSemanticHash);
  });

  it("neutralizes generated ids while retaining graph topology", () => {
    const artifact = base();
    const renamed = structuredClone(artifact);
    const oldEffect = renamed.effects[0]!.id;
    const oldObservation = renamed.observations[0]!.id;
    const oldEffectNode = renamed.plan.nodes[0]!.id;
    renamed.effects[0]!.id = "generated-effect-replacement";
    renamed.observations[0]!.id = "generated-observation-replacement";
    renamed.observations[0]!.effectId = "generated-effect-replacement";
    if (renamed.plan.nodes[0]!.kind === "effect") renamed.plan.nodes[0]!.effectId = "generated-effect-replacement";
    if (renamed.plan.nodes[1]!.kind === "observe") renamed.plan.nodes[1]!.observationId = "generated-observation-replacement";
    renamed.plan.nodes[0]!.id = "generated-node-a";
    renamed.plan.nodes[1]!.id = "generated-node-b";
    renamed.plan.nodes[1]!.dependsOn = renamed.plan.nodes[1]!.dependsOn.map((id) => id === oldEffectNode ? "generated-node-a" : id);
    renamed.plan.nodes[1]!.causalPrerequisites = renamed.plan.nodes[1]!.causalPrerequisites.map((id) => id === oldEffectNode ? "generated-node-a" : id);
    renamed.plan.completion.observationIds = renamed.plan.completion.observationIds.map((id) => id === oldObservation ? "generated-observation-replacement" : id);
    expect(oldEffect).not.toBe(renamed.effects[0]!.id);
    expect(computeIrSemanticHash(renamed)).toBe(artifact.metadata.irSemanticHash);
  });

  it("does not normalize semantically meaningful payload ordering", () => {
    const left = base();
    left.effects[0]!.payload.sequence = ["inspect", "write", "verify"];
    const right = structuredClone(left);
    right.effects[0]!.payload.sequence = ["write", "inspect", "verify"];
    expect(computeIrSemanticHash(left)).not.toBe(computeIrSemanticHash(right));
  });

  it("retains semantic payload identifiers that overlap runtime metadata names", () => {
    const left = base();
    left.effects[0]!.payload = { ...left.effects[0]!.payload, workId: "work-a", field: "status" };
    const right = structuredClone(left);
    right.effects[0]!.payload = { ...right.effects[0]!.payload, workId: "work-b" };
    expect(computeIrSemanticHash(left)).not.toBe(computeIrSemanticHash(right));
  });

  it("repeats canonical hashes deterministically under fixed-seed object-key fuzz", () => {
    fc.assert(fc.property(fc.dictionary(fc.string({ minLength: 1, maxLength: 12 }), fc.oneof(fc.integer(), fc.boolean(), fc.string())), (record) => {
      const reversed = Object.fromEntries(Object.entries(record).reverse());
      return canonicalSerialize(record) === canonicalSerialize(reversed);
    }), { seed: PHASE1_CORPUS_SEED, numRuns: 250 });
  });

  it("uses an explicit namespace separate from effect/idempotency identity", () => {
    const ir = base().metadata.irSemanticHash;
    const effectLike = createHash("sha256").update(`finnor.business-effect.semantic/v1\0${canonicalSerialize(base().effects)}`).digest("hex");
    expect(IR_HASH_NAMESPACE).toBe("finnor.planning-ir.semantic/v1");
    expect(ir).not.toBe(effectLike);
  });

  it("classifies replacement of a legacy hard constraint as a regression, not an improvement", () => {
    const legacy = semanticSnapshotFromArtifact(base());
    legacy.hardConstraints = [{ id: "legacy-bound", strength: "HARD", kind: "precondition", description: "Retain the existing bound", status: "satisfied", subjectRefs: [], values: { revision: 7 } }];
    const ir = structuredClone(legacy);
    ir.hardConstraints = [{ id: "different-bound", strength: "HARD", kind: "precondition", description: "A different bound", status: "satisfied", subjectRefs: [], values: { revision: 8 } }];
    expect(comparePlanningSemantics(legacy, ir).classification).toBe("REGRESSION");
  });
});

describe("IR admissibility and lowering boundary", () => {
  it("admits and lowers through the existing DomainAction representation", async () => {
    const result = await compiler().admit(base());
    expect(result.admissible).toBe(true);
    if (!result.admissible) return;
    expect(lowerAdmittedPlanningIr(result.admitted)[0]).toMatchObject({
      actionType: "fixture_action",
      requiredCapability: "action:fixture_action",
      planning: {
        intent: { executionModel: result.admitted.artifact.intent.executionModel },
        goal: { objectiveCompatibility: "reuse_existing_objective_semantics" },
        completion: { mode: "all" },
      },
    });
  });

  it("rejects acknowledgement-only evidence and known HARD violations", async () => {
    const acknowledgement = base();
    acknowledgement.observations[0]!.requiredEvidence = ["provider_acknowledgement"];
    acknowledgement.metadata.irSemanticHash = computeIrSemanticHash(acknowledgement);
    expect((await compiler().admit(acknowledgement)).admissible).toBe(false);

    const hard = base();
    hard.constraints.hard = [{ id: "known-conflict", strength: "HARD", kind: "user_restriction", description: "User prohibited this mutation", status: "violated", subjectRefs: [], values: {} }];
    hard.metadata.irSemanticHash = computeIrSemanticHash(hard);
    expect((await compiler().admit(hard)).admissible).toBe(false);
  });

  it("accepts a violated SOFT preference without downgrading it into a HARD rule", async () => {
    const soft = base();
    soft.constraints.soft = [{ id: "preference", strength: "SOFT", kind: "preference", description: "Prefer the morning", status: "violated", subjectRefs: [], values: { window: "morning" } }];
    soft.metadata.irSemanticHash = computeIrSemanticHash(soft);
    expect((await compiler().admit(soft)).admissible).toBe(true);
  });

  it("rejects graph corruption under fixed-seed property fuzz", async () => {
    await fc.assert(fc.asyncProperty(fc.integer({ min: 1, max: 10_000 }), async (suffix) => {
      const candidate = base();
      candidate.plan.nodes[0]!.dependsOn = [`nonexistent-${suffix}`];
      candidate.metadata.irSemanticHash = computeIrSemanticHash(candidate);
      return !(await compiler().admit(candidate)).admissible;
    }), { seed: PHASE1_CORPUS_SEED, numRuns: 100 });
  });

  it("grounds effect-only forged refs and rejects effects without causal observation proof", async () => {
    const forged = base();
    forged.effects[0]!.targetRefs = [{ kind: "asset", entityType: "equipment", entityId: "00000000-0000-4000-8000-00000000dead" }];
    forged.metadata.irSemanticHash = computeIrSemanticHash(forged);
    const rejectingCompiler = new IrAdmissibilityCompiler({
      groundPayload: async () => [],
      groundRef: async (ref) => ref.entityId.endsWith("dead") ? "not_found" : "verified",
      hasCapability: () => true,
      hasActionType: () => true,
      requiredObservation: () => "canonical_state",
      now: () => new Date(PHASE1_FIXED_CLOCK),
    });
    const forgedResult = await rejectingCompiler.admit(forged);
    expect(forgedResult.admissible).toBe(false);
    if (!forgedResult.admissible) expect(forgedResult.issues.some((entry) => entry.code === "TARGET_NOT_GROUNDED" && entry.path.includes("targetRefs"))).toBe(true);

    const missingObservation = base();
    missingObservation.observations = [];
    missingObservation.plan.nodes = missingObservation.plan.nodes.filter((node) => node.kind !== "observe");
    missingObservation.plan.completion.observationIds = ["missing-observation"];
    missingObservation.metadata.irSemanticHash = computeIrSemanticHash(missingObservation);
    expect((await compiler().admit(missingObservation)).admissible).toBe(false);
  });
});

describe("pure DomainEngine migrated classes", () => {
  it.each([
    ["log_stock_used_on_visit", inventoryPlugin, stockUsageDomainEngine],
    ["send_customer_message", customerCommPlugin, customerMessageDomainEngine],
    ["computer_task", computerTaskPlugin, computerTaskDomainEngine],
  ] as const)("keeps %s intelligence pure while the legacy adapter stays governed", (actionType, plugin, intelligence) => {
    expect(plugin.intelligence).toBe(intelligence);
    expect(intelligence.actionTypes).toContain(actionType);
    expect("execute" in intelligence).toBe(false);
    expect("tools" in intelligence).toBe(false);
    expect(typeof plugin.execute).toBe("function");
  });

  it("never treats provider acknowledgement as delivered external truth", () => {
    expect(customerMessageDomainEngine.reconcileDecision({ actionType: "send_customer_message", payload: {}, observation: { providerAcknowledged: true } })).toEqual({ status: "pending", reasonCodes: ["PROVIDER_ACK_IS_NOT_DELIVERY"] });
  });
});
