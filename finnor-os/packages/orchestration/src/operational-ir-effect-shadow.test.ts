import { describe, expect, it } from "vitest";
import { P2_ZERO_SHADOW_MUTATIONS, type StaticResolutionProvider } from "@finnor/operational-ir";
import { observeOperationalQueryP2EffectShadow } from "./operational-ir-effect-shadow";
import type { OperationalQueryShadowInput } from "./operational-ir-shadow";

const TENANT_ID = "50000000-0000-4000-8000-000000000001";
const HOUSEHOLD_ID = "40000000-0000-4000-8000-000000000001";

function input(): OperationalQueryShadowInput {
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
    compiledAt: "2026-08-30T04:00:00.000Z",
  };
}

describe("Operational Query P2 effect shadow integration", () => {
  it("runs tenant-scoped P2 inference and admissibility on the production query candidate with zero behavior change", async () => {
    const tenants: string[] = [];
    const provider: StaticResolutionProvider = {
      async resolveEntity(request) {
        tenants.push(request.trustedTenantId);
        return { status: "EXISTS", tenantId: request.trustedTenantId, type: request.type };
      },
      async resolveCapability(request) {
        tenants.push(request.trustedTenantId);
        return { status: "EXISTS", supportedDimensions: request.requiredDimensions, configured: "NOT_REQUIRED" };
      },
    };
    const recorded: unknown[] = [];
    const summary = await observeOperationalQueryP2EffectShadow(input(), TENANT_ID, provider, (value) => recorded.push(value));
    expect(summary).toMatchObject({
      authoritativePath: "EXISTING",
      behaviorChanged: false,
      executionModel: "QUERY",
      queryIntent: "customer_lookup",
      admissibility: "ADMISSIBLE",
      reasonCodes: [],
      dimensions: ["AUTHORITY", "OBSERVATION", "PII", "READ", "REVERSIBILITY"],
      runtimeAuthorityReevaluationRequired: true,
      ...P2_ZERO_SHADOW_MUTATIONS,
    });
    expect(recorded).toEqual([summary]);
    expect(new Set(tenants)).toEqual(new Set([TENANT_ID]));
  });

  it("contains resolution and recorder failures without changing the authoritative query", async () => {
    const provider: StaticResolutionProvider = {
      async resolveEntity() { throw new Error("database unavailable"); },
      async resolveCapability() { throw new Error("database unavailable"); },
    };
    const summary = await observeOperationalQueryP2EffectShadow(input(), TENANT_ID, provider, () => { throw new Error("log unavailable"); });
    expect(summary).toMatchObject({
      authoritativePath: "EXISTING",
      behaviorChanged: false,
      admissibility: "UNRESOLVED",
      reasonCodes: ["P2_SHADOW_INTERNAL_FAILURE"],
      ...P2_ZERO_SHADOW_MUTATIONS,
    });
  });
});
