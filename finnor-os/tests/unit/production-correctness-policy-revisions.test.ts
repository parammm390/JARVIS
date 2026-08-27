import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

function source(relativePath: string): string {
  return readFileSync(fileURLToPath(new URL(relativePath, import.meta.url)), "utf8");
}

describe("production-correctness policy revision truth", () => {
  it("reads the effective revision and serializes version allocation from revision history", () => {
    const route = source("../../apps/api/app/api/policies/[tenantId]/[actionType]/route.ts");

    expect(route).toContain("pg_advisory_xact_lock");
    expect(route).toContain("lte(domainPolicyRevisions.effectiveFrom, new Date())");
    expect(route).toContain("orderBy(desc(domainPolicyRevisions.effectiveFrom), desc(domainPolicyRevisions.version))");
    expect(route).toContain("orderBy(desc(domainPolicyRevisions.version))");
    expect(route).toContain("Math.max(existing.version, latestRevision?.version ?? 0) + 1");
    expect(route).toContain("base.effectiveFrom <= new Date() ? base : null");
    expect(route).not.toContain("const version = existing.version + 1");
  });

  it("uses a deterministic version tie-break everywhere current policy is selected", () => {
    for (const path of [
      "../../packages/orchestration/src/planner.ts",
      "../../packages/orchestration/src/durable-execution.ts",
      "../../packages/orchestration/src/index.ts",
    ]) {
      const currentSelectors = source(path).match(/orderBy\(desc\(domainPolicyRevisions\.effectiveFrom\)[^;]+/g) ?? [];
      expect(currentSelectors.length).toBeGreaterThan(0);
      expect(currentSelectors.every((selector) => selector.includes("desc(domainPolicyRevisions.version)"))).toBe(true);
    }
  });

  it("uses the exact drafted revision for approval timeout and receipt evidence", () => {
    const expiry = source("../../apps/worker/src/handlers/scan-approval-expiry.ts");
    const watchdog = source("../../apps/worker/src/handlers/scan-watchdog.ts");
    const steps = source("../../packages/workflow-runtime/src/steps.ts");

    for (const worker of [expiry, watchdog]) {
      expect(worker).toContain("eq(domainActions.policyId, domainPolicyRevisions.policyId)");
      expect(worker).toContain("eq(domainActions.policyVersion, domainPolicyRevisions.version)");
    }
    expect(steps).toContain("eq(domainPolicyRevisions.version, action.policyVersion)");
  });
});
