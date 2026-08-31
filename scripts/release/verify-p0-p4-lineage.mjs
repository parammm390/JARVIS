import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync, readdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const finnorRoot = join(repositoryRoot, "finnor-os");

const LINEAGE = Object.freeze({
  remoteMain: "ff9221538f671970c98b83d408b51ca5d63604c5",
  p0: "4257973fcd2ea8624ed179bf5b18d1ab513eccf6",
  p1: "1a31904b35fff39aa1cab1c404f1d7467d723989",
  p2: "5cc95730babeee99055b5cb00c88b7d66dff8ab8",
  p3: "c0965059b92c1b0f73100c4556301044c1b7e9c4",
  p4: "39a114f963b46b2abfde3420037395dfb95610cc",
  supersededP0P1Head: "4a95f2089f1038e24ec555eb6f6ed2e753d5a398",
});

// P4's entire FINNOR OS tree remains byte-identical in the promoted release.
// This one test adapter is the only exception: it selects this descendant
// lineage proof instead of asking the phase-bound P0 inventory to enumerate
// source that was intentionally introduced by P3/P4.
const P4_FINNOR_OS_EXCEPTIONS = [
  "finnor-os/tests/unit/p0-architecture-contract.test.ts",
];

const RELEASE_RECONCILIATION_PATHS = [
  ".github/workflows/ci.yml",
  ".github/workflows/production-release.yml",
  "eslint.config.mjs",
  "finnor-os/tests/unit/p0-architecture-contract.test.ts",
  "next-env.d.ts",
  "package-lock.json",
  "package.json",
  "scripts/release/azure-managed-run-command.mjs",
  "scripts/release/deploy-azure-worker.mjs",
  "scripts/release/deploy-production.mjs",
  "scripts/release/preflight-production.mjs",
  "scripts/release/release-policy.test.mjs",
  "scripts/release/validate-deployment-truth.mjs",
  "scripts/release/verify-p0-p4-lineage.mjs",
  "scripts/release/verify-production-parity.mjs",
  "src/app/api/jarvis/operational-stream/route.ts",
  "src/components/jarvis/CustomCursor.tsx",
  "src/components/jarvis/workspaces/projector.test.ts",
  "tsconfig.json",
].sort();

function git(args) {
  return execFileSync("git", args, {
    cwd: repositoryRoot,
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
  }).trimEnd();
}

function lines(value) {
  return value.split("\n").filter(Boolean).sort();
}

function assertAncestor(ancestor, descendant, label) {
  assert.doesNotThrow(
    () => git(["merge-base", "--is-ancestor", ancestor, descendant]),
    `${label}: ${ancestor} is not an ancestor of ${descendant}`,
  );
}

function readJson(path) {
  return JSON.parse(readFileSync(join(finnorRoot, path), "utf8"));
}

function packageManifests(directory) {
  const result = [];
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    if (entry.name === "node_modules" || entry.name.startsWith(".")) continue;
    const path = join(directory, entry.name);
    if (entry.isDirectory()) result.push(...packageManifests(path));
    else if (entry.name === "package.json") result.push(path);
  }
  return result.sort();
}

function currentPackageGraph() {
  const manifests = packageManifests(finnorRoot)
    .map((path) => JSON.parse(readFileSync(path, "utf8")))
    .filter((manifest) => manifest.name);
  const names = new Set(manifests.map((manifest) => manifest.name));
  return new Map(manifests.map((manifest) => {
    const dependencies = {
      ...manifest.dependencies,
      ...manifest.devDependencies,
      ...manifest.optionalDependencies,
      ...manifest.peerDependencies,
    };
    return [manifest.name, Object.keys(dependencies).filter((name) => names.has(name)).sort()];
  }));
}

function graphCycles(graph) {
  const cycles = [];
  const active = [];
  const complete = new Set();
  const visit = (node) => {
    const index = active.indexOf(node);
    if (index >= 0) {
      cycles.push([...active.slice(index), node]);
      return;
    }
    if (complete.has(node)) return;
    active.push(node);
    for (const dependency of graph.get(node) ?? []) visit(dependency);
    active.pop();
    complete.add(node);
  };
  for (const node of [...graph.keys()].sort()) visit(node);
  return cycles;
}

export function verifyP0P4ReleaseLineage() {
  const head = git(["rev-parse", "HEAD"]);
  const ordered = [LINEAGE.remoteMain, LINEAGE.p0, LINEAGE.p1, LINEAGE.p2, LINEAGE.p3, LINEAGE.p4, head];
  for (let index = 0; index < ordered.length - 1; index += 1) {
    assertAncestor(ordered[index], ordered[index + 1], `P0-P4 lineage step ${index + 1}`);
  }

  const finnorChanges = lines(git(["diff", "--name-only", LINEAGE.p4, head, "--", "finnor-os"]));
  assert.deepEqual(
    finnorChanges,
    P4_FINNOR_OS_EXCEPTIONS,
    `final FINNOR OS tree differs from certified P4 outside the release-lineage adapter: ${finnorChanges.join(", ")}`,
  );

  const releaseChanges = lines(git(["diff", "--name-only", LINEAGE.p4, head]));
  assert.deepEqual(
    releaseChanges,
    RELEASE_RECONCILIATION_PATHS,
    `release reconciliation path set drifted: ${releaseChanges.join(", ")}`,
  );

  const contract = readJson("architecture/p0/substrate-contract.json");
  const invariants = readJson("architecture/p0/invariants.json");
  const replay = readJson("architecture/p0/replay-corpus.json");
  const capability = readJson("architecture/p0/capability-inventory.json");
  const references = readJson("architecture/p2/closure-reference-inventory.json");
  const graph = currentPackageGraph();
  const cycles = graphCycles(graph);
  assert.deepEqual(cycles, [], `release introduced package cycles: ${JSON.stringify(cycles)}`);

  return {
    status: "PASS",
    mode: "IMMUTABLE_PHASE_LINEAGE",
    head,
    lineage: LINEAGE,
    supersededP0P1HeadMerged: false,
    p4FinnorOsExceptions: P4_FINNOR_OS_EXCEPTIONS,
    releaseReconciliationPaths: RELEASE_RECONCILIATION_PATHS,
    baselineSha: LINEAGE.remoteMain,
    branch: git(["branch", "--show-current"]) || process.env.GITHUB_HEAD_REF || process.env.GITHUB_REF_NAME || "DETACHED",
    changedPaths: lines(git(["diff", "--name-only", LINEAGE.remoteMain, head, "--", "finnor-os"])).map((path) => path.replace(/^finnor-os\//, "")),
    executionModels: contract.executionModels.length,
    semanticOwners: contract.semanticOwnership.length,
    lifecycleCount: Object.keys(contract.lifecycles).length,
    invariants: invariants.invariants.length,
    hardGates: invariants.hardGates.length,
    replayCases: replay.cases.length,
    replayHash: replay.corpusHash,
    capabilityCounts: capability.counts,
    referenceConcepts: references.concepts.length,
    productionReferenceMovement: references.productionReferenceMovement,
    unexplainedProductionReferenceMovement: references.unexplainedProductionReferenceMovement,
    internalPackages: graph.size,
    internalPackageCycles: cycles.length,
  };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    console.log(JSON.stringify(verifyP0P4ReleaseLineage(), null, 2));
  } catch (error) {
    console.error(error);
    process.exitCode = 1;
  }
}
