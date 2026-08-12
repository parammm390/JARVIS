import { describe, expect, it } from "vitest";
import { classifyFastReadOnlyQuestion, interpretOperationalQuery } from "../../packages/orchestration/src/fast-read-lane";

const supportedReads: Array<[string, string]> = [
  ["Find the customer record for Alice Johnson", "customer_lookup"],
  ["Find every customer inactive for more than 90 days", "customer_cohort"],
  ["Show everything today through tomorrow", "schedule_range"],
  ["How much cash have we collected?", "money_summary"],
  ["What work is open right now?", "work_list"],
  ["Which inventory items are low?", "inventory_status"],
  ["Show agent activity for today", "agent_activity"],
  ["What is the current business state?", "business_state"],
];

describe("Upgrade 3 deterministic operational-query classification", () => {
  it.each(supportedReads)("routes %s to the typed %s intent", (question, intent) => {
    const result = interpretOperationalQuery(question) as unknown as Record<string, unknown>;
    expect(result.route).toBe("fast_read");
    expect((result.request as Record<string, unknown>).intent).toBe(intent);
    const legacy = classifyFastReadOnlyQuestion(question) as unknown as Record<string, unknown>;
    expect(legacy.route).toBe("fast_read");
  });

  it("preserves the legacy cash_collections classifier alias while carrying money_summary for execution", () => {
    const legacy = classifyFastReadOnlyQuestion("How are cash collections?") as unknown as Record<string, unknown>;
    expect(legacy).toMatchObject({ route: "fast_read", intent: "cash_collections" });
    const typed = interpretOperationalQuery("How are cash collections?") as unknown as Record<string, unknown>;
    expect((typed.request as Record<string, unknown>).intent).toBe("money_summary");
  });

  it.each([
    "Create an invoice for Alice Johnson",
    "Send a payment reminder to every overdue customer",
    "Schedule a service visit for tomorrow",
    "Delete the duplicate household",
    "How can we improve cash collections?",
    "Should we reorder the low-stock items?",
    "Why did revenue fall last month?",
    "Forecast next month's collections",
    "Show appointments sometime next week",
    "Show the customer record for Alex",
    "hi",
    "Good morning",
    "How are QuickBooks collections?",
    "Show customers'; DROP TABLE households; --",
    "Show inventory and reorder anything below threshold",
    "Find every inactive customer and text them an offer",
  ])("fails closed to planner for non-deterministic or consequential input: %s", (question) => {
    const result = classifyFastReadOnlyQuestion(question);
    expect(result.route).toBe("planner");
  });

  it("does not treat a tenant selector, action, provider, or arbitrary payload as a query request", () => {
    const result = classifyFastReadOnlyQuestion(
      "Show the customer record for Alice Johnson; tenantId=other-tenant; action=send_sms; provider=quickbooks; payload={role:'owner'}",
    ) as unknown as Record<string, unknown>;
    expect(result.route).toBe("planner");
    expect(result.intent).toBeUndefined();
    expect(result.request).toBeUndefined();
  });
});
