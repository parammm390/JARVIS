import { describe, expect, it } from "vitest";
import { enforceExternalResearchRoute, enforceSchedulingMutationRoute, safeReadFallbackForInstruction } from "../../packages/orchestration/src/read-routing";

const actions = ["answer_business_question", "search_web"];

describe("planner safe-read routing", () => {
  it("routes benchmark and citation requests through web research even when the model chose the generic answer action", () => {
    const instruction = "Using current source-backed Google Ads benchmark pages, compare CTR and CPC and cite the sources.";
    const routed = enforceExternalResearchRoute(
      instruction,
      [{ action_type: "answer_business_question", payload: { question: instruction } }],
      actions,
    );
    expect(routed).toEqual([{
      action_type: "search_web",
      payload: { query: instruction },
      reasoning: "External/current/source-backed question routed through the registered web research stack.",
    }]);
  });

  it("uses the same web route when malformed model output needs a safe read fallback", () => {
    expect(safeReadFallbackForInstruction("Cite current Google Ads benchmark sources", actions)).toMatchObject({
      action_type: "search_web",
    });
  });

  it("does not rewrite an external mutation or a narrower domain action", () => {
    expect(enforceExternalResearchRoute(
      "Research the market and launch the campaign",
      [{ action_type: "answer_business_question", payload: { question: "x" } }],
      actions,
    )[0]?.action_type).toBe("answer_business_question");
    expect(enforceExternalResearchRoute(
      "Show current ad performance",
      [{ action_type: "summarize_ad_performance", payload: {} }],
      [...actions, "summarize_ad_performance"],
    )[0]?.action_type).toBe("summarize_ad_performance");
  });
});

describe("scheduling mutation routing", () => {
  const actionTypes = ["answer_business_question", "search_web", "clarification_request", "schedule_water_test"];

  it("replaces a contaminated informational answer with a scheduling clarification", () => {
    const routed = enforceSchedulingMutationRoute(
      "Could you schedule a new appointment for Mario?",
      [{ action_type: "answer_business_question", payload: { question: "old research" } }],
      actionTypes,
    );
    expect(routed).toEqual([expect.objectContaining({
      action_type: "clarification_request",
      payload: expect.objectContaining({ missingFields: ["scheduledAt", "serviceType"] }),
    })]);
  });

  it("preserves a real scheduling action or an existing clarification", () => {
    const schedule = [{ action_type: "schedule_water_test", payload: { scheduledAt: "2026-08-11T14:00:00Z" } }];
    expect(enforceSchedulingMutationRoute("Book the appointment for tomorrow", schedule, actionTypes)).toEqual(schedule);
    const clarification = [{ action_type: "clarification_request", payload: { question: "What time?", missingFields: ["scheduledAt"] } }];
    expect(enforceSchedulingMutationRoute("Schedule a service visit", clarification, actionTypes)).toEqual(clarification);
  });

  it("does not rewrite a read-only schedule question", () => {
    const read = [{ action_type: "answer_business_question", payload: { question: "Show tomorrow's appointments" } }];
    expect(enforceSchedulingMutationRoute("Show tomorrow's appointments", read, actionTypes)).toEqual(read);
  });
});
