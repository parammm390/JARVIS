import { execFileSync } from "node:child_process";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { certifyP0 } from "../../scripts/p0/certify";
import { verifyP6DescendantLineage } from "../../scripts/p6/verify-descendant-lineage";

const repositoryRoot = resolve(import.meta.dirname, "../../..");

function verifyP0P4ReleaseLineage(): Record<string, any> {
  return JSON.parse(execFileSync(process.execPath, [resolve(repositoryRoot, "scripts/release/verify-p0-p4-lineage.mjs")], {
    cwd: repositoryRoot,
    encoding: "utf8",
  })) as Record<string, any>;
}

describe("P0 existing substrate architecture contract", () => {
  it("certifies exact owners, runtime lifecycle enums, invariants, inventories, and a cycle-free minimal-churn diff", async () => {
    if (process.env.FINNOR_CERTIFICATION_P0_P6_LINEAGE === "1") {
      const finalLineage = verifyP6DescendantLineage();
      expect(finalLineage).toMatchObject({
        status: "PASS_FINAL_DESCENDANT_LINEAGE",
        finalP5Certification: "PASS",
        finalP6Certification: "PASS",
        reconciliationCount: { p5: 1, p6: 1 },
        hardGates: { p5: 23, p6: 28, nonZero: 0 },
        unexplainedSemanticDrift: 0,
      });
      return;
    }
    const releaseLineage = process.env.FINNOR_CERTIFICATION_RELEASE_LINEAGE === "1";
    const result = releaseLineage ? verifyP0P4ReleaseLineage() : await certifyP0();
    const closure = releaseLineage || process.env.FINNOR_CERTIFICATION_CLOSURE === "1";
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
