import { mkdirSync, writeFileSync } from "node:fs"
import { chromium } from "playwright"

const baseURL = process.env.PLAYWRIGHT_BASE_URL ?? "https://finnorai.com"
const outputDir = "evidence/jarvis-p4-t5-v6"
const routes = [
  { name: "home", path: "/jarvis", marker: "main" },
  { name: "work", path: "/jarvis/work", marker: "[data-jarvis-work]" },
  { name: "customers", path: "/jarvis/customers", marker: "[data-jarvis-household-360]" },
  { name: "schedule", path: "/jarvis/schedule", marker: "[data-jarvis-dispatch-field]" },
  { name: "money", path: "/jarvis/money", marker: "[data-jarvis-cash-pressure]" },
  { name: "agents", path: "/jarvis/agents", marker: "[data-jarvis-agent-fleet]" },
]
const viewports = [
  { label: "1440", width: 1440, height: 900 },
  { label: "768", width: 768, height: 900 },
  { label: "390", width: 390, height: 844 },
]

function expectedConsoleMessage(message) {
  return message.includes("401 (Unauthorized)") || message.includes("Failed to load resource")
}

mkdirSync(outputDir, { recursive: true })
const results = []
for (const viewport of viewports) {
  for (const route of routes) {
    // Isolate each production route so an in-flight Next Link prefetch from a
    // previous route cannot be misreported as a live console defect.
    const browser = await chromium.launch({ headless: true })
    const context = await browser.newContext({ viewport: { width: viewport.width, height: viewport.height } })
    const page = await context.newPage()
    try {
      const consoleErrors = []
      const pageErrors = []
      page.on("console", (message) => { if (message.type() === "error") consoleErrors.push(message.text()) })
      page.on("pageerror", (error) => pageErrors.push(error.message))
      const firstResponse = await page.goto(`${baseURL}${route.path}`, { waitUntil: "domcontentloaded" })
      await page.locator(route.marker).first().waitFor({ state: "visible", timeout: 30_000 })
      // Give the first render's route prefetches a realistic settle window
      // before exercising the explicit hard-reload path. Immediate reloads
      // abort an otherwise healthy RSC request and surface a misleading
      // client fallback warning in Chromium.
      await page.waitForTimeout(1500)
      const reloadResponse = await page.reload({ waitUntil: "load" })
      await page.locator(route.marker).first().waitFor({ state: "visible", timeout: 30_000 })
      // Let Next Link prefetches settle before closing the page; otherwise a
      // test teardown can report an aborted RSC fetch as a product console error.
      await page.waitForTimeout(4000)
      const metrics = await page.evaluate(() => ({
        scrollWidth: document.documentElement.scrollWidth,
        clientWidth: document.documentElement.clientWidth,
        bodyWidth: document.body.scrollWidth,
        title: document.title,
        textSample: document.body.innerText.slice(0, 180),
      }))
      const result = {
        route: route.path,
        viewport: viewport.label,
        firstStatus: firstResponse?.status() ?? 0,
        reloadStatus: reloadResponse?.status() ?? 0,
        ...metrics,
        overflow: metrics.scrollWidth > viewport.width || metrics.bodyWidth > viewport.width,
        unexpectedConsoleErrors: consoleErrors.filter((message) => !expectedConsoleMessage(message)),
        pageErrors,
      }
      results.push(result)
      if (viewport.label === "1440" || (viewport.label === "390" && route.name === "work")) {
        await page.screenshot({ path: `${outputDir}/${route.name}-${viewport.label}.png`, fullPage: true })
      }
    } finally {
      await context.close()
      await browser.close()
    }
  }
}

const summary = {
  baseURL,
  deploymentSmoke: "hard reload",
  routes: results.length,
  allFirstStatus200: results.every((result) => result.firstStatus === 200),
  allReloadStatus200: results.every((result) => result.reloadStatus === 200),
  noOverflow: results.every((result) => !result.overflow),
  noUnexpectedErrors: results.every((result) => result.unexpectedConsoleErrors.length === 0 && result.pageErrors.length === 0),
  unauthenticatedBoundaryHonest: results.some((result) => result.route === "/jarvis/work" && /Sign in|unavailable/i.test(result.textSample)),
}
writeFileSync(`${outputDir}/live-smoke.json`, JSON.stringify({ task: "P4.T5", generatedAt: new Date().toISOString(), summary, results }, null, 2))
console.log(JSON.stringify({ outputDir, summary }))
