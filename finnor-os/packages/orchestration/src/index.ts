// Orchestration core (§9): Planner → confirmation gate → Executor → Reflection.
// This module is the single entry point the API, webhooks, and workers all use.

import type { DomainAction, DomainPolicy, TenantContext, ExecutionResult } from "@finnor/shared-types";
import { withTenant, domainActions, domainPolicies } from "@finnor/db";
import { buildMemorySnapshot, appendEpisode, appendShortTerm } from "@finnor/memory";
import { createDefaultRegistry, type ToolRegistry } from "@finnor/tools";
import { and, eq } from "drizzle-orm";
import { LLMPlanner, type Planner } from "./planner";
import { GatedExecutor, type Executor } from "./executor";
import { OutcomeReflection, type Reflection } from "./reflection";
import { createDefaultPluginRegistry, PluginRegistry } from "./plugin-registry";
import { resolveProvider } from "./llm";

export * from "./llm";
export * from "./planner";
export * from "./executor";
export * from "./reflection";
export * from "./plugin-registry";
export * from "./voice";

export interface Orchestrator {
  handleInstruction(
    instruction: string,
    ctx: TenantContext,
    opts?: { sessionId?: string; householdId?: string },
  ): Promise<DomainAction[]>;
  runAction(actionId: string, tenantId: string): Promise<ExecutionResult>;
}

/** A policy row is required for execution; absent one, a safe default gates everything. */
export function defaultPolicy(tenantId: string, actionType: string): DomainPolicy {
  return {
    id: "00000000-0000-4000-8000-00000000dead",
    tenantId,
    actionType,
    policy: {},
    // Default-deny posture: no configured policy → always require a human.
    requiresConfirmation: true,
    confirmationTemplate: null,
  };
}

export class FinnorOrchestrator implements Orchestrator {
  readonly plugins: PluginRegistry;
  readonly tools: ToolRegistry;
  readonly planner: Planner;
  readonly executor: Executor;
  readonly reflection: Reflection;

  constructor(deps?: {
    plugins?: PluginRegistry;
    tools?: ToolRegistry;
    planner?: Planner;
    executor?: Executor;
    reflection?: Reflection;
  }) {
    this.plugins = deps?.plugins ?? createDefaultPluginRegistry();
    this.tools = deps?.tools ?? createDefaultRegistry();
    this.planner = deps?.planner ?? new LLMPlanner(this.plugins);
    this.executor = deps?.executor ?? new GatedExecutor(this.plugins, this.tools);
    this.reflection = deps?.reflection ?? new OutcomeReflection();
  }

  /** Instruction (voice transcript or text) → plan → gate-or-execute each action. */
  async handleInstruction(
    instruction: string,
    ctx: TenantContext,
    opts: { sessionId?: string; householdId?: string } = {},
  ): Promise<DomainAction[]> {
    const memory = await buildMemorySnapshot({
      tenantId: ctx.tenantId,
      sessionId: opts.sessionId,
      householdId: opts.householdId,
      semanticQuery: instruction,
    });
    const actions = await this.planner.plan(instruction, ctx, memory);
    // Independent actions run concurrently — each is its own gated pipeline.
    const turnResults: Array<{
      actionType: string;
      payload: Record<string, unknown>;
      status: string;
      awaitingApproval: boolean;
      resultOutput: Record<string, unknown>;
    }> = [];
    await Promise.all(
      actions.map(async (action) => {
        await appendEpisode(ctx.tenantId, action.id, "planned", { instruction }, { actionType: action.actionType, reasoning: action.reasoning ?? null });
        const policy = await this.loadPolicy(action);
        const result = await this.executor.execute(action, policy);
        await this.reflectWithRetry(action, policy, result);
        // result.status is "success" even for a merely-GATED action (it succeeded at
        // drafting, not at doing) — awaitingApproval is what actually distinguishes
        // "this really happened, the resulting row/id is real" from "this is still a
        // pending draft with no real resource yet." Conflating the two previously let
        // a follow-up turn treat a pending draft's own id as if it were the id of the
        // thing it would eventually create.
        const awaitingApproval = Boolean(result.output?.gated || result.output?.pendingConfirmation);
        turnResults.push({
          actionType: action.actionType,
          payload: action.payload,
          status: result.status,
          awaitingApproval,
          resultOutput: awaitingApproval ? {} : result.output,
        });
      }),
    );
    // Write this turn back to short-term memory (§10) — without this, every turn in
    // the same call/session started completely blank, so "call them" or "do it for
    // the second one" had nothing to resolve against. TTL'd (30 min), scoped to this
    // session only, never cross-session or cross-tenant.
    if (opts.sessionId) {
      await appendShortTerm(ctx.tenantId, opts.sessionId, {
        instruction,
        actions: turnResults,
        at: new Date().toISOString(),
      }).catch(() => undefined);
    }
    return actions;
  }

