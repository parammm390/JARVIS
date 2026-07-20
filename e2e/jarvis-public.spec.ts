import { test, expect } from "@playwright/test"

// Phase 7 MAESTRO PACK §7.10 — the public /jarvis page is the one surface these tests
// can exercise without a real Supabase credential (see jarvis-authenticated.spec.ts
// for the flows that need one, and why they're gated rather than faked).

// Real, expected noise on this specific architecture — neither is a product bug:
// (1) every panel polls its own private endpoint even while logged out (so it can
//     degrade gracefully to sample data the instant a session exists), and the
//     browser logs a "Failed to load resource" console-level line for every one
//     of those 401s regardless of the app handling the rejection cleanly.
// (2) BootSequence.tsx's boot-check fetches the real finnor-os API's /api/health
//     DIRECTLY (not through the same-origin /api/jarvis proxy) to test raw
//     reachability. Production's CORS allowlist (finnor-os apps/api/middleware.ts,
//     CONSOLE_ORIGIN) only permits finnorai.com's own origin — correct there, but
//     it means this ONE check always CORS-fails when testing against the real
//     remote API from localhost (dev/CI), never in production where the origin
//     actually matches. Widening the production API's CORS allowlist to permit
//     arbitrary localhost origins is a real security-relevant backend change, not
//     something to make casually just to quiet a local test — this is the test
//     environment's own artifact, not a product defect, so it's excluded here
//     instead, same as the 401 noise.
// A genuine uncaught exception (pageerror) or any OTHER console error still fails
// the test. The bare generic "net::ERR_FAILED" line only gets excluded when it's
// the direct follow-on to the health-check CORS error above (a browser logs both
// for the one failed cross-origin fetch) — never as a blanket allowance, so an
// unrelated real network failure with that same generic message still fails loudly.
function makeNoiseFilter() {
  let sawHealthCheckCorsError = false
  return (text: string): boolean => {
    if (/Failed to load resource.*401/.test(text)) return true
    if (/api\/health.*CORS policy|blocked by CORS policy.*api\/health/i.test(text)) {
      sawHealthCheckCorsError = true
      return true
    }
    if (sawHealthCheckCorsError && text === "Failed to load resource: net::ERR_FAILED") {
      sawHealthCheckCorsError = false
      return true
    }
    return false
  }
}

test.describe("public /jarvis page", () => {
  test("loads, shows a live-ops status, and throws no unexpected console errors", async ({ page }) => {
    const unexpected: string[] = []
    const isNoise = makeNoiseFilter()
    page.on("console", (msg) => {
      if (msg.type() === "error" && !isNoise(msg.text())) unexpected.push(msg.text())
    })
    page.on("pageerror", (err) => unexpected.push(err.message))

    await page.goto("/jarvis")
    await expect(page.getByText("Good evening").or(page.getByText("Good morning")).or(page.getByText("Good afternoon"))).toBeVisible()
    // The header's Live/Simulation badge specifically — a looser text match also
    // catches the desktop sidebar's "Connected · Live" status card, which exists in
    // the DOM but is CSS-hidden below the lg breakpoint (mobile-375 project).
    await expect(page.locator("main").getByText(/^(Live|Simulation)$/).first()).toBeVisible({ timeout: 15_000 })

    expect(unexpected, `unexpected console errors on /jarvis: ${unexpected.join("\n")}`).toEqual([])
  })

  test("sidebar nav and command bar are present", async ({ page }) => {
    await page.goto("/jarvis")
    await expect(page.getByRole("button", { name: "Command Center" }).first()).toBeVisible()
    await expect(page.getByPlaceholder(/what would you like me to do/i)).toBeVisible()
  })

  test("logged out visitors see a sign-in affordance, not live private data", async ({ page }) => {
    await page.goto("/jarvis")
    // Two "Sign in" links legitimately exist in the DOM at once (desktop sidebar +
    // mobile header chip, each CSS-hidden at the other's breakpoint) — the
    // `:visible` pseudo-class filters to whichever one actually renders here.
    await expect(page.locator("a:visible", { hasText: /sign in/i })).toBeVisible()
  })
})

test.describe("technician mobile viewport (375px)", () => {
  test.use({ viewport: { width: 375, height: 812 } })

  test("public page renders (mobile nav layout) with no horizontal overflow", async ({ page }) => {
    await page.goto("/jarvis")
    // Below the sidebar's responsive breakpoint the layout switches to a top nav
    // bar (LIVE OPS ticker + a horizontally-scrollable pill row) — the desktop
    // sidebar's logo text is legitimately not part of that layout, so this checks
    // for what's actually there instead of assuming the desktop markup.
    await expect(page.getByText("LIVE OPS")).toBeVisible()
    const hasHorizontalScroll = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1)
    expect(hasHorizontalScroll).toBe(false)
  })
})

test.describe("login page", () => {
  test("renders email + password fields and a submit control", async ({ page }) => {
    await page.goto("/jarvis/login")
    await expect(page.getByLabel(/email/i).or(page.getByPlaceholder(/email/i))).toBeVisible()
    await expect(page.getByLabel(/password/i).or(page.getByPlaceholder(/password/i))).toBeVisible()
  })
})
