import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import fc from "fast-check";
import { POST as esign } from "../../apps/api/app/api/webhooks/esign/route";
import { POST as ghl } from "../../apps/api/app/api/webhooks/ghl/route";
import { POST as marketing } from "../../apps/api/app/api/webhooks/marketing/route";
import { POST as payment } from "../../apps/api/app/api/webhooks/payment/route";
import { POST as vapi } from "../../apps/api/app/api/webhooks/vapi/route";

const routes = [esign, ghl, marketing, payment, vapi] as const;
const badBodies = fc.oneof(fc.string(), fc.uint8Array().map((v) => new TextDecoder().decode(v)), fc.constantFrom("", "{", "[]", "null", "not-json"));

describe("inbound webhook fuzz wall", () => {
  let inheritedAuthDevBypass: string | undefined;
  beforeEach(() => {
    // CI intentionally enables the local-only auth bypass. This test exercises
    // production webhook rejection behaviour, where that bypass must be absent.
    inheritedAuthDevBypass = process.env.AUTH_DEV_BYPASS;
    delete process.env.AUTH_DEV_BYPASS;
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    if (inheritedAuthDevBypass === undefined) delete process.env.AUTH_DEV_BYPASS;
    else process.env.AUTH_DEV_BYPASS = inheritedAuthDevBypass;
  });
  it("rejects malformed or unauthenticated payloads on every provider route without a 5xx", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("ALLOW_PLAINTEXT_ENV_SECRETS", "1");
    vi.stubEnv("STRIPE_WEBHOOK_SECRET", "test-stripe-secret");
    vi.stubEnv("MARKETING_WEBHOOK_SECRET", "test-marketing-secret");
    vi.stubEnv("VAPI_WEBHOOK_SECRET", "test-vapi-secret");
    vi.stubEnv("DOCUSIGN_WEBHOOK_SECRET", "test-docusign-secret");
    vi.stubEnv("GHL_WEBHOOK_PUBLIC_KEY", "not-a-real-public-key");
    await fc.assert(fc.asyncProperty(badBodies, async (body) => {
      for (const handler of routes) {
        const response = await handler(new Request("http://localhost/webhook", { method: "POST", body, headers: { "content-type": "application/json" } }));
        expect(response.status).toBeGreaterThanOrEqual(400);
        expect(response.status).toBeLessThan(500);
      }
    }), { numRuns: 50 });
  });
});
