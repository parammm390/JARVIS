import { createHash } from "node:crypto";
import { mkdirSync } from "node:fs";
import { chromium } from "playwright";

const baseUrl = process.env.FINNOR_QA_URL ?? "http://127.0.0.1:3200";
const screenshotDir = process.env.FINNOR_QA_SCREENSHOT_DIR ?? "/tmp/finnor-scroll-story-qa";
mkdirSync(screenshotDir, { recursive: true });

const browser = await chromium.launch({ headless: true });
const results = [];
const errors = [];

async function verifyStory(label, viewport, { forceAccelerated = false } = {}) {
  const context = await browser.newContext({ viewport, reducedMotion: "no-preference" });
  if (forceAccelerated) {
    await context.addInitScript(() => {
      for (const type of [window.WebGLRenderingContext, window.WebGL2RenderingContext]) {
        if (!type) continue;
        const original = type.prototype.getParameter;
        type.prototype.getParameter = function getParameter(parameter) {
          if (parameter === 37446) return "ANGLE (Apple, Apple M3, OpenGL 4.1)";
          return original.call(this, parameter);
        };
      }
    });
  }
  const page = await context.newPage();
  page.on("pageerror", (error) => errors.push(`${label}: ${error.message}`));
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(`${label}: ${message.text()}`);
  });

  await page.goto(baseUrl, { waitUntil: "domcontentloaded", timeout: 120_000 });
  const story = page.locator("[data-system-story]");
  const stage = page.locator("[data-system-stage]");
  const chapters = page.locator("[data-system-chapter]");
  await story.waitFor({ state: "attached", timeout: 30_000 });
  await chapters.first().evaluate((element) => element.scrollIntoView({ block: "center", behavior: "instant" }));
  await stage.locator("[data-world-variant=story]").first().waitFor({ state: "attached", timeout: 30_000 });
  if (forceAccelerated) {
    await page.waitForFunction(() => document.querySelector("[data-system-stage] [data-world-variant=story]")?.getAttribute("data-world-mode") === "accelerated", undefined, { timeout: 30_000 });
  }

  const phaseSequence = [];
  const stickyTops = [];
  let firstStageHash = "";
  let lastStageHash = "";
  let previousY = -1;
  let scrollAdvanced = true;

  for (let index = 0; index < 7; index += 1) {
    const chapter = chapters.nth(index);
    await chapter.evaluate((element) => element.scrollIntoView({ block: "center", behavior: "instant" }));
    await page.waitForFunction(
      (phase) => document.querySelector("[data-system-stage]")?.getAttribute("data-system-phase") === String(phase),
      index,
      { timeout: 10_000 },
    );
    await page.waitForTimeout(550);
    const state = await page.evaluate(() => {
      const stageElement = document.querySelector("[data-system-stage]");
      const world = stageElement?.querySelector("[data-world-variant=story]");
      const current = document.querySelector("[data-system-chapter][data-current=true]");
      return {
        phase: Number(stageElement?.getAttribute("data-system-phase")),
        worldPhase: Number(world?.getAttribute("data-world-phase")),
        currentIndex: [...document.querySelectorAll("[data-system-chapter]")].indexOf(current),
        stickyTop: stageElement?.getBoundingClientRect().top ?? 9999,
        y: window.scrollY,
      };
    });
    phaseSequence.push({ phase: state.phase, worldPhase: state.worldPhase, currentIndex: state.currentIndex });
    stickyTops.push(state.stickyTop);
    if (state.y <= previousY) scrollAdvanced = false;
    previousY = state.y;

    if (index === 0 || index === 6) {
      const image = await stage.screenshot({
        path: `${screenshotDir}/${label}-phase-${index}.png`,
      });
      const hash = createHash("sha256").update(image).digest("hex");
      if (index === 0) firstStageHash = hash;
      else lastStageHash = hash;
    }
  }

  await page.evaluate(() => window.scrollTo({ top: document.documentElement.scrollHeight, behavior: "instant" }));
  await page.waitForTimeout(250);
  const pageMetrics = await page.evaluate(() => ({
    atBottom: window.scrollY + window.innerHeight >= document.documentElement.scrollHeight - 3,
    overflow: Math.max(0, document.documentElement.scrollWidth - document.documentElement.clientWidth),
    canvasCount: document.querySelectorAll("[data-system-stage] canvas").length,
    worldMode: document.querySelector("[data-system-stage] [data-world-variant=story]")?.getAttribute("data-world-mode") ?? "missing",
  }));

  const sequencePassed = phaseSequence.every((state, index) => state.phase === index && state.worldPhase === index && state.currentIndex === index);
  const stickyPassed = stickyTops.slice(1, 6).every((top) => Math.abs(top) <= 2);
  results.push({
    name: `${label} full scroll story`,
    phaseSequence,
    stickyTops,
    sceneHashesDiffer: Boolean(firstStageHash && lastStageHash && firstStageHash !== lastStageHash),
    scrollAdvanced,
    ...pageMetrics,
    passed: sequencePassed && stickyPassed && firstStageHash !== lastStageHash && scrollAdvanced && pageMetrics.atBottom && pageMetrics.overflow <= 2 && pageMetrics.worldMode !== "missing" && (!forceAccelerated || (pageMetrics.worldMode === "accelerated" && pageMetrics.canvasCount > 0)),
  });
  await context.close();
}

async function verifyReducedMotion() {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, reducedMotion: "reduce" });
  const page = await context.newPage();
  page.on("pageerror", (error) => errors.push(`reduced-motion: ${error.message}`));
  await page.goto(baseUrl, { waitUntil: "domcontentloaded", timeout: 120_000 });
  const story = page.locator("[data-system-story]");
  await story.waitFor({ state: "visible", timeout: 30_000 });
  await story.evaluate((element) => element.scrollIntoView({ block: "start", behavior: "instant" }));
  await page.waitForTimeout(500);
  const metrics = await page.evaluate(() => {
    const chapters = [...document.querySelectorAll("[data-system-chapter]")];
    const stage = document.querySelector("[data-system-stage]");
    return {
      chapterCount: chapters.length,
      visibleChapters: chapters.filter((chapter) => getComputedStyle(chapter).display !== "none" && getComputedStyle(chapter).visibility !== "hidden").length,
      stageVisible: stage ? getComputedStyle(stage).display !== "none" && stage.getBoundingClientRect().height > 0 : false,
      overflow: Math.max(0, document.documentElement.scrollWidth - document.documentElement.clientWidth),
    };
  });
  results.push({ name: "mobile reduced-motion fallback", ...metrics, passed: metrics.chapterCount === 7 && metrics.visibleChapters === 7 && metrics.stageVisible && metrics.overflow <= 2 });
  await context.close();
}

try {
  await verifyStory("desktop", { width: 1440, height: 900 }, { forceAccelerated: true });
  await verifyStory("mobile", { width: 390, height: 844 });
  await verifyReducedMotion();
} finally {
  await browser.close();
}

const failed = results.filter((result) => !result.passed);
console.log(JSON.stringify({ checkCount: results.length, failedCount: failed.length, results, errors }, null, 2));
if (failed.length || errors.length) process.exitCode = 1;
