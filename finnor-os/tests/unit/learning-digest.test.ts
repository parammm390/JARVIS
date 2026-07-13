// Learning digest — pure aggregation logic (no DB): outcome stats and the
// deterministic concern shortlist derived from them. DB-touching computeLearningDigest
// and the scanFindings-writing job are covered by tests/integration/learning-digest.test.ts.

import { describe, it, expect } from "vitest";
import { summarizeActionOutcomes, buildTopConcerns, type ActionTypeStats, type CriticFinding } from "@finnor/orchestration";

describe("summarizeActionOutcomes", () => {
  it("buckets rows by actionType and status", () => {
    const rows = [
      { actionType: "create_invoice", status: "completed" },
      { actionType: "create_invoice", status: "completed" },
      { actionType: "create_invoice", status: "failed" },
      { actionType: "create_invoice", status: "rejected" },
      { actionType: "create_invoice", status: "pending" },
      { actionType: "schedule_water_test", status: "completed" },
    ];
    const stats = summarizeActionOutcomes(rows);
    const invoice = stats.find((s) => s.actionType === "create_invoice")!;
    expect(invoice.total).toBe(5);
    expect(invoice.completed).toBe(2);
    expect(invoice.failed).toBe(1);
    expect(invoice.rejected).toBe(1);
    expect(invoice.pending).toBe(1);
    expect(invoice.decided).toBe(4); // total minus draft minus pending
  });

  it("computes failureRate against total and rejectionRate against decided, not total", () => {
    // 10 drafted, 5 still pending (undecided), 3 approved+completed, 2 rejected.
    const rows = [
      ...Array(3).fill({ actionType: "x", status: "completed" }),
      ...Array(2).fill({ actionType: "x", status: "rejected" }),
      ...Array(5).fill({ actionType: "x", status: "pending" }),
    ];
    const [x] = summarizeActionOutcomes(rows);
    expect(x!.total).toBe(10);
    expect(x!.decided).toBe(5); // 10 - 5 pending
    expect(x!.rejectionRate).toBeCloseTo(2 / 5); // NOT 2/10 — pending rows haven't been judged yet
    expect(x!.failureRate).toBe(0);
  });

  it("returns an empty array for no rows", () => {
    expect(summarizeActionOutcomes([])).toEqual([]);
  });

  it("sorts by total volume descending", () => {
    const rows = [
      { actionType: "rare", status: "completed" },
      { actionType: "common", status: "completed" },
      { actionType: "common", status: "completed" },
      { actionType: "common", status: "failed" },
    ];
    const stats = summarizeActionOutcomes(rows);
    expect(stats[0]!.actionType).toBe("common");
  });

  it("ignores transient statuses (approved/executing) safely — never crashes, never miscounts a terminal bucket", () => {
    const rows = [
      { actionType: "x", status: "approved" },
      { actionType: "x", status: "executing" },
      { actionType: "x", status: "completed" },
    ];
    const [x] = summarizeActionOutcomes(rows);
    expect(x!.total).toBe(3);
    expect(x!.completed).toBe(1);
  });
});

describe("buildTopConcerns", () => {
  const noCriticFindings: CriticFinding[] = [];

  it("stays silent below the minimum sample size, even at 100% failure", () => {
    const stats: ActionTypeStats[] = [
      { actionType: "rare_action", total: 2, draft: 0, pending: 0, completed: 0, failed: 2, rejected: 0, needsHumanReview: 0, blockedIntegration: 0, decided: 2, failureRate: 1, rejectionRate: 0 },
    ];
    expect(buildTopConcerns(stats, noCriticFindings, 90)).toEqual([]);
  });

  it("flags an action_type crossing the failure threshold with a real sample", () => {
    const stats: ActionTypeStats[] = [
      { actionType: "create_invoice", total: 10, draft: 0, pending: 0, completed: 5, failed: 5, rejected: 0, needsHumanReview: 0, blockedIntegration: 0, decided: 10, failureRate: 0.5, rejectionRate: 0 },
    ];
    const concerns = buildTopConcerns(stats, noCriticFindings, 90);
    expect(concerns).toHaveLength(1);
    expect(concerns[0]).toContain("create_invoice");
    expect(concerns[0]).toContain("50%");
  });

  it("flags an action_type crossing the rejection threshold with a real decided sample", () => {
    const stats: ActionTypeStats[] = [
      { actionType: "bulk_notify_existing_customers", total: 12, draft: 0, pending: 2, completed: 3, failed: 0, rejected: 7, needsHumanReview: 0, blockedIntegration: 0, decided: 10, failureRate: 0, rejectionRate: 0.7 },
    ];
    const concerns = buildTopConcerns(stats, noCriticFindings, 90);
    expect(concerns.some((c) => c.includes("bulk_notify_existing_customers") && c.includes("70%"))).toBe(true);
  });

  it("appends a critic summary line when there are flagged findings", () => {
    const findings: CriticFinding[] = [{ actionId: "a1", actionType: "create_invoice", reason: "Amount mismatch", createdAt: new Date().toISOString() }];
    const concerns = buildTopConcerns([], findings, 30);
    expect(concerns).toHaveLength(1);
    expect(concerns[0]).toContain("1 action");
  });

  it("returns an empty list when nothing crosses any threshold", () => {
    const stats: ActionTypeStats[] = [
      { actionType: "create_invoice", total: 20, draft: 0, pending: 0, completed: 19, failed: 1, rejected: 0, needsHumanReview: 0, blockedIntegration: 0, decided: 20, failureRate: 0.05, rejectionRate: 0 },
    ];
    expect(buildTopConcerns(stats, noCriticFindings, 90)).toEqual([]);
  });
});
