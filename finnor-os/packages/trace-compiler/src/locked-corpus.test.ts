import { describe, expect, it } from "vitest";
import { P6_LOCKED_CASES, runP6LockedCorpus } from "../fixtures/locked-corpus";

describe("permanent P6 locked corpus", () => {
  it("passes every fixed offline case", () => {
    const results = runP6LockedCorpus();
    expect(P6_LOCKED_CASES).toHaveLength(31);
    expect(results).toHaveLength(31);
    expect(results.filter((result) => !result.passed)).toEqual([]);
  });
});
