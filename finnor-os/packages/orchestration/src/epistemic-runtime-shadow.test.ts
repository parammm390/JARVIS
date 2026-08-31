import { describe, expect, it } from "vitest";
import type { StaticResolutionProvider } from "@finnor/operational-ir";
import type { OperatingContext } from "@finnor/shared-types";
import type { OperationalQueryExecution } from "./fast-read-lane";
import {
  observeOperationalQueryP3EpistemicShadow,
  type OperationalQueryP3EpistemicShadowInput,
} from "./epistemic-runtime-shadow";

const TENANT_ID = "50000000-0000-4000-8000-000000000001";
const OTHER_TENANT_ID = "50000000-0000-4000-8000-000000000002";
const USER_ID = "60000000-0000-4000-8000-000000000001";
const HOUSEHOLD_ID = "40000000-0000-4000-8000-000000000001";
const NOW = "2026-08-30T04:00:00.000Z";

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
    metadata: {
      queryId: "query:1",
      source: "postgresql",
      durationMs: 4,
      startedAt: NOW,
      completedAt: NOW,
    },
  };
}

function input(status: "ok" | "ambiguous" = "ok"): OperationalQueryP3EpistemicShadowInput {
  const readDecision = {
    route: "fast_read" as const,
    confidence: "high" as const,
    request: { intent: "customer_lookup" as const, householdId: HOUSEHOLD_ID },
  };
  return {
    routeDecision: { version: 1, route: "QUERY", reasonCodes: ["deterministic_canonical_read"], queryDecision: readDecision },
    readDecision,
    instructionId: "10000000-0000-4000-8000-000000000001",
    workId: "20000000-0000-4000-8000-000000000001",
    workInputId: "30000000-0000-4000-8000-000000000001",
    compiledAt: NOW,
    execution: execution(status),
    context: {
      tenant: { id: TENANT_ID },
      employee: { userId: USER_ID },
    } as unknown as Pick<OperatingContext, "tenant" | "employee">,
  };
}

const ADMISSIBLE_PROVIDER: StaticResolutionProvider = {
  async resolveEntity(request) {
    return { status: "EXISTS", tenantId: request.trustedTenantId, type: request.type };
  },
  async resolveCapability(request) {
    return { status: "EXISTS", supportedDimensions: request.requiredDimensions, configured: "NOT_REQUIRED" };
  },
};

describe("P3 production epistemic shadow", () => {
  it("observes the completed canonical query with an equivalent redacted CausalReplay trace and zero behavior change", async () => {
    const authoritative = input();
    const recorded: unknown[] = [];
    const result = await observeOperationalQueryP3EpistemicShadow(authoritative, TENANT_ID, ADMISSIBLE_PROVIDER, (summary) => recorded.push(summary));

    expect(result.authoritativeExecution).toBe(authoritative.execution);
    expect(result.summary).toMatchObject({
      status: "OBSERVED",
      authoritativePath: "EXISTING",
      authoritativeBehaviorChanged: false,
      queryIntent: "customer_lookup",
      queryResultStatus: "ok",
      p2Admissibility: "ADMISSIBLE",
      consequentialDecisionAllowed: true,
      semanticDiff: "EQUIVALENT",
      plannerCallsAdded: 0,
      consequentialMutations: 0,
      persistenceWrites: 0,
      authorityDecisions: 0,
      approvalRequests: 0,
      providerCalls: 0,
      computerRuns: 0,
      workTransitions: 0,
    });
    expect(result.trace).toMatchObject({ redaction: "STRUCTURED_DECISIONS_ONLY", p2Statuses: ["ADMISSIBLE"] });
    expect(result.trace?.finalPropositions).toEqual([{ id: "operational_query.result_sufficient", status: "KNOWN", evidenceCount: 1 }]);
    expect(result.causalReplayNodes).toHaveLength(3);
    expect(recorded).toEqual([result.summary]);
    expect(JSON.stringify(result.summary)).not.toContain(HOUSEHOLD_ID);
  });

  it("records non-sufficient canonical results as explicit uncertainty without redundant retrieval", async () => {
    const result = await observeOperationalQueryP3EpistemicShadow(input("ambiguous"), TENANT_ID, ADMISSIBLE_PROVIDER, () => undefined);
    expect(result.summary).toMatchObject({
      status: "OBSERVED",
      queryResultStatus: "ambiguous",
      consequentialDecisionAllowed: false,
      semanticDiff: "EQUIVALENT",
    });
    expect(result.trace?.uncertainties).toEqual([
      expect.objectContaining({ propositionId: "operational_query.result_sufficient", category: "UNOBSERVABLE" }),
    ]);
    expect(result.trace?.candidates).toEqual([]);
    expect(result.trace?.selectedActions).toEqual([]);
    expect(result.trace?.stopDecisions.at(-1)?.reason).toBe("NO_LEGAL_ACTION");
  });

  it("never upgrades a P2 rejection and contains boundary or recorder failures", async () => {
    const rejectedProvider: StaticResolutionProvider = {
      async resolveEntity(request) {
        return { status: "CROSS_TENANT", tenantId: OTHER_TENANT_ID, type: request.type };
      },
      async resolveCapability(request) {
        return { status: "EXISTS", supportedDimensions: request.requiredDimensions, configured: "NOT_REQUIRED" };
      },
    };
    const rejectedInput = input();
    const rejected = await observeOperationalQueryP3EpistemicShadow(rejectedInput, TENANT_ID, rejectedProvider, () => undefined);
    expect(rejected.authoritativeExecution).toBe(rejectedInput.execution);
    expect(rejected.summary).toMatchObject({
      status: "OBSERVED",
      p2Admissibility: "REJECTED",
      consequentialDecisionAllowed: false,
      authoritativeBehaviorChanged: false,
    });

    const mismatched = input();
    mismatched.context.tenant.id = OTHER_TENANT_ID;
    const failed = await observeOperationalQueryP3EpistemicShadow(mismatched, TENANT_ID, ADMISSIBLE_PROVIDER, () => { throw new Error("recorder unavailable"); });
    expect(failed.authoritativeExecution).toBe(mismatched.execution);
    expect(failed.recording).toBe("RECORDER_FAILED");
    expect(failed.summary).toMatchObject({
      status: "FAILED",
      p2Admissibility: "NOT_EVALUATED",
      failureReasonCodes: ["P3_SHADOW_INTERNAL_FAILURE"],
      consequentialMutations: 0,
      authoritativeBehaviorChanged: false,
    });
  });
});
