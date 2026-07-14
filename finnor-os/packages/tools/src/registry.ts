// Tool registry (§11–12): a map of action-capable tools, each MCP-backed or stubbed.
// New integrations register new tools — orchestrator code never changes.

import { z } from "zod";
import type { ToolCallResult, RetryPolicy } from "./wrap";
import { wrappedCall, DEFAULT_RETRY } from "./wrap";
import { createHash } from "node:crypto";
import { ensureSecretsLoaded, minimizeExternalInput } from "@finnor/security";
import { claimExternalOperation, recordExternalOperationResult, awaitExternalOperationResolution } from "./idempotent-call";
import { initObservability, Sentry } from "./observability";

export interface Tool {
  name: string;
  description: string;
  inputSchema: z.ZodTypeAny;
  integration: string;
  retryPolicy?: RetryPolicy;
  /** Fields actually forwarded to this external provider. Omitted = today's
   *  pass-through behavior (opt-in per tool). Every builtin tool schema uses
   *  .passthrough(), so without this a stray field (household notes, an SSN some
   *  future planner payload attaches) flows straight to the external adapter. */
  piiAllowlist?: readonly string[];
  run(input: Record<string, unknown>): Promise<Record<string, unknown>>;
}

export class ToolRegistry {
  private tools = new Map<string, Tool>();

  register(tool: Tool): void {
    if (this.tools.has(tool.name)) {
      throw new Error(`Tool ${tool.name} already registered`);
    }
    this.tools.set(tool.name, tool);
  }

  has(name: string): boolean {
    return this.tools.has(name);
  }

  list(): string[] {
    return [...this.tools.keys()];
  }

  /** Every call goes through secrets loading, validation, PII minimization (if the
   *  tool opts in), and the timeout/retry wrapper. Never bare. Observability rides on
   *  this same chokepoint: a breadcrumb per call (tool name, integration, latency,
   *  ok/fail — never the input/output itself, respecting the PII-minimization above),
   *  and a captured message on failure. No-ops harmlessly without SENTRY_DSN. */
  async call(name: string, input: Record<string, unknown>): Promise<ToolCallResult> {
    initObservability();
    await ensureSecretsLoaded();
    const tool = this.tools.get(name);
    if (!tool) {
      return { ok: false, output: {}, error: `Unknown tool: ${name}` };
    }
    const parsed = tool.inputSchema.safeParse(input);
    if (!parsed.success) {
      return {
        ok: false,
        output: {},
        error: `Invalid input for ${name}: ${parsed.error.issues.map((i) => i.message).join("; ")}`,
      };
    }
    const safeInput = tool.piiAllowlist ? minimizeExternalInput(parsed.data, tool.piiAllowlist) : parsed.data;
    const start = Date.now();
    const result = await wrappedCall(tool.integration, () => tool.run(safeInput), tool.retryPolicy ?? DEFAULT_RETRY);
    const ms = Date.now() - start;
    Sentry.addBreadcrumb({ category: "tool", message: name, data: { integration: tool.integration, ok: result.ok, ms } });
    if (!result.ok) Sentry.captureMessage(`tool_failed:${name}`, { level: "warning" });
    return result;
  }
}

export interface ToolCallContext {
  tenantId: string;
  domainActionId: string;
}

/**
 * Wraps a real ToolRegistry with an idempotency claim against the external_operations
 * ledger (packages/db/schema.ts) — one row per (domainActionId, tool-name+call-index),
 * so a retried execution (reflection retry, a resumed LangGraph thread) never re-fires
 * a side effect that already SUCCEEDED, while a call that previously FAILED is always
 * allowed to actually retry (that's exactly what reflection is for — a failed attempt
 * didn't deliver anything, so re-running it isn't a duplicate). Subclasses ToolRegistry
 * (not a duck-typed wrapper) because `tools` is a private field — every plugin's
 * `execute(draft, tools: ToolRegistry)` already accepts this structurally, so this
 * requires zero plugin signature changes. Constructed fresh per action execution at
 * the two chokepoints that call plugin.execute() — GatedExecutor and
 * makeExecuteNode() — after the confirmation gate has already cleared. Relies on
 * plugins' execute() being deterministic (same draft → same sequence of tool calls),
 * which holds for every plugin in this codebase today — a retry's Nth call lands on
 * the same operationKey as the original attempt's Nth call.
 */
export class ScopedToolRegistry extends ToolRegistry {
  // Per-instance call counter, not per-tool: several plugins (bulk_notify_existing_
  // customers, proposal-batch) call the SAME tool once per target in a loop within one
  // execute() — keying purely on tool name would make target #2's send look like a
  // duplicate of target #1's and silently skip it. A fresh ScopedToolRegistry is
  // constructed per execute() call (see executor.ts/graph/nodes.ts), so a reflection
  // retry that replays the same deterministic call sequence lands on the SAME
  // operationKey per call, letting claimExternalOperation's failed->retry logic work
  // per-call: a call that already succeeded is never re-run, one that failed is.
  private callIndex = 0;

  constructor(
    private base: ToolRegistry,
    private ctx: ToolCallContext,
  ) {
    super();
  }

  override has(name: string): boolean {
    return this.base.has(name);
  }

  override list(): string[] {
    return this.base.list();
  }

  override async call(name: string, input: Record<string, unknown>): Promise<ToolCallResult> {
    const operationKey = `${name}:${this.callIndex++}`;
    const requestHash = hashInput(input);
    const claim = await claimExternalOperation(this.ctx.tenantId, this.ctx.domainActionId, operationKey, requestHash);
    if (!claim.claimed) {
      if (claim.existing.requestHash !== requestHash) {
        return {
          ok: false,
          output: {},
          error: `Idempotency conflict: ${name} already ran for this action with different input — refusing to re-run with new input`,
        };
      }
      // The winner of the claim race may still be mid-call — wait for it to settle
      // rather than reporting a false "not ok" for a call that's genuinely in progress.
      const settled = await awaitExternalOperationResolution(this.ctx.tenantId, this.ctx.domainActionId, operationKey, claim.existing);
      // Match wrappedCall's own convention exactly (wrap.ts): integrationUnavailable is
      // only ever present on a failure, never as an explicit `false` on success.
      return settled.status === "succeeded"
        ? { ok: true, output: (settled.response ?? {}) as Record<string, unknown> }
        : { ok: false, output: (settled.response ?? {}) as Record<string, unknown>, integrationUnavailable: true };
    }
    const result = await this.base.call(name, input);
    await recordExternalOperationResult(this.ctx.tenantId, this.ctx.domainActionId, operationKey, result.ok ? "succeeded" : "failed", result.output);
    return result;
  }
}

function hashInput(input: Record<string, unknown>): string {
  return createHash("sha256").update(JSON.stringify(input)).digest("hex");
}
