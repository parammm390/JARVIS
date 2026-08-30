import { describe, expect, it } from "vitest";
import { certifyP0 } from "../../scripts/p0/certify";

describe("P0 existing substrate architecture contract", () => {
  it("certifies exact owners, runtime lifecycle enums, invariants, inventories, and a cycle-free minimal-churn diff", async () => {
    const result = await certifyP0();
    const closure = process.env.FINNOR_CERTIFICATION_CLOSURE === "1";
    expect(result).toMatchObject({
      status: "PASS",
      executionModels: 5,
      semanticOwners: 24,
      lifecycleCount: 11,
      invariants: 15,
      hardGates: 17,
      replayCases: 24,
      referenceConcepts: 24,
      ...(closure ? {} : { productionReferenceMovement: 0 }),
      internalPackageCycles: 0,
    });
    expect(result.capabilityCounts).toEqual({
      domainActions: 59,
      domainPlugins: 26,
      operationalQueries: 13,
      capabilityContracts: 14,
      defaultTools: 16,
      totalNamedCapabilities: 102,
    });
  });
});
