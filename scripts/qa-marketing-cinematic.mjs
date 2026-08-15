import { chromium } from "playwright";

const baseUrl = process.env.FINNOR_QA_URL ?? "http://127.0.0.1:3200";
const browser = await chromium.launch({ headless: true });
const consoleErrors = [];

async function capture(name, viewport, anchor, route = "/") {
  const context = await browser.newContext({ viewport, reducedMotion: "no-preference" });
  const page = await context.newPage();
  page.on("console", (message) => {
    if (message.type() === "error") consoleErrors.push(`${name}: ${message.text()}`);
  });
  page.on("pageerror", (error) => consoleErrors.push(`${name}: ${error.message}`));
  await page.goto(`${baseUrl}${route}`, { waitUntil: "domcontentloaded", timeout: 60_000 });
  await page.waitForTimeout(1_500);
  if (anchor) {
    await page.evaluate((selector) => {
      document.querySelector(selector)?.scrollIntoView({ block: "start", behavior: "instant" });
    }, anchor);
    await page.waitForTimeout(900);
  }
  const overlay = await page.locator("[data-nextjs-dialog], #webpack-dev-server-client-overlay").count();
  const bodyLength = (await page.locator("body").innerText()).trim().length;
  await page.screenshot({ path: `qa-screenshots/marketing-rebuild/${name}.png` });
  await context.close();
  return { name, overlay, bodyLength };
}

const results = [];
results.push(await capture("cinematic-desktop-hero", { width: 1440, height: 900 }));
results.push(await capture("cinematic-desktop-company-scope", { width: 1440, height: 900 }, "#company-scope"));
results.push(await capture("cinematic-desktop-context", { width: 1440, height: 900 }, "#system"));
results.push(await capture("cinematic-desktop-system", { width: 1440, height: 900 }, "#system-story"));
results.push(await capture("cinematic-desktop-jarvis", { width: 1440, height: 900 }, "#jarvis-surface"));
results.push(await capture("cinematic-desktop-agents", { width: 1440, height: 900 }, "#agents"));
results.push(await capture("cinematic-desktop-evidence", { width: 1440, height: 900 }, "#evidence"));
results.push(await capture("cinematic-mobile-hero", { width: 390, height: 844 }));
results.push(await capture("cinematic-mobile-surfaces", { width: 390, height: 844 }, "#outcomes"));
results.push(await capture("page-desktop-product", { width: 1440, height: 900 }, undefined, "/product"));
results.push(await capture("page-desktop-capabilities", { width: 1440, height: 900 }, undefined, "/capabilities"));
results.push(await capture("page-desktop-how-it-works", { width: 1440, height: 900 }, "#flow-lab", "/how-it-works"));
results.push(await capture("page-desktop-pricing", { width: 1440, height: 900 }, undefined, "/pricing"));
results.push(await capture("page-desktop-faq", { width: 1440, height: 900 }, undefined, "/faq"));
results.push(await capture("page-mobile-pricing", { width: 390, height: 844 }, undefined, "/pricing"));
results.push(await capture("editorial-desktop-resources", { width: 1440, height: 900 }, undefined, "/resources"));
results.push(await capture("editorial-mobile-trust", { width: 390, height: 844 }, undefined, "/trust-safety"));

await browser.close();

console.log(JSON.stringify({ results, consoleErrors }, null, 2));
if (results.some((result) => result.overlay > 0 || result.bodyLength < 500) || consoleErrors.length > 0) {
  process.exitCode = 1;
}
