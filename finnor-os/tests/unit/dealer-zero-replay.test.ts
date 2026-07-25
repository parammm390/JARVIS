import { describe, expect, it } from "vitest";
import { diffNormalizedReceipts } from "../../packages/orchestration/src/dealer-zero-replay";

const receipt = { proposedAction: { actionType: "create_invoice", payload: { amountUsd: 129, householdId: "synthetic-hh" } }, expectedResult: { invoice: "draft" }, actualResult: { invoice: "created" }, failure: null, approval: { required: true } };
describe("Dealer Zero normalized receipt replay (B4.T3)", () => {
  it("ignores key order and runtime-only receipt fields omitted from the contract", () => { expect(diffNormalizedReceipts([receipt], [{ ...receipt, proposedAction: { payload: { householdId: "synthetic-hh", amountUsd: 129 }, actionType: "create_invoice" } }]).equal).toBe(true); });
  it("catches a deliberate behavioral change in a receipt report", () => { const report = diffNormalizedReceipts([receipt], [{ ...receipt, actualResult: { invoice: "failed" } }]); expect(report.equal).toBe(false); expect(report.added).toHaveLength(1); expect(report.removed).toHaveLength(1); });
});
