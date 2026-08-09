import { mkdirSync, writeFileSync } from "node:fs"
import { chromium } from "playwright"

const baseURL = process.env.PLAYWRIGHT_BASE_URL ?? "http://127.0.0.1:3102"
const outputPath = "evidence/jarvis-p4-t4-v6/cold-performance.json"
const samplesPerViewport = 5
const viewports = [
  { label: "desktop", width: 1440, height: 900 },
  { label: "mobile", width: 390, height: 844 },
]

function expectedConsoleMessage(message) {
  return message.includes("401 (Unauthorized)") || message.includes("Failed to load resource")
}

async function collectSample(viewport, sample) {
  const browser = await chromium.launch({ headless: true })
  const context = await browser.newContext({ viewport: { width: viewport.width, height: viewport.height } })
  const page = await context.newPage()
  const consoleErrors = []
  const pageErrors = []
  page.on("console", (message) => { if (message.type() === "error") consoleErrors.push(message.text()) })
  page.on("pageerror", (error) => pageErrors.push(error.message))
  await page.addInitScript(() => {
    const state = window
    state.__jarvisP4Cls = 0
    if (!("PerformanceObserver" in window)) return
    try {
      const observer = new PerformanceObserver((list) => {
        for (const entry of list.getEntries()) {
          if (!entry.hadRecentInput) state.__jarvisP4Cls += entry.value || 0
        }
      })
      observer.observe({ type: "layout-shift", buffered: true })
    } catch {
      // The result records zero only when this browser does not expose CLS entries.
    }
  })
  const response = await page.goto(`${baseURL}/jarvis`, { waitUntil: "load" })
  await page.waitForTimeout(700)
  const metrics = await page.evaluate(() => {
    const navigation = performance.getEntriesByType("navigation")[0]
    const scripts = performance.getEntriesByType("resource").filter((entry) => entry.name.includes("/_next/") && entry.name.endsWith(".js"))
    return {
      dclMs: navigation?.domContentLoadedEventEnd ?? 0,
      loadMs: navigation?.loadEventEnd ?? 0,
      responseStartMs: navigation?.responseStart ?? 0,
      jsTransferBytes: scripts.reduce((sum, entry) => sum + (entry.transferSize || 0), 0),
      jsEncodedBytes: scripts.reduce((sum, entry) => sum + (entry.encodedBodySize || 0), 0),
      jsResourceCount: scripts.length,
      cls: window.__jarvisP4Cls || 0,
      scrollWidth: document.documentElement.scrollWidth,
      clientWidth: document.documentElement.clientWidth,
      bodyWidth: document.body.scrollWidth,
      title: document.title,
    }
  })
  const result = {
    viewport: viewport.label,
    width: viewport.width,
    height: viewport.height,
    sample,
    status: response?.status() ?? 0,
    ...metrics,
    unexpectedConsoleErrors: consoleErrors.filter((message) => !expectedConsoleMessage(message)),
    pageErrors,
  }
  await context.close()
  await browser.close()
  return result
}

const samples = []
for (const viewport of viewports) {
  for (let sample = 1; sample <= samplesPerViewport; sample += 1) {
    samples.push(await collectSample(viewport, sample))
  }
}

function median(values) {
  const sorted = [...values].sort((a, b) => a - b)
  return sorted[Math.floor(sorted.length / 2)] ?? 0
}

const summaries = viewports.map((viewport) => {
  const current = samples.filter((sample) => sample.viewport === viewport.label)
  return {
    viewport: viewport.label,
    samples: current.length,
    medianDclMs: median(current.map((sample) => sample.dclMs)),
    medianLoadMs: median(current.map((sample) => sample.loadMs)),
    worstLoadMs: Math.max(...current.map((sample) => sample.loadMs)),
    maxJsEncodedBytes: Math.max(...current.map((sample) => sample.jsEncodedBytes)),
    maxJsTransferBytes: Math.max(...current.map((sample) => sample.jsTransferBytes)),
    maxCls: Math.max(...current.map((sample) => sample.cls)),
    noOverflow: current.every((sample) => sample.scrollWidth <= sample.width && sample.bodyWidth <= sample.width),
    noUnexpectedErrors: current.every((sample) => sample.unexpectedConsoleErrors.length === 0 && sample.pageErrors.length === 0),
  }
})

mkdirSync("evidence/jarvis-p4-t4-v6", { recursive: true })
writeFileSync(outputPath, JSON.stringify({
  task: "P4.T4",
  route: "/jarvis",
  baseURL,
  coldSampleDefinition: "fresh Chromium browser + fresh context per sample; wait 700ms after load",
  lighthouse: "BLOCKED-ENV — npx lighthouse@11 did not resolve a sample within the bounded attempt; no Lighthouse score claimed",
  samples,
  summaries,
}, null, 2))
console.log(JSON.stringify({ outputPath, samples: samples.length, summaries }))
