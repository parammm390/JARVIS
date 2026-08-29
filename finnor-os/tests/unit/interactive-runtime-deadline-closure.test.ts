import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { repairPlanningDeadlineAt } from "../../apps/worker/src/handlers/repair-plan-after-terminal-failure";

const orchestration = readFileSync(fileURLToPath(new URL("../../packages/orchestration/src/index.ts", import.meta.url)), "utf8");
const computerRunner = readFileSync(fileURLToPath(new URL("../../packages/computer/src/runner.ts", import.meta.url)), "utf8");
const computerHandler = readFileSync(fileURLToPath(new URL("../../apps/worker/src/handlers/run-computer-task.ts", import.meta.url)), "utf8");

describe("provider/planner/repair absolute deadline closure", () => {
  it("creates one bounded absolute deadline when a durable repair job starts", () => {
    expect(repairPlanningDeadlineAt(1_000, "20000")).toBe(21_000);
    expect(repairPlanningDeadlineAt(1_000, "")).toBe(21_000);
    expect(repairPlanningDeadlineAt(1_000, "   ")).toBe(21_000);
    expect(repairPlanningDeadlineAt(1_000, "1")).toBe(6_000);
    expect(repairPlanningDeadlineAt(1_000, "999999")).toBe(61_000);
  });

  it("passes the same repair deadline through the ordinary planner", () => {
    const repair = orchestration.slice(
      orchestration.indexOf("async repairPlanAfterTerminalFailure"),
      orchestration.indexOf("private policyCache"),
    );
    expect(repair).toContain("deadlineAt: options.deadlineAt")
    expect(repair).toContain("deadlineMs: options.deadlineMs")
  });

  it("makes every computer micro-planner call consume the canonical run deadline", () => {
    expect(computerRunner).toContain("deadlineAt: run.deadlineAt?.getTime() ?? startedAt + limits.timeoutMs")
    expect(computerHandler).toContain("deadlineAt: context.deadlineAt")
  });
});
