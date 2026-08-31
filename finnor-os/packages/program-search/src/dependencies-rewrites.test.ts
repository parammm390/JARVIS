import { describe, expect, it } from "vitest";
import { composeOperationalProgramEffects, sealOperationalProgram } from "@finnor/operational-ir";
import { internalCanonicalWriteProgram, parallelConflictingWritesProgram, validCompensationProgram } from "../../operational-ir/fixtures/p2-programs";
import { reseal, sequenceProgram } from "../../operational-ir/fixtures/programs";
import { derivePartialOrder, nodesIndependent } from "./dependencies";
import { generateGuardedRewrites, rewriteInventory } from "./rewrites";
import type { SearchCapability } from "./contracts";

function auditedRecoveryFixture(): { program: ReturnType<typeof validCompensationProgram>; capability: SearchCapability } {
  const complete = validCompensationProgram();
  if (complete.body.kind !== "sequence" || complete.body.steps[0]?.kind !== "effect" || complete.body.steps[1]?.kind !== "compensation") throw new Error("fixture drift");
  const original = complete.body.steps[0];
  const compensation = complete.body.steps[1].effect;
  const { irSemanticHash: _hash, ...draft } = complete;
  const program = sealOperationalProgram({ ...draft, body: original });
  return {
    program,
    capability: {
      capability: compensation.requiredCapability,
      available: true,
      version: "audited-recovery-v1",
      compensation: { forOperation: original.operation, effect: compensation, proofRef: "audit:message-recovery:v1" },
      cost: {},
      success: {
        ordinal: 700,
        source: "test recovery ordinal",
        version: "p4-success-heuristic-v1",
        quality: "CONSERVATIVE_HEURISTIC",
        confidence: "LOW",
        calibratedProbability: false,
        fallbackAssumption: { ordinal: 300, rationale: "Ordinal only." },
      },
    },
  };
}

function minimalCapability(capability: string, options: Partial<SearchCapability> = {}): SearchCapability {
  return {
    capability,
    available: true,
    version: "audited-test-v1",
    cost: {},
    success: {
      ordinal: 700,
      source: "test ordinal",
      version: "p4-success-heuristic-v1",
      quality: "CONSERVATIVE_HEURISTIC",
      confidence: "LOW",
      calibratedProbability: false,
      fallbackAssumption: { ordinal: 300, rationale: "Ordinal only." },
    },
    ...options,
  };
}

describe("causal partial orders", () => {
  it("distinguishes optional sequence order from actual independence", () => {
    const plan = derivePartialOrder(sequenceProgram());
    expect(plan.legal).toBe(true);
    expect(plan.relations).toEqual(expect.arrayContaining([
      expect.objectContaining({ relation: "MAY_PRECEDE", from: "effect.send-message", to: "effect.create-task" }),
      expect.objectContaining({ relation: "INDEPENDENT" }),
    ]));
    expect(nodesIndependent(plan, "effect.send-message", "effect.create-task")).toBe(true);
  });

  it("keeps explicit causal dependencies mandatory", () => {
    const program = reseal(sequenceProgram(), (draft) => {
      if (draft.body.kind !== "sequence" || draft.body.steps[1]?.kind !== "effect") throw new Error("fixture drift");
      draft.body.steps[1].dependsOn = ["effect.send-message"];
    });
    const plan = derivePartialOrder(program);
    expect(plan.relations).toContainEqual(expect.objectContaining({ relation: "MUST_PRECEDE", from: "effect.send-message", to: "effect.create-task" }));
    expect(plan.topologicalLayers).toEqual([["effect.send-message"], ["effect.create-task"]]);
  });

  it("rejects parallel conflicting writes", () => {
    const program = parallelConflictingWritesProgram();
    const plan = derivePartialOrder(program, composeOperationalProgramEffects(program));
    expect(plan.legal).toBe(false);
    expect(plan.relations).toContainEqual(expect.objectContaining({ relation: "CONFLICTS", from: "effect.create-task-a", to: "effect.create-task-b" }));
    expect(plan.reasonCodes).toContain("PARALLEL_WRITE_CONFLICT");
  });
});

