// B3.T3 — small additive Holt-Winters implementation with honest uncertainty bands.
// It requires two complete seasons; callers must show unavailable rather than extrapolate
// from a handful of rows.

export interface ForecastPoint { day: number; estimate: number; low: number; high: number }

export function holtWinters(values: number[], horizon = 14, season = 7): ForecastPoint[] | null {
  if (values.length < season * 2 || values.some((value) => !Number.isFinite(value))) return null;
  const alpha = 0.35, beta = 0.15, gamma = 0.2;
  let level = values.slice(0, season).reduce((sum, value) => sum + value, 0) / season;
  let trend = (values.slice(season, season * 2).reduce((sum, value) => sum + value, 0) / season - level) / season;
  const seasonal = values.slice(0, season).map((value) => value - level);
  const residuals: number[] = [];
  for (let index = season; index < values.length; index += 1) {
    const priorLevel = level, priorTrend = trend, priorSeason = seasonal[index % season]!;
    const fitted = priorLevel + priorTrend + priorSeason;
    residuals.push(values[index]! - fitted);
    level = alpha * (values[index]! - priorSeason) + (1 - alpha) * (priorLevel + priorTrend);
    trend = beta * (level - priorLevel) + (1 - beta) * priorTrend;
    seasonal[index % season] = gamma * (values[index]! - level) + (1 - gamma) * priorSeason;
  }
  const sigma = Math.sqrt(residuals.reduce((sum, value) => sum + value * value, 0) / Math.max(1, residuals.length));
  return Array.from({ length: horizon }, (_, index) => {
    const estimate = Math.max(0, level + (index + 1) * trend + seasonal[(values.length + index) % season]!);
    const band = 1.96 * sigma * Math.sqrt(1 + (index + 1) / season);
    return { day: index + 1, estimate, low: Math.max(0, estimate - band), high: estimate + band };
  });
}
