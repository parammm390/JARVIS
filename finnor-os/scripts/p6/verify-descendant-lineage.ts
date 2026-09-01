import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const osRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const repositoryRoot = resolve(osRoot, "..");

export const P6_LINEAGE = Object.freeze({
  remoteMain: "ff9221538f671970c98b83d408b51ca5d63604c5",
  p0: "4257973fcd2ea8624ed179bf5b18d1ab513eccf6",
  p1: "1a31904b35fff39aa1cab1c404f1d7467d723989",
  p2: "5cc95730babeee99055b5cb00c88b7d66dff8ab8",
  p3: "c0965059b92c1b0f73100c4556301044c1b7e9c4",
  p4: "39a114f963b46b2abfde3420037395dfb95610cc",
  promotedMain: "7ec3cee9528b54490e35ae77c19156d466362146",
  p5Local: "baa777e8caedaaf09fdfde5f6e901393b90c201f",
});

const P6_BRANCH = "codex/p6-trace-compiler";

function git(args: string[]): string {
  return execFileSync("git", args, { cwd: repositoryRoot, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 }).trimEnd();
}

function assertAncestor(ancestor: string, descendant: string, label: string): void {
  assert.doesNotThrow(() => git(["merge-base", "--is-ancestor", ancestor, descendant]), `${label}: ${ancestor} is not an ancestor of ${descendant}`);
}

function changedPaths(): string[] {
  const committed = git(["diff", "--name-only", P6_LINEAGE.p5Local, "--", "finnor-os"])
    .split("\n").filter(Boolean).map((path) => path.replace(/^finnor-os\//, ""));
  const untracked = git(["status", "--porcelain=v1", "-uall", "--", "finnor-os"])
    .split("\n").filter(Boolean).map((line) => line.slice(3).split(" -> ").at(-1)!.replace(/^finnor-os\//, ""));
  return [...new Set([...committed, ...untracked])].sort();
}

export function verifyP6DescendantLineage() {
  const head = git(["rev-parse", "HEAD"]);
  const ordered = [
    P6_LINEAGE.remoteMain, P6_LINEAGE.p0, P6_LINEAGE.p1, P6_LINEAGE.p2, P6_LINEAGE.p3,
    P6_LINEAGE.p4, P6_LINEAGE.promotedMain, P6_LINEAGE.p5Local, head,
  ];
  for (let index = 0; index < ordered.length - 1; index += 1) assertAncestor(ordered[index]!, ordered[index + 1]!, `P6 descendant lineage step ${index + 1}`);
  assert.equal(git(["branch", "--show-current"]), P6_BRANCH);

  const changed = changedPaths();
  const outOfScope = changed.filter((path) => !(path === "package.json"
    || path === "package-lock.json"
    || path === "tsconfig.base.json"
    || path === "vitest.config.ts"
    || path.startsWith("architecture/p6/")
    || path.startsWith("scripts/p6/")
    || path.startsWith("packages/trace-compiler/")
    || /^tests\/unit\/p6-[^/]+\.test\.ts$/.test(path)));
  assert.deepEqual(outOfScope, [], `P6 contains out-of-scope changes: ${outOfScope.join(", ")}`);

  const protectedPaths = [
    "finnor-os/architecture/p0", "finnor-os/architecture/p1", "finnor-os/architecture/p2", "finnor-os/architecture/p3", "finnor-os/architecture/p4", "finnor-os/architecture/p5",
    "finnor-os/scripts/p0", "finnor-os/scripts/p1", "finnor-os/scripts/p2", "finnor-os/scripts/p3", "finnor-os/scripts/p4", "finnor-os/scripts/p5",
    "finnor-os/packages/db", "finnor-os/packages/authority", "finnor-os/packages/computer", "finnor-os/packages/workflow-runtime",
    "finnor-os/packages/shared-types", "finnor-os/packages/operational-ir", "finnor-os/packages/epistemic-runtime", "finnor-os/packages/program-search", "finnor-os/packages/speculative-runtime",
    "finnor-os/packages/data-platform", "finnor-os/packages/read-models", "finnor-os/packages/orchestration",
  ];
  assert.equal(git(["diff", "--name-only", P6_LINEAGE.p5Local, "--", ...protectedPaths]), "", "P6 changed a P0-P5 artifact, Work, Authority, BusinessEffect, provider/computer, planner, or governed evidence owner");

  const boundary = JSON.parse(readFileSync(join(osRoot, "architecture/p6/production-release-boundary.json"), "utf8"));
  assert.equal(boundary.p5LocalSha, P6_LINEAGE.p5Local);
  assert.equal(boundary.p5FinalCertification, "BLOCKED_BY_P0_P4_RELEASE_FAILURE");
  assert.equal(boundary.reconciliationCount, 0);
  assert.equal(boundary.productionRelease.finalPassReached, false);

  return {
    status: "PASS_LOCAL_DESCENDANT_LINEAGE",
    finalP6CertificationEligible: false,
    finalBlocker: "P5_FINAL_CERTIFICATION_NOT_PASSED",
    head,
    branch: P6_BRANCH,
    lineage: P6_LINEAGE,
    changedPaths: changed,
    protectedP0P5DiffCount: 0,
    p6ReconciliationCount: 0,
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
