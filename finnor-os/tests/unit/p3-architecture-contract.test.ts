import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  EPISTEMIC_HEURISTIC_VERSION,
  EPISTEMIC_STATE_VERSION,
  EPISTEMIC_TRACE_VERSION,
  EVIDENCE_KIND_TRUTH_CLASS,
  EXISTING_TRUTH_PRECEDENCE,
} from "../../packages/epistemic-runtime/src/index";

const root = resolve(import.meta.dirname, "../..");
const contract = JSON.parse(readFileSync(resolve(root, "architecture/p3/epistemic-runtime-contract.json"), "utf8")) as Record<string, any>;
const audit = JSON.parse(readFileSync(resolve(root, "architecture/p3/pre-change-reference-inventory.json"), "utf8")) as Record<string, any>;
const corpus = JSON.parse(readFileSync(resolve(root, "architecture/p3/replay-corpus.json"), "utf8")) as Record<string, any>;
const gates = JSON.parse(readFileSync(resolve(root, "architecture/p3/hard-gates.json"), "utf8")) as {
  gates: Array<{ id: string; expected: number; evidence: Array<{ file: string; title: string }> }>;
};

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value as Record<string, unknown>)
    .sort(([left], [right]) => left.localeCompare(right)).map(([key, child]) => [key, canonicalize(child)]));
  return value;
}

describe("P3 Epistemic Runtime architecture contract", () => {
  it("locks explicit belief states, evidence taxonomy, exact P0 precedence, and separate canonical truth", () => {
    expect(EPISTEMIC_STATE_VERSION).toBe(1);
    expect(EPISTEMIC_TRACE_VERSION).toBe(1);
    expect(EPISTEMIC_HEURISTIC_VERSION).toBe("p3-information-value-v1");
    expect(contract.epistemicState).toMatchObject({
      version: 1,
      propositionStatuses: ["KNOWN", "UNKNOWN", "STALE", "CONFLICTING", "UNCERTAIN"],
      canonicalTruthSeparateFromBelief: true,
    });
    expect(contract.evidence.taxonomy).toEqual(Object.keys(EVIDENCE_KIND_TRUTH_CLASS));
    expect(contract.truthPrecedence.exactExistingOrder).toEqual(EXISTING_TRUTH_PRECEDENCE);
    expect(contract.truthPrecedence.lowerSourceCanOverrideCanonical).toBe(false);
  });

  it("locks typed read-only acquisition, safety-first scoring, bounded stopping, P2 monotonicity, and trace redaction", () => {
    expect(contract.informationActions).toMatchObject({
      kinds: ["READ", "RETRIEVE", "ASK", "INSPECT", "RESEARCH", "WAIT"],
      mutability: "READ_ONLY",
      vendorAgnosticSemantics: true,
    });
    expect(contract.decisionValue.ordering).toEqual([
      "safety_legality",
      "decision_relevance",
      "expected_uncertainty_reduction",
      "user_interruption",
      "latency",
      "cost",
      "privacy_failure",
    ]);
    expect(contract.stopAndBudget.budgets).toEqual(["maxActions", "maxUserInterruptions", "maxLatencyMs", "maxCostUnits", "deadline"]);
    expect(contract.p2Handoff.REJECTED).toContain("without acquisition or rerun");
    expect(contract.p2Handoff.actualContract).toBe("@finnor/operational-ir StaticAdmissibilityResult");
    expect(contract.trace).toMatchObject({ redaction: "STRUCTURED_DECISIONS_ONLY" });
    expect(contract.trace.excludes).toContain("chain-of-thought");
  });

  it("locks reconciliation to the independently certified P2 closure and the zero-mutation production shadow", () => {
    expect(contract).toMatchObject({
      p2ClosureSha: "5cc95730babeee99055b5cb00c88b7d66dff8ab8",
      p2ClosureStatus: "P2_CLOSURE_PASS",
      lineageReconciliation: {
        p3BaselineSha: "8fcd8a1cebcf92791047777c0d9c70e95fc7aad2",
        p2ClosureSha: "5cc95730babeee99055b5cb00c88b7d66dff8ab8",
        p2PullRequest: 45,
        p3ClosureBranch: "codex/p3-epistemic-runtime-closure",
        p2CertificationStatus: "PASS",
        reconciled: true,
      },
      productionShadow: {
        authoritativeResultPreservedByIdentity: true,
        newPlannerCalls: 0,
        consequentialMutations: 0,
        persistenceWrites: 0,
        authorityDecisions: 0,
        approvalRequests: 0,
        providerOperations: 0,
        computerRuns: 0,
        workTransitions: 0,
      },
    });
  });

  it("records the exact current-head source audit and no parallel truth, memory, authority, or BusinessEffect owner", () => {
    expect(audit).toMatchObject({
      auditKind: "P3_PRE_CHANGE_CURRENT_HEAD_AUDIT",
      workspaceHeadAtAudit: "8fcd8a1cebcf92791047777c0d9c70e95fc7aad2",
      p3BaselineSha: "8fcd8a1cebcf92791047777c0d9c70e95fc7aad2",
      p2ClosureStatusAtAudit: "RUNNING_NO_P2_CLOSURE_PASS",
      p2LocalCertifiedShaAtAudit: "856c0cc370adc35490b18f9dc1d7244bcf46266f",
      reuseDecision: {
        newContextDatabase: false,
        newMemorySystem: false,
        newCanonicalTruthOwner: false,
        newAuthoritySystem: false,
        newBusinessEffectIdentity: false,
      },
      closureReconciliation: {
        p2ClosureSha: "5cc95730babeee99055b5cb00c88b7d66dff8ab8",
        p2ClosureStatus: "P2_CLOSURE_PASS",
        reconciledAfterAudit: true,
      },
    });
    expect(audit.exactOwners).toHaveLength(15);
  });

  it("locks all 20 zero-tolerance gates to executable evidence and the exact frozen corpus", () => {
    expect(gates.gates).toHaveLength(20);
    expect(new Set(gates.gates.map((gate) => gate.id)).size).toBe(20);
    for (const gate of gates.gates) {
      expect(gate.expected, gate.id).toBe(0);
      expect(gate.evidence.length, gate.id).toBeGreaterThan(0);
      for (const evidence of gate.evidence) {
        const evidencePath = resolve(root, evidence.file);
        expect(existsSync(evidencePath), `${gate.id}:${evidence.file}`).toBe(true);
        expect(readFileSync(evidencePath, "utf8"), `${gate.id}:${evidence.file}`).toContain(evidence.title);
      }
    }
    expect(corpus).toMatchObject({
      fixedClock: "2026-08-31T00:00:00.000Z",
      fixedSeed: 31082026,
      extensionCases: 24,
      fixtureSha256: "ce3632ddf4c3a004347d365361ae307d04257c22ba31672c5fea178ec70c42fc",
      liveExternalDependencies: 0,
      combined: {
        categoryCases: 104,
        selectorEntries: 151,
        uniqueSelectors: 150,
        corpusHash: "62da72452f6d4c0e9a87f307c8f6e8253c966beebaed2f0615a65d427324b2d5",
      },
    });
    const hashInput = structuredClone(corpus);
    delete hashInput.combined.corpusHash;
    expect(corpus.combined.corpusHash).toBe(createHash("sha256").update(JSON.stringify(canonicalize(hashInput))).digest("hex"));
  });
});
