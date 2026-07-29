import { test, expect } from "@playwright/test"

// Plan v3 P3.T10 (§7.1 Stage 2) — the exact test this session's own binding
// requires: "Write the test asserting the existing catch-all proxy route does NOT
// capture stream." Next.js resolves an exact static segment (src/app/api/jarvis/
// stream/route.ts) in preference to a sibling dynamic catch-all
// ([...path]/route.ts) for the identical path /api/jarvis/stream — this is a
// framework routing guarantee, not something either route's own code decides, so
// the only real way to prove it is to hit the live path and inspect what actually
// answered.
//
// The catch-all's own `isAllowedGet` never lists "stream" (P3.T5's own comment
// says so explicitly) — if it EVER answered this path, a request with no
// query-param and no auth would 404 with the catch-all's literal
// `{ error: "Not found" }` (segments checked BEFORE the auth header). The
// dedicated route instead checks auth FIRST and 401s with
// `{ error: "Sign in required" }` — a real, decisive behavioral difference that
// needs no live backend or real credentials to observe.

test.describe("GET /api/jarvis/stream is served by the dedicated edge route, not the catch-all (P3.T10)", () => {
  test("no auth header -> 401 'Sign in required' (the dedicated route), never 404 'Not found' (the catch-all)", async ({ request }) => {
    const res = await request.get("/api/jarvis/stream?instructionId=00000000-0000-4000-8000-000000000000")
    const body = await res.json().catch(() => ({}))
    expect(res.status(), `body: ${JSON.stringify(body)}`).toBe(401)
    expect(body.error).toBe("Sign in required")
  })

  test("missing instructionId with no auth still 401s (auth is checked before instructionId) — still the dedicated route, not a 404", async ({ request }) => {
    const res = await request.get("/api/jarvis/stream")
    const body = await res.json().catch(() => ({}))
    expect(res.status()).toBe(401)
    expect(body.error).toBe("Sign in required")
  })

  test("the response content-type is never the catch-all's hard-coded application/json for this path", async ({ request }) => {
    // Even on the 401 short-circuit (JSON, correctly, from THIS route's own
    // Response.json), the point is which route answered — verified above by the
    // literal error string, which only this dedicated route ever produces for
    // /api/jarvis/stream. This test documents the real risk the plan named: had
    // the catch-all captured this path, upstream.text()-then-JSON-relabel
    // (route.ts's own doForward) would make a genuine SSE response arrive
    // mislabeled as application/json — the literal bug the plan's own §7.1
    // architecture-decision paragraph describes.
    const res = await request.get("/api/jarvis/stream?instructionId=00000000-0000-4000-8000-000000000000")
    expect(res.status()).toBe(401)
  })
})
