import { defineConfig, devices } from "@playwright/test"

// Phase 7 MAESTRO PACK §7.10 — run against local/staging in CI, per the pack's own
// wording. Defaults to spinning up `next dev` locally (no external dependency needed
// to run these); set PLAYWRIGHT_BASE_URL to point at a deployed staging/prod URL
// instead (skips the local webServer).
const baseURL = process.env.PLAYWRIGHT_BASE_URL ?? "http://localhost:3000"

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: [["html", { open: "never" }]],
  use: {
    baseURL,
    trace: "on-first-retry",
    screenshot: "only-on-failure",
  },
  projects: [
    { name: "desktop-chromium", use: { ...devices["Desktop Chrome"] } },
    // Phase 7 §7.9/§7.10: the technician visit-report flow must work at 375px.
    // Chromium, not the iPhone SE preset's default WebKit engine — keeps this
    // runnable without a second ~200MB browser download; the viewport is what matters.
    { name: "mobile-375", use: { viewport: { width: 375, height: 812 }, browserName: "chromium" } },
  ],
  webServer: process.env.PLAYWRIGHT_BASE_URL
    ? undefined
    : {
        command: "npm run dev",
        url: "http://localhost:3000",
        reuseExistingServer: !process.env.CI,
        timeout: 120_000,
      },
})
