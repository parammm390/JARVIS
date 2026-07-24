import { describe, expect, it } from "vitest";
import { rollingZScores } from "../../packages/read-models/src/anomaly-detector";
describe("B3 rolling anomaly detector", () => {
  it("detects a real spike after a variable baseline", () => {
    const found = rollingZScores([10, 11, 9, 10, 12, 8, 11, 9, 10, 12, 8, 11, 9, 10, 100], 14, 3);
    expect(found).toHaveLength(1); expect(found[0]!.index).toBe(14);
  });
  it("does not call a constant history anomalous", () => expect(rollingZScores(Array(20).fill(5))).toEqual([]));
});
