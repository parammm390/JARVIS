import { describe, expect, it } from "vitest";
import { holtWinters } from "../../packages/read-models/src/holt-winters";

describe("B3 Holt-Winters forecasts", () => {
  it("returns 14 non-negative bands for a known weekly seasonal series", () => {
    const result = holtWinters([10, 12, 14, 16, 18, 20, 22, 11, 13, 15, 17, 19, 21, 23]);
    expect(result).toHaveLength(14);
    expect(result![0]!.estimate).toBeGreaterThan(0);
    expect(result!.every((point) => point.low <= point.estimate && point.estimate <= point.high)).toBe(true);
  });
  it("refuses insufficient history", () => expect(holtWinters([1, 2, 3])).toBeNull());
});