describe("guarded rewrite system", () => {
  it("declares every rule with pattern, replacement, preconditions, effect proof class, and cost impact", () => {
    const inventory = rewriteInventory();
    expect(inventory.map((rule) => rule.id)).toEqual([
      "flatten_nested_sequence",
      "remove_semantic_noop_container",
      "canonicalize_constraint_order",
      "reorder_independent_operations",
      "parallelize_independent_operations",
      "batch_compatible_operations",
      "substitute_equivalent_capability",
      "introduce_legal_compensation_path",
      "normalize_branch_structure",
    ]);
    expect(inventory.every((rule) => rule.pattern && rule.replacement && rule.preconditions.length && rule.effectRequirements.length && rule.costImpact)).toBe(true);
  });

  it("parallelizes only a pairwise-independent sequence with equivalent effects", () => {
    const rewrites = generateGuardedRewrites(sequenceProgram(), []);
    const parallel = rewrites.find((rewrite) => rewrite.rule.id === "parallelize_independent_operations");
    expect(parallel).toMatchObject({ safetyClass: "SEMANTIC_EQUIVALENCE", effectRelation: "EQUIVALENT", program: { body: { kind: "parallel" } } });
  });

  it("does not parallelize conflicting writes and emits no rewrite loops to the parent hash", () => {
    const conflict = parallelConflictingWritesProgram();
    expect(generateGuardedRewrites(conflict, []).some((rewrite) => rewrite.rule.id === "parallelize_independent_operations")).toBe(false);
    const sequence = sequenceProgram();
    const rewrites = generateGuardedRewrites(sequence, []);
    expect(rewrites.every((rewrite) => rewrite.program.irSemanticHash !== sequence.irSemanticHash)).toBe(true);
    expect(new Set(rewrites.map((rewrite) => `${rewrite.rule.id}:${rewrite.program.irSemanticHash}`)).size).toBe(rewrites.length);
  });

  it("introduces only an exactly linked audited conditional compensation path", () => {
    const { program, capability } = auditedRecoveryFixture();
    const rewrite = generateGuardedRewrites(program, [capability]).find((candidate) => candidate.rule.id === "introduce_legal_compensation_path");
    expect(rewrite).toMatchObject({
      safetyClass: "STRICTER_SAFE",
      effectRelation: "STRICTER",
      proofRefs: ["audit:message-recovery:v1"],
      program: { body: { kind: "sequence" } },
    });
    const summary = composeOperationalProgramEffects(rewrite!.program);
    expect(summary.compensationLinks).toContainEqual(expect.objectContaining({
      originalEffectId: "effect.send-message",
      compensationEffectId: "effect.compensate-message",
    }));

    const invalid = structuredClone(capability);
    invalid.compensation!.effect.effectDeclaration!.contract.compensates = "effect.somewhere-else";
    expect(generateGuardedRewrites(program, [invalid]).some((candidate) => candidate.rule.id === "introduce_legal_compensation_path")).toBe(false);
  });

  it("binds audited substitutions to the declared available replacement capability", () => {
    const program = internalCanonicalWriteProgram();
    if (program.body.kind !== "effect") throw new Error("fixture drift");
    const replacement = { ...structuredClone(program.body), requiredCapability: "action:create_task_alternative" };
    const original = minimalCapability("action:create_task", { equivalenceClass: "audited-create-task" });
    const alternative = minimalCapability("action:create_task_alternative", {
      equivalenceClass: "audited-create-task",
      substitution: { replacesCapability: "action:create_task", proofRef: "audit:create-task:v1", replacementEffect: replacement },
    });
    expect(generateGuardedRewrites(program, [original, alternative])).toContainEqual(expect.objectContaining({
      rule: expect.objectContaining({ id: "substitute_equivalent_capability" }),
    }));

    const misbound = structuredClone(alternative);
    misbound.substitution!.replacementEffect.requiredCapability = "action:unrelated";
    expect(generateGuardedRewrites(program, [original, misbound]).some((candidate) => candidate.rule.id === "substitute_equivalent_capability")).toBe(false);

    const unavailable = structuredClone(alternative);
    unavailable.available = false;
    expect(generateGuardedRewrites(program, [original, unavailable]).some((candidate) => candidate.rule.id === "substitute_equivalent_capability")).toBe(false);
  });
});
