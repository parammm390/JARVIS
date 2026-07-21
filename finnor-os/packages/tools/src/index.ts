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
export * from "./stripe";
export * from "./docusign";
export * from "./health";
export * from "./ads-write";
export * from "./observability";
export * from "./provider-health";
export * from "./provider-circuit-breaker";
export * from "./provider-budget";
export * from "./emulators/fault-injection";
export * from "./emulators/scheduling-emulator";
export * from "./emulators/communications-emulator";
export * from "./capabilities/scheduling";
export * from "./capabilities/communications";
export * from "./emulators/crm-emulator";
export * from "./capabilities/crm";
export * from "./emulators/accounting-emulator";
export * from "./capabilities/accounting";
export * from "./emulators/marketing-emulator";
export * from "./capabilities/marketing";
export * from "./emulators/inventory-emulator";
export * from "./capabilities/inventory";
export * from "./emulators/documents-emulator";
export * from "./capabilities/documents";
export * from "./binding-resolution";
