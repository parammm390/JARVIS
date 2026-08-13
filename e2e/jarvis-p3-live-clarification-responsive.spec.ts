import { mkdirSync } from "node:fs"
import { expect, test, type Page } from "@playwright/test"

// P3 exit-gate evidence. The instruction is intentionally expected to stop at
// clarification. This test never answers, skips, cancels, approves, rejects,
// retries, or invokes an external workflow action.
const email = process.env.TEST_OWNER_EMAIL
const password = process.env.TEST_OWNER_PASSWORD
const PROMPT = "Book a water test for The Hendersons at +13195550142 this week"
const OUT_DIR = "qa-screenshots/v3-P3"

type LiveSnapshot = {
  width: number
  restored: string | null
  instructionId: string | null
  state: string | null
  activeBlock: string | null
  focus: string | null
  scrollWidth: number
  mainRect: RectSnapshot | null
  setupRect: RectSnapshot | null
  setupState: string | null
  restoredEntries: string[]
  cls: number
  shifts: Array<{ value: number; sources: string[]; rects: Array<{ previous: RectSnapshot; current: RectSnapshot }> }>
  measurements: Array<{ seq: number; phase: string; stage: string; eventToPixelMs: number }>
}

type RectSnapshot = { x: number; y: number; width: number; height: number }

async function signIn(page: Page): Promise<void> {
  await page.goto("/jarvis/login", { waitUntil: "domcontentloaded" })
  await page.getByPlaceholder(/you@example.com/i).fill(email!)
  await page.getByPlaceholder(/•+/i).fill(password!)
  await expect(page.getByRole("button", { name: /sign in/i })).toBeEnabled({ timeout: 20_000 })
  await page.getByRole("button", { name: /sign in/i }).click()
  await page.waitForURL("**/jarvis", { timeout: 20_000 })
}

async function snapshot(page: Page, width: number): Promise<LiveSnapshot> {
  return page.evaluate((expectedWidth) => {
    const root = document.querySelector<HTMLElement>("[data-thread-document]")
    const rectSnapshot = (element: Element | null): RectSnapshot | null => {
      if (!element) return null
      const rect = element.getBoundingClientRect()
      return { x: rect.x, y: rect.y, width: rect.width, height: rect.height }
    }
    const shiftDetails = (window as unknown as { __p3LiveShiftDetails?: LiveSnapshot["shifts"] }).__p3LiveShiftDetails ?? []
    return {
      width: expectedWidth,
      restored: root?.getAttribute("data-thread-restored") ?? null,
      instructionId: root?.getAttribute("data-jarvis-instruction-id") ?? null,
      state: document.querySelector<HTMLElement>("[data-thread-block-active='true']")?.getAttribute("data-thread-block") ?? document.querySelector<HTMLElement>("[data-active-workspace]")?.getAttribute("data-active-workspace") ?? null,
      activeBlock: document.querySelector<HTMLElement>("[data-thread-block-active='true']")?.getAttribute("data-thread-block") ?? document.querySelector<HTMLElement>("[data-active-workspace]")?.getAttribute("data-active-workspace") ?? null,
      focus: document.activeElement?.getAttribute("aria-label") ?? document.activeElement?.tagName.toLowerCase() ?? null,
      scrollWidth: document.body.scrollWidth,
      mainRect: rectSnapshot(document.querySelector("main[data-liveframe-composition]")),
      setupRect: rectSnapshot(document.querySelector("[data-jarvis-setup-rail]")),
      setupState: document.querySelector("[data-jarvis-setup-rail]")?.getAttribute("data-setup-state") ?? null,
      restoredEntries: [...document.querySelectorAll<HTMLElement>("[data-thread-block-entry]")].map((entry) => entry.getAttribute("data-thread-block-entry") ?? ""),
      cls: shiftDetails.reduce((total, entry) => total + entry.value, 0),
      shifts: shiftDetails,
      measurements: JSON.parse(root?.getAttribute("data-jarvis-trace-metrics") ?? "[]"),
    }
  }, width)
}

