export * from "./errors";
export * from "./wrap";
export * from "./registry";
export * from "./idempotent-call";
export * from "./mcp-client";
export * from "./builtin-tools";

import { ToolRegistry } from "./registry";
import { registerBuiltinTools } from "./builtin-tools";

/** Standard startup registry: built-ins registered once, extensible by callers. */
export function createDefaultRegistry(): ToolRegistry {
  const registry = new ToolRegistry();
  registerBuiltinTools(registry);
  return registry;
}
export * from "./vapi-rest";
export * from "./email";
export * from "./maps";
export * from "./exa";
export * from "./llm";
export * from "./voice-personas";
export * from "./ads";
export * from "./quickbooks";
export * from "./health";
export * from "./ads-write";
export * from "./temporal-signals";
export * from "./observability";
