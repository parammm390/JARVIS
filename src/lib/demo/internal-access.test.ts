import { afterEach, describe, expect, it, vi } from "vitest";

import { requireInternalDemoAccess } from "./internal-access";

describe("requireInternalDemoAccess", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("fails closed when no internal token is configured", async () => {
    vi.stubEnv("FINNOR_INTERNAL_DEMO_TOKEN", "");
    const response = requireInternalDemoAccess(new Request("https://finnorai.com/api/generate-demo"));

    expect(response?.status).toBe(404);
    await expect(response?.json()).resolves.toEqual({ error: "Not found." });
  });

  it("rejects an incorrect token", () => {
    vi.stubEnv("FINNOR_INTERNAL_DEMO_TOKEN", "internal-only");
    const response = requireInternalDemoAccess(new Request("https://finnorai.com/api/generate-demo", {
      headers: { authorization: "Bearer public-visitor" },
    }));

    expect(response?.status).toBe(404);
  });

  it("allows the configured internal bearer token", () => {
    vi.stubEnv("FINNOR_INTERNAL_DEMO_TOKEN", "internal-only");
    const response = requireInternalDemoAccess(new Request("https://finnorai.com/api/generate-demo", {
      headers: { authorization: "Bearer internal-only" },
    }));

    expect(response).toBeNull();
  });
});
