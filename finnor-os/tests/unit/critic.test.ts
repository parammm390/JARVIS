// Critic — unconfigured state must be explicit and never attempt a real network call
// (same contract every other adapter holds), and the JSON-parsing contract must
// degrade to an honest "no verdict" rather than guessing, exactly like the planner
// treats its own malformed LLM output.

import { describe, it, expect, beforeEach } from "vitest";
import type { LLMProvider } from "@finnor/orchestration";

function fakeProvider(response: string): LLMProvider {
  return { name: "fake", complete: async () => response };
}

describe("critic — unconfigured state", () => {
  beforeEach(() => {
    delete process.env.AWS_BEDROCK_API_KEY;
  });

  it("criticConfigured reports false when no Bedrock key is set", async () => {
    const { criticConfigured } = await import("@finnor/orchestration");
    expect(criticConfigured()).toBe(false);
  });

  it("criticConfigured reports true once AWS_BEDROCK_API_KEY is set", async () => {
    process.env.AWS_BEDROCK_API_KEY = "test-key";
    const { criticConfigured } = await import("@finnor/orchestration");
    expect(criticConfigured()).toBe(true);
  });
});

describe("critic — reviewAction verdict parsing", () => {
  const input = {
    instruction: "Create a $50 invoice for the Petersons",
    actionType: "create_invoice",
    payload: { amountUsd: 50, customerName: "the Petersons" },
    summary: "Create a $50 invoice for the Petersons.",
    reasoning: "Caller explicitly named the Petersons and the amount.",
  };

  it("returns the parsed verdict when the model responds with clean JSON", async () => {
    const { reviewAction } = await import("@finnor/orchestration");
    const verdict = await reviewAction(input, fakeProvider('{"flagged": false, "reason": "Amount and customer match the instruction."}'));
    expect(verdict).toEqual({ flagged: false, reason: "Amount and customer match the instruction." });
  });

  it("surfaces a flagged verdict with its reason", async () => {
    const { reviewAction } = await import("@finnor/orchestration");
    const verdict = await reviewAction(
      { ...input, payload: { amountUsd: 5000, customerName: "the Petersons" } },
      fakeProvider('{"flagged": true, "reason": "Instruction said $50, drafted action says $5000."}'),
    );
    expect(verdict.flagged).toBe(true);
    expect(verdict.reason).toContain("$5000");
  });

  it("degrades to an honest unflagged default when the model response is not valid JSON", async () => {
    const { reviewAction } = await import("@finnor/orchestration");
    const verdict = await reviewAction(input, fakeProvider("not json at all"));
    expect(verdict.flagged).toBe(false);
    expect(verdict.reason).toMatch(/could not be parsed/i);
  });

  it("degrades to an honest unflagged default when the JSON doesn't match the expected shape", async () => {
    const { reviewAction } = await import("@finnor/orchestration");
    const verdict = await reviewAction(input, fakeProvider('{"unexpected": "shape"}'));
    expect(verdict.flagged).toBe(false);
    expect(verdict.reason).toMatch(/could not be parsed/i);
  });

  it("wraps and rethrows a provider failure rather than swallowing it", async () => {
    const { reviewAction } = await import("@finnor/orchestration");
    const failing: LLMProvider = {
      name: "failing",
      complete: async () => {
        throw new Error("network down");
      },
    };
    await expect(reviewAction(input, failing)).rejects.toThrow(/Critic LLM call failed.*network down/);
  });
});
