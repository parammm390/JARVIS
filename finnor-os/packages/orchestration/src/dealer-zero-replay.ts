// B4.T3: normalized receipt replay. IDs, timestamps and trace IDs are intentionally
// excluded: they are transport/runtime noise, not behavior. A changed action, expected
// result, actual result, failure, or approval contract is a behavioral regression.

export interface ReceiptLike {
  proposedAction: unknown;
  expectedResult: unknown;
  actualResult: unknown;
  failure: unknown;
  approval: unknown;
}
export interface NormalizedReceipt { action: unknown; expected: unknown; actual: unknown; failure: unknown; approval: unknown; }
export interface ReceiptDiff { equal: boolean; added: NormalizedReceipt[]; removed: NormalizedReceipt[]; }

function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b)).map(([key, child]) => [key, canonical(child)]));
  return value ?? null;
}
export function normalizeReceipt(receipt: ReceiptLike): NormalizedReceipt {
  return { action: canonical(receipt.proposedAction), expected: canonical(receipt.expectedResult), actual: canonical(receipt.actualResult), failure: canonical(receipt.failure), approval: canonical(receipt.approval) };
}
function key(receipt: NormalizedReceipt): string { return JSON.stringify(receipt); }
export function diffNormalizedReceipts(baseline: ReceiptLike[], candidate: ReceiptLike[]): ReceiptDiff {
  const remaining = new Map<string, NormalizedReceipt[]>();
  for (const item of baseline.map(normalizeReceipt)) remaining.set(key(item), [...(remaining.get(key(item)) ?? []), item]);
  const added: NormalizedReceipt[] = [];
  for (const item of candidate.map(normalizeReceipt)) { const matches = remaining.get(key(item)); if (matches?.length) matches.pop(); else added.push(item); }
  const removed = [...remaining.values()].flat();
  return { equal: added.length === 0 && removed.length === 0, added, removed };
}
