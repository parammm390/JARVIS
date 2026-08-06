import { afterEach, describe, expect, it } from "vitest";
import { registerBuiltinTools, ToolRegistry, type Tool } from "@finnor/tools";

class RecordingRegistry extends ToolRegistry {
  readonly registered: Tool[] = [];

  override register(tool: Tool): void {
    this.registered.push(tool);
    super.register(tool);
  }
}

const ENV_KEYS = ["COMMS_MODE", "GOHIGHLEVEL_API_KEY", "VAPI_API_KEY", "VAPI_PHONE_NUMBER_ID", "VAPI_ASSISTANT_ID"] as const;
const previousEnv = new Map<string, string | undefined>();

afterEach(() => {
  for (const key of ENV_KEYS) {
    const value = previousEnv.get(key);
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  previousEnv.clear();
});

function setEnv(key: (typeof ENV_KEYS)[number], value: string | undefined): void {
  if (!previousEnv.has(key)) previousEnv.set(key, process.env[key]);
  if (value === undefined) delete process.env[key];
  else process.env[key] = value;
}

describe("builtin outbound-call registration", () => {
  it("keeps the sandbox call driver when live Vapi credentials are present", () => {
    setEnv("COMMS_MODE", "sandbox");
    setEnv("GOHIGHLEVEL_API_KEY", "configured");
    setEnv("VAPI_API_KEY", "configured");
    setEnv("VAPI_PHONE_NUMBER_ID", "phone-number-id");
    setEnv("VAPI_ASSISTANT_ID", "assistant-id");

    const registry = new RecordingRegistry();
    registerBuiltinTools(registry);

    const callTool = registry.registered.find((tool) => tool.name === "vapi_place_call");
    expect(callTool?.integration).toBe("sandbox");
    expect(callTool?.description).toMatch(/^SANDBOX:/);
  });
});
