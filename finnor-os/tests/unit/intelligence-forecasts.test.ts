import { describe, expect, it } from "vitest";
import { holtWinters } from "../../packages/read-models/src/holt-winters";

describe("B3 forecast input contract", () => {
  it("keeps 14-day bands unavailable until two weekly seasons of real daily history exist", () => {
    expect(holtWinters(Array(13).fill(0))).toBeNull();
    expect(holtWinters(Array.from({ length: 56 }, (_, index) => index % 7))).toHaveLength(14);
  });
});
