import { describe, expect, it } from "vitest";
import { composeOperationalProgramEffects } from "@finnor/operational-ir";
import { parallelProgram, sequenceProgram } from "../../operational-ir/fixtures/programs";
import {
  capability,
  checkP2Resolved,
  estimate,
  queryProgram,
  searchProblem,
} from "../fixtures/programs";
import { estimateProgramCost } from "./cost-model";
import { compareProgramSemantics, programSemanticSnapshot } from "./semantic-diff";
import { searchOperationalPrograms } from "./search";
import { createProgramSearchDecisionReceipt, programSearchReceiptToCausalReplayNodes } from "./trace";
import type { SearchCapability } from "./contracts";

function actionCapability(name: string, latency: number): SearchCapability {
  return {
    capability: name,
    available: true,
    version: "locked-action-v1",
    cost: {
      modelCalls: estimate(0, "calls"),
      tokens: estimate(0, "tokens"),
      providerCalls: estimate(1, "calls"),
      financialSpend: estimate(0, "currency_units"),
      expectedLatencyMs: estimate(latency, "ms"),
      humanInterruptions: estimate(0, "interruptions"),
      computerUseMs: estimate(0, "ms"),
      failureRecoveryBurden: estimate(1, "ordinal_units"),
    },
    success: {
      ordinal: 700,
      source: "locked ordinal",
      version: "p4-success-heuristic-v1",
      quality: "CONSERVATIVE_HEURISTIC",
      confidence: "LOW",
      calibratedProbability: false,
      fallbackAssumption: { ordinal: 300, rationale: "Ordinal only." },
    },
  };
}

describe("cost and success model", () => {
  it("sums sequential latency and takes the maximum independent parallel latency", () => {
    const capabilities = [actionCapability("action:send_message", 100), actionCapability("action:create_task", 40)];
    const sequential = estimateProgramCost({ program: sequenceProgram(), capabilities, origin: "PROCEDURE_TEMPLATE" });
    const parallel = estimateProgramCost({ program: parallelProgram(), capabilities, origin: "DETERMINISTIC_REWRITE" });
    expect(sequential.expectedLatencyMs.value).toBe(140);
    expect(parallel.expectedLatencyMs.value).toBe(100);
  });

  it("records source, version, quality, confidence, and fallback for every dimension", () => {
    const result = estimateProgramCost({ program: queryProgram(), capabilities: [capability("money_summary", { latency: null })], origin: "MODEL_CANDIDATE" });
    for (const value of Object.values(result)) {
      expect(value).toEqual(expect.objectContaining({ source: expect.any(String), version: expect.any(String), quality: expect.any(String), confidence: expect.any(String), fallbackAssumption: expect.objectContaining({ value: expect.any(Number), rationale: expect.any(String) }) }));
    }
    expect(result.expectedLatencyMs.value).toBeNull();
    expect(result.modelCalls.value).toBe(1);
  });
});

describe("semantic differential and structured receipt", () => {
  it("classifies equal, better, stricter-safe, and weakened semantics", () => {
    const program = queryProgram();
    const effects = composeOperationalProgramEffects(program);
    const cost = estimateProgramCost({ program, capabilities: [capability("money_summary", { latency: 100 })], origin: "PROCEDURE_TEMPLATE" });
    const baseline = programSemanticSnapshot({ program, effects, cost });
    expect(compareProgramSemantics({ authoritative: baseline, optimized: structuredClone(baseline) }).classification).toBe("EQUIVALENT");

    const better = structuredClone(baseline);
    better.latencyMs -= 1;
    expect(compareProgramSemantics({ authoritative: baseline, optimized: better }).classification).toBe("BETTER_PROGRAM");

    const stricter = structuredClone(baseline);
    stricter.hardConstraints.push("additional-safe-constraint");
    expect(compareProgramSemantics({ authoritative: baseline, optimized: stricter }).classification).toBe("STRICTER_SAFE");

    const weaker = structuredClone(baseline);
    weaker.observations = [];
    expect(compareProgramSemantics({ authoritative: baseline, optimized: weaker }).classification).toBe("REGRESSION");

    const changedUnknownCoverage = structuredClone(baseline);
    changedUnknownCoverage.unknownCostFields = ["expectedLatencyMs"];
    expect(compareProgramSemantics({ authoritative: baseline, optimized: changedUnknownCoverage })).toMatchObject({
      classification: "UNSUPPORTED",
      reasonCodes: ["DIFFERENCE_NOT_PROVEN_SAFE_OR_BETTER"],
    });
  });

  it("emits bounded structured decisions and CausalReplay evidence without goal text or chain-of-thought", async () => {
    const problem = searchProblem();
    const result = await searchOperationalPrograms(problem, { checkP2: checkP2Resolved });
    const receipt = createProgramSearchDecisionReceipt(problem, result);
    const serialized = JSON.stringify(receipt);
    expect(receipt).toMatchObject({ redaction: "STRUCTURED_DECISIONS_ONLY", status: "SELECTED", selectedProgramHash: result.selectedProgramHash });
    expect(serialized).not.toContain(problem.goal.statement);
    expect(serialized.toLowerCase()).not.toContain("chain-of-thought");
    expect(programSearchReceiptToCausalReplayNodes(receipt)).toEqual([
      expect.objectContaining({ stage: "planning", facts: expect.objectContaining({ selectedProgramHash: result.selectedProgramHash }) }),
    ]);
  });
});
