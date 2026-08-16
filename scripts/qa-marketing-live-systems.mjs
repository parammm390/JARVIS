import { chromium } from "playwright";
import { mkdirSync } from "node:fs";
import { join } from "node:path";

const baseUrl = process.env.FINNOR_QA_URL ?? "http://127.0.0.1:3200";
const screenshotDir = process.env.FINNOR_QA_SCREENSHOT_DIR ?? "/tmp/finnor-live-qa";
mkdirSync(screenshotDir, { recursive: true });
const browser = await chromium.launch({ headless: true });
const results = [];
const errors = [];
const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, reducedMotion: "no-preference" });
const page = await context.newPage();
let currentCheck = "live-systems";
page.on("console", (message) => {
  if (message.type() !== "error") return;
  const value = message.text();
  // Rapid synthetic route changes can cancel a speculative Next.js RSC prefetch;
  // the router explicitly falls back to a full navigation in this case.
  if (value.includes("Failed to fetch RSC payload") && value.includes("Falling back to browser navigation")) return;
  errors.push(`${currentCheck}: ${value}`);
});
page.on("pageerror", (error) => errors.push(`${currentCheck}: ${error.message}`));

const captures = process.env.FINNOR_QA_INTERACTIONS_ONLY === "1" ? [] : [
  ["live-home-operations", "/", "#operations-pulse", { width: 1440, height: 900 }],
  ["live-product-console", "/product", "#product-live", { width: 1440, height: 900 }],
  ["live-capabilities-network", "/capabilities", "#capabilities-live", { width: 1440, height: 900 }],
  ["live-how-telemetry", "/how-it-works", "#how-live", { width: 1440, height: 900 }],
  ["live-pricing-composer", "/pricing", "#pricing-live", { width: 1440, height: 900 }],
  ["live-faq-explorer", "/faq", "#faq-live", { width: 1440, height: 900 }],
  ["live-resources-library", "/resources", "#resources-live", { width: 1440, height: 900 }],
  ["live-trust-runtime", "/trust-safety", "#trust-live", { width: 1440, height: 900 }],
  ["live-home-operations-mobile", "/", "#operations-pulse", { width: 390, height: 844 }],
  ["live-pricing-composer-mobile", "/pricing", "#pricing-live", { width: 390, height: 844 }],
  ["live-trust-runtime-mobile", "/trust-safety", "#trust-live", { width: 390, height: 844 }],
];

for (const [name, route, selector, viewport] of captures) {
  currentCheck = name;
  await page.setViewportSize(viewport);
  try {
    const response = await page.goto(`${baseUrl}${route}`, { waitUntil: "domcontentloaded", timeout: 120_000 });
    const anchor = page.locator(selector);
    await anchor.waitFor({ state: "attached", timeout: 30_000 });
    await anchor.evaluate((element) => element.scrollIntoView({ block: "start", behavior: "instant" }));
    await page.waitForTimeout(1_100);
    const metrics = await page.evaluate((target) => ({
      overlay: Boolean(document.querySelector("[data-nextjs-dialog], #webpack-dev-server-client-overlay")),
      overflow: Math.max(0, document.documentElement.scrollWidth - document.documentElement.clientWidth),
      anchorText: (document.querySelector(target)?.textContent ?? "").trim().length,
    }), selector);
    await page.screenshot({ path: join(screenshotDir, `${name}.png`) });
    results.push({ name, status: response?.status() ?? 0, ...metrics, passed: response?.status() === 200 && !metrics.overlay && metrics.overflow <= 2 && metrics.anchorText > 120 });
  } catch (error) {
    results.push({ name, passed: false, error: error instanceof Error ? error.message : String(error) });
  }
}

await page.setViewportSize({ width: 1360, height: 860 });

async function check(name, route, action, assertion) {
  try {
    await page.goto(`${baseUrl}${route}`, { waitUntil: "domcontentloaded", timeout: 120_000 });
    const value = await action();
    results.push({ name, passed: assertion(value) });
  } catch (error) {
    results.push({ name, passed: false, error: error instanceof Error ? error.message : String(error) });
  }
}

