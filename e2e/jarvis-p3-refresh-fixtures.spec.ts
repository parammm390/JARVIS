import { mkdirSync } from "node:fs"
import { expect, test, type Page } from "@playwright/test"

// P3.T7 labelled fixture evidence only. The dev-only receipt fixture provides a
// settled terminal Thread snapshot; `restore=1` exercises the same settled-entry
// presentation path used by a restored live snapshot. It does not claim a live
// authenticated instruction-session restore or backend reconnect.

const OUT_DIR = "qa-screenshots/v3-P3"
const VIEWPORTS = [
  { label: "1440", width: 1440, height: 900 },
  { label: "390", width: 390, height: 844 },
] as const

type SpatialSnapshot = {
  restored: string | null
  stackRestored: string | null
  blocks: Array<{ key: string | null; state: string | null; collapsed: string | null; entry: string | null }>
  activeBlock: string | null
  receiptMotion: string | null
  receiptText: string
  historyCount: string | null
  scrollHeight: number
  scrollWidth: number
}

type RuntimeSnapshot = SpatialSnapshot & {
  settledMotionAnimations: number
  layoutShift: number
  focusedBlock: string | null
}

async function readSnapshot(page: Page): Promise<RuntimeSnapshot> {
  return page.evaluate(() => {
    const root = document.querySelector("[data-thread-document]")
    const receipt = document.querySelector("[data-thread-receipt-motion]")
    const layoutShiftEntries = performance.getEntriesByType("layout-shift") as Array<PerformanceEntry & { value?: number; hadRecentInput?: boolean }>
    const trackedLayoutShifts = ((window as unknown as { __jarvisP3T7LayoutShifts?: number[] }).__jarvisP3T7LayoutShifts ?? [])
    const settledMotionAnimations = receipt && typeof receipt.getAnimations === "function" ? receipt.getAnimations().length : 0
    return {
      restored: root?.getAttribute("data-thread-restored") ?? null,
      stackRestored: document.querySelector("[data-thread-stack-restored]")?.getAttribute("data-thread-stack-restored") ?? null,
      blocks: [...document.querySelectorAll("[data-thread-block]")].map((node) => ({
        key: node.getAttribute("data-thread-block"),
        state: node.getAttribute("data-thread-spine-state"),
        collapsed: node.getAttribute("data-thread-block-collapsed"),
        entry: node.parentElement?.getAttribute("data-thread-block-entry") ?? null,
      })),
      activeBlock: document.querySelector("[data-thread-block-active='true']")?.getAttribute("data-thread-block") ?? null,
      receiptMotion: receipt?.getAttribute("data-thread-receipt-motion") ?? null,
      receiptText: receipt?.textContent?.replace(/\s+/g, " ").trim() ?? "",
      historyCount: document.querySelector("[data-thread-history]")?.getAttribute("data-thread-history-count") ?? null,
      scrollHeight: document.documentElement.scrollHeight,
      scrollWidth: document.documentElement.scrollWidth,
      settledMotionAnimations,
      layoutShift: trackedLayoutShifts.length > 0
        ? trackedLayoutShifts.reduce((total, value) => total + value, 0)
        : layoutShiftEntries.reduce((total, entry) => total + (entry.hadRecentInput ? 0 : entry.value ?? 0), 0),
      focusedBlock: document.activeElement?.getAttribute("data-thread-block") ?? null,
    }
  })
}

function spatialSignature(snapshot: SpatialSnapshot) {
  return {
    restored: snapshot.restored,
    stackRestored: snapshot.stackRestored,
    blocks: snapshot.blocks,
    activeBlock: snapshot.activeBlock,
    receiptMotion: snapshot.receiptMotion,
    receiptText: snapshot.receiptText,
    historyCount: snapshot.historyCount,
    scrollWidth: snapshot.scrollWidth,
  }
}

async function openRestoredReceipt(page: Page, width: number, height: number, reducedMotion = false) {
  await page.setViewportSize({ width, height })
  if (reducedMotion) await page.emulateMedia({ reducedMotion: "reduce" })
  await page.addInitScript(() => {
    const metricsWindow = window as unknown as { __jarvisP3T7LayoutShifts?: number[] }
    metricsWindow.__jarvisP3T7LayoutShifts = []
    try {
      if (typeof PerformanceObserver !== "undefined" && PerformanceObserver.supportedEntryTypes?.includes("layout-shift")) {
        const observer = new PerformanceObserver((list) => {
          const shifts = metricsWindow.__jarvisP3T7LayoutShifts ?? []
          for (const entry of list.getEntries() as Array<PerformanceEntry & { value?: number; hadRecentInput?: boolean }>) {
            if (!entry.hadRecentInput && typeof entry.value === "number") shifts.push(entry.value)
          }
          metricsWindow.__jarvisP3T7LayoutShifts = shifts
        })
        observer.observe({ type: "layout-shift", buffered: true })
      }
    } catch {
      // This browser simply leaves the bounded performance-entry fallback above.
    }
  })
  await page.goto("/jarvis/next?fixture=receipt&restore=1", { waitUntil: "domcontentloaded" })
  await expect(page.getByText("FIXTURE · receipt")).toBeVisible()
  await expect(page.locator("[data-thread-document]")).toHaveAttribute("data-thread-restored", "true")
  await expect(page.locator("[data-thread-stack-restored]")).toHaveAttribute("data-thread-stack-restored", "true")
  await page.waitForTimeout(700)
}

