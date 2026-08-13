import { mkdirSync } from "node:fs"
import { expect, test, type Page } from "@playwright/test"

// P1.T4 — labelled shared-component evidence. The harness advances the real
// Thread/Orb/scene tree with source-labelled fixtures; it never reaches the
// kernel or creates tenant data. Ignite and reconnect remain covered by the
// source-edge contract tests until an authenticated run/transport transition is
// available in this environment.

const OUT_DIR = "evidence/jarvis-p1-t4-v6"
const STEPS = [
  "rest",
  "listening",
  "heard",
  "understood-midfill",
  "understood-complete",
  "plan-empty",
  "plan",
  "clarify",
  "approval",
  "execution",
  "verifying",
  "receipt",
] as const

type MomentSnapshot = {
  state: string | null
  scene: string | null
  mode: string | null
  moments: string[]
  sources: string[]
  scrollWidth: number
}

async function readMoments(page: Page): Promise<MomentSnapshot> {
  return page.evaluate(() => ({
    state: document.querySelector("[data-fixture-journey-state]")?.getAttribute("data-fixture-journey-state") ?? null,
    scene: document.querySelector("[data-command-canvas-scene]")?.getAttribute("data-command-canvas-scene") ?? null,
    mode: document.querySelector("[data-liveframe-mode]")?.getAttribute("data-liveframe-mode") ?? null,
    moments: [...document.querySelectorAll("[data-jarvis-signature-moment]")].map((node) => node.getAttribute("data-jarvis-signature-moment") ?? ""),
    sources: [...document.querySelectorAll("[data-jarvis-signature-source]")].map((node) => node.getAttribute("data-jarvis-signature-source") ?? ""),
    scrollWidth: document.documentElement.scrollWidth,
  }))
}

function unexpectedErrors(errors: string[]) {
  return errors.filter((message) => !message.includes("Failed to load resource: the server responded with a status of 401 (Unauthorized)"))
}

async function runJourney(page: Page, width: number, height: number, reducedMotion: boolean) {
  mkdirSync(OUT_DIR, { recursive: true })
  await page.setViewportSize({ width, height })
  if (reducedMotion) await page.emulateMedia({ reducedMotion: "reduce" })
  const errors: string[] = []
  page.on("console", (message) => { if (message.type() === "error") errors.push(message.text()) })
  page.on("pageerror", (error) => errors.push(error.message))

  await page.goto("/jarvis/next?fixture=signature-journey", { waitUntil: "domcontentloaded" })
  await expect(page.locator("[data-fixture-journey]")).toBeVisible()
  const state = page.locator("[data-fixture-journey-state]")
  const next = page.locator("[data-fixture-journey-next]")
  const snapshots: MomentSnapshot[] = [await readMoments(page)]

  for (let index = 1; index < STEPS.length; index += 1) {
    await next.click()
    await expect(state).toHaveAttribute("data-fixture-journey-state", STEPS[index]!)
    await page.waitForTimeout(reducedMotion ? 80 : 180)
    const snapshot = await readMoments(page)
    snapshots.push(snapshot)
    if (["listening", "understood-complete", "plan", "approval", "receipt"].includes(STEPS[index]!)) {
      await page.screenshot({ path: `${OUT_DIR}/${STEPS[index]}-${width}${reducedMotion ? "-reduced" : ""}.png`, fullPage: true })
    }
  }

  const byState = new Map(snapshots.map((snapshot) => [snapshot.state, snapshot]))
  expect(byState.get("listening")?.moments).toContain("wake")
  expect(byState.get("understood-complete")?.moments).toContain("gather")
  expect(byState.get("plan")?.moments).toContain("draw")
  expect(byState.get("approval")?.moments).toContain("clamp")
  expect(byState.get("receipt")?.moments).toContain("settle")
  expect(byState.get("approval")?.sources).toContain("instruction machine awaiting_approval")
  expect(byState.get("receipt")?.sources).toContain("instruction_events.completed · authoritative receipt")
  expect(snapshots.every((snapshot) => snapshot.scrollWidth <= width)).toBe(true)
  expect(unexpectedErrors(errors)).toEqual([])
  console.log(`[P1.T4] ${width}px reduced=${reducedMotion} snapshots=${JSON.stringify(snapshots)}`)
}

test.describe("P1.T4 — seven signature moments, labelled source edges", () => {
  test.setTimeout(60_000)

  test("wake → Gather → Draw → Clamp → Settle are deterministic at desktop", async ({ page, context }) => {
    test.skip(test.info().project.name !== "desktop-chromium", "explicit viewport fixture")
    await context.clearCookies()
    await runJourney(page, 1440, 1000, false)
  })

  test("the same signature path keeps the reduced-motion end states at mobile width", async ({ page, context }) => {
    test.skip(test.info().project.name !== "desktop-chromium", "explicit viewport fixture")
    await context.clearCookies()
    await runJourney(page, 390, 844, true)
  })

  test("restored snapshots do not replay one-shot signature entrances", async ({ page, context }) => {
    test.skip(test.info().project.name !== "desktop-chromium", "explicit viewport fixture")
    await context.clearCookies()
    for (const [fixture, moment] of [["listening", "wake"], ["plan", "draw"], ["approval", "clamp"], ["receipt", "settle"]] as const) {
      await page.goto(`/jarvis/next?fixture=${fixture}&restore=1`, { waitUntil: "domcontentloaded" })
      await expect(page.locator("[data-jarvis-thread][data-source='fixture']")).toBeVisible({ timeout: 20_000 })
      await page.waitForTimeout(350)
      expect(await page.locator(`[data-jarvis-signature-moment="${moment}"]`).count(), `${fixture} replayed ${moment}`).toBe(0)
    }
  })
})
