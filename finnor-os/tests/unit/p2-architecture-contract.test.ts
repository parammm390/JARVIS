import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  AUDITED_OPERATION_EFFECT_CATALOG,
  AUDITED_QUERY_EFFECT_CATALOG,
  EFFECT_DIMENSIONS,
  INFORMATION_CLASSIFICATIONS,
  IR_RUNTIME_MAPPING_MATRIX,
  STATIC_REVERSIBILITY,
} from "../../packages/operational-ir/src/index";

const root = resolve(import.meta.dirname, "../..");
const contract = JSON.parse(readFileSync(resolve(root, "architecture/p2/effect-system-contract.json"), "utf8")) as Record<string, unknown>;
const gates = JSON.parse(readFileSync(resolve(root, "architecture/p2/hard-gates.json"), "utf8")) as {
  gates: Array<{ id: string; expected: number; evidence: Array<{ file: string; title: string }> }>;
};
const audit = JSON.parse(readFileSync(resolve(root, "packages/operational-ir/audit/p2-pre-change-reference-inventory.json"), "utf8")) as Record<string, unknown>;

describe("P2 Operational Effect System architecture contract", () => {
  it("locks the effect taxonomy, information lattice, reversibility, and authority separation", () => {
    expect(contract).toMatchObject({
      p2BaselineSha: "18d35eb27320a8b89377208d652e2230ce2b5deb",
      p1CertifiedSha: "18d35eb27320a8b89377208d652e2230ce2b5deb",
      p1Status: "P1_PASS",
      responsibilityBoundary: { merged: false },
      effectTaxonomy: EFFECT_DIMENSIONS,
      informationClassification: { labels: INFORMATION_CLASSIFICATIONS },
      reversibility: { categories: STATIC_REVERSIBILITY, executionTruth: "Existing BusinessEffectSet reversibility" },
      authorityRequirements: { grantsAuthority: false, producesAuthorityDecision: false, runtimeReevaluationRequired: true },
      staticAdmissibility: { statuses: ["ADMISSIBLE", "REJECTED", "UNRESOLVED"], unresolvedIsAdmissible: false },
    });
    expect(contract.lineageReconciliation).toMatchObject({
      remoteMainSha: "ff9221538f671970c98b83d408b51ca5d63604c5",
      p1RemoteCertifiedSha: null,
      p1LocalCertifiedSha: "18d35eb27320a8b89377208d652e2230ce2b5deb",
      closureAnchorSha: "d8b69d08005f299d39aaa8638a0214b26bd787c7",
      closureP1Sha: "1a31904b35fff39aa1cab1c404f1d7467d723989",
      closureBranch: "codex/p2-operational-effect-system-closure",
      reconciled: true,
    });
  });

  it("locks the audited inference scope and exact IR to existing-runtime mapping classifications", () => {
    const scope = contract.supportedInferenceScope as { queries: string[]; actions: string[] };
    expect(scope.queries).toEqual(Object.keys(AUDITED_QUERY_EFFECT_CATALOG));
    expect(scope.actions).toEqual(Object.keys(AUDITED_OPERATION_EFFECT_CATALOG));
    expect(contract.irRuntimeMapping).toEqual(IR_RUNTIME_MAPPING_MATRIX.map(({ p2Semantic, runtimeOwner, classification }) => ({ p2Semantic, runtimeOwner, classification })));
    expect(contract.shadowAndEnforcement).toMatchObject({
      existingAuthoritative: true,
      behaviorMutationCounters: 0,
      automaticPlannerActionCutover: false,
    });
  });

  it("records the actual P2 current-head audit and every zero-tolerance hard gate with executable evidence", () => {
    expect(audit).toMatchObject({
      auditKind: "P2_PRE_CHANGE_CURRENT_HEAD_AUDIT",
      workspaceHeadAtAudit: "8fcd8a1cebcf92791047777c0d9c70e95fc7aad2",
      p2BaselineSha: "18d35eb27320a8b89377208d652e2230ce2b5deb",
      p1Status: "P1_PASS",
      actualVocabularies: { canonicalEntityTypes: 40, partyTypes: 7, actionHardeningRows: 59, p2AuditedQueryIntents: 17 },
    });
    expect(gates.gates).toHaveLength(18);
    expect(new Set(gates.gates.map((gate) => gate.id)).size).toBe(18);
    for (const gate of gates.gates) {
      expect(gate.expected, gate.id).toBe(0);
      expect(gate.evidence.length, gate.id).toBeGreaterThan(0);
      for (const evidence of gate.evidence) {
        expect(readFileSync(resolve(root, evidence.file), "utf8"), `${gate.id}:${evidence.file}`).toContain(evidence.title);
      }
    }
  });
});
