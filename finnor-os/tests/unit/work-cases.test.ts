import { describe, expect, it } from "vitest";
import {
  deriveWorkStatus,
  projectDomainActionStatus,
  projectWorkflowRunStatus,
  projectWorkflowStepStatus,
  WORK_STATUSES,
} from "@finnor/read-models";

describe("P2.T1 Work status projection", () => {
  it("keeps the v6 vocabulary exact and exhaustive for domain actions", () => {
    expect(WORK_STATUSES).toEqual(["Needs you", "Working", "Waiting", "Partial", "Cancelled", "Completed", "Failed", "Blocked"]);
    expect(projectDomainActionStatus("draft")).toBe("Waiting");
    expect(projectDomainActionStatus("pending")).toBe("Needs you");
    expect(projectDomainActionStatus("approved")).toBe("Waiting");
    expect(projectDomainActionStatus("rejected")).toBe("Cancelled");
    expect(projectDomainActionStatus("executing")).toBe("Working");
    expect(projectDomainActionStatus("completed")).toBe("Completed");
    expect(projectDomainActionStatus("failed")).toBe("Failed");
    expect(projectDomainActionStatus("needs_human_review")).toBe("Needs you");
    expect(projectDomainActionStatus("blocked_integration_unavailable")).toBe("Blocked");
  });

  it("maps workflow run and step states without collapsing failure into success", () => {
    expect(projectWorkflowRunStatus("running")).toBe("Working");
    expect(projectWorkflowRunStatus("failed")).toBe("Failed");
    expect(projectWorkflowRunStatus("compensating")).toBe("Working");
    expect(projectWorkflowRunStatus("compensated")).toBe("Completed");
    expect(projectWorkflowRunStatus("paused")).toBe("Needs you");
    expect(projectWorkflowRunStatus("escalated")).toBe("Needs you");
    expect(projectWorkflowRunStatus("cancelled")).toBe("Cancelled");
    expect(projectWorkflowStepStatus("pending")).toBe("Waiting");
    expect(projectWorkflowStepStatus("leased")).toBe("Working");
    expect(projectWorkflowStepStatus("failed")).toBe("Failed");
    expect(projectWorkflowStepStatus("compensating")).toBe("Working");
    expect(projectWorkflowStepStatus("compensated")).toBe("Completed");
  });

  it("uses the v6 projection priority for mixed cases", () => {
    expect(deriveWorkStatus(["Completed", "Needs you", "Working"])).toBe("Needs you");
    expect(deriveWorkStatus(["Completed", "Failed", "Working"])).toBe("Failed");
    expect(deriveWorkStatus(["Completed", "Blocked"])).toBe("Blocked");
    expect(deriveWorkStatus(["Cancelled", "Completed"])).toBe("Partial");
    expect(deriveWorkStatus([])).toBe("Waiting");
  });

  it("lets unanimous durable completion outrank a stale approval-gate trace", () => {
    expect(deriveWorkStatus(["Completed"], "action_gated")).toBe("Completed");
    expect(deriveWorkStatus(["Completed", "Completed"], "executing")).toBe("Completed");
    expect(deriveWorkStatus(["Completed", "Working"], "action_gated")).toBe("Needs you");
  });
});
