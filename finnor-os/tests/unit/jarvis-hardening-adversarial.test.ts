import { describe, expect, it, vi } from "vitest";
import {
  clarificationContinuationAction,
  createFastReadOnlyRouter,
  createInstructionTraceAnswerEnvelope,
  interpretOperationalQuery,
  parseSpokenDecision,
  plannerContinuationInstruction,
  plannerShortTermContext,
  resolveCompetitorResearch,
  safeReadFallbackForInstruction,
  schedulingClarificationFallbackForInstruction,
  validateOperationalQueryRequest,
} from "@finnor/orchestration";
import type { MemorySnapshot, OperatingContext, OperationalQueryRequest, OperationalQueryResult } from "@finnor/shared-types";
import { IntegrationError, ToolRegistry } from "@finnor/tools";

// Exact prompts supplied for this regression track. Keep the punctuation and the
// en dash intact: routing and follow-up behavior are part of the contract.
const RESEARCH_PROMPT = "Find competitors in Florida around my age, doing better/worse than us, in the $5M–$15M bracket.";
const OPERATIONAL_PROMPT = "Tell me all details of our work/appointments for tomorrow.";

function operatingContext(
  profile: Partial<OperatingContext["tenant"]["profile"]> = {},
  userFacts: Record<string, unknown> = {},
): OperatingContext {
  return {
    version: 1,
    assembledAt: "2026-08-17T12:00:00.000Z",
    truthPrecedence: ["CANONICAL", "WORK", "PROFILE", "SESSION", "MEMORY", "WEB"],
    tenant: {
      id: "tenant-a",
      companyName: "Aqua Example",
      timezone: "America/New_York",
      profile: {
        industry: "water treatment",
        niche: "residential water filtration",
        description: null,
        primaryGeographies: ["Florida"],
        foundedYear: null,
        idealCustomerProfile: { segment: "private-well homeowners" },
        businessFacts: {},
        comparisonDefaults: {},
        updatedAt: "2026-08-17T00:00:00.000Z",
        ...profile,
      },
    },
    employee: {
      userId: "user-a",
      employeeId: "user-a",
      displayName: "Owner",
      role: "owner",
      authorityRoles: ["owner"],
      profile: { title: "Founder", profileFacts: userFacts, updatedAt: "2026-08-17T00:00:00.000Z" },
    },
    activeWork: { id: "work-a", status: "understanding", sessionId: "session-a", initialInstruction: RESEARCH_PROMPT, activeContext: {}, updatedAt: "2026-08-17T12:00:00.000Z" },
    referencedEntities: [],
    canonicalSummaries: [],
    memory: { conversation: null, semantic: [], episodic: [] },
    integrationHealth: {},
    authority: { principal: "user-a", employeeId: "user-a", revision: 1, roles: ["owner"] },
    sources: [],
    health: { status: "complete", missing: [], errors: [] },
  };
}

const MEMORY: MemorySnapshot = {
  shortTerm: {
    turns: [
      {
        instruction: RESEARCH_PROMPT,
        answer: {
          intent: "search_web",
          title: "Competitor research",
          prose: "An old answer body that must not be copied into a new turn.",
          evidence: [{ source: "exa", ref: "research-run:old", timestamp: "2026-08-16T00:00:00.000Z" }],
        },
        actions: [{ actionType: "send_follow_up", payload: { householdId: "household-1" }, status: "pending", awaitingApproval: true }],
        at: "2026-08-16T00:00:00.000Z",
      },
      {
        instruction: "Schedule a water test for the customer.",
        actions: [{ actionType: "clarification_request", payload: { missingFields: ["scheduledAt", "serviceType"] }, status: "pending" }],
        at: "2026-08-16T00:01:00.000Z",
      },
    ],
  },
  longTerm: {
    household: { id: "household-1", contactInfo: { name: "Avery", phone: "+15550191919" } },
  },
  semantic: [{ chunk: "A canonical fact", sourceDocId: "doc-1", similarity: 0.99 }],
  episodic: [],
  patterns: null,
};

function emptyScheduleResult(asOf = "2026-08-17T00:00:00.000Z"): OperationalQueryResult {
  return {
    kind: "operational_query_result",
    status: "ok",
    data: { rows: [], count: 0 },
    version: 1,
    intent: "schedule_range",
    source: { kind: "canonical_postgres", tables: ["appointments", "service_visits", "work_orders"] },
    asOf,
    count: 0,
    truncated: false,
    page: { limit: 50, returned: 0, totalCount: 0, totalCountExact: true, hasMore: false, nextCursor: null, truncated: false },
    meta: {
      version: 1,
      source: { kind: "canonical_postgres", tables: ["appointments", "service_visits", "work_orders"] },
      asOf,
    },
    range: { start: "2026-08-17T07:00:00.000Z", end: "2026-08-18T07:00:00.000Z" },
    timeZone: "America/Los_Angeles",
    localDateRange: { startDate: "tomorrow" },
    rows: [],
  };
}

