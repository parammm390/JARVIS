import { execFileSync } from "node:child_process";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { TRACE_COMPILER_VERSION } from "@finnor/trace-compiler";
import { verifyP6DescendantLineage } from "../../scripts/p6/verify-descendant-lineage";

const OS_ROOT = resolve(import.meta.dirname, "../..");
const REPOSITORY_ROOT = resolve(OS_ROOT, "..");

function json(path: string): any {
  return JSON.parse(readFileSync(join(OS_ROOT, path), "utf8"));
}

function packageFiles(directory: string): string[] {
  return readdirSync(directory).flatMap((entry) => {
    if (entry === "node_modules" || entry.startsWith(".")) return [];
    const path = join(directory, entry);
    return statSync(path).isDirectory() ? packageFiles(path) : entry === "package.json" ? [path] : [];
  });
}

function cycles(graph: Map<string, string[]>): string[][] {
  const result: string[][] = [];
  const complete = new Set<string>();
  const active: string[] = [];
  const visit = (node: string): void => {
    const at = active.indexOf(node);
    if (at >= 0) { result.push([...active.slice(at), node]); return; }
    if (complete.has(node)) return;
    active.push(node);
    for (const next of graph.get(node) ?? []) visit(next);
    active.pop();
    complete.add(node);
  };
  for (const node of [...graph.keys()].sort()) visit(node);
  return result;
}

describe("P6 architecture contract", () => {
  it("records one final reconciliation while preserving the offline-only boundary", () => {
    const boundary = json("architecture/p6/production-release-boundary.json");
    expect(boundary).toMatchObject({
      p6SourceSha: "04360c912efd6f9c37e54d1b840255701e61a262",
      p5FinalCertification: "PASS",
      p6FinalCertification: "PASS_FINAL_DESCENDANT_LINEAGE_OFFLINE_ONLY",
      reconciliationCount: 1,
      automaticPlannerInput: false,
      procedureCandidateExecutable: false,
      authorityGrantPossible: false,
    });
    expect(execFileSync("git", ["merge-base", "--is-ancestor", boundary.reconciledMainSha, boundary.p5FinalSha], { cwd: REPOSITORY_ROOT }).toString()).toBe("");
    expect(execFileSync("git", ["merge-base", "--is-ancestor", boundary.p5FinalSha, boundary.p6ImplementationSha], { cwd: REPOSITORY_ROOT }).toString()).toBe("");
  });

  it("keeps P0-P5 protected owners and historical certifiers unchanged", () => {
    const lineage = verifyP6DescendantLineage();
    expect(lineage).toMatchObject({ status: "PASS_FINAL_DESCENDANT_LINEAGE", unexplainedSemanticDrift: 0 });
    expect(json("architecture/p6/pre-change-reference-inventory.json")).toMatchObject({ databaseTablesAdded: 0, parallelEventLogsCreated: 0, authoritativeOwnersReplaced: 0 });
  });

  it("defines canonical Trace IR and a frozen non-executing candidate boundary", () => {
    const contract = json("architecture/p6/trace-compiler-contract.json");
    expect(TRACE_COMPILER_VERSION).toBe(1);
    expect(contract.traceIr.edgeKinds).toEqual(["CONTROL", "DATA", "CAUSAL", "OBSERVATION", "AUTHORITY", "RETRY", "COMPENSATION", "TEMPORAL"]);
    expect(contract.identity.distinctFrom).toHaveLength(6);
    expect(contract.normalization.replacementLedger).toBe(false);
    expect(contract.antiUnification.negativeOnlyActionsEnterPositiveBody).toBe(false);
    expect(contract.candidate).toMatchObject({ executionStatus: "NON_EXECUTABLE_HYPOTHESIS", certificationStatus: "UNCERTIFIED_P6_HYPOTHESIS", automaticPlannerInput: false, frozen: true, authorityGrantPossible: false });
  });

  it("adds no package cycle", () => {
    const manifests = packageFiles(OS_ROOT).map((path) => JSON.parse(readFileSync(path, "utf8")));
    const names = new Set(manifests.flatMap((manifest) => manifest.name ? [manifest.name] : []));
    const graph = new Map<string, string[]>();
    for (const manifest of manifests) if (manifest.name) {
      const dependencies = { ...manifest.dependencies, ...manifest.optionalDependencies, ...manifest.peerDependencies };
      graph.set(manifest.name, Object.keys(dependencies).filter((name) => names.has(name)).sort());
    }
    expect(graph.get("@finnor/trace-compiler")).toEqual(["@finnor/shared-types"]);
    expect([...graph].filter(([, dependencies]) => dependencies.includes("@finnor/trace-compiler"))).toEqual([]);
    expect(cycles(graph)).toEqual([]);
  });

  it("locks all P6 hard gates to zero with executable evidence", () => {
    const manifest = json("architecture/p6/hard-gates.json");
    const required = [
      "authority_requirements_generalized_away", "verification_requirements_generalized_away", "consequential_effects_generalized_away",
      "unsafe_retry_inference", "false_loop_inference", "unsupported_branch_fabrication", "provider_ack_treated_as_verified_success",
      "simulated_trace_treated_as_real_support", "cross_tenant_private_value_leakage", "raw_secret_leakage", "PII_literal_leakage_into_procedure",
      "model_chain_of_thought_persisted", "trace_causal_order_violations", "dataflow_binding_nondeterminism", "anti_unification_nondeterminism",
      "procedure_identity_nondeterminism", "ProcedureCandidate_executed", "new_authority_systems", "BusinessEffect_identity_changes",
      "Work_lifecycle_changes", "P0_invariant_regressions", "P1_invariant_regressions", "P2_invariant_regressions", "P3_invariant_regressions",
      "P4_invariant_regressions", "P5_invariant_regressions", "new_package_cycles", "unexplained_semantic_diff_regressions",
    ];
    expect(manifest.gates.map((gate: any) => gate.id).sort()).toEqual(required.sort());
    for (const gate of manifest.gates) {
      expect(gate.expected).toBe(0);
      expect(gate.evidence.length).toBeGreaterThan(0);
      for (const evidence of gate.evidence) expect(readFileSync(join(OS_ROOT, evidence.file), "utf8")).toContain(evidence.title);
    }
  });
});
