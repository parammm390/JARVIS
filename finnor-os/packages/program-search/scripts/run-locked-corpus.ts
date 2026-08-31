import { createHash } from "node:crypto";
import { canonicalSerialize, canonicalizeIrFragment } from "@finnor/operational-ir";
import { P4_LOCKED_CASES, runP4LockedCorpus } from "../fixtures/locked-corpus";

const results = await runP4LockedCorpus();
const hash = createHash("sha256")
  .update(canonicalSerialize(canonicalizeIrFragment(P4_LOCKED_CASES)), "utf8")
  .digest("hex");
process.stdout.write(`${JSON.stringify({ status: "PASS", count: results.length, hash, cases: results }, null, 2)}\n`);
