import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  advance: vi.fn(),
  appendEpisode: vi.fn(),
  returning: vi.fn(),
}));

vi.mock("../../packages/domain-plugins/shared/workflow", () => ({
  advanceWorkflowForAction: mocks.advance,
}));

vi.mock("@finnor/memory", () => ({ appendEpisode: mocks.appendEpisode }));

vi.mock("@finnor/db", () => ({
  domainActions: {
    tenantId: "tenant_id",
    id: "id",
    status: "status",
    executionStartedAt: "execution_started_at",
  },
  withTenant: vi.fn(async (_tenantId: string, callback: (db: unknown) => unknown) => callback({
    update: () => ({ set: () => ({ where: () => ({ returning: mocks.returning }) }) }),
  })),
}));

import { advanceWorkflowForActionRequired } from "../../packages/orchestration/src/workflow";

function orchestrationSource(path: string): string {
  return readFileSync(fileURLToPath(new URL(`../../packages/orchestration/src/${path}`, import.meta.url)), "utf8");
}

describe("production-correctness workflow advancement", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.returning.mockResolvedValue([{ id: "action-1" }]);
  });

  it("returns successful advancement without creating a reconciliation marker", async () => {
    mocks.advance.mockResolvedValue([{ workflow: "lead_to_install", subjectId: "household-1", toState: "quote_sent" }]);

    await expect(advanceWorkflowForActionRequired({ tenantId: "tenant-1", actionId: "action-1", actionType: "generate_quote", payload: {} })).resolves.toEqual({
      ok: true,
      advanced: [{ workflow: "lead_to_install", subjectId: "household-1", toState: "quote_sent" }],
    });
    expect(mocks.returning).not.toHaveBeenCalled();
  });

  it("durably flags a successful effect whose workflow state did not advance", async () => {
    mocks.advance.mockRejectedValue(new Error("database unavailable"));

    await expect(advanceWorkflowForActionRequired({ tenantId: "tenant-1", actionId: "action-1", actionType: "generate_quote", payload: {} })).resolves.toEqual({
      ok: false,
      error: "database unavailable",
    });
    expect(mocks.returning).toHaveBeenCalledOnce();
    expect(mocks.appendEpisode).toHaveBeenCalledWith("tenant-1", "action-1", "workflow_advancement_failed", {}, expect.objectContaining({
      effectSucceeded: true,
      workflowAdvancementRecorded: false,
    }));
  });

  it("routes all three executors through the required boundary without swallowed advancement", () => {
    for (const path of ["executor.ts", "durable-execution.ts", "graph/nodes.ts"]) {
      const text = orchestrationSource(path);
      expect(text).toContain("advanceWorkflowForActionRequired");
      expect(text).not.toMatch(/advanceWorkflowForAction\([^;]+\.catch\(\(\) => \[\]\)/s);
    }
  });
});