  /**
   * Draft and gate a SINGLE action whose action_type/payload is already known —
   * skips the LLM planner entirely. For system-originated work (scheduled scans,
   * proactive jobs) where there's no free-text instruction to interpret, only a
   * deterministic decision already made by the caller. This is the shared primitive
   * every proactive scan handler uses so each one gets a real rendered summary and
   * (if voice is configured) a real voice_confirm_request job — the same treatment
   * a human-typed instruction gets, not a hand-inserted row that skips the pipeline.
   */
  async draftKnownAction(
    actionType: string,
    payload: Record<string, unknown>,
    tenantId: string,
    opts: { source?: string } = {},
  ): Promise<{ action: DomainAction; result: ExecutionResult }> {
    const [row] = await withTenant(tenantId, (db) =>
      db.insert(domainActions).values({ tenantId, actionType, payload, status: "draft" }).returning(),
    );
    if (!row) throw new Error("draftKnownAction: insert returned no row");
    const action: DomainAction = {
      id: row.id,
      tenantId: row.tenantId,
      actionType: row.actionType,
      payload: row.payload as Record<string, unknown>,
      policyId: row.policyId,
      status: row.status,
      createdAt: row.createdAt.toISOString(),
    };
    await appendEpisode(tenantId, action.id, "planned", { source: opts.source ?? "system_scan" }, { actionType });
    const policy = await this.loadPolicy(action);
    const result = await this.executor.execute(action, policy);
    await this.reflectWithRetry(action, policy, result);
    return { action, result };
  }

  /** Resume an approved action (called after POST /confirm flips status to approved). */
  async runAction(actionId: string, tenantId: string): Promise<ExecutionResult> {
    const row = await withTenant(tenantId, async (db) => {
      const [r] = await db
        .select()
        .from(domainActions)
        .where(and(eq(domainActions.id, actionId), eq(domainActions.tenantId, tenantId)));
      return r;
    });
    if (!row) return { status: "failure", output: {}, error: "Action not found" };
    if (row.status !== "approved") {
      return {
        status: "failure",
        output: {},
        error: `Action is ${row.status}, not approved — the confirmation gate has not cleared.`,
      };
    }
    const action: DomainAction = {
      id: row.id,
      tenantId: row.tenantId,
      actionType: row.actionType,
      payload: row.payload as Record<string, unknown>,
      policyId: row.policyId,
      status: row.status,
      createdAt: row.createdAt.toISOString(),
    };
    const policy = await this.loadPolicy(action);
    const result = await this.executor.execute(action, policy);
    await this.reflectWithRetry(action, policy, result);
    return result;
  }

  // Policies change rarely; a short TTL cache removes a DB round trip from every
  // execution without letting edits go stale for more than 30 seconds.
  private policyCache = new Map<string, { at: number; policy: DomainPolicy }>();

  async loadPolicy(action: DomainAction): Promise<DomainPolicy> {
    const cacheKey = `${action.tenantId}:${action.policyId ?? action.actionType}`;
    const cached = this.policyCache.get(cacheKey);
    if (cached && Date.now() - cached.at < 30_000) return cached.policy;
    const row = await withTenant(action.tenantId, async (db) => {
      const [r] = action.policyId
        ? await db.select().from(domainPolicies).where(eq(domainPolicies.id, action.policyId))
        : await db
            .select()
            .from(domainPolicies)
            .where(eq(domainPolicies.actionType, action.actionType))
            .limit(1);
      return r;
    });
    const policy: DomainPolicy = !row
      ? defaultPolicy(action.tenantId, action.actionType)
      : {
          id: row.id,
          tenantId: row.tenantId,
          actionType: row.actionType,
          policy: row.policy as Record<string, unknown>,
          requiresConfirmation: row.requiresConfirmation,
          confirmationTemplate: row.confirmationTemplate,
          modelProvider: row.modelProvider ?? undefined,
        };
    this.policyCache.set(cacheKey, { at: Date.now(), policy });
    return policy;
  }

  /**
   * Voice/console-shared decision path: audit row FIRST (§19), then status flip, then
   * execution on approve. decidedBy records the channel ("voice:<callId>" or a user id).
   * Idempotent: deciding an already-decided action is a no-op with a clear result.
   */
  async decide(
    actionId: string,
    tenantId: string,
    decision: "approve" | "reject",
    decidedBy: string,
  ): Promise<ExecutionResult> {
    const row = await withTenant(tenantId, async (db) => {
      const [r] = await db
        .select()
        .from(domainActions)
        .where(and(eq(domainActions.id, actionId), eq(domainActions.tenantId, tenantId)));
      return r;
    });
    if (!row) return { status: "failure", output: {}, error: "Action not found" };
    if (row.status !== "pending" && row.status !== "needs_human_review") {
      return { status: "success", output: { idempotent: true, status: row.status } };
    }
    await appendEpisode(tenantId, actionId, decision === "approve" ? "confirmed" : "rejected", { by: decidedBy }, { channel: decidedBy.startsWith("voice:") ? "voice" : "console" });
    await withTenant(tenantId, (db) =>
      db
        .update(domainActions)
        .set({ status: decision === "approve" ? "approved" : "rejected" })
        .where(eq(domainActions.id, actionId)),
    );
    if (decision === "reject") return { status: "success", output: { rejected: true } };
    return this.runAction(actionId, tenantId);
  }

  /** Reflection loop: retry once on mismatch, escalate after that (§9). */
  private async reflectWithRetry(
    action: DomainAction,
    policy: DomainPolicy,
    result: ExecutionResult,
  ): Promise<void> {
    const outcome = await this.reflection.evaluate(action, result);
    if (outcome.decision === "retry") {
      const retryResult = await this.executor.execute(action, policy);
      await this.reflection.evaluate(action, retryResult);
    }
  }
}

/** Convenience: resolve the model provider an action's policy asks for. */
export function providerForPolicy(policy: DomainPolicy) {
  return resolveProvider(policy.modelProvider);
}
export * from "./workflow";
