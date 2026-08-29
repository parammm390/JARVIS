// B2.T6: terminal workflow-step failures are repaired asynchronously so the worker
// never performs a new business action inline. FinnorOrchestrator persists a new,
// lineaged plan and sends it through the normal confirmation gate.

import { FinnorOrchestrator } from "@finnor/orchestration";
import type { JobHandler } from "../queue";

let orchestrator: FinnorOrchestrator | null = null;

export function repairPlanningDeadlineAt(now = Date.now(), configured = process.env.REPAIR_PLANNER_DEADLINE_MS): number {
  // Empty environment variables are common in templated deployments. Number("")
  // is zero, which would silently collapse the repair budget to the 5s floor.
  const normalized = configured?.trim();
  const parsed = normalized ? Number(normalized) : 20_000;
  const budgetMs = Number.isFinite(parsed) ? Math.min(60_000, Math.max(5_000, Math.floor(parsed))) : 20_000;
  return now + budgetMs;
}

export const repairPlanAfterTerminalFailure: JobHandler = async (payload) => {
  const tenantId = String(payload.tenantId ?? "");
  const domainActionId = String(payload.domainActionId ?? "");
  const workflowStepId = String(payload.workflowStepId ?? "");
  if (!tenantId || !domainActionId || !workflowStepId) throw new Error("repair_plan_after_terminal_failure requires tenantId, domainActionId, and workflowStepId");
  orchestrator ??= new FinnorOrchestrator();
  // One absolute budget is created when the durable repair job is accepted by a
  // worker. Every provider/repair pass consumes the remainder of this timestamp.
  await orchestrator.repairPlanAfterTerminalFailure(tenantId, domainActionId, workflowStepId, {
    deadlineAt: repairPlanningDeadlineAt(),
  });
};
