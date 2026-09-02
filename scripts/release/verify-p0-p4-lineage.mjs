import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

// Compatibility entrypoint retained for older local invocations. The canonical
// production branch now carries the stronger immutable P0-P6 lineage proof;
// this alias deliberately has no provider-specific deployment behavior.
const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const finnorRoot = join(repositoryRoot, "finnor-os");

function git(args) {
  return execFileSync("git", args, { cwd: repositoryRoot, encoding: "utf8" }).trim();
}

export function verifyP0P4ReleaseLineage() {
  const manifestPath = join(finnorRoot, "architecture/p6/final-lineage.json");
  assert.ok(existsSync(manifestPath), "the canonical P0-P6 lineage manifest is missing");
  const output = execFileSync("npm", ["run", "p6:lineage"], {
    cwd: finnorRoot,
    encoding: "utf8",
    env: { ...process.env, NO_COLOR: "1", FORCE_COLOR: "0" },
    maxBuffer: 64 * 1024 * 1024,
  });
  return {
    status: "PASS",
    mode: "CANONICAL_P0_P6_LINEAGE",
    head: git(["rev-parse", "HEAD"]),
    output: output.trim(),
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
