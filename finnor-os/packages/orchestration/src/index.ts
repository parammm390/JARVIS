// Orchestration core (§9): Planner → confirmation gate → Executor → Reflection.
// This module is the single entry point the API, webhooks, and workers all use.

import type { DomainAction, DomainPolicy, TenantContext, ExecutionResult } from "@finnor/shared-types";
import { withTenant, domainActions, domainPolicies, actionLog, enqueueJob } from "@finnor/db";
import { buildMemorySnapshot, appendEpisode, appendShortTerm, mirrorTurnToZep } from "@finnor/memory";
import { createDefaultRegistry, type ToolRegistry } from "@finnor/tools";
import { and, eq, inArray } from "drizzle-orm";
import { LLMPlanner, type Planner } from "./planner";
import { GatedExecutor, type Executor } from "./executor";
import { OutcomeReflection, type Reflection } from "./reflection";
import { createDefaultPluginRegistry, PluginRegistry } from "./plugin-registry";
import { resolveProvider } from "./llm";
import { AllowlistExecutor } from "./graph/allowlist-executor";
import { LangGraphExecutor } from "./graph/executor";
import { buildGateGraph } from "./graph/build-graph";
import { getCheckpointer } from "./graph/checkpointer";
import { ensureSecretsLoaded, redactStructured, redactText } from "@finnor/security";

