import { expect, test } from "@playwright/test"

test.describe("tenant operational realtime routes", () => {
  test("fails closed before configuration and never accepts credentials in the URL", async ({ request }) => {
    const res = await request.get("/api/jarvis/operational-stream?access_token=must-not-be-read&tenantId=must-not-be-read")
    const body = await res.json().catch(() => ({}))
    expect(res.status()).toBe(401)
    expect(body).toEqual({ error: "Sign in required" })
    expect(JSON.stringify(body)).not.toContain("must-not-be-read")
  })

  for (const path of ["/api/jarvis/business-world?scene=customer", "/api/jarvis/operational-deltas"]) {
    test(`${path} is admitted by the canonical proxy before authentication`, async ({ request }) => {
      const res = await request.get(path)
      const body = await res.json().catch(() => ({}))
      expect(res.status()).toBe(401)
      expect(body.error).not.toBe("Not found")
    })
  }
})
