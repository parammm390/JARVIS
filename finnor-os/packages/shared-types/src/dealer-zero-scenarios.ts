// Shared scenario identity only. Worker-owned scenario behavior lives beside the
// simulator; API/UI consumers may validate names without importing a worker app.
export const DEALER_ZERO_SCENARIO_PACKS = ["normal_day", "brutal_summer", "payment_crunch", "equipment_recall", "chaos_day"] as const;
export type DealerZeroScenarioPack = (typeof DEALER_ZERO_SCENARIO_PACKS)[number];

export function isDealerZeroScenarioPack(value: unknown): value is DealerZeroScenarioPack {
  return typeof value === "string" && (DEALER_ZERO_SCENARIO_PACKS as readonly string[]).includes(value);
}
