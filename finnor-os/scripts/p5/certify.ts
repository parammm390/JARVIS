import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { readFile, readdir } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { canonicalSerialize, canonicalizeIrFragment } from "@finnor/operational-ir";
import { P5_LOCKED_CASES, runP5LockedCorpus } from "../../packages/speculative-runtime/fixtures/locked-corpus";
import { SPECULATIVE_ADAPTER_INVENTORY, ZERO_REAL_SIDE_EFFECTS } from "../../packages/speculative-runtime/src/index";
import { P6_LINEAGE, verifyP6DescendantLineage } from "../p6/verify-descendant-lineage";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const repositoryRoot = resolve(root, "..");
const P5_BASELINE_SHA = "7ec3cee9528b54490e35ae77c19156d466362146";
const P4_CERTIFIED_SHA = "39a114f963b46b2abfde3420037395dfb95610cc";
const P5_FIXTURE_SHA = "0575d50dfa75c915fd0160b76c6eeb69df813336dd2c4e07733bc94805cf8d36";
const P5_RAW_FIXTURE_SHA = "1a5ec39882f37656e02dee9dd8938e467e0147e39dc1626ae0da16ef5c145fb0";
const P5_COMBINED_SHA = "683d68028325d7747e82ddca8d155e0b3b4bff97ca2a6033ab25866fd5be1df1";

// Regression suites are runnable on the later P5 branch. Historical phase
// certifiers remain separate because their immutable branch/lineage locks must
// not be weakened to make a later phase appear certified.
export const P0_P4_REGRESSION_COMMANDS = [
  "npm run test:p0:replay",
  "npm run test:p1:unit",
  "npm run test:p1:contract",
  "npm run test:p2:unit",
  "npm run test:p2:contract",
  "npm run test:p3:unit",
  "npm run test:p3:contract",
  "npm run test:p3:replay",
  "npm run test:p4:unit",
  "npm run test:p4:contract",
  "npm run test:p4:replay",
];

export const P0_P4_HISTORICAL_CERTIFICATION_ENTRYPOINTS = [
  "npm run p0:certify",
  "npm run p1:certify",
  "npm run p2:certify",
  "npm run p3:certify",
  "npm run p4:certify",
];

type JsonObject = Record<string, any>;
type GateManifest = { gates: Array<{ id: string; expected: number; evidence: Array<{ file: string; title: string }> }> };

function git(args: string[]): string {
  return execFileSync("git", args, { cwd: repositoryRoot, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 }).trimEnd();
}

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value as JsonObject)
    .sort(([left], [right]) => left.localeCompare(right)).map(([key, child]) => [key, canonicalize(child)]));
  return value;
}

function deterministicHash(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(canonicalize(value))).digest("hex");
}

async function readJson<T>(path: string): Promise<T> {
  return JSON.parse(await readFile(path, "utf8")) as T;
}

async function filesBelow(directory: string, predicate: (path: string) => boolean): Promise<string[]> {
  const result: string[] = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    if (entry.name === "node_modules" || entry.name.startsWith(".")) continue;
    const path = join(directory, entry.name);
    if (entry.isDirectory()) result.push(...await filesBelow(path, predicate));
    else if (predicate(path)) result.push(path);
  }
  return result.sort();
}

