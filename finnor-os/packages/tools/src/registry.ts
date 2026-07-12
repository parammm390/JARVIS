// Tool registry (§11–12): a map of action-capable tools, each MCP-backed or stubbed.
// New integrations register new tools — orchestrator code never changes.

import { z } from "zod";
import type { ToolCallResult, RetryPolicy } from "./wrap";
import { wrappedCall, DEFAULT_RETRY } from "./wrap";

export interface Tool {
  name: string;
  description: string;
  inputSchema: z.ZodTypeAny;
  integration: string;
  retryPolicy?: RetryPolicy;
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

  /** Every call goes through validation + the timeout/retry wrapper. Never bare. */
  async call(name: string, input: Record<string, unknown>): Promise<ToolCallResult> {
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
    return wrappedCall(tool.integration, () => tool.run(parsed.data), tool.retryPolicy ?? DEFAULT_RETRY);
  }
}
