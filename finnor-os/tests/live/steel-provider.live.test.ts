import { afterEach, describe, expect, it } from "vitest";
import { SteelProvider, type ComputerProviderSession } from "@finnor/computer";

const enabled = process.env.STEEL_LIVE === "1" && Boolean(process.env.STEEL_API_KEY?.trim());

/** Explicit opt-in live-provider test. It is deliberately separate from deterministic
 * CI and never prints credentials, CDP URLs, viewer URLs, or session identifiers. */
describe.skipIf(!enabled)("SteelProvider live lifecycle", () => {
  let provider: SteelProvider | null = null;
  let session: ComputerProviderSession | null = null;
  const origins = { homeUrl: "https://example.com/", allowedOrigins: ["https://example.com"], authOrigins: [] };

  afterEach(async () => {
    if (provider && session) await provider.release(session).catch(() => undefined);
    session = null;
    provider = null;
  });

  it("creates, controls, observes, accounts for, and releases an isolated session", async () => {
    provider = new SteelProvider({ apiKey: process.env.STEEL_API_KEY!.trim() });
    session = await provider.createSession({
      tenantId: "live-provider-check",
      runId: "live-provider-check",
      auth: {},
      mode: "READ_ONLY",
      origins,
      limits: { maxSteps: 3, timeoutMs: 60_000, maxProviderCredits: 5, maxScreenshots: 1, maxArtifacts: 2, maxDownloadBytes: 0, maxUploadBytes: 0, maxOutputBytes: 4096 },
    });
    await provider.perform(session, { kind: "navigate", url: origins.homeUrl }, origins);
    const observation = await provider.observe(session, origins);
    const cost = await provider.cost(session);
    expect(observation).toMatchObject({ url: "https://example.com/", title: expect.stringContaining("Example Domain") });
    expect(observation.text).toContain("Example Domain");
    expect(Number.isFinite(cost.creditsUsed)).toBe(true);
    expect(session.liveViewUrl).toBeTruthy();
    await provider.release(session);
    session = null;
  }, 60_000);
});