function changedPaths(baseline: string, head: string, includeWorktree: boolean): string[] {
  const committed = git(["diff", "--name-only", baseline, head, "--", "finnor-os"])
    .split("\n").filter(Boolean).map((path) => path.replace(/^finnor-os\//, ""));
  const untracked = includeWorktree
    ? git(["status", "--porcelain=v1", "-uall", "--", "finnor-os"])
      .split("\n").filter(Boolean).map((line) => line.slice(3).split(" -> ").at(-1)!.replace(/^finnor-os\//, ""))
    : [];
  return [...new Set([...committed, ...untracked])].sort();
}

function validateLineageAndScope(baseline: string, head: string, requiredBranch: string | null, includeWorktree: boolean): string[] {
  if (requiredBranch) assert.equal(git(["branch", "--show-current"]), requiredBranch);
  assert.doesNotThrow(() => git(["merge-base", "--is-ancestor", baseline, head]));
  assert.doesNotThrow(() => git(["merge-base", "--is-ancestor", P4_CERTIFIED_SHA, head]));
  const changed = changedPaths(baseline, head, includeWorktree);
  const allowed = changed.filter((path) =>
    path === "package.json"
    || path === "package-lock.json"
    || path === "tsconfig.base.json"
    || path === "vitest.config.ts"
    || path.startsWith("architecture/p5/")
    || path.startsWith("scripts/p5/")
    || path.startsWith("packages/speculative-runtime/")
    || path === "packages/program-search/src/contracts.ts"
    || path === "packages/program-search/src/extraction.ts"
    || path === "packages/program-search/src/index.ts"
    || path === "packages/program-search/src/search.ts"
    || path === "packages/program-search/src/simulation-evidence.ts"
    || path === "packages/program-search/src/simulation-evidence.test.ts"
    || path === "packages/program-search/src/trace.ts"
    || path === "packages/orchestration/package.json"
    || path === "packages/orchestration/src/index.ts"
    || path === "packages/orchestration/src/program-search-shadow.ts"
    || path === "packages/orchestration/src/program-search-shadow.test.ts"
    || path === "packages/orchestration/src/speculative-runtime-shadow.ts"
    || path === "packages/orchestration/src/speculative-runtime-shadow.test.ts"
    || /^tests\/unit\/p5-[^/]+\.test\.ts$/.test(path));
  assert.deepEqual(changed, allowed, `P5 contains out-of-scope changes: ${changed.filter((path) => !allowed.includes(path)).join(", ")}`);
  const protectedPaths = [
    "finnor-os/architecture/p0", "finnor-os/architecture/p1", "finnor-os/architecture/p2", "finnor-os/architecture/p3", "finnor-os/architecture/p4",
    "finnor-os/scripts/p0", "finnor-os/scripts/p1", "finnor-os/scripts/p2", "finnor-os/scripts/p3", "finnor-os/scripts/p4",
    "finnor-os/packages/db", "finnor-os/packages/authority", "finnor-os/packages/computer", "finnor-os/packages/workflow-runtime",
    "finnor-os/packages/shared-types", "finnor-os/packages/operational-ir", "finnor-os/packages/epistemic-runtime",
    "finnor-os/packages/data-platform", "finnor-os/packages/read-models",
    "finnor-os/packages/orchestration/src/planner.ts", "finnor-os/packages/orchestration/src/compiler.ts",
    "finnor-os/packages/orchestration/src/business-effects.ts", "finnor-os/packages/orchestration/src/runtime-bridge.ts",
    "finnor-os/packages/orchestration/src/objective-loop.ts", "finnor-os/packages/orchestration/src/executor.ts",
  ];
  assert.equal(git(["diff", "--name-only", baseline, head, "--", ...protectedPaths]), "", "P5 changed a canonical truth, P0-P4 artifact, execution, Authority, BusinessEffect, Work, Objective, planner, or provider/computer owner");
  const indexDiff = git(["diff", "--unified=0", baseline, head, "--", "finnor-os/packages/orchestration/src/index.ts"]);
  assert.deepEqual(indexDiff.split("\n").filter((line) => line.startsWith("-") && !line.startsWith("---")), [], "P5 removed production orchestration behavior");
  return changed;
}

function graphCycles(graph: Map<string, string[]>): string[][] {
  const result: string[][] = [];
  const complete = new Set<string>();
  const active: string[] = [];
  const visit = (node: string): void => {
    const index = active.indexOf(node);
    if (index >= 0) { result.push([...active.slice(index), node]); return; }
    if (complete.has(node)) return;
    active.push(node);
    for (const next of graph.get(node) ?? []) visit(next);
    active.pop();
    complete.add(node);
  };
  for (const node of [...graph.keys()].sort()) visit(node);
  return result;
}

async function validatePackageGraph(): Promise<{ packages: number; cycles: 0 }> {
  const manifests = await filesBelow(root, (path) => path.endsWith("package.json"));
  const rows = await Promise.all(manifests.map((path) => readJson<{ name?: string; dependencies?: JsonObject; optionalDependencies?: JsonObject; peerDependencies?: JsonObject }>(path)));
  const names = new Set(rows.flatMap((manifest) => manifest.name ? [manifest.name] : []));
  const graph = new Map<string, string[]>();
  for (const manifest of rows) {
    if (!manifest.name) continue;
    const declared = { ...manifest.dependencies, ...manifest.optionalDependencies, ...manifest.peerDependencies };
    graph.set(manifest.name, Object.keys(declared).filter((dependency) => names.has(dependency)).sort());
  }
  assert.deepEqual(graph.get("@finnor/speculative-runtime"), ["@finnor/epistemic-runtime", "@finnor/operational-ir", "@finnor/shared-types"]);
  assert.ok(graph.get("@finnor/orchestration")?.includes("@finnor/speculative-runtime"));
  assert.ok(!graph.get("@finnor/program-search")?.includes("@finnor/speculative-runtime"), "P4 consumes a callback contract and must not depend upward on P5");
  const cycles = graphCycles(graph);
  assert.deepEqual(cycles, []);
  return { packages: graph.size, cycles: 0 };
}

async function validateContractsAndGates(): Promise<Record<string, 0>> {
  const contract = await readJson<JsonObject>(join(root, "architecture/p5/world-runtime-contract.json"));
  assert.equal(contract.ownership.programSelection, "P4");
  assert.equal(contract.ownership.worldPrediction, "P5");
  assert.equal(contract.snapshot.databaseCopy, false);
  assert.equal(contract.shadow.realSideEffects, 0);
  assert.equal(SPECULATIVE_ADAPTER_INVENTORY.length, 8);
  assert.ok(SPECULATIVE_ADAPTER_INVENTORY.every((adapter) => adapter.realSideEffects === 0));
  assert.deepEqual(Object.values(ZERO_REAL_SIDE_EFFECTS), Array(Object.keys(ZERO_REAL_SIDE_EFFECTS).length).fill(0));
  const required = [
    "real_db_mutations_during_simulation", "real_provider_calls_during_simulation", "real_computer_mutations_during_simulation",
    "real_authority_decisions_during_simulation", "real_approval_requests_during_simulation", "real_work_transitions_during_simulation",
    "cross_tenant_world_access", "parent_snapshot_mutations", "branch_state_leakage", "false_verified_completion",
    "hidden_consequential_failure_branches", "P2_rejections_overridden", "P3_mandatory_unknowns_ignored",
    "P4_selection_authority_moved_to_P5", "simulation_budget_overruns", "simulation_nondeterminism", "BusinessEffect_identity_changes",
    "P0_invariant_regressions", "P1_invariant_regressions", "P2_invariant_regressions", "P3_invariant_regressions", "P4_invariant_regressions", "new_package_cycles",
  ];
  const manifest = await readJson<GateManifest>(join(root, "architecture/p5/hard-gates.json"));
  assert.deepEqual(manifest.gates.map((gate) => gate.id).sort(), required.sort());
  const result: Record<string, 0> = {};
  for (const gate of manifest.gates) {
    assert.equal(gate.expected, 0);
    assert.ok(gate.evidence.length > 0);
    for (const evidence of gate.evidence) assert.ok((await readFile(join(root, evidence.file), "utf8")).includes(evidence.title), `${gate.id}:${evidence.file}:${evidence.title}`);
    result[gate.id] = 0;
  }
  return result;
}

async function validateCorpora(): Promise<{ count: 26; canonicalHash: string; combinedHash: string }> {
  const fixtureBytes = await readFile(join(root, "packages/speculative-runtime/fixtures/locked-cases.json"));
  assert.equal(createHash("sha256").update(fixtureBytes).digest("hex"), P5_RAW_FIXTURE_SHA);
  const canonicalHash = createHash("sha256").update(canonicalSerialize(canonicalizeIrFragment(P5_LOCKED_CASES))).digest("hex");
  assert.equal(canonicalHash, P5_FIXTURE_SHA);
  assert.equal(P5_LOCKED_CASES.length, 26);
  const manifest = await readJson<JsonObject>(join(root, "architecture/p5/replay-corpus.json"));
  assert.equal(manifest.fixtureCanonicalSha256, P5_FIXTURE_SHA);
  const combinedHash = String(manifest.combined.corpusHash);
  delete manifest.combined.corpusHash;
  assert.equal(deterministicHash(manifest), combinedHash);
  assert.equal(combinedHash, P5_COMBINED_SHA);
  assert.deepEqual(manifest.combined, { categoryCases: 156, selectorEntries: 203, uniqueSelectors: 202 });
  assert.equal((await runP5LockedCorpus()).length, 26);
  return { count: 26, canonicalHash, combinedHash };
}

function validateReleaseBoundary(): { finalCertification: "PASS"; reconciliationCount: 1; runtimeScope: "SPECULATIVE_SHADOW_ONLY" } {
  const boundary = JSON.parse(readFileSync(join(root, "architecture/p5/production-release-boundary.json"), "utf8")) as JsonObject;
  assert.equal(boundary.p5BaselineSha, P5_BASELINE_SHA);
  assert.equal(boundary.p4CertifiedSha, P4_CERTIFIED_SHA);
  assert.equal(boundary.p5FinalCertification, "PASS");
  assert.equal(boundary.reconciliationCount, 1);
  assert.equal(boundary.runtimeScope, "SPECULATIVE_SHADOW_ONLY");
  return { finalCertification: "PASS", reconciliationCount: 1, runtimeScope: "SPECULATIVE_SHADOW_ONLY" };
}

export async function certifyP5() {
  const lineage = verifyP6DescendantLineage();
  const changed = validateLineageAndScope(P6_LINEAGE.closureMain, P6_LINEAGE.p5Final, null, false);
  const graph = await validatePackageGraph();
  const hardGates = await validateContractsAndGates();
  const corpus = await validateCorpora();
  const productionRelease = validateReleaseBoundary();
  return {
    status: "PASS_FINAL_DESCENDANT_LINEAGE_SHADOW_ONLY",
    finalCertification: "PASS",
    p5BaselineSha: P5_BASELINE_SHA,
    p5SourceSha: P6_LINEAGE.p5Source,
    p5FinalSha: P6_LINEAGE.p5Final,
    p4CertifiedSha: P4_CERTIFIED_SHA,
    closureMainSha: P6_LINEAGE.closureMain,
    branch: lineage.branch,
    changedPaths: changed,
    internalPackages: graph.packages,
    internalPackageCycles: graph.cycles,
    p5ExtensionCases: corpus.count,
    combinedCorpusCases: 156,
    p5CorpusHash: corpus.canonicalHash,
    combinedCorpusHash: corpus.combinedHash,
    hardGates,
    productionBoundary: productionRelease,
    runtimeScope: "SPECULATIVE_SHADOW_ONLY",
  };
}

if (process.argv.includes("--run")) {
  void certifyP5().then((result) => console.log(JSON.stringify(result, null, 2))).catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}
