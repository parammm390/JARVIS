import { describe, expect, it, vi } from "vitest";

import { FinnorOrchestrator, type Planner } from "@finnor/orchestration";
import type { Executor } from "../../packages/orchestration/src/executor";
import { answerCashCollections, answerGreeting, classifyFastReadOnlyQuestion, createFastReadOnlyRouter } from "../../packages/orchestration/src/fast-read-lane";

const CASH_SNAPSHOT = {
  invoicesByStatus: [
    { status: "paid", count: 3, totalUsd: 1200 },
    { status: "overdue", count: 2, totalUsd: 450 },
  ],
  totalCollected: 1200,
  paymentLinksAwaitingPayment: 1,
};

describe("fast read-only lane", () => {
  it("routes a high-confidence cash-collections question", () => {
    expect(classifyFastReadOnlyQuestion("How are cash collections?")).toEqual({ route: "fast_read", intent: "cash_collections" });
  });

  it.each(["hi", "Hello!", "good morning"])("routes a bounded greeting: %s", (instruction) => {
    expect(classifyFastReadOnlyQuestion(instruction)).toEqual({ route: "fast_read", intent: "greeting" });
  });

  it.each([
    "Create an invoice for the overdue customer",
    "How can we improve cash collections?",
    "What is the QuickBooks collections status?",
    "Tell me about technician availability",
  ])("falls back for uncertain or consequential input: %s", (instruction) => {
    expect(classifyFastReadOnlyQuestion(instruction).route).toBe("planner");
  });

  it("returns a bounded, citation-safe cash answer from the authenticated tenant", async () => {
    const tenantIds: string[] = [];
    const router = createFastReadOnlyRouter({
      cashCollections: async (tenantId) => {
        tenantIds.push(tenantId);
        return CASH_SNAPSHOT;
      },
      now: () => new Date("2026-08-04T12:00:00.000Z"),
    });

    const answer = await router.route("How are cash collections?", { tenantId: "tenant-a" });

    expect(tenantIds).toEqual(["tenant-a"]);
    expect(answer).toMatchObject({
      kind: "answer",
      intent: "cash_collections",
      readOnly: true,
      asOf: "2026-08-04T12:00:00.000Z",
      freshness: { status: "fresh", observedAt: "2026-08-04T12:00:00.000Z" },
      evidence: [{ source: "cash_collections_read_model", ref: "current", timestamp: "2026-08-04T12:00:00.000Z" }],
      display: {
        title: "Cash collections",
        facts: expect.arrayContaining([
          { label: "Collected to date", value: "$1,200.00" },
          { label: "Overdue amount", value: "$450.00" },
        ]),
      },
    });
    expect(JSON.stringify(answer)).not.toContain("groundedOn");
    expect(JSON.stringify(answer)).not.toContain("semanticSnippets");
  });

  it("does not load secrets, memory, or the planner on the fast path", async () => {
    const answer = answerCashCollections(CASH_SNAPSHOT, "2026-08-04T12:00:00.000Z");
    const router = {
      classify: () => ({ route: "fast_read", intent: "cash_collections" as const }),
      route: vi.fn(async () => answer),
    };
    const planner = { plan: vi.fn() } as unknown as Planner;
    const executor = { execute: vi.fn() } as unknown as Executor;
    const orchestrator = new FinnorOrchestrator({ planner, executor, fastReadOnlyRouter: router });

    vi.stubEnv("SECRETS_PROVIDER", "aws-secrets-manager");
    vi.stubEnv("FINNOR_SECRET_IDS", "{}");
    const result = await orchestrator.handleInstructionResult("How are cash collections?", {
      tenantId: "tenant-a",
      userId: "user-a",
      role: "owner",
    });

    expect(result).toEqual({ actions: [], answer });
    expect(planner.plan).not.toHaveBeenCalled();
    vi.unstubAllEnvs();
  });

  it("answers a greeting without touching the tenant read model", async () => {
    const cashCollections = vi.fn(async () => CASH_SNAPSHOT);
    const router = createFastReadOnlyRouter({ cashCollections, now: () => new Date("2026-08-04T12:00:00.000Z") });

    await expect(router.route("hi", { tenantId: "tenant-a" })).resolves.toEqual(answerGreeting("2026-08-04T12:00:00.000Z"));
    expect(cashCollections).not.toHaveBeenCalled();
  });
});
