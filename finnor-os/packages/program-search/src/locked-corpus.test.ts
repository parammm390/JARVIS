import { describe, expect, it } from "vitest";
import { P4_LOCKED_CASES, runP4LockedCorpus } from "../fixtures/locked-corpus";

describe("P4 permanent locked corpus", () => {
  it("executes every required deterministic case without model/provider/network dependencies", async () => {
    const results = await runP4LockedCorpus();
    expect(results).toHaveLength(26);
    expect(results.map((result) => result.id)).toEqual(P4_LOCKED_CASES.map((fixture) => fixture.id));
    expect(results.every((result) => result.passed && result.actual === result.evidence)).toBe(true);
  });
});
