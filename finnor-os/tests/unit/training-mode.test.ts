import { describe, expect, it } from "vitest";
import { dedupeInventoryBySku } from "../../packages/orchestration/src/training-mode";

describe("training bootstrap source convergence", () => {
  it("keeps the last source row for each inventory SKU", () => {
    expect(dedupeInventoryBySku([
      { sku: "FILTER-A", name: "old", quantity: 1 },
      { sku: "FILTER-B", name: "b", quantity: 2 },
      { sku: "FILTER-A", name: "current", quantity: 3 },
    ])).toEqual([
      { sku: "FILTER-A", name: "current", quantity: 3 },
      { sku: "FILTER-B", name: "b", quantity: 2 },
    ]);
  });
});
