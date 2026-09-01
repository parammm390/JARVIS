import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { canonicalSerialize, TRACE_SOURCE_OWNERS } from "@finnor/trace-compiler";
import { P6_LOCKED_CASES, runP6LockedCorpus } from "../../packages/trace-compiler/fixtures/locked-corpus";
import { P6_LINEAGE, verifyP6DescendantLineage } from "./verify-descendant-lineage";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const RAW_FIXTURE_HASH = "7bdfd7d17e4086c398e92fd1390e49adce8c92c0217096e7153032a8cc425dec";
const CANONICAL_FIXTURE_HASH = "192d07f939b223f7ec0f3be3b202ef5ea704529a07e5746e54092316152d685c";
const LOCKED_RESULT_HASH = "8e450419d22c780309299a8da0a3bd709d3ed10f23e99c2fc2ad8fae9b9d139a";
const COMBINED_CORPUS_HASH = "30c62819459c3c898378b8b4ab40381c4ff2a7293c8ba8936317cf48142fa35d";

type JsonObject = Record<string, any>;
type GateManifest = { gates: Array<{ id: string; expected: number; evidence: Array<{ file: string; title: string }> }> };

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

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value as JsonObject)
    .sort(([left], [right]) => left.localeCompare(right)).map(([key, child]) => [key, canonicalize(child)]));
  return value;
}

function hash(value: string | Buffer): string {
  return createHash("sha256").update(value).digest("hex");
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
  const manifests = await Promise.all((await filesBelow(root, (path) => path.endsWith("package.json")))
    .map((path) => readJson<{ name?: string; dependencies?: JsonObject; optionalDependencies?: JsonObject; peerDependencies?: JsonObject }>(path)));
  const names = new Set(manifests.flatMap((manifest) => manifest.name ? [manifest.name] : []));
  const graph = new Map<string, string[]>();
  for (const manifest of manifests) if (manifest.name) {
    const dependencies = { ...manifest.dependencies, ...manifest.optionalDependencies, ...manifest.peerDependencies };
    graph.set(manifest.name, Object.keys(dependencies).filter((name) => names.has(name)).sort());
  }
  assert.deepEqual(graph.get("@finnor/trace-compiler"), ["@finnor/shared-types"]);
  assert.deepEqual([...graph].filter(([, dependencies]) => dependencies.includes("@finnor/trace-compiler")), []);
  assert.deepEqual(graphCycles(graph), []);
  return { packages: graph.size, cycles: 0 };
}

async function validateContractsAndGates(): Promise<Record<string, 0>> {
  const contract = await readJson<JsonObject>(join(root, "architecture/p6/trace-compiler-contract.json"));
  assert.deepEqual(contract.traceIr.edgeKinds, ["CONTROL", "DATA", "CAUSAL", "OBSERVATION", "AUTHORITY", "RETRY", "COMPENSATION", "TEMPORAL"]);
  assert.equal(contract.normalization.replacementLedger, false);
  assert.equal(contract.antiUnification.negativeOnlyActionsEnterPositiveBody, false);
  assert.equal(contract.candidate.automaticPlannerInput, false);
  assert.equal(contract.candidate.authorityGrantPossible, false);
  assert.equal(TRACE_SOURCE_OWNERS.length, 24);
  const manifest = await readJson<GateManifest>(join(root, "architecture/p6/hard-gates.json"));
  assert.equal(manifest.gates.length, 28);
  const result: Record<string, 0> = {};
  for (const gate of manifest.gates) {
    assert.equal(gate.expected, 0);
    assert.ok(gate.evidence.length > 0);
    for (const evidence of gate.evidence) assert.ok((await readFile(join(root, evidence.file), "utf8")).includes(evidence.title), `${gate.id}:${evidence.file}:${evidence.title}`);
    result[gate.id] = 0;
  }
  return result;
}

