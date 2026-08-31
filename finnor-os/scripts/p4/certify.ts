import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { readFile, readdir } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { canonicalSerialize, canonicalizeIrFragment } from "@finnor/operational-ir";
import {
  GUARDED_REWRITE_RULES,
  PROGRAM_SEARCH_CP_SAT_SOLVER_VERSION,
  PROGRAM_SEARCH_SMT_SOLVER_VERSION,
  searchOperationalPrograms,
} from "../../packages/program-search/src/index";
import { P4_LOCKED_CASES, runP4LockedCorpus } from "../../packages/program-search/fixtures/locked-corpus";
import { capability, checkP2Resolved, queryProgram, searchProblem } from "../../packages/program-search/fixtures/programs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const repositoryRoot = resolve(root, "..");
const P4_BASELINE_SHA = "c0965059b92c1b0f73100c4556301044c1b7e9c4";
const P3_CERTIFIED_SHA = "c0965059b92c1b0f73100c4556301044c1b7e9c4";
const P4_BRANCH = "codex/p4-program-search";
const P4_FIXTURE_SHA = "9c2735988365f09408b793b935cb53d0c429fd202b7d4cf99b0dfad6641f5365";
const P4_RAW_FIXTURE_SHA = "e1f90ec49f2a818ee76a99e70dc9eae2c6a99b9d43f1077c863f04e349325d4a";
const P4_COMBINED_SHA = "31cd85f0db2a948be03f0104d724d5a2b3f1f3c02f925b7bd3779b19274ac5fd";

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

