import { describe, expect, it } from "vitest";
import { checkPolicyCoverage } from "../../scripts/lint-policy-coverage";

describe("B6 policy coverage lint", () => {
  it("is red for an uncovered action and green for complete coverage", () => {
    expect(checkPolicyCoverage(["read", "write"], ["read"])).toEqual({ missing: ["write"], stale: [] });
    expect(checkPolicyCoverage(["read", "write"], ["read", "write"])).toEqual({ missing: [], stale: [] });
  });
});
