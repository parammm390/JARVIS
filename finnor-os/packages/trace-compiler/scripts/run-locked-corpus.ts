import { runP6LockedCorpus } from "../fixtures/locked-corpus";

const results = runP6LockedCorpus();
const failed = results.filter((result) => !result.passed);
console.log(JSON.stringify({ status: failed.length === 0 ? "PASS" : "FAIL", count: results.length, failed, results }, null, 2));
if (failed.length > 0) process.exitCode = 1;
