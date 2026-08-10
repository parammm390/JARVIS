import { chromium } from "playwright";

const browser = await chromium.launch({ headless: true });
const reducedMotion = process.env.FINNOR_REDUCED_MOTION === "1" ? "reduce" : "no-preference";
const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, reducedMotion });
const page = await context.newPage();

await page.addInitScript(() => {
  window.__finnorVitals = { lcp: 0, lcpElement: null, cls: 0, longTasks: 0, longTaskTime: 0, longestTask: 0, longTaskEntries: [] };
  new PerformanceObserver((list) => {
    const entries = list.getEntries();
    const latest = entries[entries.length - 1];
    if (latest) {
      window.__finnorVitals.lcp = latest.startTime;
      window.__finnorVitals.lcpElement = latest.element ? {
        tag: latest.element.tagName,
        className: String(latest.element.className).slice(0, 140),
        text: String(latest.element.textContent ?? "").trim().replace(/\s+/g, " ").slice(0, 160),
      } : null;
    }
  }).observe({ type: "largest-contentful-paint", buffered: true });
  new PerformanceObserver((list) => {
    for (const entry of list.getEntries()) {
      if (!entry.hadRecentInput) window.__finnorVitals.cls += entry.value;
    }
  }).observe({ type: "layout-shift", buffered: true });
  new PerformanceObserver((list) => {
    for (const entry of list.getEntries()) {
      window.__finnorVitals.longTasks += 1;
      window.__finnorVitals.longTaskTime += entry.duration;
      window.__finnorVitals.longestTask = Math.max(window.__finnorVitals.longestTask, entry.duration);
      window.__finnorVitals.longTaskEntries.push({ startMs: Math.round(entry.startTime), durationMs: Math.round(entry.duration) });
    }
  }).observe({ type: "longtask", buffered: true });
});

await page.goto(process.env.FINNOR_QA_URL ?? "http://127.0.0.1:3200", { waitUntil: "load", timeout: 30_000 });
await page.waitForTimeout(4_000);

const metrics = await page.evaluate(() => {
  const navigation = performance.getEntriesByType("navigation")[0];
  const resources = performance.getEntriesByType("resource");
  const scripts = resources.filter((entry) => entry.initiatorType === "script");
  const totalEncoded = resources.reduce((sum, entry) => sum + (entry.encodedBodySize || 0), 0);
  const scriptEncoded = scripts.reduce((sum, entry) => sum + (entry.encodedBodySize || 0), 0);
  return {
    ttfbMs: Math.round(navigation.responseStart),
    domContentLoadedMs: Math.round(navigation.domContentLoadedEventEnd),
    loadMs: Math.round(navigation.loadEventEnd),
    lcpMs: Math.round(window.__finnorVitals.lcp),
    lcpElement: window.__finnorVitals.lcpElement,
    cls: Number(window.__finnorVitals.cls.toFixed(4)),
    longTasks: window.__finnorVitals.longTasks,
    longTaskTimeMs: Math.round(window.__finnorVitals.longTaskTime),
    longestTaskMs: Math.round(window.__finnorVitals.longestTask),
    longestTasks: window.__finnorVitals.longTaskEntries.sort((a, b) => b.durationMs - a.durationMs).slice(0, 5),
    encodedResourcesKb: Math.round(totalEncoded / 1024),
    encodedScriptsKb: Math.round(scriptEncoded / 1024),
    resourceCount: resources.length,
    canvasCountTotal: document.querySelectorAll("canvas").length,
    canvasDetails: Array.from(document.querySelectorAll("canvas")).map((canvas) => {
      const rect = canvas.getBoundingClientRect();
      return {
        className: String(canvas.className),
        parentClassName: String(canvas.parentElement?.className ?? ""),
        top: Math.round(rect.top),
        bottom: Math.round(rect.bottom),
        width: Math.round(rect.width),
        height: Math.round(rect.height),
      };
    }),
    canvasCountAtHero: Array.from(document.querySelectorAll("canvas")).filter((canvas) => {
      const rect = canvas.getBoundingClientRect();
      const style = window.getComputedStyle(canvas);
      return style.display !== "none" && style.visibility !== "hidden" && rect.bottom > 0 && rect.top < window.innerHeight;
    }).length,
    errorOverlay: Boolean(document.querySelector("[data-nextjs-dialog], #webpack-dev-server-client-overlay")),
  };
});

console.log(JSON.stringify(metrics, null, 2));
await browser.close();

if (metrics.errorOverlay || metrics.lcpMs > 2500 || metrics.cls > 0.1) process.exitCode = 1;
