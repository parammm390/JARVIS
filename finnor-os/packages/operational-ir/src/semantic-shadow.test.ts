import { describe, expect, it } from "vitest";
import {
  compareSemanticSnapshots,
  runPureShadowCompilation,
  runPureShadowCandidateCompilation,
  semanticSnapshotFromOperationalProgram,
  ZERO_SHADOW_MUTATIONS,
  type SemanticSnapshot,
  type TrustedLoweringContext,
  type OperationalProgram,
  type OperationalProgramSemanticEnvelope,
} from "./index";
import {
  atomicProgram,
  FIXED_ACTION_IDS,
  FIXED_NOW,
  FIXED_TENANT_ID,
  FIXED_WORK_ID,
  queryProgram,
  reseal,
  sequenceProgram,
} from "../fixtures/programs";

function cloneSnapshot(snapshot: SemanticSnapshot): SemanticSnapshot {
  return structuredClone(snapshot);
}

function loweringContext(): TrustedLoweringContext {
  return {
    tenantId: FIXED_TENANT_ID,
    createdAt: FIXED_NOW,
    domainActionIds: { ...FIXED_ACTION_IDS },
    workId: FIXED_WORK_ID,
  };
}

function envelopeOf(program: OperationalProgram): OperationalProgramSemanticEnvelope {
  const { irSemanticHash: _hash, executionModel: _executionModel, body: _body, ...envelope } = structuredClone(program);
  return envelope;
}

describe("normalized semantic diff", () => {
  const baseline = semanticSnapshotFromOperationalProgram(atomicProgram());

  it("classifies normalized semantic parity as EQUIVALENT", () => {
    expect(compareSemanticSnapshots({ legacy: baseline, ir: cloneSnapshot(baseline) })).toEqual({
      classification: "EQUIVALENT",
      equivalent: true,
      differences: [],
      reasonCodes: ["normalized_semantics_equal"],
    });
  });

  it("classifies only restrictive additions as EXPECTED_IMPROVEMENT", () => {
    const strengthened = cloneSnapshot(baseline);
    strengthened.scope.excluded.push("entity:household:40000000-0000-4000-8000-000000000099");
    strengthened.hardConstraints.push('{"category":"risk_exposure","description":"No unapproved exposure"}');
    strengthened.expectedObservations.push('{"evidence":{"kind":"canonical_state"},"verificationFloor":"EXISTING_OR_STRONGER"}');
    expect(compareSemanticSnapshots({ legacy: baseline, ir: strengthened })).toMatchObject({
      classification: "EXPECTED_IMPROVEMENT",
      equivalent: false,
      differences: [
        { field: "scope.excluded", relation: "IR_SUPERSET" },
        { field: "hardConstraints", relation: "IR_SUPERSET" },
        { field: "expectedObservations", relation: "IR_SUPERSET" },
      ],
    });
  });

  it("fails target, effect, capability, and verification weakening as REGRESSION", () => {
    const changed = cloneSnapshot(baseline);
    changed.canonicalTargets = ["entity:household:forged"];
    changed.requiredCapabilities = [];
    changed.expectedObservations = [];
    const result = compareSemanticSnapshots({ legacy: baseline, ir: changed });
    expect(result.classification).toBe("REGRESSION");
    expect(result.reasonCodes).toEqual(expect.arrayContaining([
      "semantic_mismatch:canonicalTargets",
      "semantic_mismatch:requiredCapabilities",
      "semantic_mismatch:expectedObservations",
    ]));
  });

  it("fails a changed Operational Query request as REGRESSION", () => {
    const query = queryProgram();
    const legacy = semanticSnapshotFromOperationalProgram(query);
    const changed = cloneSnapshot(legacy);
    changed.queryIntents = ['{"request":{"intent":"business_state"}}'];
    expect(compareSemanticSnapshots({ legacy, ir: changed })).toMatchObject({
      classification: "REGRESSION",
      reasonCodes: ["semantic_mismatch:queryIntents"],
    });
  });

  it("classifies unsupported and invalid seams explicitly", () => {
    expect(compareSemanticSnapshots({ fixtureValid: false })).toMatchObject({ classification: "FIXTURE_INVALID" });
    expect(compareSemanticSnapshots({ legacyStatus: "UNSUPPORTED", irStatus: "SUPPORTED", ir: baseline })).toMatchObject({ classification: "LEGACY_UNSUPPORTED" });
    expect(compareSemanticSnapshots({ legacyStatus: "SUPPORTED", irStatus: "UNSUPPORTED", legacy: baseline })).toMatchObject({ classification: "IR_UNSUPPORTED" });
    expect(compareSemanticSnapshots({ legacyStatus: "SUPPORTED", irStatus: "SUPPORTED", legacy: baseline })).toMatchObject({ classification: "FIXTURE_INVALID" });
  });

  it("ignores only metadata excluded before snapshot construction", () => {
    const metadataOnly = reseal(atomicProgram(), (draft) => {
      draft.compilerVersion = "other-compiler/99";
      draft.provenance.compiledAt = "2035-01-01T00:00:00.000Z";
      draft.provenance.traceId = "unrelated-trace";
      draft.nonSemantic = { artifactId: "other-artifact", runtimeTimestamp: "2035-01-01T00:00:00.000Z" };
    });
    expect(compareSemanticSnapshots({
      legacy: baseline,
      ir: semanticSnapshotFromOperationalProgram(metadataOnly),
    }).classification).toBe("EQUIVALENT");
  });
});

