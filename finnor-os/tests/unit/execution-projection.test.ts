import { describe, expect, it } from "vitest";
import { EXECUTION_COMPENSATABLE_STEP_TYPES } from "@finnor/shared-types";
import { deriveExecutionNodeStatus, sanitizeExecutionValue } from "@finnor/read-models";
import { COMPENSATABLE_STEP_TYPES } from "@finnor/tools";

describe("ExecutionProjection truth boundary", () => {
  it("redacts secret-shaped values for every role and direct customer content for technicians", () => {
    const source = {
      application: "supplier_portal",
      apiKey: "never-render",
      nested: { authorization: "Bearer abcdefghijklmnopqrstuvwxyz", result: "safe", email: "customer@example.com" },
      providerSessionRef: "credential-handle",
    };
    expect(sanitizeExecutionValue(source, "owner")).toEqual({
      application: "supplier_portal",
      nested: { result: "safe", email: "customer@example.com" },
    });
    expect(sanitizeExecutionValue(source, "technician")).toEqual({
      application: "supplier_portal",
      nested: { result: "safe", email: "[REDACTED]" },
    });
  });

  it("bounds nested arrays, object width, string length, and recursion depth", () => {
    const projected = sanitizeExecutionValue({ values: Array.from({ length: 70 }, (_, index) => index), long: "x".repeat(2_100), deep: { a: { b: { c: { d: { e: { f: { g: { h: true } } } } } } } } }, "owner") as Record<string, unknown>;
    expect(projected.values).toHaveLength(50);
    expect(String(projected.long)).toHaveLength(2_001);
    expect(JSON.stringify(projected.deep)).toContain("[TRUNCATED]");
  });

  it.each([
    ["draft", [], "not_started", undefined, "runnable"],
    ["draft", ["executing"], "not_started", undefined, "waiting_dependency"],
    ["draft", ["failed"], "not_started", undefined, "blocked"],
    ["pending", [], "not_started", undefined, "awaiting_approval"],
    ["approved", [], "not_started", undefined, "approved"],
    ["executing", [], "awaiting_observation", undefined, "executing"],
    ["completed", [], "awaiting_observation", undefined, "verifying"],
    ["completed", [], "verified", undefined, "succeeded"],
    ["failed", [], "failed", undefined, "failed"],
    ["rejected", [], "failed", undefined, "rejected"],
    ["needs_human_review", [], "failed", undefined, "blocked"],
    ["completed", [], "verified", "denied", "denied"],
    ["completed", [], "verified", "authority_changed", "denied"],
  ] as const)("derives %s from persisted source facts as %s", (sourceStatus, dependencyStatuses, verification, authorityState, expected) => {
    expect(deriveExecutionNodeStatus({ sourceStatus, dependencyStatuses: [...dependencyStatuses], verification, authorityState })).toBe(expected);
  });

  it("treats an active persisted computer run as executing even when the action row lags", () => {
    expect(deriveExecutionNodeStatus({ sourceStatus: "completed", dependencyStatuses: [], verification: "verified", computerStatus: "running" })).toBe("executing");
  });

  it("keeps the projection and executable resolver on the same two supported compensations", () => {
    expect(EXECUTION_COMPENSATABLE_STEP_TYPES).toEqual(["hold_appointment", "reserve_stock"]);
    expect(COMPENSATABLE_STEP_TYPES).toEqual(EXECUTION_COMPENSATABLE_STEP_TYPES);
  });
});
