// A4.T3 unit coverage for the pure rule (packages/workflow-runtime/src/dlq-triage.ts).
// Integration coverage (real clustering across rows, real DB writes) lives in
// tests/integration/dlq-auto-triage.test.ts.

import { describe, it, expect } from "vitest";
import { suggestDisposition } from "@finnor/workflow-runtime";

function row(overrides: Partial<{ errorKind: string; attempts: number; replayable: boolean; envelope: unknown }> = {}) {
  return {
    id: "row-1",
    tenantId: "tenant-1",
    relatedOutboxEventId: null,
    relatedWorkflowStepId: null,
    envelope: overrides.envelope ?? { type: "test.event" },
    errorKind: overrides.errorKind ?? "retryable",
    attempts: overrides.attempts ?? 1,
    firstSeenAt: new Date(),
    lastError: "boom",
    replayable: overrides.replayable ?? true,
    status: "open",
    createdAt: new Date(),
    resolvedAt: null,
    suggestedDisposition: null,
    suggestionReason: null,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any;
}

describe("suggestDisposition (A4.T3 rule)", () => {
  it("discards a non-replayable row regardless of kind", () => {
    expect(suggestDisposition(row({ replayable: false, errorKind: "retryable" }), 0).disposition).toBe("discard");
  });

  it("discards validation/terminal/auth kinds even if flagged replayable", () => {
    for (const kind of ["validation", "terminal", "auth"]) {
      expect(suggestDisposition(row({ errorKind: kind, replayable: true }), 0).disposition).toBe("discard");
    }
  });

  it("escalates needs_human and config kinds", () => {
    expect(suggestDisposition(row({ errorKind: "needs_human" }), 0).disposition).toBe("escalate");
    expect(suggestDisposition(row({ errorKind: "config" }), 0).disposition).toBe("escalate");
  });

  it("escalates a retryable failure sitting in a cluster of 3+ other open siblings", () => {
    const result = suggestDisposition(row({ errorKind: "retryable", attempts: 1 }), 3);
    expect(result.disposition).toBe("escalate");
    expect(result.reason).toMatch(/open dead letters share this event type/);
  });

  it("escalates a retryable failure that's already been attempted 3+ times", () => {
    expect(suggestDisposition(row({ errorKind: "retryable", attempts: 3 }), 0).disposition).toBe("escalate");
  });

  it("replays an isolated, low-attempt retryable or provider_down failure", () => {
    expect(suggestDisposition(row({ errorKind: "retryable", attempts: 1 }), 0).disposition).toBe("replay");
    expect(suggestDisposition(row({ errorKind: "provider_down", attempts: 2 }), 1).disposition).toBe("replay");
  });
});
