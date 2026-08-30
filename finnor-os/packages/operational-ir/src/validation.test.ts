import { describe, expect, it } from "vitest";
import {
  atomicProgram,
  branchProgram,
  compensationProgram,
  parallelProgram,
  queryProgram,
  reseal,
  sequenceProgram,
  waitProgram,
  HOUSEHOLD_REF,
  FIXED_HOUSEHOLD_ID,
} from "../fixtures/programs";
import { analyzeProgramGraph, computeIrSemanticHash, sealOperationalProgram, semanticSnapshotFromOperationalProgram, validateOperationalProgram, type OperationalProgram } from "./index";

function errorCodes(program: unknown): string[] {
  return validateOperationalProgram(program).errors.map((issue) => issue.code);
}

describe("Operational IR schema and static validation", () => {
  it("accepts the complete smallest atomic Effect program", () => {
    const program = atomicProgram();
    const result = validateOperationalProgram(program);
    expect(result.valid).toBe(true);
    expect(result.errors).toEqual([]);
    expect(program.goal.statement).not.toBe(program.body.kind === "effect" ? program.body.operation : "");
  });

  it("accepts Query, Sequence, Parallel, Branch, Wait, and Compensation structures", () => {
    for (const program of [queryProgram(), sequenceProgram(), parallelProgram(), branchProgram(), waitProgram(), compensationProgram()]) {
      expect(validateOperationalProgram(program), program.semanticId).toMatchObject({ valid: true, errors: [] });
    }
  });

  it("derives sequence dependencies structurally without changing existing execution", () => {
    const graph = analyzeProgramGraph(sequenceProgram().body);
    expect(graph.edges).toContainEqual({ from: "effect.send-message", to: "effect.create-task", source: "sequence" });
    expect(semanticSnapshotFromOperationalProgram(sequenceProgram()).dependencies).toContain("effect.send-message->effect.create-task");
  });

  it("rejects a schema with a required artifact missing", () => {
    const program = atomicProgram() as unknown as Record<string, unknown>;
    const { goal: _goal, ...missingGoal } = program;
    expect(errorCodes(missingGoal)).toContain("SCHEMA_INVALID");
  });

  it("rejects duplicate semantic ids across artifact kinds", () => {
    const program = reseal(atomicProgram(), (draft) => { draft.scope.semanticId = draft.goal.semanticId; });
    expect(errorCodes(program)).toContain("DUPLICATE_SEMANTIC_ID");
  });

  it("rejects malformed dependency references", () => {
    const program = reseal(atomicProgram(), (draft) => {
      if (draft.body.kind === "effect") draft.body.dependsOn = ["effect.missing"];
    });
    expect(errorCodes(program)).toContain("MALFORMED_DEPENDENCY");
  });

  it("rejects duplicate and self dependencies", () => {
    const duplicate = reseal(sequenceProgram(), (draft) => {
      if (draft.body.kind === "sequence" && draft.body.steps[1]?.kind === "effect") draft.body.steps[1].dependsOn = ["effect.send-message", "effect.send-message"];
    });
    expect(errorCodes(duplicate)).toContain("DUPLICATE_DEPENDENCY");
    const self = reseal(sequenceProgram(), (draft) => {
      if (draft.body.kind === "sequence" && draft.body.steps[0]?.kind === "effect") draft.body.steps[0].dependsOn = [draft.body.steps[0].semanticId];
    });
    expect(errorCodes(self)).toContain("SELF_DEPENDENCY");
  });

  it("rejects forbidden dependency cycles", () => {
    const program = reseal(sequenceProgram(), (draft) => {
      if (draft.body.kind !== "sequence") return;
      const first = draft.body.steps[0];
      const second = draft.body.steps[1];
      if (first?.kind === "effect" && second?.kind === "effect") {
        first.dependsOn = [second.semanticId];
        second.dependsOn = [first.semanticId];
      }
    });
    expect(errorCodes(program)).toContain("DEPENDENCY_CYCLE");
  });

  it("rejects known HARD violations but retains SOFT violations as warnings", () => {
    const hard = reseal(atomicProgram(), (draft) => { draft.constraints[0]!.evaluation = "VIOLATED"; });
    expect(errorCodes(hard)).toContain("HARD_CONSTRAINT_VIOLATED");
    const soft = reseal(atomicProgram(), (draft) => {
      draft.constraints[0]!.severity = "SOFT";
      draft.constraints[0]!.evaluation = "VIOLATED";
    });
    const result = validateOperationalProgram(soft);
    expect(result.valid).toBe(true);
    expect(result.warnings.map((issue) => issue.code)).toContain("SOFT_CONSTRAINT_VIOLATED");
  });

  it("represents unresolved and ambiguous refs without guessing", () => {
    const program = reseal(queryProgram(), (draft) => {
      draft.entities.push({ kind: "entity_ref", semanticId: "entity.unknown", entityType: "household", resolution: { status: "unresolved", expression: "the Smiths", reason: "no unique canonical match" } });
      draft.entities.push({ kind: "entity_ref", semanticId: "entity.ambiguous", entityType: "household", resolution: {
        status: "ambiguous",
        expression: "the Smiths",
        reason: "two canonical matches",
        candidates: [
          { kind: "entity", type: "household", id: "40000000-0000-4000-8000-000000000011" },
          { kind: "entity", type: "household", id: "40000000-0000-4000-8000-000000000012" },
        ],
      } });
    });
    const result = validateOperationalProgram(program);
    expect(result.valid).toBe(true);
    expect(result.warnings.map((issue) => issue.code)).toEqual(expect.arrayContaining(["UNRESOLVED_ENTITY_REFERENCE", "AMBIGUOUS_ENTITY_REFERENCE"]));
  });

  it("rejects an Effect that targets an ambiguous ref", () => {
    const program = reseal(atomicProgram(), (draft) => {
      draft.entities[0] = { kind: "entity_ref", semanticId: HOUSEHOLD_REF.semanticId, entityType: "household", resolution: {
        status: "ambiguous",
        expression: "the customer",
        reason: "two matches",
        candidates: [
          { kind: "entity", type: "household", id: FIXED_HOUSEHOLD_ID },
          { kind: "entity", type: "household", id: "40000000-0000-4000-8000-000000000099" },
        ],
      } };
    });
    expect(errorCodes(program)).toContain("UNRESOLVED_EFFECT_TARGET");
  });

  it("rejects model-invented tenant identity even inside open query/effect data", () => {
    const effectForgery = reseal(atomicProgram(), (draft) => {
      if (draft.body.kind === "effect") draft.body.arguments.tenantId = "90000000-0000-4000-8000-000000000001";
    });
    expect(errorCodes(effectForgery)).toContain("TENANT_IDENTITY_FORBIDDEN");
    const queryForgery = reseal(queryProgram(), (draft) => {
      if (draft.body.kind === "query") (draft.body.request as unknown as Record<string, unknown>).tenant_id = "90000000-0000-4000-8000-000000000001";
    });
    expect(errorCodes(queryForgery)).toContain("TENANT_IDENTITY_FORBIDDEN");
  });

  it("rejects alternate tenant selectors and tenant-shaped EntityRefs", () => {
    for (const key of ["tenant", "tenant_id", "targetTenantId", "owning_tenant_ref"]) {
      const forgery = reseal(queryProgram(), (draft) => {
        if (draft.body.kind === "query") (draft.body.request as unknown as Record<string, unknown>)[key] = "90000000-0000-4000-8000-000000000001";
      });
      expect(errorCodes(forgery), key).toContain("TENANT_IDENTITY_FORBIDDEN");
    }
    const tenantEntity = reseal(atomicProgram(), (draft) => {
      draft.entities[0]!.entityType = "tenant";
      if (draft.entities[0]!.resolution.status === "resolved") draft.entities[0]!.resolution.canonical.type = "tenant";
    });
    expect(errorCodes(tenantEntity)).toContain("TENANT_IDENTITY_FORBIDDEN");
  });

  it("rejects target bindings that do not match canonical ids", () => {
    const program = reseal(atomicProgram(), (draft) => {
      if (draft.body.kind === "effect") draft.body.arguments.householdId = "40000000-0000-4000-8000-000000000999";
    });
    expect(errorCodes(program)).toContain("GROUNDED_TARGET_MISMATCH");
  });

  it("rejects invalid observations and required goal-observation weakening", () => {
    const missing = reseal(atomicProgram(), (draft) => {
      if (draft.body.kind === "effect") draft.body.expectedObservationRefs = ["observation.missing"];
    });
    expect(errorCodes(missing)).toContain("INVALID_EXPECTED_OBSERVATION");
    const weakened = reseal(queryProgram(), (draft) => { draft.successCondition.criteria = [{ kind: "predicate", predicate: draft.goal.predicate }]; });
    expect(errorCodes(weakened)).toContain("REQUIRED_GOAL_OBSERVATION_OMITTED");
  });

  it("rejects a supplemental observation used as an Effect's expected proof", () => {
    const program = reseal(atomicProgram(), (draft) => { draft.observations[0]!.strength = "SUPPLEMENTAL"; });
    expect(errorCodes(program)).toContain("EXPECTED_OBSERVATION_NOT_REQUIRED");
  });

  it("rejects invalid compensation links", () => {
    const program = reseal(compensationProgram(), (draft) => {
      if (draft.body.kind === "sequence" && draft.body.steps[1]?.kind === "compensation") draft.body.steps[1].forEffectId = "effect.missing";
    });
    expect(errorCodes(program)).toContain("INVALID_COMPENSATION_LINK");
  });

  it("rejects duplicate FIRST_MATCH branch cases/conditions", () => {
    const duplicateCase = reseal(branchProgram(), (draft) => {
      if (draft.body.kind === "branch") draft.body.cases.push(structuredClone(draft.body.cases[0]!));
    });
    expect(errorCodes(duplicateCase)).toEqual(expect.arrayContaining(["DUPLICATE_BRANCH_CASE", "DUPLICATE_BRANCH_CONDITION", "DUPLICATE_SEMANTIC_ID"]));
  });

  it("rejects programs that statically exceed their Budget", () => {
    const program = reseal(sequenceProgram(), (draft) => { draft.budget!.maxSteps = 1; });
    expect(errorCodes(program)).toContain("BUDGET_EXCEEDED");
  });

  it("rejects structure that contradicts QUERY/ATOMIC execution models", () => {
    const queryAsAtomic = reseal(queryProgram(), (draft) => { draft.executionModel = "ATOMIC_ACTION"; });
    expect(errorCodes(queryAsAtomic)).toContain("ATOMIC_MODEL_STRUCTURE_INVALID");
    const sequenceAsAtomic = reseal(sequenceProgram(), (draft) => { draft.executionModel = "ATOMIC_ACTION"; });
    expect(errorCodes(sequenceAsAtomic)).toContain("ATOMIC_MODEL_STRUCTURE_INVALID");
  });

  it("rejects CONVERSATION as not applicable to operational computation", () => {
    const program = reseal(queryProgram(), (draft) => { draft.executionModel = "CONVERSATION"; });
    expect(errorCodes(program)).toContain("CONVERSATION_IR_NOT_APPLICABLE");
  });

  it("rejects CLARIFY as not applicable to executable operational computation", () => {
    const program = reseal(queryProgram(), (draft) => { draft.executionModel = "CLARIFY"; });
    expect(errorCodes(program)).toContain("CLARIFY_IR_NOT_APPLICABLE");
  });

  it("rejects a stale/tampered semantic hash", () => {
    const program = atomicProgram();
    const tampered = { ...program, irSemanticHash: `ir:sha256:${"0".repeat(64)}` } as OperationalProgram;
    expect(computeIrSemanticHash(tampered)).toBe(program.irSemanticHash);
    expect(errorCodes(tampered)).toContain("SEMANTIC_HASH_MISMATCH");
  });

  it("seals strict drafts without using runtime state", () => {
    const program = atomicProgram();
    const { irSemanticHash: _hash, ...draft } = program;
    expect(sealOperationalProgram(draft)).toEqual(program);
  });
});
