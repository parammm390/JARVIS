import { describe, expect, it } from "vitest";
import type { StaticResolutionProvider } from "@finnor/operational-ir";
import type { OperatingContext } from "@finnor/shared-types";
import type { OperationalQueryExecution } from "./fast-read-lane";
import type { OperationalQueryP3EpistemicShadowInput } from "./epistemic-runtime-shadow";
import { observeOperationalQueryP4ProgramSearchShadow } from "./program-search-shadow";

const TENANT_ID = "50000000-0000-4000-8000-000000000001";
const OTHER_TENANT_ID = "50000000-0000-4000-8000-000000000002";
const USER_ID = "60000000-0000-4000-8000-000000000001";
const HOUSEHOLD_ID = "40000000-0000-4000-8000-000000000001";
const NOW = "2026-08-31T00:00:00.000Z";

function execution(status: "ok" | "ambiguous" = "ok"): OperationalQueryExecution {
  const source = { kind: "canonical_postgres" as const, tables: ["households", "contacts"] };
  return {
    request: { intent: "customer_lookup", householdId: HOUSEHOLD_ID },
    result: {
      kind: "operational_query_result",
      status,
      data: {},
      version: 1,
      intent: "customer_lookup",
      source,
      asOf: NOW,
      count: 0,
      truncated: false,
      page: { limit: 50, returned: 0, totalCount: 0, totalCountExact: true, hasMore: false, nextCursor: null, truncated: false },
      meta: { version: 1, source, asOf: NOW },
      resolution: status === "ok" ? "exact" : "ambiguous",
      rows: [],
    },
    metadata: { queryId: "query:p4", source: "postgresql", durationMs: 4, startedAt: NOW, completedAt: NOW },
  };
}

function input(status: "ok" | "ambiguous" = "ok"): OperationalQueryP3EpistemicShadowInput {
  const readDecision = { route: "fast_read" as const, confidence: "high" as const, request: { intent: "customer_lookup" as const, householdId: HOUSEHOLD_ID } };
  return {
    routeDecision: { version: 1, route: "QUERY", reasonCodes: ["deterministic_canonical_read"], queryDecision: readDecision },
    readDecision,
    instructionId: "10000000-0000-4000-8000-000000000001",
    workId: "20000000-0000-4000-8000-000000000001",
    workInputId: "30000000-0000-4000-8000-000000000001",
    compiledAt: NOW,
    execution: execution(status),
    context: { tenant: { id: TENANT_ID }, employee: { userId: USER_ID } } as unknown as Pick<OperatingContext, "tenant" | "employee">,
  };
}

const ADMISSIBLE_PROVIDER: StaticResolutionProvider = {
  async resolveEntity(request) { return { status: "EXISTS", tenantId: request.trustedTenantId, type: request.type }; },
  async resolveCapability(request) { return { status: "EXISTS", supportedDimensions: request.requiredDimensions, configured: request.requiresConfiguredBinding ? true : "NOT_REQUIRED" }; },
};

describe("P4 production program-search shadow", () => {
  it("selects only a shadow program while preserving authoritative execution identity and zero mutations", async () => {
    const authoritative = input();
    const recorded: unknown[] = [];
    const result = await observeOperationalQueryP4ProgramSearchShadow(authoritative, TENANT_ID, ADMISSIBLE_PROVIDER, (summary) => recorded.push(summary));
    expect(result.authoritativeExecution).toBe(authoritative.execution);
    expect(result.summary).toMatchObject({
      status: "OBSERVED",
      authoritativePath: "EXISTING",
      authoritativeBehaviorChanged: false,
      searchStatus: "SELECTED",
      survivingCandidates: 1,
      semanticDiff: "EQUIVALENT",
      p2Statuses: ["ADMISSIBLE"],
      plannerCallsAdded: 0,
      consequentialMutations: 0,
      persistenceWrites: 0,
      authorityDecisions: 0,
      approvalRequests: 0,
      providerCalls: 0,
      computerRuns: 0,
      workTransitions: 0,
    });
    expect(result.searchResult?.selectedProgram).not.toBeNull();
    expect(result.receipt).toMatchObject({ redaction: "STRUCTURED_DECISIONS_ONLY", status: "SELECTED" });
    expect(result.causalReplayNodes).toHaveLength(1);
    expect(recorded).toEqual([result.summary]);
    expect(JSON.stringify(result.summary)).not.toContain(HOUSEHOLD_ID);
  });

  it("hands unresolved mandatory query knowledge back to P3", async () => {
    const result = await observeOperationalQueryP4ProgramSearchShadow(input("ambiguous"), TENANT_ID, ADMISSIBLE_PROVIDER, () => undefined);
    expect(result.summary).toMatchObject({ status: "OBSERVED", searchStatus: "P3_UNRESOLVED", survivingCandidates: 0, semanticDiff: "UNSUPPORTED" });
    expect(result.summary.requirementsForP3).toEqual(["operational_query.result_sufficient"]);
  });

  it("cannot override a P2 rejection and contains boundary/recorder failure", async () => {
    const rejectedProvider: StaticResolutionProvider = {
      async resolveEntity() { return { status: "CROSS_TENANT", tenantId: OTHER_TENANT_ID }; },
      async resolveCapability(request) { return { status: "EXISTS", supportedDimensions: request.requiredDimensions, configured: "NOT_REQUIRED" }; },
    };
    const rejected = await observeOperationalQueryP4ProgramSearchShadow(input(), TENANT_ID, rejectedProvider, () => undefined);
    expect(rejected.summary).toMatchObject({ status: "OBSERVED", searchStatus: "NO_SURVIVING_PROGRAM", p2Statuses: ["REJECTED"], survivingCandidates: 0 });
    expect(rejected.searchResult?.selectedProgram).toBeNull();

    const mismatched = input();
    mismatched.context.tenant.id = OTHER_TENANT_ID;
    const failed = await observeOperationalQueryP4ProgramSearchShadow(mismatched, TENANT_ID, ADMISSIBLE_PROVIDER, () => { throw new Error("recorder unavailable"); });
    expect(failed.authoritativeExecution).toBe(mismatched.execution);
    expect(failed.recording).toBe("RECORDER_FAILED");
    expect(failed.summary).toMatchObject({ status: "FAILED", searchStatus: "NOT_EVALUATED", failureReasonCodes: ["P4_SHADOW_INTERNAL_FAILURE"], consequentialMutations: 0 });
  });
});
