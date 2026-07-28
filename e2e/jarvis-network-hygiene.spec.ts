import { test, expect } from "@playwright/test"

// Plan v3 P1.T11 — the regression net under defect C-15.
//
// Before P1.T9, every polling lane in `lib/data-core.ts` fired on a fixed interval
// whether or not anyone was signed in: 21 requests per full cycle, all 401, roughly
// 90 requests/minute against production from a logged-out browser tab.
//
// The rule now is simple and this test enforces it: a signed-out visitor makes
// essentially no private API calls at all. The budget is fewer than 5 requests to
// the authenticated proxy surface (`/api/jarvis/*`) across a 30-second window —
// deliberately a budget rather than zero, so a single legitimate probe does not
// make the suite brittle, while anything resembling the old storm fails loudly.

const WINDOW_MS = 30_000
const MAX_PRIVATE_REQUESTS = 5

test.describe("signed-out network hygiene (C-15)", () => {
  // One 30s observation window plus page load.
  test.setTimeout(90_000)

  test("a signed-out /jarvis makes fewer than 5 private API requests in 30s", async ({ page, context }) => {
    // Guarantee "signed out": no Supabase session anywhere in this context.
    await context.clearCookies()

    const privateRequests: string[] = []
    page.on("request", (req) => {
      const url = req.url()
      if (url.includes("/api/jarvis/")) privateRequests.push(`${req.method()} ${new URL(url).pathname}`)
    })

    await page.goto("/jarvis", { waitUntil: "domcontentloaded" })
    await expect(page.locator("body")).toBeVisible()

    // Count from a clean slate AFTER load, so this measures steady-state polling —
    // the thing that actually stormed — rather than one-off boot traffic.
    privateRequests.length = 0
    await page.waitForTimeout(WINDOW_MS)

    const counts = new Map<string, number>()
    for (const r of privateRequests) counts.set(r, (counts.get(r) ?? 0) + 1)
    const breakdown = [...counts.entries()]
      .sort((a, b) => b[1] - a[1])
      .map(([path, n]) => `  ${n}x ${path}`)
      .join("\n")

    expect(
      privateRequests.length,
      `Signed-out /jarvis made ${privateRequests.length} request(s) to /api/jarvis/* in ${WINDOW_MS / 1000}s ` +
        `(budget: < ${MAX_PRIVATE_REQUESTS}). This is defect C-15 — a private lane is polling without a session.\n${breakdown}`,
    ).toBeLessThan(MAX_PRIVATE_REQUESTS)
  })

  test("a signed-out /jarvis renders no private metric as a confident zero (C-01)", async ({ page, context }) => {
    await context.clearCookies()
    await page.goto("/jarvis", { waitUntil: "domcontentloaded" })
    await expect(page.locator("body")).toBeVisible()

    // Every number rendered through `Metric` carries its own provenance. Signed out,
    // no private metric may claim to be `known` — §5.5 permits a number only for
    // known / stale / partial, and a signed-out read is `denied`.
    await page.waitForTimeout(2_000)
    const knownMetrics = await page.locator('[data-truth="known"][data-source^="api:"]').count()
    expect(
      knownMetrics,
      "A signed-out page rendered a metric marked as known from a live API source. That is defect C-01: " +
        "a 401 presented as a real number.",
    ).toBe(0)
  })
})
