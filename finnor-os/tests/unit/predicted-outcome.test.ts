// jarvis-v3 P4.T1 — pure-function coverage for extractPredicted, the shared
// normalizer GET /api/actions/pending and GET /api/receipts/[id] both use to
// surface a plugin's real simulate() prediction. No DB needed (BLOCKER B-1's
// established posture, backend side): this is a pure projection over whatever
// shape planner.ts already wrote into predictedReceipt.

import { describe, it, expect } from "vitest";
import { extractPredicted } from "../../apps/api/lib/predicted-outcome";

describe("extractPredicted", () => {
  it("returns the real predicted object from a genuine predictedReceipt", () => {
    const predictedReceipt = {
      version: 1,
      actionType: "start_invoice_to_cash_workflow",
      simulation: {
        mode: "dry_run",
        summary: "Dry run: payment-link, delivery, and accounting-sync steps would be queued for $890; no command or payment link was created.",
        predicted: { invoiceId: "inv-1", invoiceFound: true, amountUsd: 890, steps: ["create_payment_link", "send_message", "sync_invoice"] },
      },
    };
    expect(extractPredicted(predictedReceipt)).toEqual({
      invoiceId: "inv-1",
      invoiceFound: true,
      amountUsd: 890,
      steps: ["create_payment_link", "send_message", "sync_invoice"],
    });
  });

  it("returns null for a null predictedReceipt (row predates B2.T2, or no simulate() ran)", () => {
    expect(extractPredicted(null)).toBeNull();
  });

  it("returns null when simulation is missing", () => {
    expect(extractPredicted({ version: 1, actionType: "x" })).toBeNull();
  });

  it("returns null when simulation.predicted is missing (a plugin whose simulate() has no data-backed prediction)", () => {
    expect(extractPredicted({ version: 1, actionType: "x", simulation: { mode: "dry_run", summary: "no data" } })).toBeNull();
  });

  it("never throws on a malformed shape", () => {
    expect(extractPredicted("not an object")).toBeNull();
    expect(extractPredicted(42)).toBeNull();
    expect(extractPredicted({ simulation: "not an object either" })).toBeNull();
    expect(extractPredicted({ simulation: { predicted: "also not an object" } })).toBeNull();
  });
});
