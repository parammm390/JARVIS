import { mkdirSync, writeFileSync } from "node:fs"
import { createRequire } from "node:module"
import { chromium } from "playwright"

const require = createRequire(import.meta.url)
const axePath = require.resolve("axe-core")
const baseURL = process.env.PLAYWRIGHT_BASE_URL ?? "http://127.0.0.1:3101"
const outputPath = "evidence/jarvis-p4-t4-v6/a11y-axe.json"
const viewports = [
  { label: "1440", width: 1440, height: 900 },
  { label: "768", width: 768, height: 900 },
  { label: "390", width: 390, height: 844 },
]
const routes = [
  { name: "home-ready", path: "/jarvis/next?fixture=rest", marker: "[data-jarvis-thread]" },
  { name: "work", path: "/jarvis/work", marker: "[data-jarvis-work]" },
  { name: "customers", path: "/jarvis/customers", marker: "[data-jarvis-household-360]" },
  { name: "schedule", path: "/jarvis/schedule", marker: "[data-jarvis-dispatch-field]" },
  { name: "money", path: "/jarvis/money", marker: "[data-jarvis-cash-pressure]" },
  { name: "agents", path: "/jarvis/agents", marker: "[data-jarvis-agent-fleet]" },
]

const browser = await chromium.launch({ headless: true })
const results = []
try {
  for (const viewport of viewports) {
    const context = await browser.newContext({ viewport: { width: viewport.width, height: viewport.height } })
    const page = await context.newPage()
    await page.emulateMedia({ reducedMotion: "reduce" })
    for (const route of routes) {
      await page.goto(`${baseURL}${route.path}`, { waitUntil: "domcontentloaded" })
      await page.locator(route.marker).waitFor({ state: "visible" })
      await page.waitForTimeout(650)
      await page.addScriptTag({ path: axePath })
      const result = await page.evaluate(async () => {
        const axeResult = await window.axe.run(document, {
          runOnly: { type: "tag", values: ["wcag2a", "wcag2aa"] },
        })
        return {
          violations: axeResult.violations.map((violation) => ({
            id: violation.id,
            impact: violation.impact,
            help: violation.help,
            nodes: violation.nodes.map((node) => ({ target: node.target, html: node.html })),
          })),
          incomplete: axeResult.incomplete.map((item) => ({ id: item.id, impact: item.impact, help: item.help })),
          passes: axeResult.passes.length,
        }
      })
      results.push({ route: route.path, viewport: viewport.label, ...result })
    }
    await context.close()
  }
} finally {
  await browser.close()
}

mkdirSync("evidence/jarvis-p4-t4-v6", { recursive: true })
writeFileSync(outputPath, JSON.stringify({
  task: "P4.T4",
  tool: "axe-core",
  baseURL,
  reducedMotion: true,
  results,
  violationCount: results.reduce((sum, result) => sum + result.violations.length, 0),
}, null, 2))
console.log(JSON.stringify({ outputPath, routes: results.length, violations: results.reduce((sum, result) => sum + result.violations.length, 0) }))
