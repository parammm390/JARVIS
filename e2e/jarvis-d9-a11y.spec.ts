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
