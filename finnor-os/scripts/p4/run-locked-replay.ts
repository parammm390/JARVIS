import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { canonicalSerialize, canonicalizeIrFragment } from "@finnor/operational-ir";
import { P4_LOCKED_CASES, runP4LockedCorpus } from "../../packages/program-search/fixtures/locked-corpus";

async function main(): Promise<void> {
  const root = resolve(import.meta.dirname, "../..");
  const manifest = JSON.parse(await readFile(resolve(root, "architecture/p4/replay-corpus.json"), "utf8")) as Record<string, any>;
  const fixtureHash = createHash("sha256").update(canonicalSerialize(canonicalizeIrFragment(P4_LOCKED_CASES))).digest("hex");
  assert.equal(P4_LOCKED_CASES.length, 26);
  assert.equal(fixtureHash, manifest.fixtureCanonicalSha256);
  assert.equal(manifest.combined.categoryCases, 130);
  const results = await runP4LockedCorpus();
  assert.equal(results.length, 26);
  assert.deepEqual(results.filter((result) => !result.passed), []);
  process.stdout.write(`${JSON.stringify({ status: "PASS", p4Cases: results.length, p4CorpusHash: fixtureHash, combinedCases: manifest.combined.categoryCases, combinedCorpusHash: manifest.combined.corpusHash }, null, 2)}\n`);
}

void main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
