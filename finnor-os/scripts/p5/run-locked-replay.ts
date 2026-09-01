import { createHash } from "node:crypto";
import { canonicalSerialize, canonicalizeIrFragment } from "@finnor/operational-ir";
import { P5_LOCKED_CASES, runP5LockedCorpus } from "../../packages/speculative-runtime/fixtures/locked-corpus";

void (async () => {
  const cases = await runP5LockedCorpus();
  const hash = createHash("sha256").update(canonicalSerialize(canonicalizeIrFragment(P5_LOCKED_CASES)), "utf8").digest("hex");
  process.stdout.write(`${JSON.stringify({ status: "PASS", count: cases.length, hash }, null, 2)}\n`);
})();
