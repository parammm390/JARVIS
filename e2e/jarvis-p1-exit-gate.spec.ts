import { mkdirSync, writeFileSync } from "node:fs"
import { expect, test, type Page } from "@playwright/test"

// P1.T5 — final Home craft/responsive audit. These are the same source-labelled
// fixture projections used by P1.T3/T4; this test never creates tenant data or
// treats a fixture as authenticated product state.

const OUT_DIR = "evidence/jarvis-p1-t5-v6"
const VIEWPORTS = [
  { name: "desktop", width: 1440, height: 1000 },
  { name: "tablet", width: 768, height: 1024 },
  { name: "mobile", width: 390, height: 844 },
] as const

const SCENES = [
  { fixture: "rest", scene: "ready", dominant: "presence" },
  { fixture: "listening", scene: "listening", dominant: "dock" },
  { fixture: "plan", scene: "plan", dominant: "thread" },
  { fixture: "approval", scene: "approval", dominant: "approval" },
  { fixture: "execution", scene: "working", dominant: "weave" },
  { fixture: "receipt", scene: "outcome", dominant: "receipt" },
  { fixture: "recovery", scene: "recovery", dominant: "recovery" },
] as const

type HomeSnapshot = {
  viewport: number
  fixture: string
  scene: string | null
  mode: string | null
  dominant: string | null
  scrollWidth: number
  scrollHeight: number
  primaryStatuses: Array<{ text: string; visible: boolean }>
  nowGroups: number
  nowRows: number
  operationsFloorCount: number
  businessPulseCount: number
  approvalCockpitCount: number
  approvalFocusInsideDialog: boolean
  minCraftFontSize: number | null
  untrustedCurrencyNodes: string[]
  rawNowRailCopy: string[]
  infiniteRestAnimations: string[]
}

function unexpectedErrors(errors: string[]) {
  return errors.filter((message) => !message.includes("Failed to load resource: the server responded with a status of 401 (Unauthorized)"))
}

async function readSnapshot(page: Page, viewport: number, fixture: string): Promise<HomeSnapshot> {
  return page.evaluate(({ viewport: currentViewport, fixture: currentFixture }) => {
    const root = document.querySelector<HTMLElement>("[data-jarvis-thread]")
    const visible = (element: Element | null) => {
      if (!element) return false
      const style = getComputedStyle(element)
      const rect = element.getBoundingClientRect()
      return style.display !== "none" && style.visibility !== "hidden" && Number(style.opacity) > 0 && rect.width > 0 && rect.height > 0
    }
    const fontSizes = [
      "[data-jarvis-setup-rail] .j-fs-micro",
      ".jarvis-ops-rail__heading",
      ".jarvis-ops-list__title",
      ".jarvis-ops-list__detail",
      ".jarvis-orb-readout__eyebrow",
      ".jarvis-orb-readout__satellite",
      ".jarvis-orb-readout__intent > span",
      ".jarvis-orb-readout__state strong",
      ".jarvis-business-pulse__title",
      ".jarvis-business-pulse__note",
    ]
      .map((selector) => document.querySelector(selector))
      .filter(visible)
      .map((element) => Number.parseFloat(getComputedStyle(element!).fontSize))
      .filter((size) => Number.isFinite(size))

    const untrustedCurrencyNodes = [...document.querySelectorAll<HTMLElement>('[data-truth]')]
      .filter((element) => visible(element))
      .filter((element) => !["known", "stale", "partial"].includes(element.dataset.truth ?? ""))
      .map((element) => element.textContent?.replace(/\s+/g, " ").trim() ?? "")
      .filter((text) => /\$\s?\d/.test(text))

    const restAnimations = [...document.querySelectorAll<HTMLElement>('[data-jarvis-ambient-orb] *')]
      .map((element) => {
        const style = getComputedStyle(element)
        return { name: style.animationName, iteration: style.animationIterationCount }
      })
      .filter(({ name, iteration }) => name !== "none" && iteration === "infinite")
      .map(({ name }) => name)

    return {
      viewport: currentViewport,
      fixture: currentFixture,
      scene: root?.dataset.commandCanvasScene ?? null,
      mode: root?.dataset.liveframeMode ?? null,
      dominant: root?.dataset.sceneDominant ?? null,
      scrollWidth: document.documentElement.scrollWidth,
      scrollHeight: document.documentElement.scrollHeight,
      primaryStatuses: [...document.querySelectorAll<HTMLElement>("[data-primary-status]")].map((element) => ({
        text: element.textContent?.replace(/\s+/g, " ").trim() ?? "",
        visible: visible(element),
      })),
      nowGroups: document.querySelectorAll("[data-jarvis-now-rail] [data-now-group]").length,
      nowRows: document.querySelectorAll("[data-jarvis-now-rail] .jarvis-ops-list__item").length,
      operationsFloorCount: document.querySelectorAll("[data-jarvis-operation-floor]").length,
      businessPulseCount: document.querySelectorAll("[data-jarvis-business-pulse]").length,
      approvalCockpitCount: document.querySelectorAll("[data-jarvis-approval-cockpit]").length,
      approvalFocusInsideDialog: root?.dataset.commandCanvasScene === "approval"
        ? Boolean(document.activeElement?.closest('[role="dialog"]'))
        : false,
      minCraftFontSize: fontSizes.length > 0 ? Math.min(...fontSizes) : null,
      untrustedCurrencyNodes,
      rawNowRailCopy: [...document.querySelectorAll<HTMLElement>("[data-jarvis-now-rail] .jarvis-ops-list__title, [data-jarvis-now-rail] .jarvis-ops-list__detail")]
        .map((element) => element.textContent?.replace(/\s+/g, " ").trim() ?? "")
        .filter((text) => /[_{}[\]]/.test(text)),
      infiniteRestAnimations: root?.dataset.commandCanvasScene === "ready" ? restAnimations : [],
    }
  }, { viewport, fixture })
}