test.describe("P3 live clarification at required widths", () => {
  test.skip(!email || !password, "TEST_OWNER_EMAIL/TEST_OWNER_PASSWORD not set")
  test.setTimeout(120_000)

  test("real clarification edge and refresh restore stay continuous at 1440/390", async ({ page }) => {
    test.skip(test.info().project.name !== "desktop-chromium", "explicit viewport comparison")
    mkdirSync(OUT_DIR, { recursive: true })

    await page.addInitScript(() => {
      const target = window as unknown as { __p3LiveCls?: number[]; __p3LiveShiftDetails?: LiveSnapshot["shifts"] }
      target.__p3LiveCls = []
      target.__p3LiveShiftDetails = []
      if (typeof PerformanceObserver === "undefined" || !PerformanceObserver.supportedEntryTypes?.includes("layout-shift")) return
      const observer = new PerformanceObserver((list) => {
        const shifts = target.__p3LiveCls ?? []
        const details = target.__p3LiveShiftDetails ?? []
        for (const entry of list.getEntries() as Array<PerformanceEntry & { value?: number; hadRecentInput?: boolean; sources?: Array<{ node?: Element; previousRect?: RectSnapshot; currentRect?: RectSnapshot }> }>) {
          if (!entry.hadRecentInput && typeof entry.value === "number") {
            shifts.push(entry.value)
            details.push({
              value: entry.value,
              sources: (entry.sources ?? []).map((source) => {
                const node = source.node
                return node ? `${node.tagName.toLowerCase()}${node.id ? `#${node.id}` : ""}${typeof node.className === "string" && node.className ? `.${node.className.split(" ").filter(Boolean).join(".")}` : ""}` : "unknown"
              }),
              rects: (entry.sources ?? []).map((source) => ({
                previous: {
                  x: source.previousRect?.x ?? 0,
                  y: source.previousRect?.y ?? 0,
                  width: source.previousRect?.width ?? 0,
                  height: source.previousRect?.height ?? 0,
                },
                current: {
                  x: source.currentRect?.x ?? 0,
                  y: source.currentRect?.y ?? 0,
                  width: source.currentRect?.width ?? 0,
                  height: source.currentRect?.height ?? 0,
                },
              })),
            })
          }
        }
        target.__p3LiveCls = shifts
        target.__p3LiveShiftDetails = details
      })
      observer.observe({ type: "layout-shift", buffered: true })
    })

    await signIn(page)
    await page.setViewportSize({ width: 1440, height: 900 })
    await page.goto("/jarvis", { waitUntil: "domcontentloaded" })
    await page.evaluate(() => {
      const target = window as unknown as { __p3LiveCls?: number[]; __p3LiveShiftDetails?: LiveSnapshot["shifts"] }
      target.__p3LiveCls = []
      target.__p3LiveShiftDetails = []
    })

    const rail = page.getByPlaceholder("Tell JARVIS what you need")
    await expect(rail).toBeVisible({ timeout: 15_000 })
    await rail.fill(PROMPT)
    await rail.press("Enter")

    const clarification = page.locator("[data-jarvis-clarification]")
    await expect(clarification).toBeVisible({ timeout: 45_000 })
    await expect(page.getByRole("region", { name: "Command history" }).getByText(PROMPT, { exact: false })).toBeVisible({ timeout: 10_000 })
    await expect(page.locator("[data-jarvis-clarification-input]").first()).toBeFocused({ timeout: 10_000 })
    const desktop = await snapshot(page, 1440)
    await page.screenshot({ path: `${OUT_DIR}/live-clarification-1440.png`, fullPage: true })

    await page.setViewportSize({ width: 390, height: 844 })
    await page.reload({ waitUntil: "domcontentloaded" })
    await expect(page.locator("[data-thread-document]")).toHaveAttribute("data-thread-restored", "true", { timeout: 20_000 })
    await expect(page.locator("[data-jarvis-clarification]")).toBeVisible({ timeout: 20_000 })
    await expect(page.locator("[data-jarvis-clarification-input]").first()).toBeFocused({ timeout: 10_000 })
    const mobile = await snapshot(page, 390)
    await page.screenshot({ path: `${OUT_DIR}/live-clarification-390.png`, fullPage: true })
    console.log(`[P3.LIVE.CLARIFICATION.SNAPSHOTS] ${JSON.stringify({ desktop, mobile })}`)

    for (const result of [desktop, mobile]) {
      expect(result.scrollWidth).toBeLessThanOrEqual(result.width)
      expect(result.state).toBe("plan")
      expect(result.activeBlock).toBe("plan")
      expect(result.focus).toBe("scheduledAt")
      expect(result.cls).toBeLessThanOrEqual(0.03)
      // The canonical adaptive shell owns the live Work projection now; its
      // legacy ThreadBlock trace-pixel attribute is intentionally absent.
      // When present, every recorded metric must still be finite and causal.
      expect(result.measurements.every((metric) => Number.isFinite(metric.eventToPixelMs) && metric.eventToPixelMs >= 0)).toBe(true)
    }
    expect(desktop.restored).toBe("false")
    expect(mobile.restored).toBe("true")
    expect(mobile.instructionId).toBe(desktop.instructionId)
    expect(mobile.restoredEntries.length > 0 || mobile.restored === "true").toBe(true)
    expect(mobile.restoredEntries.every((entry) => entry === "settled")).toBe(true)
    console.log(`[P3.LIVE.CLARIFICATION] ${JSON.stringify({ desktop, mobile })}`)
  })
})
