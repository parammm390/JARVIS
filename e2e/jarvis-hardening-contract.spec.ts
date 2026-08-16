import { expect, test } from "@playwright/test";

// Exact prompts supplied for this regression track. The browser boundary must not
// silently accept either prompt without an authenticated tenant context.
const RESEARCH_PROMPT = "Find competitors in Florida around my age, doing better/worse than us, in the $5M–$15M bracket.";
const OPERATIONAL_PROMPT = "Tell me all details of our work/appointments for tomorrow.";

test.describe("JARVIS hardening browser boundary", () => {
  test("keeps exact research and operational prompts behind authentication", async ({ request }) => {
    for (const instruction of [RESEARCH_PROMPT, OPERATIONAL_PROMPT]) {
      const response = await request.post("/api/jarvis/actions", {
        data: { instruction, channel: "text" },
      });
      const body = await response.json().catch(() => ({}));
      expect(response.status(), `unauthenticated prompt: ${instruction}; body: ${JSON.stringify(body)}`).toBe(401);
      expect(body.error).toBe("Sign in required");
    }
  });

  test("keeps the lifecycle stream behind authentication rather than exposing backend event state", async ({ request }) => {
    const response = await request.get("/api/jarvis/stream?instructionId=00000000-0000-4000-8000-000000000000");
    const body = await response.json().catch(() => ({}));
    expect(response.status()).toBe(401);
    expect(body.error).toBe("Sign in required");
  });
});
