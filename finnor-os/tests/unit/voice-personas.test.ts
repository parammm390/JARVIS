import { describe, expect, it } from "vitest";
import { agentKeyForPersona, VOICE_AGENT_KEYS } from "@finnor/tools";

describe("bounded voice persona attribution", () => {
  it("maps only source-owned personas to safe product keys", () => {
    expect(VOICE_AGENT_KEYS).toEqual(["jarvis", "payment-collector", "win-back", "service-reminder", "follow-up"]);
    expect(agentKeyForPersona("main")).toBe("jarvis");
    expect(agentKeyForPersona("payment_collector")).toBe("payment-collector");
    expect(agentKeyForPersona("winback")).toBe("win-back");
    expect(agentKeyForPersona("service_reminder")).toBe("service-reminder");
    expect(agentKeyForPersona("install_followup")).toBe("follow-up");
  });

  it("does not create an agent edge for unknown or missing persona values", () => {
    expect(agentKeyForPersona("assistant-ready")).toBeUndefined();
    expect(agentKeyForPersona(undefined)).toBeUndefined();
  });
});