test.describe("P3.T7 — refresh/reconnect settled-state fixture evidence", () => {
  test.setTimeout(60_000)

  for (const { label, width, height } of VIEWPORTS) {
    test(`refresh keeps the same receipt spine and no settled one-shot replay at ${label}px`, async ({ page, context }) => {
      test.skip(test.info().project.name !== "desktop-chromium", "explicit widths")
      mkdirSync(OUT_DIR, { recursive: true })
      await context.clearCookies()

      const errors: string[] = []
      const unauthorizedUrls: string[] = []
      page.on("console", (message) => { if (message.type() === "error") errors.push(message.text()) })
      page.on("pageerror", (error) => errors.push(error.message))
      page.on("response", (response) => { if (response.status() === 401) unauthorizedUrls.push(response.url()) })

      await openRestoredReceipt(page, width, height)
      const before = await readSnapshot(page)
      await page.screenshot({ path: `${OUT_DIR}/refresh-${label}-before.png`, fullPage: true })

      await page.reload({ waitUntil: "domcontentloaded" })
      await expect(page.getByText("FIXTURE · receipt")).toBeVisible()
      await expect(page.locator("[data-thread-document]")).toHaveAttribute("data-thread-restored", "true")
      await page.waitForTimeout(700)
      const after = await readSnapshot(page)
      await page.screenshot({ path: `${OUT_DIR}/refresh-${label}-after.png`, fullPage: true })
      console.log(`[P3.T7] ${label}px before=${JSON.stringify(before)} after=${JSON.stringify(after)}`)

      expect(spatialSignature(after)).toEqual(spatialSignature(before))
      expect(after.activeBlock).toBe("receipt")
      expect(after.receiptMotion).toBe("settled")
      expect(after.settledMotionAnimations).toBe(0)
      expect(after.layoutShift).toBeLessThanOrEqual(0.03)
      expect(after.scrollWidth).toBeLessThanOrEqual(width)

      const receiptHeader = page.locator("[data-thread-block='receipt'] > button")
      await receiptHeader.focus()
      await expect(receiptHeader).toBeFocused()
      await receiptHeader.press("Enter")
      await expect(page.locator("[data-thread-block='receipt']")).toHaveAttribute("data-thread-block-collapsed", "false")
      await expect(receiptHeader).toBeFocused()

      const unexpectedErrors = errors.filter((message) => !message.includes("Failed to load resource: the server responded with a status of 401 (Unauthorized)"))
      expect(unexpectedErrors, `unexpected browser errors at ${label}px: ${unexpectedErrors.join(" | ")}`).toEqual([])
      expect(unauthorizedUrls.every((url) => /^https?:\/\/[^/]+\/api\/jarvis\/receipts\?domainActionId=fixture-node-\d+$/.test(url))).toBe(true)
    })
  }

  test("reduced motion keeps the restored receipt state settled after refresh", async ({ page, context }) => {
    test.skip(test.info().project.name !== "desktop-chromium", "single reduced-motion fixture run")
    mkdirSync(OUT_DIR, { recursive: true })
    await context.clearCookies()
    await openRestoredReceipt(page, 390, 844, true)
    const before = await readSnapshot(page)
    await page.reload({ waitUntil: "domcontentloaded" })
    await expect(page.getByText("FIXTURE · receipt")).toBeVisible()
    await page.waitForTimeout(300)
    const after = await readSnapshot(page)
    await page.screenshot({ path: `${OUT_DIR}/refresh-390-reduced-after.png`, fullPage: true })
    console.log(`[P3.T7] reduced before=${JSON.stringify(before)} after=${JSON.stringify(after)}`)

    expect(spatialSignature(after)).toEqual(spatialSignature(before))
    expect(after.receiptMotion).toBe("settled")
    expect(after.settledMotionAnimations).toBe(0)
    expect(after.scrollWidth).toBeLessThanOrEqual(390)
  })
})
