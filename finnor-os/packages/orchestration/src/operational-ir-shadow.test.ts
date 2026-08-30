import { describe, expect, it } from "vitest";
import type { CanonicalOperationalQueryRequest } from "@finnor/shared-types";
import {
  ZERO_SHADOW_MUTATIONS,
  adaptCompiledHumanOperation,
  type CompiledHumanOperationLike,
} from "@finnor/operational-ir";
import type { CompiledHumanOperation } from "./human-operating-compiler";
import {
  observeOperationalQueryIrShadow,
  queryEntityRefs,
  type OperationalIrShadowSummary,
  type OperationalQueryShadowInput,
} from "./operational-ir-shadow";

const FIXED_NOW = "2026-08-30T04:00:00.000Z";
const FIXED_HOUSEHOLD_ID = "40000000-0000-4000-8000-000000000001";

function input(request: CanonicalOperationalQueryRequest = { intent: "customer_lookup", householdId: FIXED_HOUSEHOLD_ID }): OperationalQueryShadowInput {
  const readDecision = { route: "fast_read" as const, confidence: "high" as const, request };
  return {
    routeDecision: { version: 1, route: "QUERY", reasonCodes: ["deterministic_canonical_read"], queryDecision: readDecision },
    readDecision,
    instructionId: "10000000-0000-4000-8000-000000000001",
    workId: "20000000-0000-4000-8000-000000000001",
    workInputId: "30000000-0000-4000-8000-000000000001",
    compiledAt: FIXED_NOW,
  };
}

describe("Operational Query IR shadow integration", () => {
  it("type-checks the pure adapter against the actual CompiledHumanOperation contract", () => {
    const compiled: CompiledHumanOperation = {
      version: 1,
      route: "QUERY",
      capability: "query:customer_lookup",
      target: { scope: "canonical", values: { householdId: FIXED_HOUSEHOLD_ID } },
      date: { scope: "current", values: {} },
      payload: { householdId: FIXED_HOUSEHOLD_ID },
      reasonCodes: ["deterministic_canonical_read"],
    };
    const pureAdapterInput: CompiledHumanOperationLike = compiled;
    expect(adaptCompiledHumanOperation(pureAdapterInput)).toMatchObject({
      classification: "LOSSY",
      value: { executionModel: "QUERY", capability: "query:customer_lookup" },
    });
  });

  it("uses the same route candidate, validates, lowers exactly, and records EQUIVALENT with zero mutations", () => {
    const recorded: OperationalIrShadowSummary[] = [];
    const result = observeOperationalQueryIrShadow(input(), (summary) => recorded.push(summary));
    expect(result.recording).toBe("RECORDED");
    expect(recorded).toEqual([result.summary]);
    expect(result.summary).toMatchObject({
      mode: "PURE_SHADOW",
      authoritativePath: "EXISTING",
      executionModel: "QUERY",
      queryIntent: "customer_lookup",
      sameCandidateUsed: true,
      validationValid: true,
      validationErrorCodes: [],
      loweringStatus: "LOWERED",
      loweringTarget: "operational_query",
      loweringClassification: "LOSSLESS",
      loweredRequestMatches: true,
      semanticDiff: "EQUIVALENT",
      semanticDiffReasonCodes: ["normalized_semantics_equal"],
      ...ZERO_SHADOW_MUTATIONS,
    });
    expect(result.summary.candidateFingerprint).toMatch(/^candidate:sha256:[0-9a-f]{64}$/);
    expect(result.summary.irSemanticHash).toMatch(/^ir:sha256:[0-9a-f]{64}$/);
    expect(result.record).toMatchObject({
      status: "COMPILED",
      sameCandidateUsed: true,
      shadow: {
        authoritativePath: "EXISTING",
        lowering: { status: "LOWERED", value: { kind: "operational_query", request: input().readDecision.request } },
      },
    });
  });

  it("keeps semantic hash stable across provenance timestamps and ids", () => {
    const first = observeOperationalQueryIrShadow(input(), () => undefined);
    const changed = input();
    changed.compiledAt = "2030-01-01T00:00:00.000Z";
    changed.instructionId = "90000000-0000-4000-8000-000000000001";
    changed.workId = "90000000-0000-4000-8000-000000000002";
    changed.workInputId = "90000000-0000-4000-8000-000000000003";
    const second = observeOperationalQueryIrShadow(changed, () => undefined);
    expect(second.summary.irSemanticHash).toBe(first.summary.irSemanticHash);
    expect(second.summary.candidateFingerprint).toBe(first.summary.candidateFingerprint);
  });

  it("normalizes object-key ordering without changing candidate or IR hashes", () => {
    const firstRequest = { intent: "customer_lookup", householdId: FIXED_HOUSEHOLD_ID, name: "Ada" } as const;
    const secondRequest = { name: "Ada", householdId: FIXED_HOUSEHOLD_ID, intent: "customer_lookup" } as const;
    const first = observeOperationalQueryIrShadow(input(firstRequest), () => undefined);
    const second = observeOperationalQueryIrShadow(input(secondRequest), () => undefined);
    expect(second.summary.candidateFingerprint).toBe(first.summary.candidateFingerprint);
    expect(second.summary.irSemanticHash).toBe(first.summary.irSemanticHash);
  });

  it("represents an unresolved text entity explicitly instead of guessing", () => {
    expect(queryEntityRefs({ intent: "party_lookup", query: "the regional installation lead" })).toEqual([{
      kind: "entity_ref",
      semanticId: "entity.query-expression",
      entityType: "unknown",
      resolution: {
        status: "unresolved",
        expression: "the regional installation lead",
        reason: "The existing Operational Query Plane must resolve this expression inside trusted runtime context.",
      },
    }]);
    const result = observeOperationalQueryIrShadow(input({ intent: "party_lookup", query: "the regional installation lead" }), () => undefined);
    expect(result.summary.validationValid).toBe(true);
    expect(result.summary.validationWarningCodes).toEqual(["UNRESOLVED_ENTITY_REFERENCE"]);
  });

  it("rejects a forged tenant selector before lowering", () => {
    const forged = { intent: "customer_lookup", tenantId: "forged-tenant", householdId: FIXED_HOUSEHOLD_ID } as unknown as CanonicalOperationalQueryRequest;
    const result = observeOperationalQueryIrShadow(input(forged), () => undefined);
    expect(result.summary).toMatchObject({
      validationValid: false,
      validationErrorCodes: ["TENANT_IDENTITY_FORBIDDEN"],
      loweringStatus: "INVALID",
      loweredRequestMatches: false,
      semanticDiff: "FIXTURE_INVALID",
      ...ZERO_SHADOW_MUTATIONS,
    });
  });

  it("contains recorder failures and never exposes raw query selectors in the logged summary", () => {
    const secret = "private-customer-selector@example.test";
    const result = observeOperationalQueryIrShadow(
      input({ intent: "customer_lookup", query: secret }),
      () => { throw new Error("logger unavailable"); },
    );
    expect(result.recording).toBe("RECORDER_FAILED");
    expect(JSON.stringify(result.summary)).not.toContain(secret);
    expect(result.summary.semanticDiff).toBe("EQUIVALENT");
  });

  it("has no model, provider, authority, persistence, or execution callback seam", () => {
    expect(Object.keys(input()).sort()).toEqual([
      "compiledAt",
      "instructionId",
      "readDecision",
      "routeDecision",
      "workId",
      "workInputId",
    ]);
    expect(observeOperationalQueryIrShadow.toString()).not.toMatch(/await|provider|authority|persist|execute|model|llm/i);
  });
});
