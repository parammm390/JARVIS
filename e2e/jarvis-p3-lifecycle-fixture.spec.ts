import { mkdirSync } from "node:fs"
import { expect, test, type Page } from "@playwright/test"

// P3 exit-gate fixture evidence only. `fixture=journey` advances the existing
// source-labelled Thread fixtures through one same-document component tree. It
// does not call the kernel, create a tenant event, or claim live backend timing.

const OUT_DIR = "qa-screenshots/v3-P3"
const STEPS = [
  { key: "rest", label: "ready", stage: null },
  { key: "heard", label: "captured", stage: "heard" },
  { key: "understood", label: "understanding", stage: "understood" },
  { key: "plan", label: "planning", stage: "plan" },
  { key: "clarify", label: "clarifying", stage: "plan" },
  { key: "approval", label: "approval", stage: "plan" },
  { key: "execution", label: "executing", stage: "execution" },
  { key: "verifying", label: "verifying", stage: "execution" },
  { key: "receipt", label: "terminal", stage: "receipt" },
] as const

type JourneyRuntime = {
  activeBlock: string | null
  focus: string | null
  scrollY: number
  scrollHeight: number
  scrollWidth: number
  layoutShift: number
  metrics: Array<{ seq: string | null; stage: string | null; eventToPixelMs: number }>
}

async function readJourneyRuntime(page: Page): Promise<JourneyRuntime> {
  return page.evaluate(() => {
    const metricsWindow = window as unknown as { __jarvisP3JourneyLayoutShifts?: number[] }
    const layoutShiftEntries = performance.getEntriesByType("layout-shift") as Array<PerformanceEntry & { value?: number; hadRecentInput?: boolean }>
    const tracked = metricsWindow.__jarvisP3JourneyLayoutShifts ?? []
    const active = document.activeElement
    return {
      activeBlock: document.querySelector("[data-thread-block-active='true']")?.getAttribute("data-thread-block") ?? null,
      focus: active?.getAttribute("data-fixture-journey-next") === "true"
        ? "journey-next"
        : active?.getAttribute("data-jarvis-clarification-input") === "true"
          ? "clarification-input"
          : active?.getAttribute("data-thread-block") ?? active?.tagName.toLowerCase() ?? null,
      scrollY: window.scrollY,
      scrollHeight: document.documentElement.scrollHeight,
      scrollWidth: document.documentElement.scrollWidth,
      layoutShift: tracked.length > 0
        ? tracked.reduce((total, value) => total + value, 0)
        : layoutShiftEntries.reduce((total, entry) => total + (entry.hadRecentInput ? 0 : entry.value ?? 0), 0),
      metrics: [...document.querySelectorAll("[data-fixture-trace-metric]")].map((node) => ({
        seq: node.getAttribute("data-fixture-trace-metric-seq"),
        stage: node.getAttribute("data-fixture-trace-metric-stage"),
        eventToPixelMs: Number(node.getAttribute("data-fixture-trace-event-to-pixel-ms") ?? "NaN"),
      })),
    }
  })
}