await check("home operations selects authority", "/", async () => { const section = page.locator("#operations-pulse"); await section.evaluate((element) => element.scrollIntoView({ block: "center", behavior: "instant" })); await page.waitForTimeout(500); await section.getByRole("button", { name: /Authority checked/i }).click({ force: true }); await section.getByText(/Owner boundary/i).waitFor({ state: "visible" }); return true; }, Boolean);
await check("product console selects money", "/product", async () => { await page.locator("#product-live").getByRole("button", { name: /Money surface/i }).click(); await page.locator("#product-live").getByText("Prepared · held", { exact: true }).waitFor({ state: "visible" }); return true; }, Boolean);
await check("capabilities network selects recovery", "/capabilities", async () => { await page.locator("#capabilities-live").getByRole("button", { name: /^Recover/i }).click(); await page.locator("#capabilities-live").getByText("safe route ready", { exact: true }).waitFor({ state: "visible" }); return true; }, Boolean);
await check("how-it-works telemetry selects provider timeout", "/how-it-works", async () => { await page.locator("#how-live").getByRole("button", { name: /Provider timeout/i }).click(); await page.locator("#how-live").getByText(/timeout|recovery/i).first().waitFor({ state: "visible" }); return true; }, Boolean);
await check("pricing scope selects reasoning policy", "/pricing", async () => { const button = page.locator("#pricing-live").getByRole("button", { name: /Frontier \/ complex reasoning/i }); await button.click(); return (await button.getAttribute("aria-pressed")) === "true" && await page.locator("#pricing-live").getByText(/Production deployments start around \$30,000/i).isVisible(); }, Boolean);
await check("FAQ explorer exposes authority", "/faq", async () => { await page.locator("#faq-live").getByRole("button", { name: /action crosses policy/i }).click(); await page.locator("#faq-live").getByText("Authority holds", { exact: true }).waitFor({ state: "visible" }); return true; }, Boolean);
await check("resource library selects estimator", "/resources", async () => { await page.locator("#resources-live").getByRole("button", { name: /Operational drag/i }).click(); await page.locator("#resources-live").getByText("live estimator", { exact: true }).waitFor({ state: "visible" }); return true; }, Boolean);
await check("trust runtime exposes recovery", "/trust-safety", async () => { await page.locator("#trust-live").getByRole("button", { name: /Accept provider acknowledgement/i }).click(); await page.locator("#trust-live").getByText("Recovery open", { exact: true }).waitFor({ state: "visible" }); return true; }, Boolean);

async function cursorColors(route) {
  try {
    await page.goto(`${baseUrl}${route}`, { waitUntil: "domcontentloaded", timeout: 120_000 });
    await page.mouse.move(420, 320);
    const cursor = page.locator('[data-finnor-cursor="dot"]').first();
    await cursor.waitFor({ state: "attached", timeout: 30_000 });
    return await cursor.evaluate((element) => getComputedStyle(element).backgroundColor);
  } catch (error) {
    return `missing: ${error instanceof Error ? error.message : String(error)}`;
  }
}

const cursorHome = await cursorColors("/");
const cursorProduct = await cursorColors("/product");
const cursorJarvis = await cursorColors("/jarvis");
results.push({ name: "cursor keeps one visible color", passed: cursorHome === "rgb(36, 119, 255)" && cursorHome === cursorProduct && cursorProduct === cursorJarvis, cursorHome, cursorProduct, cursorJarvis });

const failed = results.filter((result) => !result.passed);
console.log(JSON.stringify({ checkCount: results.length, failedCount: failed.length, results, errors }, null, 2));
await Promise.race([browser.close(), new Promise((resolve) => setTimeout(resolve, 2_000))]);
process.exit(failed.length || errors.length ? 1 : 0);
