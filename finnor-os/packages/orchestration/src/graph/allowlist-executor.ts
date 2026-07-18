// Routes each action to the legacy GatedExecutor or the new LangGraphExecutor by
// actionType, via an env-var allowlist — a per-action-type migration switch, not a
// process-wide flag, so the blast radius of adding LangGraph to one more action type
// is exactly that action type. Every other FinnorOrchestrator method (handleInstruction,
// draftKnownAction, runAction, decide) calls `this.executor.execute(...)` through the
// Executor interface and needs zero changes — this class IS the single Executor they see.

import type { DomainAction, DomainPolicy, ExecutionResult } from "@finnor/shared-types";
import type { Executor } from "../executor";

// Phase 13 Part A: the vertical-workflow action types move onto the LangGraph engine
// by default now that the restart-proof (langgraph-workflow-actions.test.ts) has run
// against them. The env var remains the kill switch — `undefined` (unset) means "use
// this default", an explicit empty string means "explicitly route nothing to the
// graph engine" — those are different states and must stay distinguishable.
export const DEFAULT_GRAPH_ACTION_TYPES = [
  "schedule_water_test",
  "start_water_test_workflow",
  "request_proposal_signature",
  "start_installation_workflow",
  "start_invoice_to_cash_workflow",
];

function parseAllowlist(raw: string): Set<string> {
  return new Set(
    raw
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean),
  );
}

export function graphActionTypeAllowlist(): Set<string> {
  const raw = process.env.ORCHESTRATION_ENGINE_GRAPH_ACTION_TYPES;
  return raw === undefined ? new Set(DEFAULT_GRAPH_ACTION_TYPES) : parseAllowlist(raw);
}

export class AllowlistExecutor implements Executor {
  constructor(
    private legacy: Executor,
    private graph: Executor,
    private allowlist: Set<string> = graphActionTypeAllowlist(),
  ) {}

  private resolve(actionType: string): Executor {
    return this.allowlist.has(actionType) ? this.graph : this.legacy;
  }

  execute(action: DomainAction, policy: DomainPolicy): Promise<ExecutionResult> {
    return this.resolve(action.actionType).execute(action, policy);
  }

  async close(actionId: string, tenantId: string, actionType: string): Promise<void> {
    await this.resolve(actionType).close?.(actionId, tenantId, actionType);
  }
}