async function runJourney(page: Page, width: number, height: number, reducedMotion: boolean, screenshotName: string) {
  mkdirSync(OUT_DIR, { recursive: true })
  await page.setViewportSize({ width, height })
  if (reducedMotion) await page.emulateMedia({ reducedMotion: "reduce" })
  await page.addInitScript(() => {
    const metricsWindow = window as unknown as { __jarvisP3JourneyLayoutShifts?: number[] }
    metricsWindow.__jarvisP3JourneyLayoutShifts = []
    try {
      if (typeof PerformanceObserver !== "undefined" && PerformanceObserver.supportedEntryTypes?.includes("layout-shift")) {
        const observer = new PerformanceObserver((list) => {
          const shifts = metricsWindow.__jarvisP3JourneyLayoutShifts ?? []
          for (const entry of list.getEntries() as Array<PerformanceEntry & { value?: number; hadRecentInput?: boolean }>) {
            if (!entry.hadRecentInput && typeof entry.value === "number") shifts.push(entry.value)
          }
          metricsWindow.__jarvisP3JourneyLayoutShifts = shifts
        })
        observer.observe({ type: "layout-shift", buffered: true })
      }
    } catch {
      // The bounded performance-entry fallback below remains available.
    }
  })

  const errors: string[] = []
  const unauthorizedUrls: string[] = []
  page.on("console", (message) => { if (message.type() === "error") errors.push(message.text()) })
  page.on("pageerror", (error) => errors.push(error.message))
  page.on("response", (response) => { if (response.status() === 401) unauthorizedUrls.push(response.url()) })

  await page.goto("/jarvis/next?fixture=journey", { waitUntil: "domcontentloaded" })
  await expect(page.getByText("FIXTURE · journey")).toBeVisible()
  const state = page.locator("[data-fixture-journey-state]")
  const next = page.locator("[data-fixture-journey-next]")
  expect(await state.count()).toBe(1)
  expect(await next.count()).toBe(1)
  await expect(state).toHaveAttribute("data-fixture-journey-state", "rest")

  const transcript: Array<{ step: string; activeBlock: string | null; focus: string | null; scrollY: number }> = []
  transcript.push({ step: "rest", ...(await readJourneyRuntime(page)) })
  for (let index = 1; index < STEPS.length; index += 1) {
    const expected = STEPS[index]!
    await next.click()
    await expect(state).toHaveAttribute("data-fixture-journey-state", expected.key)
    if (expected.stage) {
      const metric = page.locator(`[data-fixture-trace-metric-seq="${index}"]`)
      await expect(metric).toHaveCount(1)
    }
    if (expected.key !== "rest") await expect(page.locator("[data-thread-block-active='true']")).toHaveCount(1)
    const runtime = await readJourneyRuntime(page)
    transcript.push({ step: expected.key, activeBlock: runtime.activeBlock, focus: runtime.focus, scrollY: runtime.scrollY })
  }

  await page.waitForTimeout(250)
  const runtime = await readJourneyRuntime(page)
  const unexpectedErrors = errors.filter((message) => !message.includes("Failed to load resource: the server responded with a status of 401 (Unauthorized)"))
  expect(unexpectedErrors, `unexpected browser errors: ${unexpectedErrors.join(" | ")}`).toEqual([])
  expect(unauthorizedUrls.every((url) => /^https?:\/\/[^/]+\/api\/jarvis\/user-prefs$/.test(url) || /^https?:\/\/[^/]+\/api\/jarvis\/receipts\?domainActionId=fixture-node-\d+$/.test(url))).toBe(true)
  expect(runtime.scrollWidth).toBeLessThanOrEqual(width)
  expect(runtime.layoutShift).toBeLessThanOrEqual(0.03)
  expect(runtime.metrics).toHaveLength(8)
  expect(runtime.metrics.every((metric) => Number.isFinite(metric.eventToPixelMs) && metric.eventToPixelMs >= 0)).toBe(true)
  expect(transcript.map((entry) => entry.step)).toEqual(STEPS.map((step) => step.key))
  expect(transcript.some((entry) => entry.activeBlock === "plan")).toBe(true)
  expect(transcript.some((entry) => entry.activeBlock === "execution")).toBe(true)
  expect(transcript.at(-1)?.activeBlock).toBe("receipt")
  await page.screenshot({ path: `${OUT_DIR}/${screenshotName}`, fullPage: true })
  console.log(`[P3.EXIT] ${width}px reduced=${reducedMotion} transcript=${JSON.stringify(transcript)} runtime=${JSON.stringify(runtime)}`)
}

test.describe("P3 exit-gate same-document lifecycle, labelled fixture", () => {
  test.setTimeout(60_000)

  test("ready through terminal remains one causal document at 1440px", async ({ page, context }) => {
    test.skip(test.info().project.name !== "desktop-chromium", "explicit viewport fixture")
    await context.clearCookies()
    await runJourney(page, 1440, 900, false, "lifecycle-1440.png")
  })

  test("ready through terminal remains one causal document at 390px", async ({ page, context }) => {
    test.skip(test.info().project.name !== "desktop-chromium", "explicit viewport fixture")
    await context.clearCookies()
    await runJourney(page, 390, 844, false, "lifecycle-390.png")
  })

  test("reduced motion preserves the same lifecycle states at 390px", async ({ page, context }) => {
    test.skip(test.info().project.name !== "desktop-chromium", "explicit reduced-motion fixture")
    await context.clearCookies()
    await runJourney(page, 390, 844, true, "lifecycle-390-reduced.png")
  })
})
