import { describe, expect, it } from "vitest";
import { ewmaReorderSuggestion } from "../../packages/read-models/src/reorder-points";

describe("B3 EWMA reorder points", () => {
  it("derives a transparent 14-day point from real daily usage inputs", () => {
    expect(ewmaReorderSuggestion(Array(14).fill(3), 10)).toEqual({
      dailyUsage: 3, horizonDays: 14, reorderPoint: 42, suggestedQuantity: 32,
    });
  });

  it("does not make a suggestion without enough history or when stock covers the point", () => {
    expect(ewmaReorderSuggestion([1, 1, 1], 0)).toBeNull();
    expect(ewmaReorderSuggestion(Array(14).fill(1), 15)).toBeNull();
  });
});
