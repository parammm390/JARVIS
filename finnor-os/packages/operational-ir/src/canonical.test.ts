import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { atomicProgram, branchProgram, parallelProgram, reseal, sequenceProgram } from "../fixtures/programs";
import { canonicalSerialize, isIrSemanticHash } from "./index";

describe("Operational IR canonical serialization and semantic hashing", () => {
  it("sorts object keys but preserves meaningful array order", () => {
    expect(canonicalSerialize({ z: 1, a: { d: 4, b: 2 } })).toBe('{"a":{"b":2,"d":4},"z":1}');
    expect(canonicalSerialize(["second", "first"])).toBe('["second","first"]');
  });

  it("is invariant to arbitrary JSON object insertion order", () => {
    fc.assert(fc.property(fc.dictionary(fc.string({ minLength: 1, maxLength: 20 }), fc.jsonValue()), (value) => {
      const reversed = Object.fromEntries(Object.entries(value).reverse());
      expect(canonicalSerialize(value)).toBe(canonicalSerialize(reversed));
    }), { seed: 20260830, numRuns: 100 });
  });

  it("ignores compiler/runtime timestamps, traces, provenance ids, and generated artifact ids", () => {
    const first = atomicProgram();
    const second = reseal(first, (draft) => {
      draft.compilerVersion = "other-compiler/99";
      draft.provenance.compiledAt = "2026-09-01T04:00:00.000Z";
      draft.provenance.traceId = "trace:completely-different";
      draft.provenance.sourceRefs = [{ kind: "work", id: "different-generated-work-id" }];
      draft.nonSemantic = { artifactId: "new-generated-id", runtimeTimestamp: "2026-09-01T04:00:00.000Z", traceIds: ["x", "y"] };
    });
    expect(second.irSemanticHash).toBe(first.irSemanticHash);
  });

  it("normalizes unordered IR sets and parallel branch order", () => {
    const first = branchProgram();
    const second = reseal(first, (draft) => {
      draft.observations.reverse();
      draft.entities.reverse();
      draft.constraints.reverse();
      draft.scope.includeEntityRefs.reverse();
    });
    expect(second.irSemanticHash).toBe(first.irSemanticHash);
    const parallel = parallelProgram();
    const reversed = reseal(parallel, (draft) => { if (draft.body.kind === "parallel") draft.body.branches.reverse(); });
    expect(reversed.irSemanticHash).toBe(parallel.irSemanticHash);
  });

  it("does not normalize semantically meaningful Sequence ordering", () => {
    const first = sequenceProgram();
    const second = reseal(first, (draft) => { if (draft.body.kind === "sequence") draft.body.steps.reverse(); });
    expect(second.irSemanticHash).not.toBe(first.irSemanticHash);
  });

  it("does not normalize FIRST_MATCH branch-case ordering", () => {
    const first = branchProgram();
    const second = reseal(first, (draft) => {
      if (draft.body.kind !== "branch" || !draft.body.otherwise) return;
      const fallback = draft.body.otherwise;
      draft.body.cases.push({
        caseId: "case.fallback-capability",
        when: { kind: "assertion", subject: { kind: "program" }, path: ["capabilities", "task"], operator: "eq", expected: true },
        then: fallback,
      });
      delete draft.body.otherwise;
    });
    const reversed = reseal(second, (draft) => { if (draft.body.kind === "branch") draft.body.cases.reverse(); });
    expect(reversed.irSemanticHash).not.toBe(second.irSemanticHash);
  });

  it("uses a tagged identity domain that cannot masquerade as a BusinessEffect hash/idempotency key", () => {
    const hash = atomicProgram().irSemanticHash;
    expect(isIrSemanticHash(hash)).toBe(true);
    expect(hash).toMatch(/^ir:sha256:[0-9a-f]{64}$/);
    expect(hash).not.toMatch(/^[0-9a-f]{64}$/);
  });

  it("rejects unsupported values, non-finite numbers, Dates, undefined, and cyclic data", () => {
    expect(() => canonicalSerialize(Number.NaN)).toThrow(/non-finite/);
    expect(() => canonicalSerialize(new Date())).toThrow(/Date objects/);
    expect(() => canonicalSerialize(undefined)).toThrow(/undefined/);
    expect(() => canonicalSerialize({ value: undefined })).toThrow(/undefined/);
    const cyclic: Record<string, unknown> = {};
    cyclic.self = cyclic;
    expect(() => canonicalSerialize(cyclic)).toThrow(/cyclic/);
  });
});
