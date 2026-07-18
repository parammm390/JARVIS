// Phase 13 Part A: graphActionTypeAllowlist() must distinguish "env var unset" (use
// the code default) from "env var explicitly set to empty string" (explicit empty
// allowlist) — collapsing those two states would silently re-route every vertical
// workflow action type onto the graph engine for any deployment that merely forgot to
// set the var, defeating the kill switch's purpose.

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { graphActionTypeAllowlist, DEFAULT_GRAPH_ACTION_TYPES } from "@finnor/orchestration";

describe("graphActionTypeAllowlist", () => {
  const ENV_KEY = "ORCHESTRATION_ENGINE_GRAPH_ACTION_TYPES";
  let original: string | undefined;

  beforeEach(() => {
    original = process.env[ENV_KEY];
  });
  afterEach(() => {
    if (original === undefined) delete process.env[ENV_KEY];
    else process.env[ENV_KEY] = original;
  });

  it("defaults to DEFAULT_GRAPH_ACTION_TYPES when the env var is unset", () => {
    delete process.env[ENV_KEY];
    expect(graphActionTypeAllowlist()).toEqual(new Set(DEFAULT_GRAPH_ACTION_TYPES));
    expect(DEFAULT_GRAPH_ACTION_TYPES).toEqual([
      "schedule_water_test",
      "start_water_test_workflow",
      "request_proposal_signature",
      "start_installation_workflow",
      "start_invoice_to_cash_workflow",
    ]);
  });

  it("an explicit empty string means an explicit empty allowlist — NOT the default", () => {
    process.env[ENV_KEY] = "";
    expect(graphActionTypeAllowlist()).toEqual(new Set());
  });

  it("a non-empty env var still overrides the default entirely (kill switch)", () => {
    process.env[ENV_KEY] = "schedule_water_test, request_proposal_signature";
    expect(graphActionTypeAllowlist()).toEqual(new Set(["schedule_water_test", "request_proposal_signature"]));
  });
});
