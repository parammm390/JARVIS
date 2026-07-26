import { test, expect } from "@playwright/test"

// D9 regression coverage for public JARVIS. Authenticated Bridge/Map proof remains
// separately gated on a real session; this file makes the universally reachable
// keyboard and reduced-motion promises repeatable in CI.

function expectedNetworkNoise(text: string): boolean {
  return /Failed to load resource.*(401|502|503)|api\/health.*CORS policy|blocked by CORS policy.*api\/health|Failed to load resource: net::ERR_FAILED/.test(text)
}

test("command palette is keyboard reachable and Escape restores its trigger", async ({ page }) => {
  await page.goto("/jarvis")
  const trigger = page.getByPlaceholder(/what would you like me to do/i)
  await expect(trigger).toBeVisible({ timeout: 15_000 })
  await expect(page.locator("html[data-jarvis-palette-ready='true']")).toBeVisible()
  await trigger.focus()
  await page.keyboard.press("Control+k")
  const paletteInput = page.getByPlaceholder(/jump to a view or draft an instruction/i)
  await expect(paletteInput).toBeVisible()
  await expect(paletteInput).toBeFocused()
  await page.keyboard.press("Escape")
  await expect(paletteInput).toBeHidden()
  await expect(trigger).toBeFocused()
})

test("reduced motion renders without hydration or unexpected console errors", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" })
  const unexpected: string[] = []
  page.on("console", (message) => {
    if (message.type() === "error" && !expectedNetworkNoise(message.text())) unexpected.push(message.text())
  })
  page.on("pageerror", (error) => unexpected.push(error.message))

  await page.goto("/jarvis")
  await expect(page.getByPlaceholder(/what would you like me to do/i)).toBeVisible({ timeout: 15_000 })
  await expect(page.locator(".jarvis-gridfloor")).toHaveCSS("animation-duration", "0s")
  expect(unexpected).toEqual([])
})

test("primary console settles without unexpected layout shift", async ({ page }) => {
  await page.addInitScript(() => {
    type ShiftSource = { node?: Node | null }
    type LayoutShift = PerformanceEntry & {
      value: number
      hadRecentInput: boolean
      sources?: ShiftSource[]
    }
    const target = window as typeof window & {
      __jarvisD9Cls?: number
      __jarvisD9Shifts?: Array<{ value: number; sources: string[] }>
    }
    target.__jarvisD9Cls = 0
    target.__jarvisD9Shifts = []
    new PerformanceObserver((list) => {
      for (const entry of list.getEntries() as PerformanceEntryList) {
        const shift = entry as LayoutShift
        if (!shift.hadRecentInput) {
          target.__jarvisD9Cls! += shift.value
          target.__jarvisD9Shifts!.push({
            value: shift.value,
            sources: (shift.sources ?? []).map(({ node }) => {
              if (!(node instanceof HTMLElement)) return "unknown"
              const id = node.id ? `#${node.id}` : ""
              const classes = [...node.classList].slice(0, 3).map((name) => `.${name}`).join("")
              const label = node.getAttribute("aria-label")
              return `${node.tagName.toLowerCase()}${id}${classes}${label ? `[aria-label=${label}]` : ""}`
            }),
          })
        }
      }
    }).observe({ type: "layout-shift", buffered: true })
  })

  await page.goto("/jarvis")
  await expect(page.getByPlaceholder(/what would you like me to do/i)).toBeVisible({ timeout: 15_000 })
  await page.waitForTimeout(3_000)
  const result = await page.evaluate(() => {
    const target = window as typeof window & {
      __jarvisD9Cls?: number
      __jarvisD9Shifts?: Array<{ value: number; sources: string[] }>
    }
    return { cls: target.__jarvisD9Cls, shifts: target.__jarvisD9Shifts }
  })
  expect(result.cls, JSON.stringify(result.shifts)).toBe(0)
})
