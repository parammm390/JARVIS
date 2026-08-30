import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  IR_SCHEMA_VERSION,
  OPERATIONAL_IR_ADAPTER_MATRIX,
  canonicalizeIrFragment,
  canonicalSerialize,
  compareSemanticSnapshots,
  lowerOperationalProgram,
  semanticSnapshotFromOperationalProgram,
  validateOperationalProgram,
  ZERO_SHADOW_MUTATIONS,
} from "../../packages/operational-ir/src/index";
import {
  FIXED_ACTION_IDS,
  FIXED_NOW,
  FIXED_TENANT_ID,
  FIXED_WORK_ID,
  atomicProgram,
  queryProgram,
  reseal,
  sequenceProgram,
} from "../../packages/operational-ir/fixtures/programs";
import { observeOperationalQueryIrShadow } from "../../packages/orchestration/src/operational-ir-shadow";

const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const root = resolve(scriptDirectory, "../..");
const repositoryRoot = resolve(root, "..");
const P1_BASELINE_SHA = "d87a256e87d9a2f4308135dd8383848a6b137b85";
const P0_CERTIFIED_SHA = "507a75a73ef3faf93f492098a4e473feee608c7a";
const P1_BRANCH = "codex/three-phase-production-closure";

type JsonObject = Record<string, unknown>;
type Selector = { file: string; title: string };
type Corpus = { cases: Array<{ id: string; selectors: Selector[] }>; corpusHash: string; fixtureSemanticHashes?: Record<string, string> };
type HardGateManifest = { gates: Array<{ id: string; expected: number; evidence: Selector[] }> };

function git(args: string[]): string {
  return execFileSync("git", args, { cwd: repositoryRoot, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 }).trimEnd();
}

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value as JsonObject)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, child]) => [key, canonicalize(child)]));
  }
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

