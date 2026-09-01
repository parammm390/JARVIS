import { describe, expect, it } from "vitest";
import {
  computerWriteProgram,
  declaredCommunicationProgram,
  financialWriteProgram,
  internalCanonicalWriteProgram,
} from "../../operational-ir/fixtures/p2-programs";
import { inferExecutableNodeEffects } from "@finnor/operational-ir";
import { reseal } from "../../operational-ir/fixtures/programs";
import { SPECULATIVE_ADAPTER_INVENTORY, classifyEffectAdapter } from "./adapters";

function adapter(program: ReturnType<typeof internalCanonicalWriteProgram>) {
  if (program.body.kind !== "effect") throw new Error("fixture drift");
  return classifyEffectAdapter(program.body, program).adapterClass;
}

describe("closed speculative adapter inventory", () => {
  it("routes existing P2 declarations to their hypothetical capability class", () => {
    expect(adapter(internalCanonicalWriteProgram())).toBe("CANONICAL_WRITE");
    expect(adapter(declaredCommunicationProgram())).toBe("COMMUNICATION");
    expect(adapter(financialWriteProgram())).toBe("FINANCIAL_EFFECT");
    expect(adapter(computerWriteProgram())).toBe("COMPUTER_MUTATION");

    const base = internalCanonicalWriteProgram();
    if (base.body.kind !== "effect") throw new Error("fixture drift");
    const inferred = inferExecutableNodeEffects(base.body, base);
    if (!inferred.declaration) throw new Error("fixture declaration unavailable");
    const provider = reseal(base, (draft) => {
      if (draft.body.kind !== "effect") throw new Error("fixture drift");
      draft.body.effectDeclaration = {
        ...structuredClone(inferred.declaration!),
        source: "IR_DECLARED",
        externalMutations: [{ system: "audited-provider", resource: { kind: "resource", type: "provider_request", selector: "NEW" } }],
      };
    });
    expect(adapter(provider)).toBe("PROVIDER_MUTATION");
  });

  it("exposes all read/write/external/wait/observation classes with zero real side effects", () => {
    expect(SPECULATIVE_ADAPTER_INVENTORY).toHaveLength(8);
    expect(new Set(SPECULATIVE_ADAPTER_INVENTORY.map((entry) => entry.adapterClass)).size).toBe(8);
    expect(SPECULATIVE_ADAPTER_INVENTORY.every((entry) => entry.output === "hypothetical_only" && entry.realSideEffects === 0)).toBe(true);
  });

  it("fails closed when one P2 effect mixes multiple external adapter classes", () => {
    const communication = declaredCommunicationProgram();
    const financial = financialWriteProgram();
    if (communication.body.kind !== "effect" || financial.body.kind !== "effect" || !communication.body.effectDeclaration) throw new Error("fixture drift");
    const inferredFinancial = inferExecutableNodeEffects(financial.body, financial).declaration;
    if (!inferredFinancial) throw new Error("fixture financial declaration unavailable");
    const financialDeclaration = structuredClone(inferredFinancial);
    const mixed = reseal(communication, (draft) => {
      if (draft.body.kind !== "effect" || !draft.body.effectDeclaration) throw new Error("fixture drift");
      draft.body.effectDeclaration.financial = financialDeclaration.financial;
    });
    if (mixed.body.kind !== "effect") throw new Error("fixture drift");
    expect(classifyEffectAdapter(mixed.body, mixed)).toMatchObject({
      status: "UNSUPPORTED",
      reasonCodes: expect.arrayContaining(["MULTI_CLASS_EXTERNAL_EFFECT_REQUIRES_EXPLICIT_P2_LOWERING"]),
    });
  });
});
