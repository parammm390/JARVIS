// B3.T5: transparent heuristic, not a learned probability.
export interface ChurnRiskInput { daysSinceVisit: number; visitsLastYear: number; hasActiveAmc: boolean; overdueBalanceUsd: number }
export function churnRisk(input: ChurnRiskInput): { score: number; factors: string[]; label: "heuristic" } {
  const factors: string[] = []; let score = 0;
  if (input.daysSinceVisit >= 365) { score += 35; factors.push("no visit in a year"); }
  if (input.visitsLastYear === 0) { score += 25; factors.push("no visits in the last year"); }
  if (!input.hasActiveAmc) { score += 20; factors.push("no active maintenance agreement"); }
  if (input.overdueBalanceUsd > 0) { score += 20; factors.push("overdue balance"); }
  return { score, factors, label: "heuristic" };
}
