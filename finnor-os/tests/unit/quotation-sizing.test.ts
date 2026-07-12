import { describe, it, expect } from "vitest";
import { sizeSoftener, SizingPayloadSchema } from "../../packages/domain-plugins/quotation/index";

describe("size_equipment_for_household — standard sizing formula", () => {
  it("4 people, 18 gpg well water with 0.4 ppm iron", () => {
    const input = SizingPayloadSchema.parse({ hardnessGpg: 18, ironPpm: 0.4, peopleInHousehold: 4 });
    const r = sizeSoftener(input);
    expect(r.compensatedHardness).toBeCloseTo(19.6); // 18 + 0.4*4
    expect(r.dailyGallons).toBe(300); // 4 × 75
    expect(r.weeklyGrains).toBe(41160); // 19.6 × 300 × 7
    expect(r.recommendedCapacityGrains).toBe(48_000); // next common size up
  });
  it("small soft-water household lands on the smallest unit", () => {
    const r = sizeSoftener(SizingPayloadSchema.parse({ hardnessGpg: 4, peopleInHousehold: 2 }));
    expect(r.recommendedCapacityGrains).toBe(24_000);
  });
  it("caps at the largest common size instead of inventing hardware", () => {
    const r = sizeSoftener(SizingPayloadSchema.parse({ hardnessGpg: 60, ironPpm: 5, peopleInHousehold: 12 }));
    expect(r.recommendedCapacityGrains).toBe(110_000);
  });
});
