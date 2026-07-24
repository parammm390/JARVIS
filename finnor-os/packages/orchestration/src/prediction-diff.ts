// B2.T3: compare only fields a simulation explicitly marked comparable. Omitted
// fields mean "unknown", never a silent match and never a penalty to accuracy.

export interface PredictionDiffField { path: string; predicted: unknown; actual: unknown; matched: boolean }
export interface PredictionDiff { compared: number; matched: number; accuracy: number | null; fields: PredictionDiffField[] }

function flatten(value: unknown, path = ""): Array<[string, unknown]> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return [[path, value]];
  return Object.entries(value as Record<string, unknown>).flatMap(([key, child]) => flatten(child, path ? `${path}.${key}` : key));
}
function atPath(value: unknown, path: string): unknown {
  return path.split(".").reduce<unknown>((current, key) => current && typeof current === "object" ? (current as Record<string, unknown>)[key] : undefined, value);
}
export function diffPrediction(expectedResult: Record<string, unknown> | undefined, actual: Record<string, unknown>): PredictionDiff {
  if (!expectedResult) return { compared: 0, matched: 0, accuracy: null, fields: [] };
  const fields = flatten(expectedResult).map(([path, predicted]) => {
    const actualValue = atPath(actual, path);
    return { path, predicted, actual: actualValue, matched: JSON.stringify(predicted) === JSON.stringify(actualValue) };
  });
  const matched = fields.filter((field) => field.matched).length;
  return { compared: fields.length, matched, accuracy: fields.length ? matched / fields.length : null, fields };
}