describe("JARVIS hardening adversarial unit contracts", () => {
  it("keeps the exact operational prompt on the deterministic fast-read path", () => {
    expect(interpretOperationalQuery(OPERATIONAL_PROMPT)).toMatchObject({
      route: "fast_read",
      confidence: "high",
      request: { intent: "schedule_range", localDateRange: { startDate: "tomorrow" } },
    });
  });

  it("keeps the exact competitor prompt out of internal-only reads and preserves it for research", () => {
    expect(interpretOperationalQuery(RESEARCH_PROMPT)).toMatchObject({ route: "planner", reason: "external_or_ambiguous" });
    // Without authenticated OperatingContext, the generic provider-failure
    // fallback must not turn this ambiguous request into either an internal
    // business answer or an unbound web search. The contextual resolver below
    // owns the single clarification / resolved WEB route.
    expect(safeReadFallbackForInstruction(RESEARCH_PROMPT, ["answer_business_question", "search_web"])).toBeNull();
  });

  it("asks one precise clarification for unresolved age/comparison ambiguity before external research", () => {
    const result = resolveCompetitorResearch(RESEARCH_PROMPT, operatingContext());
    expect(result.route).toBe("clarification");
    if (result.route !== "clarification") throw new Error("Expected one contextual clarification");
    expect(result.action).toMatchObject({
      action_type: "clarification_request",
      payload: {
        missingFields: ["authenticated user age", "scale metric", "comparison metric", "company comparison baseline"],
        context: expect.stringContaining(RESEARCH_PROMPT),
      },
    });
    expect(result.action.payload.question).toMatch(/age.*revenue.*better\/worse/i);
  });

  it("routes resolved competitor criteria to web research exactly once", () => {
    const result = resolveCompetitorResearch(RESEARCH_PROMPT, operatingContext({
      comparisonDefaults: { scaleMetric: "annual revenue", performanceMetric: "lead conversion rate" },
      businessFacts: { leadConversionRate: "31%" },
    }, { age: 39 }));
    expect(result.route).toBe("resolved");
    if (result.route !== "resolved") throw new Error("Expected contextual web research");
    expect(result.action).toMatchObject({
      action_type: "search_web",
      payload: {
        researchContext: {
          companyName: "Aqua Example",
          comparison: { founderAge: 39, scaleMetric: "annual revenue", performanceMetric: "lead conversion rate", companyBaseline: "31%" },
          sourceKinds: ["PROFILE", "WEB"],
        },
      },
    });
    expect(result.action.payload.query).toMatch(/actual residential water filtration companies in Florida/i);
    expect(result.action.payload.query).toMatch(/exclude generic market statistics/i);
  });

  it("rejects tenant identity smuggling while accepting a typed tenant-free tomorrow request", () => {
    const valid = validateOperationalQueryRequest({ intent: "schedule_range", localDateRange: { startDate: "tomorrow" } });
    expect(valid).toMatchObject({ success: true, request: { intent: "schedule_range" } });

    const forged = validateOperationalQueryRequest({
      intent: "schedule_range",
      localDateRange: { startDate: "tomorrow" },
      tenantId: "foreign-tenant",
    });
    expect(forged).toMatchObject({ success: false });
    expect((forged as { error: string }).error).toMatch(/tenantId|unknown|identity/i);
  });

  it("labels a canonical zero result and refuses to turn an unavailable read into zero", async () => {
    const calls: Array<{ tenantId: string; request: OperationalQueryRequest }> = [];
    const router = createFastReadOnlyRouter({
      now: () => new Date("2026-08-17T00:00:00.000Z"),
      executeOperationalQuery: (async (tenantId: string, request: OperationalQueryRequest) => {
        calls.push({ tenantId, request });
        return emptyScheduleResult();
      }) as never,
    });
    const answer = await router.route(OPERATIONAL_PROMPT, { tenantId: "tenant-a" });

    expect(calls).toEqual([{ tenantId: "tenant-a", request: { intent: "schedule_range", localDateRange: { startDate: "tomorrow" } } }]);
    expect(answer?.query?.result).toMatchObject({ status: "ok", count: 0, page: { returned: 0, totalCount: 0, totalCountExact: true } });
    expect(answer?.evidence[0]).toMatchObject({ source: "operational_query:schedule_range" });
    // This is intentionally exact: a zero canonical count must say zero appointments,
    // not the weaker "scheduled items" wording that can hide an unverifiable read.
    expect(answer?.spokenSummary).toMatch(/0 appointments found/i);

    const unavailable = createFastReadOnlyRouter({
      executeOperationalQuery: async () => { throw new Error("canonical read unavailable"); },
    });
    await expect(unavailable.route(OPERATIONAL_PROMPT, { tenantId: "tenant-a" })).rejects.toThrow("canonical read unavailable");
  });

  it("renders the resolved tenant-local date rather than the UTC date for positive-offset timezones", async () => {
    const indiaResult = {
      ...emptyScheduleResult("2026-08-17T17:30:00.000Z"),
      timeZone: "Asia/Kolkata",
      range: { start: "2026-08-17T18:30:00.000Z", end: "2026-08-18T18:30:00.000Z" },
    } as OperationalQueryResult;
    const router = createFastReadOnlyRouter({ executeOperationalQuery: (async () => indiaResult) as never });
    const answer = await router.route(OPERATIONAL_PROMPT, { tenantId: "tenant-a" });
    expect(answer?.spokenSummary).toMatch(/0 appointments found for 2026-08-18/i);
    expect(answer?.display.facts).toEqual(expect.arrayContaining([{ label: "Date", value: "2026-08-18" }]));
  });

  it("retains follow-up action/evidence references but isolates a self-contained New Work prompt", () => {
    const followUp = plannerShortTermContext("Do the same for us", MEMORY.shortTerm);
    expect(followUp).toMatchObject({ turns: expect.arrayContaining([
      expect.objectContaining({ actions: [expect.objectContaining({ actionType: "send_follow_up", awaitingApproval: true })] }),
    ]) });
    expect(JSON.stringify(followUp)).not.toContain("old answer body");
    expect(JSON.stringify(followUp)).toContain("research-run:old");

    expect(plannerShortTermContext(OPERATIONAL_PROMPT, MEMORY.shortTerm)).toBeNull();
    expect(plannerContinuationInstruction("scheduledAt: 2026-08-20T14:00:00.000Z; serviceType: water test", MEMORY.shortTerm)).toContain("Schedule a water test for the customer.");
  });

  it("continues only with canonical household identity and asks precisely when that identity is missing", () => {
    const complete = clarificationContinuationAction(
      "scheduledAt: 2026-08-20T14:00:00.000Z; serviceType: water test",
      "Schedule a water test for the customer.",
      MEMORY,
      ["start_water_test_workflow", "clarification_request"],
    );
    expect(complete).toMatchObject({
      action_type: "start_water_test_workflow",
      payload: { householdId: "household-1", phoneNumber: "+15550191919", scheduledAt: "2026-08-20T14:00:00.000Z" },
    });

    const missing = clarificationContinuationAction(
      "scheduledAt: 2026-08-20T14:00:00.000Z; serviceType: water test",
      "Schedule a water test for the customer.",
      { ...MEMORY, longTerm: {} },
      ["start_water_test_workflow", "clarification_request"],
    );
    expect(missing).toMatchObject({
      action_type: "clarification_request",
      payload: { missingFields: ["householdId"], question: "Which household should I use for this water-test appointment?" },
    });
  });

  it("uses the scheduling fallback as one write-free clarification", () => {
    const result = schedulingClarificationFallbackForInstruction("What appointments are already booked?", ["clarification_request"]);
    expect(result).toBeNull();

    const clarified = schedulingClarificationFallbackForInstruction("Schedule a service appointment for the customer", ["clarification_request"]);
    expect(clarified).toMatchObject({
      action_type: "clarification_request",
      payload: {
        question: "What date and time should I use, and what service should this appointment cover?",
        missingFields: ["scheduledAt", "serviceType"],
      },
    });
  });

  it("keeps receipt evidence source labels in the browser-safe trace envelope", () => {
    const trace = createInstructionTraceAnswerEnvelope("instruction-1", {
      kind: "answer",
      intent: "schedule_range",
      readOnly: true,
      spokenSummary: "There are no appointments.",
      display: { title: "Schedule range", facts: [{ label: "Appointments", value: "0" }] },
      evidence: [{ source: "canonical_postgres", ref: "appointments:tenant-a:tomorrow", timestamp: "2026-08-17T00:00:00.000Z" }],
      asOf: "2026-08-17T00:00:00.000Z",
      freshness: { status: "fresh", observedAt: "2026-08-17T00:00:00.000Z" },
    });
    expect(trace.result.evidence).toEqual([{ source: "canonical_postgres", ref: "appointments:tenant-a:tomorrow", timestamp: "2026-08-17T00:00:00.000Z" }]);
  });

  it("parses voice approvals fail-closed and preserves the last explicit decision", () => {
    expect(parseSpokenDecision("yes, go ahead")).toBe("approve");
    expect(parseSpokenDecision("yes—wait, no, hold off")).toBe("reject");
    expect(parseSpokenDecision("Maybe later")).toBe("unclear");
  });

  it("retries a provider failure and recovers on the next attempt at the explicit tool seam", async () => {
    const provider = vi.fn()
      .mockRejectedValueOnce(new IntegrationError("crm", "temporary outage", true))
      .mockResolvedValueOnce({ providerRef: "crm-recovered-1" });
    const registry = new ToolRegistry();
    registry.register({
      name: "crm_probe",
      description: "Provider recovery contract probe",
      integration: "crm",
      inputSchema: (await import("zod")).z.object({}),
      retryPolicy: { attempts: 3, baseDelayMs: 1, timeoutMs: 1_000 },
      run: provider,
    });

    const result = await registry.call("crm_probe", {});
    expect(result).toMatchObject({ ok: true, output: { providerRef: "crm-recovered-1" } });
    expect(provider).toHaveBeenCalledTimes(2);
  });
});