async function validateCorpora() {
  const fixtureBytes = await readFile(join(root, "packages/trace-compiler/fixtures/locked-cases.json"));
  assert.equal(hash(fixtureBytes), RAW_FIXTURE_HASH);
  assert.equal(hash(canonicalSerialize(P6_LOCKED_CASES)), CANONICAL_FIXTURE_HASH);
  assert.equal(P6_LOCKED_CASES.length, 31);
  const results = runP6LockedCorpus();
  assert.equal(results.length, 31);
  assert.deepEqual(results.filter((result) => !result.passed), []);
  assert.equal(hash(canonicalSerialize(results)), LOCKED_RESULT_HASH);
  const semanticDiffCounts = Object.fromEntries([...new Set(results.map((result) => result.semanticDiff!))].sort()
    .map((classification) => [classification, results.filter((result) => result.semanticDiff === classification).length]));
  const semanticDiffManifest = await readJson<JsonObject>(join(root, "architecture/p6/semantic-diff-results.json"));
  assert.deepEqual(semanticDiffManifest.classifications, {
    FAITHFUL_GENERALIZATION: 28,
    STRICTER_SAFE: 0,
    OVER_GENERALIZED: 0,
    UNDER_GENERALIZED: 0,
    UNSUPPORTED: 2,
    FIXTURE_INVALID: 1,
  });
  assert.equal(semanticDiffManifest.lockedResultSha256, LOCKED_RESULT_HASH);
  assert.deepEqual([
    semanticDiffManifest.consequentialGateRemovalsFromEmittedCandidates,
    semanticDiffManifest.authorityRequirementRemovalsFromEmittedCandidates,
    semanticDiffManifest.verificationRequirementRemovalsFromEmittedCandidates,
    semanticDiffManifest.observationRequirementRemovalsFromEmittedCandidates,
    semanticDiffManifest.recoveryEdgeRemovalsFromEmittedCandidates,
  ], [0, 0, 0, 0, 0]);
  const manifest = await readJson<JsonObject>(join(root, "architecture/p6/replay-corpus.json"));
  assert.equal(manifest.fixtureCanonicalSha256, CANONICAL_FIXTURE_HASH);
  assert.equal(manifest.lockedResultSha256, LOCKED_RESULT_HASH);
  assert.equal(manifest.combined.categoryCases, 187);
  const combinedHash = manifest.combined.corpusHash;
  delete manifest.combined.corpusHash;
  assert.equal(hash(JSON.stringify(canonicalize(manifest))), combinedHash);
  assert.equal(combinedHash, COMBINED_CORPUS_HASH);
  return { extensionCases: 31 as const, combinedCases: 187 as const, fixtureHash: CANONICAL_FIXTURE_HASH, resultHash: LOCKED_RESULT_HASH, combinedHash, semanticDiffCounts };
}

export const P0_P5_REGRESSION_COMMANDS = [
  "npm run test:p0:replay",
  "npm run test:p1:unit", "npm run test:p1:contract",
  "npm run test:p2:unit", "npm run test:p2:contract", "npm run test:p2:replay",
  "npm run test:p3:unit", "npm run test:p3:contract", "npm run test:p3:replay",
  "npm run test:p4:unit", "npm run test:p4:contract", "npm run test:p4:replay",
  "npm run test:p5:unit", "npm run test:p5:contract", "npm run test:p5:replay",
];

export async function certifyP6LocalOffline() {
  const lineage = verifyP6DescendantLineage();
  const graph = await validatePackageGraph();
  const hardGates = await validateContractsAndGates();
  const corpus = await validateCorpora();
  const boundary = await readJson<JsonObject>(join(root, "architecture/p6/production-release-boundary.json"));
  assert.equal(boundary.p5FinalCertification, "BLOCKED_BY_P0_P4_RELEASE_FAILURE");
  assert.equal(boundary.reconciliationCount, 0);
  return {
    status: "PASS_LOCAL_OFFLINE_ONLY",
    finalCertification: "BLOCKED_BY_P5_FINAL_CERTIFICATION",
    p6PassEligible: false,
    p6BaselineSha: P6_LINEAGE.p5Local,
    p5LocalSha: P6_LINEAGE.p5Local,
    p5LocalStatus: boundary.p5LocalStatus,
    p5FinalStatus: boundary.p5FinalCertification,
    currentMainSha: P6_LINEAGE.promotedMain,
    branch: lineage.branch,
    head: lineage.head,
    changedPaths: lineage.changedPaths,
    lineage: lineage.lineage,
    protectedP0P5DiffCount: lineage.protectedP0P5DiffCount,
    p6ReconciliationCount: lineage.p6ReconciliationCount,
    internalPackages: graph.packages,
    internalPackageCycles: graph.cycles,
    sourceTraceOwners: TRACE_SOURCE_OWNERS.length,
    corpus,
    hardGates,
    productionRelease: boundary.productionRelease,
  } as const;
}

if (process.argv.includes("--run")) {
  void certifyP6LocalOffline().then((result) => console.log(JSON.stringify(result, null, 2))).catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}
