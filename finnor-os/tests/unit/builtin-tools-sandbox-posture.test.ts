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
  it("does not select a live driver at registration from process-global credentials", () => {
    setEnv("COMMS_MODE", "sandbox");
    setEnv("GOHIGHLEVEL_API_KEY", "configured");
    setEnv("VAPI_API_KEY", "configured");
    setEnv("VAPI_PHONE_NUMBER_ID", "phone-number-id");
    setEnv("VAPI_ASSISTANT_ID", "assistant-id");

    const registry = new RecordingRegistry();
    registerBuiltinTools(registry);

    const callTool = registry.registered.find((tool) => tool.name === "vapi_place_call");
    expect(callTool?.integration).toBe("tenant-routed");
    expect(callTool?.description).toMatch(/^Tenant-routed/);
  });

  it("registers the real campaign adapter from operating mode even before managed secrets are loaded", () => {
    setEnv("COMMS_MODE", "real");
    setEnv("GOHIGHLEVEL_API_KEY", undefined);
    setEnv("VAPI_API_KEY", undefined);
    setEnv("VAPI_PHONE_NUMBER_ID", undefined);
    setEnv("VAPI_ASSISTANT_ID", undefined);

    const registry = new RecordingRegistry();
    registerBuiltinTools(registry);

    expect(registry.has("vapi_place_call")).toBe(true);
    expect(registry.has("vapi_create_campaign")).toBe(true);
    expect(registry.registered.filter((tool) => tool.name === "vapi_place_call")).toHaveLength(1);
  });
});
