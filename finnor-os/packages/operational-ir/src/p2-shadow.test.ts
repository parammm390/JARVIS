import { describe, expect, it } from "vitest";
import {
  P2_ZERO_SHADOW_MUTATIONS,
  decideP2ProposalEnforcement,
  runP2EffectShadow,
} from "./index";
import { atomicProgram, queryProgram } from "../fixtures/programs";
import {
  computerWriteProgram,
  declaredCommunicationProgram,
  financialWriteProgram,
  internalCanonicalWriteProgram,
  staticResolutionContext,
} from "../fixtures/p2-programs";

describe("P2 shadow-first migration", () => {
  it("shadows every representative audited class with zero behavior change", async () => {
    const programs = [
      queryProgram(),
      internalCanonicalWriteProgram(),
      declaredCommunicationProgram(),
      financialWriteProgram(),
      computerWriteProgram(true),
    ];
    for (const program of programs) {
      const record = await runP2EffectShadow({ program, options: { resolution: staticResolutionContext() } });
      expect(record).toMatchObject({
        mode: "P2_EFFECT_SHADOW",
        authoritativePath: "EXISTING",
        behaviorChanged: false,
        admissibility: { status: "ADMISSIBLE" },
        mutations: P2_ZERO_SHADOW_MUTATIONS,
      });
      expect(Object.isFrozen(record.mutations)).toBe(true);
    }
  });

  it("records a stricter disagreement without changing the authoritative path", async () => {
    const record = await runP2EffectShadow({ program: atomicProgram(), options: { resolution: staticResolutionContext() } });
    expect(record).toMatchObject({
      authoritativePath: "EXISTING",
      behaviorChanged: false,
      admissibility: { status: "REJECTED", reasonCodes: expect.arrayContaining(["UNCLASSIFIED_SENSITIVE_EXPORT"]) },
      disagreement: "P2_STRICTER",
      mutations: P2_ZERO_SHADOW_MUTATIONS,
    });
  });

  it("enforces only proven illegality in an explicit operation scope", async () => {
    const illegal = await runP2EffectShadow({ program: atomicProgram(), options: { resolution: staticResolutionContext() } });
    const legal = await runP2EffectShadow({ program: internalCanonicalWriteProgram(), options: { resolution: staticResolutionContext() } });
    expect(decideP2ProposalEnforcement({ operation: "send_message", enforcedOperations: ["send_message"], admissibility: illegal.admissibility })).toEqual({
      decision: "REJECT_PROPOSAL",
      reason: "PROVEN_STATICALLY_ILLEGAL",
    });
    expect(decideP2ProposalEnforcement({ operation: "create_task", enforcedOperations: ["create_task"], admissibility: legal.admissibility })).toEqual({
      decision: "CONTINUE_TO_EXISTING_RUNTIME",
      reason: "STATICALLY_ADMISSIBLE_NOT_AUTHORIZED",
      runtimeAuthorityReevaluationRequired: true,
      businessEffectCompilationRequired: true,
    });
    expect(decideP2ProposalEnforcement({ operation: "send_message", enforcedOperations: [], admissibility: illegal.admissibility })).toEqual({
      decision: "SHADOW_ONLY",
      reason: "OPERATION_OUTSIDE_ENFORCED_SCOPE",
    });
  });

  it("defers unresolved programs instead of admitting them", async () => {
    const record = await runP2EffectShadow({ program: internalCanonicalWriteProgram() });
    expect(record.admissibility.status).toBe("UNRESOLVED");
    expect(decideP2ProposalEnforcement({
      operation: "create_task",
      enforcedOperations: ["create_task"],
      admissibility: record.admissibility,
    })).toEqual({ decision: "DEFER_PROPOSAL", reason: "STATIC_ADMISSIBILITY_UNRESOLVED" });
  });
});
