import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { SPECULATIVE_ADAPTER_INVENTORY, SPECULATIVE_RUNTIME_VERSION } from "@finnor/speculative-runtime";

const OS_ROOT = resolve(import.meta.dirname, "../..");
const REPOSITORY_ROOT = resolve(OS_ROOT, "..");
const BASELINE = "7ec3cee9528b54490e35ae77c19156d466362146";

function json(path: string): any {
  return JSON.parse(readFileSync(join(OS_ROOT, path), "utf8"));
}

describe("P5 architecture contract", () => {
  it("records the exact signed baseline and one final shadow-only reconciliation", () => {
    const boundary = json("architecture/p5/production-release-boundary.json");
    expect(boundary).toMatchObject({
      p5BaselineSha: BASELINE,
      p4CertifiedSha: "39a114f963b46b2abfde3420037395dfb95610cc",
      p5SourceSha: "baa777e8caedaaf09fdfde5f6e901393b90c201f",
      p5FinalCertification: "PASS",
      reconciliationCount: 1,
      runtimeScope: "SPECULATIVE_SHADOW_ONLY",
      authorityChanges: 0,
      workLifecycleChanges: 0,
      businessEffectIdentityChanges: 0,
    });
    expect(execFileSync("git", ["merge-base", "--is-ancestor", boundary.reconciledMainSha, boundary.p5FinalSha], { cwd: REPOSITORY_ROOT }).toString()).toBe("");
    expect(execFileSync("git", ["merge-base", "--is-ancestor", boundary.p5FinalSha, "HEAD"], { cwd: REPOSITORY_ROOT }).toString()).toBe("");
  });

  it("keeps canonical owners and governed mutation runtimes unchanged", () => {
    const protectedPaths = [
      "finnor-os/packages/db",
      "finnor-os/packages/authority",
      "finnor-os/packages/computer",
      "finnor-os/packages/workflow-runtime",
      "finnor-os/packages/shared-types",
      "finnor-os/packages/operational-ir",
      "finnor-os/packages/epistemic-runtime",
      "finnor-os/packages/data-platform",
      "finnor-os/packages/read-models",
    ];
    const changed = execFileSync("git", ["diff", "--name-only", BASELINE, "--", ...protectedPaths], { cwd: REPOSITORY_ROOT, encoding: "utf8" }).trim();
    expect(changed).toBe("");
    expect(json("architecture/p5/pre-change-reference-inventory.json").parallelReplacementsCreated).toBe(0);
  });

  it("defines one closed hypothetical-only adapter per required capability class", () => {
    expect(SPECULATIVE_RUNTIME_VERSION).toBe(1);
    expect(SPECULATIVE_ADAPTER_INVENTORY.map((adapter) => adapter.adapterClass)).toEqual([
      "CANONICAL_READ", "CANONICAL_WRITE", "COMMUNICATION", "FINANCIAL_EFFECT",
      "PROVIDER_MUTATION", "COMPUTER_MUTATION", "WAIT_EVENT", "OBSERVATION",
    ]);
    expect(SPECULATIVE_ADAPTER_INVENTORY.every((adapter) => adapter.output === "hypothetical_only" && adapter.realSideEffects === 0)).toBe(true);
  });

  it("locks every required hard gate to zero with executable evidence", () => {
    const manifest = json("architecture/p5/hard-gates.json");
    const required = [
      "real_db_mutations_during_simulation", "real_provider_calls_during_simulation", "real_computer_mutations_during_simulation",
      "real_authority_decisions_during_simulation", "real_approval_requests_during_simulation", "real_work_transitions_during_simulation",
      "cross_tenant_world_access", "parent_snapshot_mutations", "branch_state_leakage", "false_verified_completion",
      "hidden_consequential_failure_branches", "P2_rejections_overridden", "P3_mandatory_unknowns_ignored",
      "P4_selection_authority_moved_to_P5", "simulation_budget_overruns", "simulation_nondeterminism",
      "BusinessEffect_identity_changes", "P0_invariant_regressions", "P1_invariant_regressions", "P2_invariant_regressions",
      "P3_invariant_regressions", "P4_invariant_regressions", "new_package_cycles",
    ];
    expect(manifest.gates.map((gate: any) => gate.id).sort()).toEqual(required.sort());
    for (const gate of manifest.gates) {
      expect(gate.expected).toBe(0);
      expect(gate.evidence.length).toBeGreaterThan(0);
      for (const evidence of gate.evidence) expect(readFileSync(join(OS_ROOT, evidence.file), "utf8")).toContain(evidence.title);
    }
  });

  it("keeps P5 shadow after the authoritative query and returns that result unchanged", () => {
    const orchestration = readFileSync(join(OS_ROOT, "packages/orchestration/src/index.ts"), "utf8");
    expect(orchestration.indexOf("const result = await this.executeFastOperationalQuery")).toBeLessThan(orchestration.indexOf("void observeOperationalQueryP4ProgramSearchShadow"));
    expect(orchestration.indexOf("void observeOperationalQueryP4ProgramSearchShadow")).toBeLessThan(orchestration.indexOf("fastQuery = result.execution"));
    const shadow = readFileSync(join(OS_ROOT, "packages/orchestration/src/speculative-runtime-shadow.ts"), "utf8");
    expect(shadow).not.toContain("@finnor/db");
    expect(shadow).not.toContain("@finnor/authority");
    expect(shadow).toContain("programSimulationEvidence");
  });
});
