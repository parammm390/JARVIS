import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const source = readFileSync(fileURLToPath(new URL("../../packages/orchestration/src/external-observation.ts", import.meta.url)), "utf8");

describe("production-correctness external observation convergence", () => {
  it("requires canonical integration-event/wake ingestion after effect settlement", () => {
    expect(source).toContain("await ingestIntegrationEvent({");
    expect(source).not.toMatch(/ingestIntegrationEvent\(\{[\s\S]*?\}\)\.catch\(/);
  });

  it("does not silently discard objective-controller resumption failures", () => {
    expect(source).toContain("await resumeObjectiveForAction(observation.tenantId, loaded.effectActionId);");
    expect(source).not.toMatch(/resumeObjectiveForAction\([^;]+\.catch\(/);
  });
});
