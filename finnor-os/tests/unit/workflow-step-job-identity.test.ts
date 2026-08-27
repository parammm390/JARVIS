import { describe, expect, it } from "vitest";
import { workflowStepJobKey } from "@finnor/workflow-runtime";

describe("workflow step delivery identity", () => {
  it("preserves the legacy generation-zero key and gives every redrive a fresh key", () => {
    expect(workflowStepJobKey("tenant-a", "step-a", 0)).toBe("workflow-step:tenant-a:step-a");
    expect(workflowStepJobKey("tenant-a", "step-a", 1)).toBe("workflow-step:tenant-a:step-a:generation:1");
    expect(workflowStepJobKey("tenant-a", "step-a", 2)).not.toBe(workflowStepJobKey("tenant-a", "step-a", 1));
  });

  it.each([-1, 1.5, Number.NaN, Number.POSITIVE_INFINITY])("rejects invalid generation %s", (generation) => {
    expect(() => workflowStepJobKey("tenant-a", "step-a", generation)).toThrow(/generation/);
  });
});
