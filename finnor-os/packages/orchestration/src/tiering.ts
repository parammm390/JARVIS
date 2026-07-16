// Risk-tiered reasoning depth (Phase 8, docs/jarvis-99-phase-7-9-execution-plan.md).
// Sibling to repair.ts — a separate single-purpose module, matching how compiler.ts
// and repair.ts are already split. Pure, no DB access, safe to call from inside an
// existing transaction/insert batch with zero extra round trips.

import type { CommandGraph } from "./compiler";
import type { ReasoningTier } from "@finnor/shared-types";

// A starting guess, not a researched number — same honesty norm as
// PLACEHOLDER_NEEDS_REAL_VALUE, even though this constant doesn't hard-gate
// anything, only tiers reasoning depth. Ground truth (repo-wide search): exactly one
// plugin schema field named amountUsd in any LLM-drafted payload — accounting's
// create_invoice. The compiledGraph.kind === "workflow" check is the primary lever
// for "high stakes" in practice, since it covers every vertical-workflow action type
// regardless of dollar amount; this magnitude check is a narrow, additional signal
// that today only fires for invoice creation.
export const DEFAULT_AMOUNT_USD_THRESHOLD = 500;

export function classifyReasoningTier(input: {
  requiresConfirmation: boolean;
  compiledGraph: CommandGraph;
  payload: Record<string, unknown>;
  amountThresholdUsd?: number;
}): ReasoningTier {
  if (!input.requiresConfirmation) return "low";
  const threshold = input.amountThresholdUsd ?? DEFAULT_AMOUNT_USD_THRESHOLD;
  const amount = typeof input.payload.amountUsd === "number" ? input.payload.amountUsd : null;
  if (input.compiledGraph.kind === "workflow" || (amount !== null && amount > threshold)) return "high";
  return "medium";
}

export interface CandidateScoreInputs {
  actionType: string;
  groundedPayload: Array<{ field: string; status: "verified" | "not_found" | "unverifiable" }>;
  /** Extension point for Phase 9 — default 0, Phase 9 wires a real value in later. */
  patternScore?: number;
}

export function scoreCandidate(input: CandidateScoreInputs): number {
  const verifiedBonus = input.groundedPayload.filter((g) => g.status === "verified").length;
  const notFoundPenalty = input.groundedPayload.filter((g) => g.status === "not_found").length * -2;
  const genericFallbackPenalty = input.actionType === "answer_business_question" ? -1 : 0;
  return verifiedBonus + notFoundPenalty + genericFallbackPenalty + (input.patternScore ?? 0);
}
