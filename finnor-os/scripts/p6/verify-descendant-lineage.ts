import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const osRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const repositoryRoot = resolve(osRoot, "..");

type FinalLineageManifest = {
  schemaVersion: 1;
  mode: "P0_P6_IMMUTABLE_DESCENDANT";
  lineage: {
    remoteMain: string;
    p0: string;
    p1: string;
    p2: string;
    p3: string;
    p4: string;
    closureMain: string;
    p5Source: string;
    p5Final: string;
    p6Source: string;
    p6Implementation: string;
  };
  reconciliationCount: { p5: 1; p6: 1 };
  protectedGitObjects: Record<string, string>;
  corpora: Record<string, string>;
  scope: Record<string, string>;
};

const manifest = JSON.parse(readFileSync(join(osRoot, "architecture/p6/final-lineage.json"), "utf8")) as FinalLineageManifest;
export const P6_LINEAGE = Object.freeze(manifest.lineage);

const FINAL_COMPOSITION_PATHS = new Set([
  ".github/scripts/certification-aws-hardening.cjs",
  ".github/workflows/ci.yml",
  ".github/workflows/production-release.yml",
  ".github/workflows/release-tail-preflight.yml",
  ".github/workflows/security.yml",
  "JARVIS-CREDENTIALS-LEDGER.md",
  "docs/release/generated/deployment-inventory.md",
  "docs/release/generated/environment-contract.md",
  "package.json",
  "finnor-os/.dockerignore",
  "finnor-os/Dockerfile.worker",
  "finnor-os/apps/api/lib/worker-readiness.ts",
  "finnor-os/apps/api/lib/auth.ts",
  "finnor-os/apps/worker/src/heartbeat.ts",
  "finnor-os/apps/worker/src/sse/gateway.ts",
  "scripts/release/azure-managed-run-command.mjs",
  "scripts/release/azure/deploy-worker.sh",
  "scripts/release/azure-runcommand-recovery.test.mjs",
  "scripts/release/certify-product-truth-deployed.mjs",
  "scripts/release/configure-azure-sse-ingress.mjs",
  "scripts/release/configure-vercel-realtime.mjs",
  "scripts/release/deploy-production.mjs",
  "scripts/release/deploy-aws-worker.mjs",
  "scripts/release/deploy-azure-worker.mjs",
  "scripts/release/release-policy.test.mjs",
  "scripts/release/release-policy.mjs",
  "scripts/release/recover-azure-run-command.mjs",
  "scripts/release/refresh-product-truth-auth.mjs",
  "scripts/release/preflight-production.mjs",
  "scripts/release/validate-deployment-truth.mjs",
  "scripts/release/verify-p0-p4-lineage.mjs",
  "scripts/release/verify-production-parity.mjs",
  "src/app/api/jarvis/[...path]/route.ts",
  "src/app/api/jarvis/[...path]/route.test.ts",
  "infra/aws/finnor-production.yaml",
  "infra/deployment/production.contract.json",
  "src/components/jarvis/workspaces/AdaptiveWorkspaceShell.tsx",
  "src/components/jarvis/workspaces/presentation.test.ts",
  "src/components/jarvis/lib/business-projections.tsx",
  "src/components/jarvis/lib/business-projections-recovery.test.ts",
  "src/lib/jarvis/useLiveQuery.ts",
  "finnor-os/README.md",
  "finnor-os/architecture/p5/README.md",
  "finnor-os/architecture/p5/production-release-boundary.json",
  "finnor-os/architecture/p6/README.md",
  "finnor-os/architecture/p6/final-lineage.json",
  "finnor-os/architecture/p6/production-release-boundary.json",
  "finnor-os/package.json",
  "finnor-os/package-lock.json",
  "finnor-os/docs/promotion-flow.md",
  "finnor-os/docs/runbooks/role-cutover.md",
  "finnor-os/scripts/release/generate-environment-contract.ts",
  "finnor-os/scripts/release/migrate-production.ts",
  "finnor-os/tests/integration/readiness-route.test.ts",
  "finnor-os/scripts/p5/certify.ts",
  "finnor-os/scripts/p6/certify.ts",
  "finnor-os/scripts/p6/verify-descendant-lineage.ts",
  "finnor-os/packages/orchestration/src/conversation.ts",
  "finnor-os/packages/orchestration/src/instruction-routing.ts",
  "finnor-os/tests/unit/conversation.test.ts",
  "finnor-os/tests/unit/instruction-routing-policy.test.ts",
  "finnor-os/tests/unit/auth-rate-limit-policy.test.ts",
  "finnor-os/tests/integration/authz.test.ts",
  "finnor-os/tests/unit/p0-architecture-contract.test.ts",
  "finnor-os/tests/unit/p5-architecture-contract.test.ts",
  "finnor-os/tests/unit/p6-architecture-contract.test.ts",
]);