export * from "./llm";
export * from "./planner";
export * from "./compiler";
export * from "./executor";
export * from "./reflection";
export * from "./plugin-registry";
export * from "./voice";
export * from "./critic";
export * from "./learning";
export * from "./tiering";
export * from "./graph/allowlist-executor";
export * from "./graph/executor";
export * from "./graph/build-graph";
export * from "./graph/checkpointer";
export * from "./graph/state";

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
    // No real row exists — version 0 marks this as never having been a stored policy
    // (real rows start at 1, migration 0023's default), so a receipt citing version 0
    // is honestly distinguishable from one that cites an actual configured policy.
    version: 0,
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
    this.reflection = deps?.reflection ?? new OutcomeReflection();
    if (deps?.executor) {
      this.executor = deps.executor;
    } else {
      const legacy = new GatedExecutor(this.plugins, this.tools);
      const graph = new LangGraphExecutor(buildGateGraph(this.plugins, this.tools, getCheckpointer()));
      this.executor = new AllowlistExecutor(legacy, graph);
    }
  }

  /** Instruction (voice transcript or text) → plan → gate-or-execute each action. */
  async handleInstruction(
    instruction: string,
    ctx: TenantContext,
    opts: { sessionId?: string; householdId?: string } = {},
  ): Promise<DomainAction[]> {
    await ensureSecretsLoaded();
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
      actions.map(async (rawAction) => {
        // Phase 16(e): tag this instruction's correlation id onto the action so the
        // executor's own enqueueJob calls (voice_confirm_request/voice_notify_failure)
        // can thread it through — in-memory only, never a DB column (see DomainAction.correlationId).
        const action: DomainAction = ctx.correlationId ? { ...rawAction, correlationId: ctx.correlationId } : rawAction;
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
        if (awaitingApproval) {
          // Fire-and-forget async second pass — reviews the action while it already
          // sits in the confirmation gate awaiting a human, so this adds zero latency
          // to the voice/instruction path itself. See critic.ts for why this fires
          // here (LLM-planned, instruction-driven actions) and not from
          // draftKnownAction (deterministic system scans have no instruction to
          // misinterpret — nothing for a critic to check).
          await enqueueJob("critic_review", { tenantId: ctx.tenantId, actionId: action.id }, `critic:${action.id}`, ctx.correlationId).catch(() => undefined);
        }
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
      // Consolidation layer (Zep, additive — see @finnor/memory/consolidated.ts):
      // mirrors the same turn so its knowledge graph can extract durable facts across
      // sessions, not just this 30-minute short-term window. No-ops instantly if
      // ZEP_API_KEY isn't configured.
      const zepInstruction = redactText(instruction).value;
      const zepOutcome = JSON.stringify(redactStructured(turnResults));
      await mirrorTurnToZep(ctx.tenantId, opts.sessionId, `Instruction: ${zepInstruction}\nOutcome: ${zepOutcome}`).catch(
        () => undefined,
      );
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
    await ensureSecretsLoaded();
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
    // Real bug found while building Phase 3's e2e proof test: unlike the LLM-planner
    // path (planner.ts:327, sets policyId at insert time), draftKnownAction — the
    // shared primitive EVERY proactive scan and the Dealer Zero simulator uses — never
    // persisted policyId onto the domain_actions row, even when loadPolicy() resolved a
    // real, versioned policy. openReceiptForFirstClaim (workflow-runtime/src/steps.ts)
    // reads policyId straight off that row, so every system-originated receipt's
    // policyApplied silently came back null — the majority of Dealer Zero's real
    // traffic, not an edge case. version 0 is defaultPolicy()'s sentinel for "no real
    // row exists" (index.ts:58) — only persist a real, stored policy's id, never that.
    if (policy.version && policy.version > 0 && policy.id !== action.policyId) {
      await withTenant(tenantId, (db) => db.update(domainActions).set({ policyId: policy.id }).where(eq(domainActions.id, action.id)));
      action.policyId = policy.id;
    }
    const result = await this.executor.execute(action, policy);
    await this.reflectWithRetry(action, policy, result);
    return { action, result };
  }

  /**
   * Claims an approved action before execution. The conditional status transition is
   * the database concurrency boundary: exactly one caller can turn approved into
   * executing, so duplicate HTTP/webhook deliveries never duplicate a side effect.
   */
  async runAction(actionId: string, tenantId: string, approvedBy?: string): Promise<ExecutionResult> {
    await ensureSecretsLoaded();
    const row = await withTenant(tenantId, async (db) => {
      const [claimed] = await db
        .update(domainActions)
        .set({ status: "executing", executionStartedAt: new Date() })
        .where(and(eq(domainActions.id, actionId), eq(domainActions.tenantId, tenantId), eq(domainActions.status, "approved")))
        .returning();
      if (claimed) return { claimed, current: claimed };
      const [current] = await db.select().from(domainActions).where(and(eq(domainActions.id, actionId), eq(domainActions.tenantId, tenantId)));
      return { claimed: null, current };
    });
    if (!row.current) return { status: "failure", output: {}, error: "Action not found" };
    if (!row.claimed) {
      if (row.current.status !== "executing" && row.current.status !== "completed") {
        return {
          status: "failure",
          output: {},
          error: `Action is ${row.current.status}, not approved — the confirmation gate has not cleared.`,
        };
      }
      return {
        status: "success",
        output: { idempotent: true, status: row.current.status },
      };
    }
    const claimed = row.claimed;
    const action: DomainAction = {
      id: claimed.id,
      tenantId: claimed.tenantId,
      actionType: claimed.actionType,
      payload: claimed.payload as Record<string, unknown>,
      policyId: claimed.policyId,
      status: claimed.status,
      createdAt: claimed.createdAt.toISOString(),
      approvedBy,
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
      // Explicit tenantId filter, not just RLS scoping — defense in depth (a role
      // that owns these tables, as local dev connections typically do, bypasses RLS
      // entirely regardless of FORCE ROW LEVEL SECURITY; without this, an
      // unqualified `.limit(1)` by actionType alone can non-deterministically pick
      // up another tenant's policy row for the same action_type). Same convention
      // scan-low-inventory.ts and friends already follow.
      const [r] = action.policyId
        ? await db.select().from(domainPolicies).where(and(eq(domainPolicies.id, action.policyId), eq(domainPolicies.tenantId, action.tenantId)))
        : await db
            .select()
            .from(domainPolicies)
            .where(and(eq(domainPolicies.actionType, action.actionType), eq(domainPolicies.tenantId, action.tenantId)))
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
          confirmationTimeoutHours: row.confirmationTimeoutHours ?? undefined,
          version: row.version,
        };
    this.policyCache.set(cacheKey, { at: Date.now(), policy });
    return policy;
  }

  /**
   * Voice/console-shared decision path. The state transition and its audit entry are
   * one transaction; the conditional UPDATE is the single winner under concurrent
   * approvals. decidedBy records the channel ("voice:<callId>" or a user id).
   */
  async decide(
    actionId: string,
    tenantId: string,
    decision: "approve" | "reject" | "escalate",
    decidedBy: string,
    opts?: { role?: string; note?: string | null; reason?: string | null },
  ): Promise<ExecutionResult> {
    // Escalate is non-terminal (pending -> needs_human_review, still awaiting a
    // human): it only ever moves a genuinely still-pending action, never one already
    // under review (that transition is a no-op, handled by the idempotent branch
    // below via the source-status check).
    const fromStatuses = decision === "escalate" ? (["pending"] as const) : (["pending", "needs_human_review"] as const);
    const toStatus = decision === "approve" ? "approved" : decision === "reject" ? "rejected" : "needs_human_review";
    const transition = await withTenant(tenantId, async (db) => {
      const [claimed] = await db
        .update(domainActions)
        .set({ status: toStatus })
        .where(
          and(
            eq(domainActions.id, actionId),
            eq(domainActions.tenantId, tenantId),
            inArray(domainActions.status, [...fromStatuses]),
          ),
        )
        .returning();
      if (!claimed) {
        const [current] = await db.select().from(domainActions).where(and(eq(domainActions.id, actionId), eq(domainActions.tenantId, tenantId)));
        return { claimed: null, current };
      }
      await db.insert(actionLog).values({
        tenantId,
        domainActionId: actionId,
        step: decision === "approve" ? "confirmed" : decision === "reject" ? "rejected" : "escalated",
        input: { by: decidedBy, ...(opts?.role ? { role: opts.role } : {}) },
        output: {
          channel: decidedBy.startsWith("voice:") ? "voice" : "console",
          ...(decision === "approve" ? { note: opts?.note ?? null } : decision === "reject" ? { reason: opts?.reason ?? null } : { note: opts?.note ?? null }),
        },
      });
      return { claimed, current: claimed };
    });
    if (!transition.current) return { status: "failure", output: {}, error: "Action not found" };
    if (!transition.claimed) {
      // For escalate specifically, an action already in needs_human_review is the
      // correct idempotent target state, not an error.
      if (decision === "escalate" && transition.current.status === "needs_human_review") {
        return { status: "success", output: { idempotent: true, status: transition.current.status } };
      }
      return { status: "success", output: { idempotent: true, status: transition.current.status } };
    }
    const row = transition.claimed;
    if (decision === "reject") {
      // Best-effort: close a paused graph thread so it doesn't dangle waiting for a
      // resume that will never come. Never blocks the reject itself.
      await this.executor.close?.(actionId, tenantId, row.actionType).catch(() => undefined);
      return { status: "success", output: { rejected: true } };
    }
    if (decision === "escalate") {
      // Stays open for a human, no executor thread to close, nothing to run yet.
      return { status: "success", output: { escalated: true } };
    }
    return this.runAction(actionId, tenantId, decidedBy);
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