describe("pure shadow compilation", () => {
  it("uses the same candidate, keeps the existing path authoritative, and has no mutation capability", () => {
    const program = atomicProgram();
    const legacy = semanticSnapshotFromOperationalProgram(program);
    const record = runPureShadowCompilation({
      sourceCandidateFingerprint: "sha256:fixed-planner-candidate",
      sameCandidateUsed: true,
      program,
      legacySnapshot: legacy,
      loweringContext: loweringContext(),
    });
    expect(record).toMatchObject({
      mode: "PURE_SHADOW",
      authoritativePath: "EXISTING",
      sameCandidateUsed: true,
      sourceCandidateFingerprint: "sha256:fixed-planner-candidate",
      irSemanticHash: program.irSemanticHash,
      validation: { valid: true },
      lowering: { status: "LOWERED", target: "domain_action_plan" },
      semanticDiff: { classification: "EQUIVALENT" },
      mutations: ZERO_SHADOW_MUTATIONS,
    });
    expect(Object.isFrozen(record.mutations)).toBe(true);
  });

  it("never accepts a compiler or model callback seam", () => {
    const source = runPureShadowCompilation.toString();
    expect(source).not.toMatch(/await|\.query\(|\.execute\(|provider|llm|modelCall/i);
    expect(Object.keys({
      sourceCandidateFingerprint: "fixed",
      sameCandidateUsed: true,
      program: queryProgram(),
    })).toEqual(["sourceCandidateFingerprint", "sameCandidateUsed", "program"]);
  });

  it("reports malformed IR as FIXTURE_INVALID with zero mutations", () => {
    const invalid = { ...queryProgram(), irSemanticHash: `ir:sha256:${"0".repeat(64)}` };
    const record = runPureShadowCompilation({ sourceCandidateFingerprint: "fixed-invalid", sameCandidateUsed: true, program: invalid });
    expect(record.semanticDiff.classification).toBe("FIXTURE_INVALID");
    expect(record.lowering.status).toBe("INVALID");
    expect(record.mutations).toEqual(ZERO_SHADOW_MUTATIONS);
  });

  it("reports current multi-step Objective lowering as IR_UNSUPPORTED", () => {
    const program = sequenceProgram();
    const record = runPureShadowCompilation({
      sourceCandidateFingerprint: "fixed-sequence",
      sameCandidateUsed: true,
      program,
      legacySnapshot: semanticSnapshotFromOperationalProgram(program),
    });
    expect(record.validation.valid).toBe(true);
    expect(record.lowering.status).toBe("UNSUPPORTED");
    expect(record.semanticDiff.classification).toBe("IR_UNSUPPORTED");
    expect(record.mutations).toEqual(ZERO_SHADOW_MUTATIONS);
  });

  it("reports an absent legacy representation as LEGACY_UNSUPPORTED", () => {
    const record = runPureShadowCompilation({
      sourceCandidateFingerprint: "fixed-query",
      sameCandidateUsed: true,
      program: queryProgram(),
      legacyStatus: "UNSUPPORTED",
    });
    expect(record.lowering.status).toBe("LOWERED");
    expect(record.semanticDiff.classification).toBe("LEGACY_UNSUPPORTED");
  });

  it("compiles the exact existing Query candidate through IR and back in one pure same-candidate shadow", () => {
    const program = queryProgram();
    const record = runPureShadowCandidateCompilation({
      sourceCandidateFingerprint: "sha256:existing-query-candidate",
      sameCandidateUsed: true,
      candidate: {
        kind: "instruction_route",
        decision: { version: 1, route: "QUERY", reasonCodes: ["deterministic_canonical_read"], queryDecision: { route: "fast_read" } },
        query: {
          request: program.body.kind === "query" ? program.body.request : { intent: "business_state" },
          semanticId: "query.customer",
          purpose: "The requested canonical customer record has been acquired.",
        },
      },
      envelope: envelopeOf(program),
      legacySnapshot: semanticSnapshotFromOperationalProgram(program),
    });
    expect(record).toMatchObject({
      status: "COMPILED",
      authoritativePath: "EXISTING",
      sameCandidateUsed: true,
      adaptation: { classification: "LOSSLESS", value: { irSemanticHash: program.irSemanticHash } },
      shadow: { lowering: { status: "LOWERED", target: "operational_query" }, semanticDiff: { classification: "EQUIVALENT" } },
      mutations: ZERO_SHADOW_MUTATIONS,
    });
  });

  it("records an inapplicable conversation candidate without constructing or mutating IR", () => {
    const program = queryProgram();
    const record = runPureShadowCandidateCompilation({
      sourceCandidateFingerprint: "sha256:conversation-candidate",
      sameCandidateUsed: true,
      candidate: { kind: "instruction_route", decision: { version: 1, route: "CONVERSATION", reasonCodes: ["non_business_conversation"] } },
      envelope: envelopeOf(program),
      legacySnapshot: semanticSnapshotFromOperationalProgram(program),
    });
    expect(record).toMatchObject({
      status: "NOT_APPLICABLE",
      authoritativePath: "EXISTING",
      adaptation: { classification: "NOT_APPLICABLE" },
      semanticDiff: { classification: "IR_UNSUPPORTED" },
      mutations: ZERO_SHADOW_MUTATIONS,
    });
  });
});
