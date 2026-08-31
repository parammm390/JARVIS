import { describe, expect, it } from "vitest";
import { runP4LockedCorpus } from "../../packages/program-search/fixtures/locked-corpus";

describe("P4 locked replay integration", () => {
  it("replays all bounded search, rewrite, solver, handoff, extraction, and lowering cases", async () => {
    const results = await runP4LockedCorpus();
    expect(results).toHaveLength(26);
    expect(results.filter((result) => !result.passed)).toEqual([]);
  });
});
