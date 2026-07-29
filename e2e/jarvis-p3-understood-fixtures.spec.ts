import { test, expect } from "@playwright/test"
import { mkdirSync } from "node:fs"

// Plan v3 P3 exit-gate evidence — the session's own binding requires screenshots
// of the UNDERSTOOD block mid-fill AND complete, at 1440px AND 390px, into
// qa-screenshots/v3-P3/. Same labelled `?fixture=` debug harness as P2's own
// jarvis-next-golden.spec.ts (real Thread/ThreadBlocks components, fixture DATA,
// gated on NODE_ENV !== "production", visible FIXTURE chip) — a live, timing-
// dependent mid-poll moment cannot be staged on demand, so `understood-midfill`
// (2 of 4 real context chips arrived) and `understood-complete` (all 4) stand in
// for it, per §0.2 rule 3.

const OUT_DIR = "qa-screenshots/v3-P3"

const WIDTHS = [
  { label: "1440", width: 1440, height: 900 },
  { label: "390", width: 390, height: 844 },
] as const

const STATES = ["understood-midfill", "understood-complete"] as const

test.describe("P3 — UNDERSTOOD block mid-fill / complete (labelled FIXTURE harness)", () => {
  test.setTimeout(60_000)

  for (const state of STATES) {
    for (const { label, width, height } of WIDTHS) {
      test(`fixture=${state} at ${label}px`, async ({ page, context }) => {
        test.skip(test.info().project.name !== "desktop-chromium", "viewport is set per-test; one project is enough")
        mkdirSync(OUT_DIR, { recursive: true })
        await context.clearCookies()
        await page.setViewportSize({ width, height })

        const errors: string[] = []
        page.on("console", (msg) => {
          if (msg.type() === "error") errors.push(msg.text())
        })
        page.on("pageerror", (err) => errors.push(String(err)))

        await page.goto(`/jarvis/next?fixture=${state}`, { waitUntil: "domcontentloaded" })
        await expect(page.getByText(`FIXTURE · ${state}`)).toBeVisible()
        await page.waitForTimeout(900) // let the M4 ContextGather stagger settle before capture

        await page.screenshot({ path: `${OUT_DIR}/${state}-${label}.png`, fullPage: true, animations: "disabled" })
        expect(errors, `console errors on fixture=${state} at ${label}px: ${errors.join(" | ")}`).toEqual([])
      })
    }
  }
})
