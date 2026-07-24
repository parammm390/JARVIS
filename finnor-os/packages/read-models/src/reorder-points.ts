// B3.T7 — transparent, data-only reorder suggestion.  The 14-day horizon is a
// planning default (not a vendor lead-time claim); callers expose it in the
// suggestion so a dealer can change the decision before any procurement action.

export interface EwmaReorderSuggestion {
  dailyUsage: number;
  horizonDays: number;
  reorderPoint: number;
  suggestedQuantity: number;
}

/**
 * Returns no suggestion until there are seven observed calendar days of actual
 * stock-use history. Zero-use days belong in `dailyUsage`; this function does not
 * manufacture them or infer usage from inventory snapshots.
 */
export function ewmaReorderSuggestion(
  dailyUsage: number[],
  currentQuantity: number,
  horizonDays = 14,
  alpha = 0.3,
): EwmaReorderSuggestion | null {
  if (
    dailyUsage.length < 7 ||
    !Number.isInteger(currentQuantity) ||
    currentQuantity < 0 ||
    !Number.isInteger(horizonDays) ||
    horizonDays < 1 ||
    !Number.isFinite(alpha) ||
    alpha <= 0 ||
    alpha > 1 ||
    dailyUsage.some((quantity) => !Number.isFinite(quantity) || quantity < 0)
  ) return null;

  let rate = dailyUsage[0]!;
  for (const quantity of dailyUsage.slice(1)) rate = alpha * quantity + (1 - alpha) * rate;
  const reorderPoint = Math.ceil(rate * horizonDays);
  if (currentQuantity > reorderPoint) return null;
  return {
    dailyUsage: Number(rate.toFixed(2)),
    horizonDays,
    reorderPoint,
    suggestedQuantity: Math.max(0, reorderPoint - currentQuantity),
  };
}
