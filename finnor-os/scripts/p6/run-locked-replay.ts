import { createHash } from "node:crypto";
import { canonicalSerialize } from "@finnor/trace-compiler";
import { P6_LOCKED_CASES, runP6LockedCorpus } from "../../packages/trace-compiler/fixtures/locked-corpus";

const results = runP6LockedCorpus();
const failed = results.filter((result) => !result.passed);
const fixtureHash = createHash("sha256").update(canonicalSerialize(P6_LOCKED_CASES)).digest("hex");
const resultHash = createHash("sha256").update(canonicalSerialize(results)).digest("hex");
process.stdout.write(`${JSON.stringify({
  status: failed.length === 0 ? "PASS" : "FAIL",
  count: results.length,
  fixtureHash,
  resultHash,
  failed,
}, null, 2)}\n`);
if (failed.length > 0) process.exitCode = 1;