const PROTECTED_RUNTIME_OWNERS = [
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

function git(args: string[]): string {
  return execFileSync("git", args, { cwd: repositoryRoot, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 }).trimEnd();
}

function assertAncestor(ancestor: string, descendant: string, label: string): void {
  assert.doesNotThrow(() => git(["merge-base", "--is-ancestor", ancestor, descendant]), `${label}: ${ancestor} is not an ancestor of ${descendant}`);
}

function assertSingleParent(commit: string, expectedParent: string, label: string): void {
  const row = git(["rev-list", "--parents", "-n", "1", commit]).split(" ");
  assert.deepEqual(row, [commit, expectedParent], `${label} must be reconciled exactly once as a single-parent descendant`);
}

function assertGitObject(commit: string, path: string, expected: string, label: string): void {
  assert.equal(git(["rev-parse", `${commit}:${path}`]), expected, `${label} protected Git object drifted`);
}

function gateCount(path: string): number {
  const document = JSON.parse(readFileSync(join(osRoot, path), "utf8")) as { gates: Array<{ expected: number }> };
  assert.ok(document.gates.length > 0, `${path} has no gates`);
  assert.ok(document.gates.every((gate) => gate.expected === 0), `${path} contains a non-zero hard gate`);
  return document.gates.length;
}

function validateCorpora(): void {
  const p5 = JSON.parse(readFileSync(join(osRoot, "architecture/p5/replay-corpus.json"), "utf8"));
  const p6 = JSON.parse(readFileSync(join(osRoot, "architecture/p6/replay-corpus.json"), "utf8"));
  assert.equal(p5.fixtureCanonicalSha256, manifest.corpora.p5);
  assert.equal(p6.fixtureCanonicalSha256, manifest.corpora.p6);
  assert.equal(p6.combined.corpusHash, manifest.corpora.combinedP0P6);
  for (const phase of ["p0", "p1", "p2", "p3", "p4"] as const) {
    assert.equal(p6.phaseCorpora[phase].corpusHash, manifest.corpora[phase]);
  }
}

export function verifyP6DescendantLineage() {
  assert.equal(manifest.schemaVersion, 1);
  assert.equal(manifest.mode, "P0_P6_IMMUTABLE_DESCENDANT");
  assert.deepEqual(manifest.reconciliationCount, { p5: 1, p6: 1 });
  assert.deepEqual(manifest.scope, {
    p3: "SHADOW_READ_ONLY",
    p4: "SHADOW_SEARCH",
    p5: "SPECULATIVE_SHADOW_ONLY",
    p6: "NON_EXECUTABLE_OFFLINE_ONLY",
  });

  const head = git(["rev-parse", "HEAD"]);
  const ordered = [
    P6_LINEAGE.remoteMain,
    P6_LINEAGE.p0,
    P6_LINEAGE.p1,
    P6_LINEAGE.p2,
    P6_LINEAGE.p3,
    P6_LINEAGE.p4,
    P6_LINEAGE.closureMain,
    P6_LINEAGE.p5Final,
    P6_LINEAGE.p6Implementation,
    head,
  ];
  for (let index = 0; index < ordered.length - 1; index += 1) {
    assertAncestor(ordered[index]!, ordered[index + 1]!, `P0-P6 descendant lineage step ${index + 1}`);
  }
  assertSingleParent(P6_LINEAGE.p5Final, P6_LINEAGE.closureMain, "P5");
  assertSingleParent(P6_LINEAGE.p6Implementation, P6_LINEAGE.p5Final, "P6");

  assertGitObject(P6_LINEAGE.p4, "finnor-os/architecture/p0", manifest.protectedGitObjects.p0Architecture!, "P0 architecture");
  assertGitObject(P6_LINEAGE.p4, "finnor-os/architecture/p1", manifest.protectedGitObjects.p1Architecture!, "P1 architecture");
  assertGitObject(P6_LINEAGE.p4, "finnor-os/architecture/p2", manifest.protectedGitObjects.p2Architecture!, "P2 architecture");
  assertGitObject(P6_LINEAGE.p4, "finnor-os/architecture/p3", manifest.protectedGitObjects.p3Architecture!, "P3 architecture");
  assertGitObject(P6_LINEAGE.p4, "finnor-os/architecture/p4", manifest.protectedGitObjects.p4Architecture!, "P4 architecture");
  assertGitObject(P6_LINEAGE.p5Final, "finnor-os", manifest.protectedGitObjects.p5FinnorTree!, "P5 complete FINNOR tree");
  assertGitObject(P6_LINEAGE.p5Final, "finnor-os/packages/speculative-runtime", manifest.protectedGitObjects.p5Runtime!, "P5 speculative runtime");
  assertGitObject(P6_LINEAGE.p6Implementation, "finnor-os", manifest.protectedGitObjects.p6FinnorTree!, "P6 complete FINNOR tree");
  assertGitObject(P6_LINEAGE.p6Implementation, "finnor-os/packages/trace-compiler", manifest.protectedGitObjects.p6Runtime!, "P6 trace compiler");

  const protectedOwnerDiff = git(["diff", "--name-only", P6_LINEAGE.closureMain, head, "--", ...PROTECTED_RUNTIME_OWNERS]);
  assert.equal(protectedOwnerDiff, "", `P5/P6 changed protected Authority, BusinessEffect, Work, provider/computer, or evidence owners: ${protectedOwnerDiff}`);

  const compositionPaths = git(["diff", "--name-only", P6_LINEAGE.p6Implementation, head]).split("\n").filter(Boolean).sort();
  const unexplained = compositionPaths.filter((path) => !FINAL_COMPOSITION_PATHS.has(path));
  assert.deepEqual(unexplained, [], `unexplained final semantic drift: ${unexplained.join(", ")}`);
  assert.equal(git(["status", "--porcelain=v1", "-uall"]), "", "final certification requires a clean exact-SHA worktree");

  const p5HardGates = gateCount("architecture/p5/hard-gates.json");
  const p6HardGates = gateCount("architecture/p6/hard-gates.json");
  validateCorpora();

  return {
    status: "PASS_FINAL_DESCENDANT_LINEAGE",
    finalP5Certification: "PASS",
    finalP6Certification: "PASS",
    head,
    branch: git(["branch", "--show-current"]) || process.env.GITHUB_HEAD_REF || process.env.GITHUB_REF_NAME || "DETACHED",
    lineage: P6_LINEAGE,
    p5FinalSha: P6_LINEAGE.p5Final,
    p6ImplementationSha: P6_LINEAGE.p6Implementation,
    p6FinalSha: head,
    reconciliationCount: manifest.reconciliationCount,
    protectedArtifactHashes: manifest.protectedGitObjects,
    corpusHashes: manifest.corpora,
    hardGates: { p5: p5HardGates, p6: p6HardGates, nonZero: 0 },
    unexplainedSemanticDrift: 0,
    finalCompositionPaths: compositionPaths,
    scope: manifest.scope,
  } as const;
}

if (process.argv.includes("--run") && process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    console.log(JSON.stringify(verifyP6DescendantLineage(), null, 2));
  } catch (error) {
    console.error(error);
    process.exitCode = 1;
  }
}