test.describe("P1.T5 — Home craft + responsive exit gate", () => {
  test.setTimeout(120_000)

  test("H0–H6 stay truthful, composed, responsive, and keyboard-safe", async ({ page, context }) => {
    test.skip(test.info().project.name !== "desktop-chromium", "explicit 1440/768/390 viewport audit")
    await context.clearCookies()
    mkdirSync(OUT_DIR, { recursive: true })

    const errors: string[] = []
    page.on("console", (message) => {
      if (message.type() === "error") {
        errors.push(message.text())
        console.log(`[P1.T5 browser console] ${message.text()}`)
      }
    })
    page.on("pageerror", (error) => {
      errors.push(error.message)
      console.log(`[P1.T5 page error] ${error.message}`)
    })

    const snapshots: HomeSnapshot[] = []
    for (const viewport of VIEWPORTS) {
      for (const expected of SCENES) {
        await page.setViewportSize({ width: viewport.width, height: viewport.height })
        await page.emulateMedia({ reducedMotion: "no-preference" })
        // The dev-only fixture is dynamically imported after the route shell;
        // commit lets the assertion wait on the actual hydrated source marker
        // instead of coupling the gate to dev-server document timing.
        await page.goto(`/jarvis/next?fixture=${expected.fixture}`, { waitUntil: "commit" })
        console.log(`[P1.T5 probe] fixture=${expected.fixture} url=${page.url()} ready=${await page.evaluate(() => document.readyState)} body=${(await page.locator("body").innerText()).slice(0,120)}`)
        await expect(page.locator("[data-jarvis-thread][data-source='fixture']")).toBeVisible({ timeout: 30_000 })
        await expect(page.locator("[data-jarvis-thread][data-command-canvas-scene]")).toHaveAttribute("data-command-canvas-scene", expected.scene)
        if (expected.scene === "approval") {
          await expect(page.getByRole("dialog", { name: /needs your approval/i })).toBeVisible()
        } else {
          await page.waitForTimeout(220)
        }

        const snapshot = await readSnapshot(page, viewport.width, expected.fixture)
        snapshots.push(snapshot)
        expect(snapshot.scene).toBe(expected.scene)
        expect(snapshot.dominant).toBe(expected.dominant)
        expect(snapshot.scrollWidth).toBe(viewport.width)
        // Ready/listening expose the single primary presence label. Later
        // Thread scenes express state through the active causal block instead
        // of duplicating that status as chrome.
        expect(snapshot.primaryStatuses.filter((status) => status.visible).length).toBeLessThanOrEqual(1)
        if (snapshot.minCraftFontSize !== null) expect(snapshot.minCraftFontSize).toBeGreaterThanOrEqual(11)
        expect(snapshot.untrustedCurrencyNodes).toEqual([])
        expect(snapshot.rawNowRailCopy).toEqual([])
        expect(snapshot.operationsFloorCount).toBe(0)

        if (expected.scene === "ready") {
          expect(snapshot.nowGroups).toBeLessThanOrEqual(3)
          expect(snapshot.nowRows).toBeLessThanOrEqual(3)
          // Ready deliberately suppresses the business pulse so the presence
          // surface owns attention until an observed business signal exists.
          expect(snapshot.businessPulseCount).toBe(0)
          expect(snapshot.infiniteRestAnimations).toEqual([])
        }
        if (expected.scene === "approval") {
          expect(snapshot.approvalCockpitCount).toBe(1)
          expect(snapshot.approvalFocusInsideDialog).toBe(true)
        }

        await page.screenshot({ path: `${OUT_DIR}/${expected.fixture}-${viewport.width}x${viewport.height}.png`, fullPage: true })
      }
    }

    await page.setViewportSize({ width: 390, height: 844 })
    await page.emulateMedia({ reducedMotion: "reduce" })
    await page.goto("/jarvis/next?fixture=approval", { waitUntil: "commit" })
    await expect(page.locator("[data-jarvis-thread][data-command-canvas-scene='approval']")).toBeVisible()
    await expect(page.getByRole("dialog", { name: /needs your approval/i })).toBeVisible()
    const reducedApproval = await readSnapshot(page, 390, "approval-reduced")
    expect(reducedApproval.scrollWidth).toBe(390)
    expect(reducedApproval.primaryStatuses.filter((status) => status.visible).length).toBeLessThanOrEqual(1)
    expect(reducedApproval.approvalFocusInsideDialog).toBe(true)
    await page.screenshot({ path: `${OUT_DIR}/approval-390x844-reduced.png`, fullPage: true })

    expect(unexpectedErrors(errors)).toEqual([])
    writeFileSync(`${OUT_DIR}/after-metrics.json`, JSON.stringify({ snapshots, reducedApproval, unexpectedErrors: unexpectedErrors(errors) }, null, 2))
  })
})