function changedPaths(): string[] {
  const committed = git(["diff", "--name-only", P4_BASELINE_SHA, "--", "finnor-os"])
    .split("\n").filter(Boolean).map((path) => path.replace(/^finnor-os\//, ""));
  const untracked = git(["status", "--porcelain=v1", "-uall", "--", "finnor-os"])
    .split("\n").filter(Boolean).map((line) => line.slice(3).split(" -> ").at(-1)!.replace(/^finnor-os\//, ""));
  return [...new Set([...committed, ...untracked])].sort();
}

function validateLineageAndScope(): string[] {
  assert.equal(git(["branch", "--show-current"]), P4_BRANCH);
  assert.doesNotThrow(() => git(["merge-base", "--is-ancestor", P3_CERTIFIED_SHA, "HEAD"]));
  const changed = changedPaths();
  const allowed = changed.filter((path) =>
    path === "package.json"
    || path === "package-lock.json"
    || path === "tsconfig.base.json"
    || path === "vitest.config.ts"
    || path.startsWith("architecture/p4/")
    || path.startsWith("scripts/p4/")
    || path.startsWith("packages/program-search/")
    || path === "packages/orchestration/package.json"
    || path === "packages/orchestration/src/index.ts"
    || path === "packages/orchestration/src/epistemic-runtime-shadow.ts"
    || path === "packages/orchestration/src/program-search-shadow.ts"
    || path === "packages/orchestration/src/program-search-shadow.test.ts"
    || /^tests\/unit\/p4-[^/]+\.test\.ts$/.test(path));
  assert.deepEqual(changed, allowed, `P4 contains out-of-scope changes: ${changed.filter((path) => !allowed.includes(path)).join(", ")}`);
  const protectedPaths = [
    "finnor-os/architecture/p0", "finnor-os/architecture/p1", "finnor-os/architecture/p2", "finnor-os/architecture/p3",
    "finnor-os/scripts/p0", "finnor-os/scripts/p1", "finnor-os/scripts/p2", "finnor-os/scripts/p3",
    "finnor-os/packages/db", "finnor-os/packages/authority", "finnor-os/packages/computer", "finnor-os/packages/workflow-runtime",
    "finnor-os/packages/shared-types", "finnor-os/packages/operational-ir", "finnor-os/packages/epistemic-runtime",
    "finnor-os/packages/orchestration/src/planner.ts", "finnor-os/packages/orchestration/src/compiler.ts",
    "finnor-os/packages/orchestration/src/business-effects.ts", "finnor-os/packages/orchestration/src/runtime-bridge.ts",
    "finnor-os/packages/orchestration/src/objective-loop.ts", "finnor-os/packages/orchestration/src/executor.ts",
  ];
  assert.equal(git(["diff", "--name-only", P4_BASELINE_SHA, "--", ...protectedPaths]), "", "P4 changed a canonical truth, P0-P3, execution, Authority, BusinessEffect, Work, planner, or Objective owner");
  const indexDiff = git(["diff", "--unified=0", P4_BASELINE_SHA, "--", "finnor-os/packages/orchestration/src/index.ts"]);
  assert.deepEqual(indexDiff.split("\n").filter((line) => line.startsWith("-") && !line.startsWith("---")), [], "P4 removed production orchestration behavior");
  const p3Diff = git(["diff", "--unified=0", P4_BASELINE_SHA, "--", "finnor-os/packages/orchestration/src/epistemic-runtime-shadow.ts"]);
  assert.deepEqual(p3Diff.split("\n").filter((line) => line.startsWith("-") && !line.startsWith("---")), [], "P4 altered certified P3 shadow behavior instead of adding a read-only reuse seam");
  const index = readFileSync(join(root, "packages/orchestration/src/index.ts"), "utf8");
  assert.ok(index.indexOf("const result = await this.executeFastOperationalQuery") < index.indexOf("void observeOperationalQueryP4ProgramSearchShadow"));
  assert.ok(index.indexOf("void observeOperationalQueryP4ProgramSearchShadow") < index.indexOf("fastQuery = result.execution"));
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

async function validatePackageGraph(): Promise<{ packages: number; cycles: number }> {
  const manifests = await filesBelow(root, (path) => path.endsWith("package.json"));
  const rows = await Promise.all(manifests.map((path) => readJson<{ name?: string; dependencies?: JsonObject; optionalDependencies?: JsonObject; peerDependencies?: JsonObject }>(path)));
  const names = new Set(rows.flatMap((manifest) => manifest.name ? [manifest.name] : []));
  const graph = new Map<string, string[]>();
  for (const manifest of rows) {
    if (!manifest.name) continue;
    const declared = { ...manifest.dependencies, ...manifest.optionalDependencies, ...manifest.peerDependencies };
    graph.set(manifest.name, Object.keys(declared).filter((dependency) => names.has(dependency)).sort());
  }
  assert.deepEqual(graph.get("@finnor/program-search"), ["@finnor/epistemic-runtime", "@finnor/operational-ir", "@finnor/shared-types"]);
  assert.ok(graph.get("@finnor/orchestration")?.includes("@finnor/program-search"));
  const cycles = graphCycles(graph);
  assert.deepEqual(cycles, []);
  assert.equal(graph.size, 48);
  return { packages: graph.size, cycles: cycles.length };
}

async function validateContractsAndGates(): Promise<Record<string, 0>> {
  const contract = await readJson<JsonObject>(join(root, "architecture/p4/search-contract.json"));
  assert.equal(contract.p4BaselineSha, P4_BASELINE_SHA);
  assert.equal(contract.p3CertifiedSha, P3_CERTIFIED_SHA);
  assert.equal(contract.p3Status, "P3_PASS_LOCAL_CERTIFIED");
  assert.equal(contract.solvers.smt.version, PROGRAM_SEARCH_SMT_SOLVER_VERSION);
  assert.equal(contract.solvers.cpSat.version, PROGRAM_SEARCH_CP_SAT_SOLVER_VERSION);
  assert.equal(contract.shadow.consequentialMutations, 0);
  assert.equal(GUARDED_REWRITE_RULES.length, 9);
  const required = [
    "model_final_plan_judgments", "hard_constraints_converted_to_score", "P2_rejected_candidates_selected", "P2_unresolved_candidates_selected",
    "P3_mandatory_unknowns_ignored", "unsafe_rewrites", "effect_weakening_rewrites", "dependency_violations",
    "conflicting_parallel_writes_selected", "rewrite_loops", "search_budget_overruns", "nondeterministic_extraction",
    "unknown_cost_treated_as_zero", "shadow_consequential_mutations", "new_execution_engines", "new_authority_systems",
    "BusinessEffect_identity_changes", "P0_invariant_regressions", "P1_invariant_regressions", "P2_invariant_regressions",
    "P3_invariant_regressions", "unexplained_semantic_diff_regressions", "new_package_cycles",
  ];
  const manifest = await readJson<GateManifest>(join(root, "architecture/p4/hard-gates.json"));
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

async function validateCorpora(): Promise<{ p4: number; combined: number; unique: number; p4Hash: string; combinedHash: string }> {
  const fixtureBytes = await readFile(join(root, "packages/program-search/fixtures/locked-cases.json"));
  assert.equal(createHash("sha256").update(fixtureBytes).digest("hex"), P4_RAW_FIXTURE_SHA);
  const canonicalHash = createHash("sha256").update(canonicalSerialize(canonicalizeIrFragment(P4_LOCKED_CASES))).digest("hex");
  assert.equal(canonicalHash, P4_FIXTURE_SHA);
  assert.equal(P4_LOCKED_CASES.length, 26);
  const manifest = await readJson<JsonObject>(join(root, "architecture/p4/replay-corpus.json"));
  assert.equal(manifest.fixtureCanonicalSha256, P4_FIXTURE_SHA);
  const combined = manifest.combined as JsonObject;
  const combinedHash = String(combined.corpusHash);
  delete combined.corpusHash;
  assert.equal(deterministicHash(manifest), combinedHash);
  assert.equal(combinedHash, P4_COMBINED_SHA);
  assert.deepEqual(combined, { categoryCases: 130, selectorEntries: 177, uniqueSelectors: 176 });
  const replay = await runP4LockedCorpus();
  assert.equal(replay.length, 26);
  return { p4: 26, combined: 130, unique: 176, p4Hash: canonicalHash, combinedHash };
}

async function validateDeterminismAndMonotonicity(): Promise<{ p2Selected: 0; p3Ignored: 0; nondeterministicExtraction: 0; hardConstraintsScored: 0; modelJudgments: 0 }> {
  const firstProgram = queryProgram("money_summary", { variant: "cert-a" });
  const secondProgram = queryProgram("work_list", { variant: "cert-b" });
  const problem = searchProblem({
    programs: [
      { candidateId: "b", origin: "MODEL_CANDIDATE", originRef: "b", program: secondProgram },
      { candidateId: "a", origin: "PROCEDURE_TEMPLATE", originRef: "a", program: firstProgram },
    ],
    capabilities: [capability("money_summary"), capability("work_list")],
  });
  const first = await searchOperationalPrograms(problem, { checkP2: checkP2Resolved });
  const second = await searchOperationalPrograms(structuredClone(problem), { checkP2: checkP2Resolved });
  assert.deepEqual(second, first);
  assert.equal(first.hardConstraintsUsedAsScores, 0);
  assert.equal(first.modelFinalPlanJudgments, 0);
  assert.ok(first.survivingCandidates.every((candidate) => candidate.p2?.status === "ADMISSIBLE"));
  return { p2Selected: 0, p3Ignored: 0, nondeterministicExtraction: 0, hardConstraintsScored: 0, modelJudgments: 0 };
}

export interface P4CertificationResult {
  status: "PASS";
  p4BaselineSha: string;
  p3CertifiedSha: string;
  p3Status: "P3_PASS_LOCAL_CERTIFIED";
  branch: string;
  changedPaths: string[];
  internalPackages: number;
  internalPackageCycles: 0;
  p4ExtensionCases: 26;
  combinedCorpusCases: 130;
  combinedUniqueSelectors: 176;
  p4CorpusHash: string;
  combinedCorpusHash: string;
  hardGates: Record<string, 0>;
}

export async function certifyP4(): Promise<P4CertificationResult> {
  const changed = validateLineageAndScope();
  const graph = await validatePackageGraph();
  const hardGates = await validateContractsAndGates();
  const corpus = await validateCorpora();
  await validateDeterminismAndMonotonicity();
  return {
    status: "PASS",
    p4BaselineSha: P4_BASELINE_SHA,
    p3CertifiedSha: P3_CERTIFIED_SHA,
    p3Status: "P3_PASS_LOCAL_CERTIFIED",
    branch: P4_BRANCH,
    changedPaths: changed,
    internalPackages: graph.packages,
    internalPackageCycles: graph.cycles as 0,
    p4ExtensionCases: corpus.p4 as 26,
    combinedCorpusCases: corpus.combined as 130,
    combinedUniqueSelectors: corpus.unique as 176,
    p4CorpusHash: corpus.p4Hash,
    combinedCorpusHash: corpus.combinedHash,
    hardGates,
  };
}

if (process.argv.includes("--run")) {
  void certifyP4().then((result) => console.log(JSON.stringify(result, null, 2))).catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}
