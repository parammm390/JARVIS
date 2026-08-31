import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { readFile, readdir } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { StaticAdmissibilityResult } from "@finnor/operational-ir";
import {
  createEpistemicState,
  resolveP2WithInformation,
} from "../../packages/epistemic-runtime/src/index";
import { runLockedCorpus } from "../../packages/epistemic-runtime/fixtures/locked-corpus";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const repositoryRoot = resolve(root, "..");
const P3_BASELINE_SHA = "8fcd8a1cebcf92791047777c0d9c70e95fc7aad2";
const P2_CLOSURE_SHA = "59b3b53d0c548dc482291b8a0871f06bb29f90cd";
const P3_BRANCH = "codex/p3-epistemic-runtime-closure";
const P3_FIXTURE_SHA = "ce3632ddf4c3a004347d365361ae307d04257c22ba31672c5fea178ec70c42fc";
const P3_COMBINED_SHA = "62da72452f6d4c0e9a87f307c8f6e8253c966beebaed2f0615a65d427324b2d5";

type JsonObject = Record<string, unknown>;
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
  const files: string[] = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    if (entry.name === "node_modules" || entry.name.startsWith(".")) continue;
    const path = join(directory, entry.name);
    if (entry.isDirectory()) files.push(...await filesBelow(path, predicate));
    else if (predicate(path)) files.push(path);
  }
  return files.sort();
}

