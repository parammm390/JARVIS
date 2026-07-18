// Phase 2 (§2.2) versioned event envelope — pure functions, no DB.

import { describe, it, expect } from "vitest";
import { makeEnvelope, checkEnvelopeVersion, CURRENT_ENVELOPE_MAJOR } from "@finnor/workflow-runtime";

describe("event envelope (§2.2)", () => {
  it("makeEnvelope stamps the current major version and tenant/type/payload", () => {
    const env = makeEnvelope({ type: "lead.created", tenantId: "tenant-1", payload: { leadId: "l-1" } });
    expect(env.version).toBe(CURRENT_ENVELOPE_MAJOR);
    expect(env.type).toBe("lead.created");
    expect(env.tenantId).toBe("tenant-1");
    expect(env.payload).toEqual({ leadId: "l-1" });
    expect(new Date(env.occurredAt).toString()).not.toBe("Invalid Date");
  });

  it("accepts an envelope on the current major version", () => {
    const env = makeEnvelope({ type: "x", tenantId: "t", payload: {} });
    expect(checkEnvelopeVersion(env)).toEqual({ ok: true });
  });

  it("rejects an unrecognized major version as a terminal (non-retryable) error, not a guess", () => {
    const result = checkEnvelopeVersion({ version: CURRENT_ENVELOPE_MAJOR + 1 });
    expect(result.ok).toBe(false);
    expect(result.errorKind).toBe("terminal");
    expect(result.reason).toMatch(/not recognized/);
  });
});
