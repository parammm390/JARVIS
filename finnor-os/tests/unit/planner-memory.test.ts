import { describe, expect, it } from "vitest";
import { plannerMemoryContext, plannerMemoryEnabled, plannerShortTermContext } from "@finnor/orchestration";
import type { MemorySnapshot } from "@finnor/shared-types";

const memory = (chunks: string[]): MemorySnapshot => ({
  shortTerm: null,
  longTerm: { canonicalSummary: { openLeads: 3, unpaidInvoicesUsd: 100 } },
  semantic: chunks.map((chunk, index) => ({ sourceDocId: `memory-${index}`, chunk, similarity: 1 })),
  episodic: [],
  patterns: null,
});

describe("planner short-term relevance boundary", () => {
  const researchThenAction = {
    turns: [
      {
        instruction: "Research 2026 water treatment dealer trends",
        answer: {
          intent: "conversation",
          spokenSummary: "Focus on water conservation and technology advancement. This prose must never leak.",
          evidence: [{ source: "exa", ref: "https://example.com/trends" }],
        },
        actions: [],
        at: "2026-08-10T12:00:00.000Z",
      },
      {
        instruction: "Draft a call for inactive customers",
        actions: [{ actionType: "bulk_notify_existing_customers", payload: { minDaysInactive: 90 }, status: "success", awaitingApproval: true }],
        at: "2026-08-10T12:05:00.000Z",
      },
    ],
  };

  it("omits all prior turns for a self-contained scheduling command", () => {
    expect(plannerShortTermContext("Could you schedule a new appointment for Mario?", researchThenAction)).toBeNull();
  });

  it("keeps identifiers for a real follow-up but strips prior answer prose", () => {
    const context = plannerShortTermContext("Do the same for Mario", researchThenAction);
    expect(context).toMatchObject({ turns: expect.any(Array) });
    expect(JSON.stringify(context)).toContain("bulk_notify_existing_customers");
    expect(JSON.stringify(context)).not.toContain("water conservation");
    expect(JSON.stringify(context)).not.toContain("spokenSummary");
  });

  it("retains sanitized context for a clarification fragment", () => {
    const context = plannerShortTermContext("Tuesday at 2pm", researchThenAction);
    expect(context).not.toBeNull();
    expect(JSON.stringify(context)).not.toContain("technology advancement");
  });
});

const snapshot = (overrides: Partial<MemorySnapshot>): MemorySnapshot => ({
  shortTerm: null,
  longTerm: null,
  semantic: [],
  episodic: [],
  patterns: null,
  ...overrides,
});

describe("planner memory feature flag (B2.T8)", () => {
  it("is disabled unless PLANNER_MEMORY is exactly 1", () => {
    const env = (value?: string) => ({ NODE_ENV: "test", ...(value === undefined ? {} : { PLANNER_MEMORY: value }) }) as NodeJS.ProcessEnv;
    expect(plannerMemoryEnabled(env())).toBe(false);
    expect(plannerMemoryEnabled(env("true"))).toBe(false);
    expect(plannerMemoryEnabled(env("1"))).toBe(true);
    expect(plannerMemoryContext(memory(["secret"]), false)).toEqual({});
  });

  it("includes canonical summary, top five rows, and no more than 1,500 words", () => {
    const context = plannerMemoryContext(memory(Array.from({ length: 7 }, (_, i) => `${i} ${"word ".repeat(400)}`)), true) as { canonicalSummary: unknown; semantic: string[] };
    expect(context.canonicalSummary).toEqual({ openLeads: 3, unpaidInvoicesUsd: 100 });
    expect(context.semantic).toHaveLength(4);
    expect(context.semantic.join(" ").trim().split(/\s+/)).toHaveLength(1500);
  });

  it("prioritizes exact named-household dates/history ahead of semantic snippets", () => {
    const context = plannerMemoryContext(
      snapshot({
        longTerm: {
          household: { id: "hh-daniel", contactInfo: { name: "Daniel Beckham" }, createdAt: "2023-04-01T12:00:00.000Z" },
          equipment: [{ type: "water softener", model: "WS-900", installDate: "2023-04-12T15:00:00.000Z" }],
          recentVisits: [{ type: "annual maintenance", completedAt: "2025-12-10T17:30:00.000Z", notes: "Customer reported excellent water quality." }],
          agreements: [],
          recentCommunications: [{ timestamp: "2025-12-10T17:30:00.000Z", content: "Asked about a filter check." }],
          canonicalSummary: { openLeads: 0 },
        },
        semantic: [{ chunk: "semantic fallback", sourceDocId: null, similarity: 0.9 }],
      }),
      true,
    );
    expect(String(context.householdHistory)).toContain("Daniel Beckham");
    expect(String(context.householdHistory)).toContain("2023-04-12T15:00:00.000Z");
    expect(String(context.householdHistory)).toContain("2025-12-10T17:30:00.000Z");
  });
});
