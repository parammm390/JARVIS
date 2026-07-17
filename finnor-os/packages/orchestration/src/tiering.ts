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

// Phase 12 (loop closure): action types where drafting against stock a scan already
// flagged as low is itself a stakes signal, independent of dollar amount — named and
// exported so scan-low-inventory.ts and this module agree on the same set without
// duplicating it.
export const STOCK_CONSUMING_ACTION_TYPES = new Set(["log_stock_used_on_visit", "start_installation_workflow"]);

export function classifyReasoningTier(input: {
  requiresConfirmation: boolean;
  compiledGraph: CommandGraph;
  payload: Record<string, unknown>;
  amountThresholdUsd?: number;
  actionType?: string;
  openScanSignals?: Array<{ scanType: string; severity: string }>;
}): ReasoningTier {
  // Tier only ever spends more reasoning on gated stakes — an action that doesn't
  // require confirmation was never going to get extra scrutiny, and scan signals
  // don't change that by design.
  if (!input.requiresConfirmation) return "low";
  const threshold = input.amountThresholdUsd ?? DEFAULT_AMOUNT_USD_THRESHOLD;
  const amount = typeof input.payload.amountUsd === "number" ? input.payload.amountUsd : null;
  if (input.compiledGraph.kind === "workflow" || (amount !== null && amount > threshold)) return "high";

  const signals = input.openScanSignals ?? [];
  const hasCritical = signals.some((s) => s.severity === "critical");
  const hasLowInventoryStockConsumption =
    input.actionType !== undefined &&
    STOCK_CONSUMING_ACTION_TYPES.has(input.actionType) &&
    signals.some((s) => s.scanType === "low_inventory");
  if (hasCritical || hasLowInventoryStockConsumption) return "high";

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
