// B3.T4 — rolling z-score detector. It rejects tiny/no-variance histories so a
// single ordinary sample is never dressed up as an anomaly.
export interface Anomaly { index: number; value: number; mean: number; zScore: number }
export function rollingZScores(values: number[], window = 14, threshold = 3): Anomaly[] {
  const anomalies: Anomaly[] = [];
  for (let index = window; index < values.length; index += 1) {
    const prior = values.slice(index - window, index);
    const mean = prior.reduce((sum, value) => sum + value, 0) / window;
    const deviation = Math.sqrt(prior.reduce((sum, value) => sum + (value - mean) ** 2, 0) / window);
    if (deviation === 0) continue;
    const zScore = (values[index]! - mean) / deviation;
    if (Math.abs(zScore) >= threshold) anomalies.push({ index, value: values[index]!, mean, zScore });
  }
  return anomalies;
}
