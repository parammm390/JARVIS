import { describe, expect, it } from "vitest";
import { P5_LOCKED_CASES, runP5LockedCorpus } from "../fixtures/locked-corpus";

describe("P5 permanent locked corpus", () => {
  it("executes all 26 fixed-clock, zero-network cases", async () => {
    const results = await runP5LockedCorpus();
    expect(results).toHaveLength(26);
    expect(results.map((result) => result.id)).toEqual(P5_LOCKED_CASES.map((fixture) => fixture.id));
    expect(results.every((result) => result.passed && result.actual === result.evidence)).toBe(true);
  });
});
