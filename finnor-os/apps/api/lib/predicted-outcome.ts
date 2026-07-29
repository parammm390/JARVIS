// jarvis-v3 P4.T1 — extracts a plugin's own simulate() prediction out of a
// domain_action's predictedReceipt column (written once, at plan-creation time,
// by orchestration/src/planner.ts's predictedReceipts[i] — see B2.T2). Shared by
// GET /api/actions/pending (pre-execution: the approval card's own predicted
// outcome) and GET /api/receipts/[id] (post-execution: the predicted<->actual
// diff). Additive and honest: any row without a real simulate() result (most of
// the 41 action types have no flagship simulate() yet, or the row predates
// B2.T2) returns null, never a fabricated prediction.

export type PredictedOutcome = Record<string, unknown>;

export function extractPredicted(predictedReceipt: unknown): PredictedOutcome | null {
  if (!predictedReceipt || typeof predictedReceipt !== "object") return null;
  const simulation = (predictedReceipt as { simulation?: unknown }).simulation;
  if (!simulation || typeof simulation !== "object") return null;
  const predicted = (simulation as { predicted?: unknown }).predicted;
  if (!predicted || typeof predicted !== "object") return null;
  return predicted as PredictedOutcome;
}
