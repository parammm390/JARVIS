import { mkdirSync, writeFileSync } from "node:fs"
import { expect, test, type Page } from "@playwright/test"

// P3.T2 — source-bound Agent Fleet geometry. The public route may not have a tenant
// session, so this audit proves the safe manifest/unknown-status composition and does
// not manufacture calls, Work, customers, health, or outcomes.

const OUT_DIR = "evidence/jarvis-p3-t2-v6"
const VIEWPORTS = [
  { name: "desktop", width: 1440, height: 1000 },
  { name: "tablet", width: 768, height: 1024 },
  { name: "mobile", width: 390, height: 844 },
] as const

type FleetSnapshot = {
  viewport: number
  rows: number
  selectedRows: number
  statusText: string
  providerScope: string
  inspectorCount: number
  scrollWidth: number
  layoutColumns: string
  sourceLabels: string[]
}

async function readSnapshot(page: Page, viewport: number): Promise<FleetSnapshot> {
  return page.evaluate((currentViewport) => {
    const layout = document.querySelector<HTMLElement>("[data-jarvis-agent-fleet] .jarvis-agent-fleet__layout")
    return {
      viewport: currentViewport,
      rows: document.querySelectorAll("[data-agent-fleet-rail] [data-agent-key]").length,
      selectedRows: document.querySelectorAll("[data-agent-fleet-rail] [data-selected='true']").length,
      statusText: document.querySelector(".jarvis-calling-agents")?.textContent?.replace(/\s+/g, " ").trim() ?? "",
      providerScope: document.querySelector(".jarvis-agent-fleet__provider-scope")?.textContent?.replace(/\s+/g, " ").trim() ?? "",
      inspectorCount: document.querySelectorAll("[data-agent-fleet-inspector]").length,
      scrollWidth: document.documentElement.scrollWidth,
      layoutColumns: layout ? getComputedStyle(layout).gridTemplateColumns : "",
      sourceLabels: [...document.querySelectorAll<HTMLElement>("[data-source]")].map((node) => node.dataset.source ?? ""),
    }
  }, viewport)
}

function unexpectedErrors(errors: string[]) {
  return errors.filter((message) => !message.includes("Failed to load resource: the server responded with a status of 401 (Unauthorized)"))
}

test.describe("P3.T2 — Agent Fleet source-bound responsive audit", () => {
  test.setTimeout(120_000)

  test("renders five channels as a fleet with honest status at 1440/768/390", async ({ page, context }) => {
    test.skip(test.info().project.name !== "desktop-chromium", "explicit 1440/768/390 viewport audit")
    await context.clearCookies()
    mkdirSync(OUT_DIR, { recursive: true })

    const errors: string[] = []
    page.on("console", (message) => { if (message.type() === "error") errors.push(message.text()) })
    page.on("pageerror", (error) => errors.push(error.message))
    const snapshots: FleetSnapshot[] = []

    for (const viewport of VIEWPORTS) {
      await page.setViewportSize({ width: viewport.width, height: viewport.height })
      await page.goto("/jarvis/agents", { waitUntil: "domcontentloaded" })
      await expect(page.locator("[data-jarvis-agent-fleet]")).toBeVisible()
      await expect(page.locator("[data-agent-fleet-rail] [data-agent-key]")).toHaveCount(9)
      await expect(page.locator(".jarvis-calling-agents")).toContainText("Assistant status unavailable")

      const snapshot = await readSnapshot(page, viewport.width)
      snapshots.push(snapshot)
      expect(snapshot.rows).toBe(9)
      expect(snapshot.selectedRows).toBe(1)
      expect(snapshot.inspectorCount).toBe(0)
      expect(snapshot.statusText).toContain("Assistant status unavailable")
      expect(snapshot.providerScope).toContain("not agent readiness")
      expect(snapshot.scrollWidth).toBe(viewport.width)
      expect(snapshot.sourceLabels).toContain("registered-action-contracts")
      expect(snapshot.sourceLabels).toContain("api:integrations-status")
      await page.screenshot({ path: `${OUT_DIR}/fleet-${viewport.width}x${viewport.height}.png`, fullPage: true })
    }

    expect(unexpectedErrors(errors)).toEqual([])
    writeFileSync(`${OUT_DIR}/after-metrics.json`, JSON.stringify({ snapshots, unexpectedErrors: unexpectedErrors(errors) }, null, 2))
  })
})