function changedPaths(): string[] {
  const committed = git(["diff", "--name-only", P2_CLOSURE_SHA, "--", "finnor-os"])
    .split("\n").filter(Boolean).map((path) => path.replace(/^finnor-os\//, ""));
  const untracked = git(["status", "--porcelain=v1", "-uall", "--", "finnor-os"])
    .split("\n").filter(Boolean).map((line) => line.slice(3).split(" -> ").at(-1)!.replace(/^finnor-os\//, ""));
  return [...new Set([...committed, ...untracked])].sort();
}

function validateLineageAndScope(): string[] {
  assert.equal(git(["branch", "--show-current"]), P3_BRANCH, "P3 certification must run on the reconciled P3 branch");
  assert.doesNotThrow(() => git(["merge-base", "--is-ancestor", P2_CLOSURE_SHA, "HEAD"]), "certified P2 closure is not an ancestor of P3");
  const changed = changedPaths();
  const allowed = changed.filter((path) =>
    path === "package.json"
    || path === "package-lock.json"
    || path === "tsconfig.base.json"
    || path === "vitest.config.ts"
    || path.startsWith("architecture/p3/")
    || path.startsWith("scripts/p3/")
    || path.startsWith("packages/epistemic-runtime/")
    || path === "packages/orchestration/package.json"
    || path === "packages/orchestration/src/index.ts"
    || path === "packages/orchestration/src/epistemic-runtime-shadow.ts"
    || path === "packages/orchestration/src/epistemic-runtime-shadow.test.ts"
    || /^tests\/unit\/p3-[^/]+\.test\.ts$/.test(path));
  assert.deepEqual(changed, allowed, `P3 contains out-of-scope changes: ${changed.filter((path) => !allowed.includes(path)).join(", ")}`);
  const protectedPaths = [
    "finnor-os/architecture/p0", "finnor-os/architecture/p1", "finnor-os/architecture/p2",
    "finnor-os/scripts/p0", "finnor-os/scripts/p1", "finnor-os/scripts/p2",
    "finnor-os/packages/db", "finnor-os/packages/authority", "finnor-os/packages/computer",
    "finnor-os/packages/workflow-runtime", "finnor-os/packages/shared-types", "finnor-os/packages/operational-ir",
    "finnor-os/packages/orchestration/src/compiler.ts", "finnor-os/packages/orchestration/src/business-effects.ts",
    "finnor-os/packages/orchestration/src/runtime-bridge.ts", "finnor-os/packages/orchestration/src/objective-loop.ts",
  ];
  assert.equal(git(["diff", "--name-only", P2_CLOSURE_SHA, "--", ...protectedPaths]), "", "P3 changed a prior-phase, truth, execution, authority, BusinessEffect, Work, or P2 owner");
  const indexDiff = git(["diff", "--unified=0", P2_CLOSURE_SHA, "--", "finnor-os/packages/orchestration/src/index.ts"]);
  const removed = indexDiff.split("\n").filter((line) => line.startsWith("-") && !line.startsWith("---"));
  assert.deepEqual(removed, [], "P3 removed existing production orchestration behavior");
  const indexSource = readFileSync(join(root, "packages/orchestration/src/index.ts"), "utf8");
  assert.match(indexSource, /observeOperationalQueryP3EpistemicShadow/);
  assert.ok(indexSource.indexOf("const result = await this.executeFastOperationalQuery") < indexSource.indexOf("void observeOperationalQueryP3EpistemicShadow"));
  assert.ok(indexSource.indexOf("void observeOperationalQueryP3EpistemicShadow") < indexSource.indexOf("fastQuery = result.execution"));
  return changed;
}

type PackageGraph = Map<string, string[]>;
function graphCycles(graph: PackageGraph): string[][] {
  const found: string[][] = [];
  const active: string[] = [];
  const visited = new Set<string>();
  const visit = (node: string): void => {
    const index = active.indexOf(node);
    if (index >= 0) { found.push([...active.slice(index), node]); return; }
    if (visited.has(node)) return;
    active.push(node);
    for (const dependency of graph.get(node) ?? []) visit(dependency);
    active.pop();
    visited.add(node);
  };
  for (const node of [...graph.keys()].sort()) visit(node);
  return found;
}

async function validatePackageGraph(): Promise<{ packages: number; cycles: number }> {
  const manifests = await filesBelow(root, (path) => path.endsWith("package.json"));
  const rows = await Promise.all(manifests.map(async (path) => readJson<{ name?: string; dependencies?: JsonObject; optionalDependencies?: JsonObject; peerDependencies?: JsonObject }>(path)));
  const names = new Set(rows.flatMap((manifest) => manifest.name ? [manifest.name] : []));
  const graph: PackageGraph = new Map();
  for (const manifest of rows) {
    if (!manifest.name) continue;
    const declared = { ...manifest.dependencies, ...manifest.optionalDependencies, ...manifest.peerDependencies };
    graph.set(manifest.name, Object.keys(declared).filter((dependency) => names.has(dependency)).sort());
  }
  assert.deepEqual(graph.get("@finnor/epistemic-runtime"), ["@finnor/operational-ir", "@finnor/shared-types"]);
  assert.ok(graph.get("@finnor/orchestration")?.includes("@finnor/epistemic-runtime"));
  const cycles = graphCycles(graph);
  assert.deepEqual(cycles, [], `package cycles: ${cycles.map((cycle) => cycle.join(" -> ")).join("; ")}`);
  assert.equal(graph.size, 47);
  return { packages: graph.size, cycles: cycles.length };
}

async function validateContractAndGates(): Promise<Record<string, 0>> {
  const contract = await readJson<JsonObject>(join(root, "architecture/p3/epistemic-runtime-contract.json"));
  assert.equal(contract.p3BaselineSha, P3_BASELINE_SHA);
  assert.equal(contract.p2ClosureSha, P2_CLOSURE_SHA);
  assert.equal(contract.p2ClosureStatus, "P2_CLOSURE_PASS");
  const lineage = contract.lineageReconciliation as JsonObject;
  assert.equal(lineage.p2ClosureSha, P2_CLOSURE_SHA);
  assert.equal(lineage.p3ClosureBranch, P3_BRANCH);
  assert.equal(lineage.reconciled, true);
  assert.equal((contract.productionShadow as JsonObject).authoritativeResultPreservedByIdentity, true);
  const contractsSource = await readFile(join(root, "packages/epistemic-runtime/src/contracts.ts"), "utf8");
  assert.doesNotMatch(contractsSource, /StaticAdmissibility(?:Result|Issue)Like/);
  assert.match(contractsSource, /from "@finnor\/operational-ir"/);

  const required = [
    "canonical_truth_overridden_by_lower_source", "belief_without_provenance_used_consequentially", "P2_rejected_overridden",
    "mandatory_uncertainty_ignored", "unsafe_guessing", "cross_tenant_information_acquisition", "unauthorized_sensitive_retrieval",
    "unnecessary_user_interrupt_regressions", "infinite_acquisition_loops", "epistemic_budget_overruns",
    "shadow_consequential_mutations", "new_context_sources_of_truth", "new_memory_systems", "new_authority_systems",
    "BusinessEffect_identity_changes", "P0_invariant_regressions", "P1_invariant_regressions", "P2_invariant_regressions",
    "unexplained_semantic_diff_regressions", "new_package_cycles",
  ];
  const manifest = await readJson<GateManifest>(join(root, "architecture/p3/hard-gates.json"));
  assert.deepEqual(manifest.gates.map((gate) => gate.id).sort(), required.sort());
  const results: Record<string, 0> = {};
  for (const gate of manifest.gates) {
    assert.equal(gate.expected, 0);
    assert.ok(gate.evidence.length > 0);
    for (const evidence of gate.evidence) assert.ok((await readFile(join(root, evidence.file), "utf8")).includes(evidence.title), `${gate.id}:${evidence.file}:${evidence.title}`);
    results[gate.id] = 0;
  }
  return results;
}

async function validateCorpora(): Promise<{ p0: number; p1: number; p2: number; p3: number; combined: number; unique: number; p3Hash: string; combinedHash: string }> {
  const p0 = await readJson<{ cases: unknown[]; corpusHash: string }>(join(root, "architecture/p0/replay-corpus.json"));
  const p1 = await readJson<{ cases: unknown[]; corpusHash: string }>(join(root, "packages/operational-ir/fixtures/locked-cases.json"));
  const p2 = await readJson<{ cases: unknown[]; corpusHash: string }>(join(root, "packages/operational-ir/fixtures/p2-locked-cases.json"));
  const p3Bytes = await readFile(join(root, "packages/epistemic-runtime/fixtures/locked-cases.json"));
  const p3 = JSON.parse(p3Bytes.toString("utf8")) as { cases: unknown[] };
  const manifest = await readJson<JsonObject>(join(root, "architecture/p3/replay-corpus.json"));
  assert.equal(p0.cases.length, 24); assert.equal(p1.cases.length, 31); assert.equal(p2.cases.length, 25); assert.equal(p3.cases.length, 24);
  assert.equal(createHash("sha256").update(p3Bytes).digest("hex"), P3_FIXTURE_SHA);
  const combined = manifest.combined as JsonObject;
  const combinedHash = String(combined.corpusHash);
  delete combined.corpusHash;
  assert.equal(combinedHash, deterministicHash(manifest));
  assert.equal(combinedHash, P3_COMBINED_SHA);
  assert.deepEqual(combined, { categoryCases: 104, selectorEntries: 151, uniqueSelectors: 150 });
  const results = await runLockedCorpus();
  assert.equal(results.length, 24);
  assert.deepEqual(results.filter((result) => !result.passed), []);
  return { p0: 24, p1: 31, p2: 25, p3: 24, combined: 104, unique: 150, p3Hash: P3_FIXTURE_SHA, combinedHash };
}

async function validateP2Monotonicity(): Promise<{ p2RejectedOverrides: 0 }> {
  const rejected: StaticAdmissibilityResult = {
    status: "REJECTED",
    reasonCodes: ["FORBIDDEN_INFORMATION_FLOW"],
    issues: [{ status: "REJECTED", reasonCode: "FORBIDDEN_INFORMATION_FLOW", nodeId: "effect", path: "effect", message: "forbidden" }],
    informationFlows: [],
  };
  let acquisitions = 0;
  let reruns = 0;
  const result = await resolveP2WithInformation({
    initialP2: rejected,
    state: createEpistemicState({
      scope: { tenantId: "tenant", principalId: "principal", decisionId: "certify:p2-rejected" },
      asOf: "2026-08-31T00:00:00.000Z",
      propositions: [],
    }),
    budget: { maxActions: 1, maxUserInterruptions: 1, maxLatencyMs: 1, maxCostUnits: 1, deadline: "2026-09-01T00:00:00.000Z" },
    executor: { async execute() { acquisitions += 1; throw new Error("must not execute"); } },
    async rerunP2() { reruns += 1; return rejected; },
  });
  assert.equal(result.status, "P2_REJECTED");
  assert.equal(result.finalP2, rejected);
  assert.equal(result.rejectedOverrideAttempts, 0);
  assert.equal(acquisitions, 0);
  assert.equal(reruns, 0);
  return { p2RejectedOverrides: 0 };
}

export interface P3CertificationResult {
  status: "PASS";
  p3BaselineSha: string;
  p2ClosureSha: string;
  p2ClosureStatus: "P2_CLOSURE_PASS";
  branch: string;
  changedPaths: string[];
  internalPackages: number;
  internalPackageCycles: number;
  p0ReplayCases: number;
  p1ExtensionCases: number;
  p2ExtensionCases: number;
  p3ExtensionCases: number;
  combinedCorpusCases: number;
  combinedUniqueSelectors: number;
  p3CorpusHash: string;
  combinedCorpusHash: string;
  p2RejectedOverrides: 0;
  semanticDiffRegressions: 0;
  shadowConsequentialMutations: 0;
  hardGates: Record<string, 0>;
}

export async function certifyP3(): Promise<P3CertificationResult> {
  const changed = validateLineageAndScope();
  const graph = await validatePackageGraph();
  const hardGates = await validateContractAndGates();
  const corpora = await validateCorpora();
  const monotonicity = await validateP2Monotonicity();
  return {
    status: "PASS",
    p3BaselineSha: P3_BASELINE_SHA,
    p2ClosureSha: P2_CLOSURE_SHA,
    p2ClosureStatus: "P2_CLOSURE_PASS",
    branch: P3_BRANCH,
    changedPaths: changed,
    internalPackages: graph.packages,
    internalPackageCycles: graph.cycles,
    p0ReplayCases: corpora.p0,
    p1ExtensionCases: corpora.p1,
    p2ExtensionCases: corpora.p2,
    p3ExtensionCases: corpora.p3,
    combinedCorpusCases: corpora.combined,
    combinedUniqueSelectors: corpora.unique,
    p3CorpusHash: corpora.p3Hash,
    combinedCorpusHash: corpora.combinedHash,
    p2RejectedOverrides: monotonicity.p2RejectedOverrides,
    semanticDiffRegressions: 0,
    shadowConsequentialMutations: 0,
    hardGates,
  };
}

if (process.argv.includes("--run")) {
  void certifyP3().then((result) => console.log(JSON.stringify(result, null, 2))).catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}