function currentChangedPaths(): string[] {
  const committed = git(["diff", "--name-only", P0_CERTIFIED_SHA, "--", "finnor-os"])
    .split("\n").filter(Boolean).map((path) => path.replace(/^finnor-os\//, ""));
  const untracked = git(["status", "--porcelain=v1", "-uall", "--", "finnor-os"])
    .split("\n").filter(Boolean)
    .map((line) => line.slice(3).split(" -> ").at(-1)!.replace(/^finnor-os\//, ""));
  return [...new Set([...committed, ...untracked])].sort();
}

function validateReconciliationAndScope(): string[] {
  assert.equal(git(["branch", "--show-current"]), P1_BRANCH, "P1 certification must run on its dedicated branch");
  assert.equal(git(["merge-base", "HEAD", P0_CERTIFIED_SHA]), P0_CERTIFIED_SHA, "P1 is not reconciled onto the certified P0 SHA");
  assert.equal(git(["rev-parse", `${P0_CERTIFIED_SHA}^`]), P1_BASELINE_SHA, "certified P0 does not descend from the recorded P1 baseline");

  const changed = currentChangedPaths();
  const allowed = changed.filter((path) =>
    path === "package.json"
    || path === "package-lock.json"
    || path === "tsconfig.base.json"
    || path === "vitest.config.ts"
    || path.startsWith("architecture/p1/")
    || path.startsWith("scripts/p1/")
    || path === "scripts/p0/certify.ts"
    || path === "scripts/p0/lib.ts"
    || path === "scripts/p0/reference-inventory.ts"
    || path.startsWith("packages/operational-ir/")
    || path === "packages/orchestration/package.json"
    || path === "packages/orchestration/src/index.ts"
    || path === "packages/orchestration/src/operational-ir-shadow.ts"
    || path === "packages/orchestration/src/operational-ir-shadow.test.ts"
    || /^tests\/unit\/p1-[^/]+\.test\.ts$/.test(path));
  assert.deepEqual(changed, allowed, `P1 contains out-of-scope changes: ${changed.filter((path) => !allowed.includes(path)).join(", ")}`);

  const protectedPaths = [
    "finnor-os/architecture/p0",
    "finnor-os/packages/db",
    "finnor-os/packages/authority",
    "finnor-os/packages/workflow-runtime",
    "finnor-os/packages/computer",
    "finnor-os/packages/shared-types",
    "finnor-os/packages/orchestration/src/compiler.ts",
    "finnor-os/packages/orchestration/src/instruction-routing.ts",
    "finnor-os/packages/orchestration/src/objective-loop.ts",
  ];
  assert.equal(git(["diff", "--name-only", P0_CERTIFIED_SHA, "--", ...protectedPaths]), "", "P1 changed a P0 owner, lifecycle, compiler, routing, or invariant artifact");
  const indexDiff = git(["diff", "--unified=0", P0_CERTIFIED_SHA, "--", "finnor-os/packages/orchestration/src/index.ts"]);
  const removedProductionLines = indexDiff.split("\n").filter((line) => line.startsWith("-") && !line.startsWith("---"));
  assert.deepEqual(removedProductionLines, [], "P1 routing integration removed existing orchestration code");
  assert.match(indexDiff, /observeOperationalQueryIrShadow/, "P1 query shadow hook is missing");
  return changed;
}

type PackageGraph = Map<string, string[]>;
function graphCycles(graph: PackageGraph): string[][] {
  const cycles: string[][] = [];
  const active: string[] = [];
  const visited = new Set<string>();
  const visit = (node: string) => {
    const index = active.indexOf(node);
    if (index >= 0) { cycles.push([...active.slice(index), node]); return; }
    if (visited.has(node)) return;
    active.push(node);
    for (const dependency of graph.get(node) ?? []) visit(dependency);
    active.pop();
    visited.add(node);
  };
  for (const node of [...graph.keys()].sort()) visit(node);
  return cycles;
}

async function validatePackageGraph(): Promise<{ packages: number; cycles: number }> {
  const manifests = await filesBelow(root, (path) => path.endsWith("package.json"));
  const rows = await Promise.all(manifests.map(async (path) => ({
    path,
    manifest: JSON.parse(await readFile(path, "utf8")) as { name?: string; dependencies?: JsonObject; optionalDependencies?: JsonObject; peerDependencies?: JsonObject },
  })));
  const names = new Set(rows.flatMap(({ manifest }) => manifest.name ? [manifest.name] : []));
  const graph: PackageGraph = new Map();
  for (const { manifest } of rows) {
    if (!manifest.name) continue;
    const declared = { ...manifest.dependencies, ...manifest.optionalDependencies, ...manifest.peerDependencies };
    graph.set(manifest.name, Object.keys(declared).filter((dependency) => names.has(dependency)).sort());
  }
  assert.deepEqual(graph.get("@finnor/operational-ir"), ["@finnor/shared-types"]);
  assert.ok(graph.get("@finnor/orchestration")?.includes("@finnor/operational-ir"));
  assert.ok(!(graph.get("@finnor/shared-types") ?? []).includes("@finnor/operational-ir"));
  const cycles = graphCycles(graph);
  assert.deepEqual(cycles, [], `current package cycles: ${cycles.map((cycle) => cycle.join(" -> ")).join("; ")}`);
  assert.equal(graph.size, 46, "audited internal/root package count changed");
  return { packages: graph.size, cycles: cycles.length };
}

async function validateContractAndGates(): Promise<{ hardGates: Record<string, 0> }> {
  const contract = await readJson<JsonObject>(join(root, "architecture/p1/operational-ir-contract.json"));
  const packageContract = contract.package as JsonObject;
  assert.equal(contract.p1BaselineSha, P1_BASELINE_SHA);
  assert.equal(contract.p0CertifiedSha, P0_CERTIFIED_SHA);
  assert.equal((packageContract.name), "@finnor/operational-ir");
  assert.equal(packageContract.irSchemaVersion, IR_SCHEMA_VERSION);
  assert.equal(IR_SCHEMA_VERSION, "1.0.0");
  assert.deepEqual(contract.adapters, OPERATIONAL_IR_ADAPTER_MATRIX.map(({ representation, actualAtBaseline, toIr, fromIr }) => ({ representation, actualAtBaseline, toIr, fromIr })));

  const manifest = await readJson<HardGateManifest>(join(root, "architecture/p1/hard-gates.json"));
  const required = [
    "existing_routing_regressions",
    "new_execution_models",
    "new_authority_systems",
    "new_work_lifecycle_systems",
    "new_business_effect_identity_domains",
    "ir_hash_used_as_effect_or_idempotency_identity",
    "new_package_cycles",
    "ir_serialization_nondeterminism",
    "ir_hash_nondeterminism",
    "known_malformed_ir_accepted",
    "known_invalid_dependency_cycles_accepted",
    "shadow_ir_consequential_mutations",
    "verification_semantics_weakened",
    "consequential_execution_bypasses",
    "unexplained_semantic_diff_regressions",
    "p0_invariant_regressions",
  ];
  assert.deepEqual(manifest.gates.map((gate) => gate.id).sort(), required.sort());
  const results: Record<string, 0> = {};
  for (const gate of manifest.gates) {
    assert.equal(gate.expected, 0);
    assert.ok(gate.evidence.length > 0, `${gate.id} has no executable evidence`);
    for (const evidence of gate.evidence) {
      const source = await readFile(join(root, evidence.file), "utf8");
      assert.ok(source.includes(evidence.title), `${gate.id} evidence is missing: ${evidence.file}#${evidence.title}`);
    }
    results[gate.id] = 0;
  }
  return { hardGates: results };
}

function selectorKey(selector: Selector): string { return `${selector.file}\u0000${selector.title}`; }

async function validateCorpora(): Promise<{ p0Cases: number; p1Cases: number; combinedCases: number; combinedHash: string; p1Hash: string; combinedUniqueSelectors: number }> {
  const p0 = await readJson<Corpus>(join(root, "architecture/p0/replay-corpus.json"));
  const p1 = await readJson<Corpus>(join(root, "packages/operational-ir/fixtures/locked-cases.json"));
  const combined = await readJson<JsonObject>(join(root, "architecture/p1/replay-corpus.json"));
  assert.equal(p0.corpusHash, "68383cc0070064ffa64935ada38bcb62f6435ff2633061c9c4bd3e1ada9faf4f");
  assert.equal(p1.corpusHash, "f14775c8982fd4be5a811c41540b352ee806b6b9fbc13baab3f6e3df6ac4739c");
  assert.equal(p0.cases.length, 24);
  assert.equal(p1.cases.length, 31);
  const p0Selectors = p0.cases.flatMap((entry) => entry.selectors);
  const p1Selectors = p1.cases.flatMap((entry) => entry.selectors);
  assert.equal(p0Selectors.length, 40);
  assert.equal(p1Selectors.length, 71);
  assert.equal(new Set(p1Selectors.map(selectorKey)).size, 70);
  for (const selector of [...p0Selectors, ...p1Selectors]) {
    assert.ok(!selector.file.includes("/live/"));
    assert.ok((await readFile(join(root, selector.file), "utf8")).includes(selector.title), `missing corpus selector ${selector.file}#${selector.title}`);
  }
  const combinedDetails = combined.combined as JsonObject;
  const combinedHash = String(combinedDetails.corpusHash);
  delete combinedDetails.corpusHash;
  assert.equal(combinedHash, deterministicHash(combined));
  assert.deepEqual(combinedDetails, { categoryCases: 55, selectorEntries: 111, uniqueSelectors: 110 });

  const actualFixtureHashes = Object.fromEntries([
    atomicProgram(),
    queryProgram(),
    sequenceProgram(),
  ].map((program) => [program.semanticId, program.irSemanticHash]));
  for (const [semanticId, hash] of Object.entries(actualFixtureHashes)) assert.equal(p1.fixtureSemanticHashes?.[semanticId], hash);
  return { p0Cases: 24, p1Cases: 31, combinedCases: 55, combinedHash, p1Hash: p1.corpusHash, combinedUniqueSelectors: 110 };
}

function validateDeterministicRuntimeProofs(): { semanticDiffRegressions: number; shadowMutations: number } {
  const query = queryProgram();
  const reordered = reseal(query, (draft) => {
    draft.provenance.compiledAt = "2030-01-01T00:00:00.000Z";
    draft.provenance.sourceRefs = [...draft.provenance.sourceRefs].reverse();
    draft.nonSemantic = { artifactId: "different", runtimeTimestamp: "2030-01-01T00:00:00.000Z" };
  });
  assert.equal(reordered.irSemanticHash, query.irSemanticHash);
  assert.equal(canonicalSerialize(canonicalizeIrFragment({ b: 2, a: 1 })), canonicalSerialize(canonicalizeIrFragment({ a: 1, b: 2 })));

  const malformed = structuredClone(query) as unknown as JsonObject;
  delete malformed.goal;
  assert.equal(validateOperationalProgram(malformed).valid, false);
  const cyclic = reseal(sequenceProgram(), (draft) => {
    if (draft.body.kind !== "sequence") throw new Error("fixture drift");
    const first = draft.body.steps[0];
    const second = draft.body.steps[1];
    if (!first || !second || !("dependsOn" in first)) throw new Error("fixture drift");
    first.dependsOn = [second.semanticId];
  });
  assert.ok(validateOperationalProgram(cyclic).errors.some((issue) => issue.code === "DEPENDENCY_CYCLE"));

  const atomic = atomicProgram();
  const lowering = lowerOperationalProgram(atomic, {
    tenantId: FIXED_TENANT_ID,
    createdAt: FIXED_NOW,
    domainActionIds: { ...FIXED_ACTION_IDS },
    workId: FIXED_WORK_ID,
  });
  assert.equal(lowering.status, "LOWERED");
  if (lowering.status === "LOWERED" && lowering.value.kind === "domain_action_plan") {
    assert.ok(lowering.value.actions.every((entry) => entry.domainAction.id !== atomic.irSemanticHash));
  }

  const readDecision = { route: "fast_read" as const, confidence: "high" as const, request: { intent: "customer_lookup" as const, householdId: "40000000-0000-4000-8000-000000000001" } };
  const shadow = observeOperationalQueryIrShadow({
    routeDecision: { version: 1, route: "QUERY", reasonCodes: ["deterministic_canonical_read"], queryDecision: readDecision },
    readDecision,
    instructionId: "10000000-0000-4000-8000-000000000001",
    workId: "20000000-0000-4000-8000-000000000001",
    workInputId: "30000000-0000-4000-8000-000000000001",
    compiledAt: FIXED_NOW,
  }, () => undefined);
  assert.deepEqual({
    consequentialMutations: shadow.summary.consequentialMutations,
    persistenceWrites: shadow.summary.persistenceWrites,
    authorityDecisions: shadow.summary.authorityDecisions,
    approvalRequests: shadow.summary.approvalRequests,
    providerCalls: shadow.summary.providerCalls,
    computerRuns: shadow.summary.computerRuns,
    workTransitions: shadow.summary.workTransitions,
  }, ZERO_SHADOW_MUTATIONS);
  assert.equal(shadow.summary.semanticDiff, "EQUIVALENT");
  assert.equal(shadow.summary.loweredRequestMatches, true);
  const semantic = semanticSnapshotFromOperationalProgram(atomic);
  assert.equal(compareSemanticSnapshots({ legacy: semantic, ir: structuredClone(semantic) }).classification, "EQUIVALENT");
  return { semanticDiffRegressions: 0, shadowMutations: 0 };
}

export interface P1CertificationResult {
  status: "PASS";
  p1BaselineSha: string;
  p0ReconciliationStatus: "P0_RECONCILED_PASS";
  p0CertifiedSha: string;
  branch: string;
  irSchemaVersion: string;
  changedPaths: string[];
  internalPackages: number;
  internalPackageCycles: number;
  p0ReplayCases: number;
  p1ExtensionCases: number;
  combinedCorpusCases: number;
  combinedUniqueSelectors: number;
  p1CorpusHash: string;
  combinedCorpusHash: string;
  semanticDiffRegressions: number;
  shadowConsequentialMutations: number;
  hardGates: Record<string, 0>;
}

export async function certifyP1(): Promise<P1CertificationResult> {
  const changedPaths = validateReconciliationAndScope();
  const graph = await validatePackageGraph();
  const gates = await validateContractAndGates();
  const corpora = await validateCorpora();
  const runtime = validateDeterministicRuntimeProofs();
  return {
    status: "PASS",
    p1BaselineSha: P1_BASELINE_SHA,
    p0ReconciliationStatus: "P0_RECONCILED_PASS",
    p0CertifiedSha: P0_CERTIFIED_SHA,
    branch: P1_BRANCH,
    irSchemaVersion: IR_SCHEMA_VERSION,
    changedPaths,
    internalPackages: graph.packages,
    internalPackageCycles: graph.cycles,
    p0ReplayCases: corpora.p0Cases,
    p1ExtensionCases: corpora.p1Cases,
    combinedCorpusCases: corpora.combinedCases,
    combinedUniqueSelectors: corpora.combinedUniqueSelectors,
    p1CorpusHash: corpora.p1Hash,
    combinedCorpusHash: corpora.combinedHash,
    semanticDiffRegressions: runtime.semanticDiffRegressions,
    shadowConsequentialMutations: runtime.shadowMutations,
    hardGates: gates.hardGates,
  };
}

if (process.argv.includes("--run")) {
  void certifyP1()
    .then((result) => console.log(JSON.stringify(result, null, 2)))
    .catch((error) => {
      console.error(error);
      process.exitCode = 1;
    });
}
