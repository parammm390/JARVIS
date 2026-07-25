// B4.T1: named Dealer Zero scenario packs. These are deliberately data-only: the
// planner remains a pure function of (seed, snapshot, scenario), and the apply half
// still uses the normal gated runtime. A fault hint is an observation for a scenario
// report; it never mutates process-wide emulator fault configuration.

export const SCENARIO_PACKS = ["normal_day", "brutal_summer", "payment_crunch", "equipment_recall", "chaos_day"] as const;
export type ScenarioPack = (typeof SCENARIO_PACKS)[number];

export interface ScenarioProfile {
  leadRange: readonly [number, number];
  visitRange: readonly [number, number];
  completionRate: number;
  complaintChance: number;
  paymentRate: number;
  recall: boolean;
  faultHints: readonly string[];
}

const PROFILES: Record<ScenarioPack, ScenarioProfile> = {
  normal_day: { leadRange: [1, 3], visitRange: [2, 5], completionRate: 0.9, complaintChance: 0.08, paymentRate: 0.8, recall: false, faultHints: [] },
  brutal_summer: { leadRange: [4, 7], visitRange: [5, 9], completionRate: 0.82, complaintChance: 0.2, paymentRate: 0.72, recall: false, faultHints: [] },
  payment_crunch: { leadRange: [1, 3], visitRange: [2, 5], completionRate: 0.9, complaintChance: 0.1, paymentRate: 0.3, recall: false, faultHints: [] },
  equipment_recall: { leadRange: [1, 3], visitRange: [3, 6], completionRate: 0.86, complaintChance: 0.35, paymentRate: 0.75, recall: true, faultHints: [] },
  chaos_day: { leadRange: [2, 5], visitRange: [3, 7], completionRate: 0.65, complaintChance: 0.45, paymentRate: 0.45, recall: false, faultHints: ["communications:provider_down", "scheduling:retryable"] },
};

export function isScenarioPack(value: unknown): value is ScenarioPack {
  return typeof value === "string" && (SCENARIO_PACKS as readonly string[]).includes(value);
}

export function scenarioProfile(scenario: ScenarioPack = "normal_day"): ScenarioProfile {
  return PROFILES[scenario];
}
