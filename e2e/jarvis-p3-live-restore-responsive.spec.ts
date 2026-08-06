import { expect, test, type Page } from "@playwright/test"

// P3 exit-gate follow-up. This is a bounded authenticated read/restore check
// against an already-existing instruction. It never submits, answers,
// approves, rejects, retries, or calls an external action.
const email = process.env.TEST_OWNER_EMAIL
const password = process.env.TEST_OWNER_PASSWORD
const instructionId = process.env.P3_LIVE_INSTRUCTION_ID
const instructionText = process.env.P3_LIVE_INSTRUCTION_TEXT

type RestoreSnapshot = {
  restored: string | null
  restoredEventCount: number
  traceCount: number
  metrics: Array<{ seq: number; phase: string; stage: string; eventToPixelMs: number }>
  focus: string | null
  scrollWidth: number
  viewportWidth: number
  blocks: Array<{ key: string | null; active: string | null; entry: string | null; collapsed: string | null }>
}

async function signIn(page: Page): Promise<void> {
  await page.goto("/jarvis/login", { waitUntil: "domcontentloaded" })
  await page.getByPlaceholder(/you@example.com/i).click()
  await page.getByPlaceholder(/you@example.com/i).pressSequentially(email!, { delay: 10 })
  await page.getByPlaceholder(/•+/i).click()
  await page.getByPlaceholder(/•+/i).pressSequentially(password!, { delay: 10 })
  await expect(page.getByRole("button", { name: /sign in/i })).toBeEnabled({ timeout: 5_000 })
  await page.getByRole("button", { name: /sign in/i }).click()
  await page.waitForURL("**/jarvis", { timeout: 20_000 })
}

async function restoreAt(page: Page, width: number, height: number): Promise<RestoreSnapshot> {
  await page.setViewportSize({ width, height })
  await page.goto("/jarvis", { waitUntil: "domcontentloaded" })
  await page.evaluate(({ id, text }) => {
    window.sessionStorage.setItem(
      "jarvis.thread.active",
      JSON.stringify({
        id: "p3-responsive-restore-thread",
        sessionId: "p3-responsive-restore-session",
        instructionId: id,
        source: "typed",
        instructionText: text,
        createdAtMs: Date.now() - 5_000,
      }),
    )
  }, { id: instructionId!, text: instructionText! })
  await page.reload({ waitUntil: "domcontentloaded" })
  const documentRoot = page.locator("[data-thread-document]")
  await expect(documentRoot).toHaveAttribute("data-thread-restored", "true", { timeout: 15_000 })
  await expect(page.getByText(instructionText!, { exact: true })).toBeVisible({ timeout: 15_000 })
  return page.evaluate(() => {
    const root = document.querySelector<HTMLElement>("[data-thread-document]")
    const body = document.body
    const active = document.activeElement
    return {
      restored: root?.getAttribute("data-thread-restored") ?? null,
      restoredEventCount: Number(root?.getAttribute("data-jarvis-restored-event-count") ?? "0"),
      traceCount: Number(root?.getAttribute("data-jarvis-trace-metrics-count") ?? "0"),
      metrics: JSON.parse(root?.getAttribute("data-jarvis-trace-metrics") ?? "[]") as RestoreSnapshot["metrics"],
      focus: active?.getAttribute("aria-label") ?? active?.getAttribute("data-jarvis-clarification-input") ?? active?.tagName.toLowerCase() ?? null,
      scrollWidth: body?.scrollWidth ?? 0,
      viewportWidth: window.innerWidth,
      blocks: [...document.querySelectorAll<HTMLElement>("[data-thread-block]")].map((node) => ({
        key: node.getAttribute("data-thread-block"),
        active: node.getAttribute("data-thread-block-active"),
        entry: node.parentElement?.getAttribute("data-thread-block-entry") ?? null,
        collapsed: node.querySelector<HTMLElement>("[data-thread-block-body]")?.getAttribute("data-thread-block-body-collapsed") ?? null,
      })),
    }
  })
}

test.describe("P3 live authenticated restore at both required widths", () => {
  test.skip(!email || !password || !instructionId || !instructionText, "live restore inputs are not set")
  test.setTimeout(90_000)

  test("restores the same owner instruction without replayed entry blooms", async ({ page }) => {
    test.skip(test.info().project.name !== "desktop-chromium", "explicit viewport comparison")
    const traceResponses: string[] = []
    page.on("response", (response) => {
      if (response.url().includes(`/api/jarvis/instructions/${instructionId}`)) {
        traceResponses.push(`${response.status()} ${new URL(response.url()).pathname}`)
      }
    })
    await signIn(page)
    let desktop: RestoreSnapshot
    try {
      desktop = await restoreAt(page, 1440, 900)
    } catch (error) {
      throw new Error(`${error instanceof Error ? error.message : String(error)}; trace responses: ${traceResponses.join(" | ") || "none"}`)
    }
    const mobile = await restoreAt(page, 390, 844)

    for (const snapshot of [desktop, mobile]) {
      expect(snapshot.restored).toBe("true")
      expect(snapshot.restoredEventCount).toBeGreaterThan(0)
      expect(snapshot.traceCount).toBe(snapshot.restoredEventCount)
      expect(snapshot.scrollWidth).toBeLessThanOrEqual(snapshot.viewportWidth)
      expect(snapshot.focus).toBe("householdId")
      expect(snapshot.blocks.length).toBeGreaterThanOrEqual(3)
      expect(snapshot.blocks.every((block) => block.entry === "settled")).toBe(true)
      expect(snapshot.metrics.length).toBe(snapshot.traceCount)
      expect(snapshot.metrics.every((metric) => Number.isFinite(metric.eventToPixelMs) && metric.eventToPixelMs >= 0)).toBe(true)
    }

    console.log(`[P3.LIVE.RESTORE] ${JSON.stringify({ desktop, mobile })}`)
  })
})
