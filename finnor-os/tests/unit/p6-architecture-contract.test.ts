import { execFileSync } from "node:child_process";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { TRACE_COMPILER_VERSION } from "@finnor/trace-compiler";

const OS_ROOT = resolve(import.meta.dirname, "../..");
const REPOSITORY_ROOT = resolve(OS_ROOT, "..");
const BASELINE = "baa777e8caedaaf09fdfde5f6e901393b90c201f";

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
  it("records local P5 status and blocks final P6 certification", () => {
    const boundary = json("architecture/p6/production-release-boundary.json");
    expect(boundary).toMatchObject({
      p6BaselineSha: BASELINE,
      p5LocalSha: BASELINE,
      p5LocalStatus: "PASS_LOCAL_SHADOW_ONLY",
      p5FinalCertification: "BLOCKED_BY_P0_P4_RELEASE_FAILURE",
      currentMainSha: "7ec3cee9528b54490e35ae77c19156d466362146",
      productionRelease: { githubRunId: 33510316331, conclusion: "failure", productionMutationOccurred: false, deploymentOccurred: false, finalPassReached: false },
      reconciliationCount: 0,
    });
    expect(execFileSync("git", ["merge-base", "--is-ancestor", BASELINE, "HEAD"], { cwd: REPOSITORY_ROOT }).toString()).toBe("");
  });

  it("keeps P0-P5 protected owners and historical certifiers unchanged", () => {
    const protectedPaths = [
      "finnor-os/architecture/p0", "finnor-os/architecture/p1", "finnor-os/architecture/p2", "finnor-os/architecture/p3", "finnor-os/architecture/p4", "finnor-os/architecture/p5",
      "finnor-os/scripts/p0", "finnor-os/scripts/p1", "finnor-os/scripts/p2", "finnor-os/scripts/p3", "finnor-os/scripts/p4", "finnor-os/scripts/p5",
      "finnor-os/packages/db", "finnor-os/packages/authority", "finnor-os/packages/computer", "finnor-os/packages/workflow-runtime",
      "finnor-os/packages/shared-types", "finnor-os/packages/operational-ir", "finnor-os/packages/epistemic-runtime", "finnor-os/packages/program-search", "finnor-os/packages/speculative-runtime",
      "finnor-os/packages/data-platform", "finnor-os/packages/read-models", "finnor-os/packages/orchestration",
    ];
    const changed = execFileSync("git", ["diff", "--name-only", BASELINE, "--", ...protectedPaths], { cwd: REPOSITORY_ROOT, encoding: "utf8" }).trim();
    expect(changed).toBe("");
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
