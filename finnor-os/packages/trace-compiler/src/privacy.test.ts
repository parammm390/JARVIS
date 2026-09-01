import { describe, expect, it } from "vitest";
import { compileProcedureCandidate } from "./compiler";
import { normalizeExecutionTrace } from "./normalize";
import { canonicalSerialize } from "./canonical";
import { P6_OPTIONS, reminderBundle, reminderTrace } from "../fixtures/locked-corpus";

describe("tenant privacy and semantic redaction", () => {
  it("redacts PII and discards raw secrets before Trace IR identity is computed", () => {
    const bundle = reminderBundle({ suffix: "privacy", pii: true });
    const send = bundle.events.find((event) => event.eventId === "send-privacy")!;
    send.inputs!.push(
      { path: "provider.api_key", value: "sk_live_should_never_persist", role: "SOURCE" },
      { path: "provider.auth_profile", value: "credential-private", role: "SOURCE" },
    );
    const trace = normalizeExecutionTrace(bundle, P6_OPTIONS);
    const bytes = canonicalSerialize(trace);
    expect(bytes).not.toContain("sk_live_should_never_persist");
    expect(bytes).not.toContain("credential-private");
    expect(bytes).not.toContain("h@example.com");
    expect(trace.provenance.redaction.secretValuesDiscarded).toBeGreaterThan(0);
    expect(trace.provenance.redaction.credentialValuesRedacted).toBeGreaterThan(0);
    expect(trace.provenance.redaction.rawSecretLeakage).toBe(0);
  });

  it("requires explicit anonymization for cross-tenant alignment and carries no private literal", () => {
    const traces = [
      reminderTrace({ suffix: "tenant-scope-a", tenantId: "tenant-a", tenantLiteral: "dealer-secret-policy-alpha" }),
      reminderTrace({ suffix: "tenant-scope-b", tenantId: "tenant-b", tenantLiteral: "dealer-secret-policy-beta" }),
    ];
    expect(() => compileProcedureCandidate(traces, P6_OPTIONS)).toThrow(/Cross-tenant alignment requires explicit semantic anonymization/);
    const result = compileProcedureCandidate(traces, { ...P6_OPTIONS, crossTenantMode: "ANONYMIZED" });
    expect(result.candidate.provenance.crossTenantAnonymized).toBe(true);
    expect(result.candidate.parameters.some((parameter) => parameter.classification === "TENANT_BOUND")).toBe(true);
    expect(canonicalSerialize(result.candidate)).not.toMatch(/dealer-secret-policy-alpha|dealer-secret-policy-beta/);
  });

  it("keeps exact source identity mappings in Trace provenance but only opaque references in a ProcedureCandidate", () => {
    const trace = reminderTrace({ suffix: "source-private" });
    expect(trace.provenance.sourceIdentities.workIds).toContain("work-source-private");
    const result = compileProcedureCandidate([trace], P6_OPTIONS);
    const bytes = canonicalSerialize(result.candidate);
    expect(bytes).not.toMatch(/work-source-private|effect-source-private|provider-op-source-private|idem-source-private/);
    expect(result.candidate.evidence.sourceIdentities.workIds[0]).toMatch(/^p6:source-identity-ref:sha256:/);
    expect(result.candidate.provenance.sourceIdentityValuesOpaque).toBe(true);
  });
});
