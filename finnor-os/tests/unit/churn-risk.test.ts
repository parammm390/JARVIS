import { describe, expect, it } from "vitest";
import { churnRisk } from "../../packages/read-models/src/churn-risk";
describe("B3 churn risk", () => it("is explicitly heuristic and explains every score factor", () => {
  const result = churnRisk({ daysSinceVisit: 400, visitsLastYear: 0, hasActiveAmc: false, overdueBalanceUsd: 20 });
  expect(result).toEqual({ score: 100, factors: ["no visit in a year", "no visits in the last year", "no active maintenance agreement", "overdue balance"], label: "heuristic" });
}));
