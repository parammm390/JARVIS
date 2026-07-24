import { describe, expect, it } from "vitest";
import { plannerMemoryContext, plannerMemoryEnabled } from "@finnor/orchestration";
import type { MemorySnapshot } from "@finnor/shared-types";

const memory = (chunks: string[]): MemorySnapshot => ({
  shortTerm: null,
  longTerm: { canonicalSummary: { openLeads: 3, unpaidInvoicesUsd: 100 } },
  semantic: chunks.map((chunk, index) => ({ sourceDocId: `memory-${index}`, chunk, similarity: 1 })),
  episodic: [],
  patterns: null,
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
});
