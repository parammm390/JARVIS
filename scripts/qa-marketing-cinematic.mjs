import { chromium } from "playwright";

const baseUrl = process.env.FINNOR_QA_URL ?? "http://127.0.0.1:3200";
const browser = await chromium.launch({ headless: true });
const consoleErrors = [];

async function capture(name, viewport, anchor) {
  const context = await browser.newContext({ viewport, reducedMotion: "no-preference" });
  const page = await context.newPage();
  page.on("console", (message) => {
    if (message.type() === "error") consoleErrors.push(`${name}: ${message.text()}`);
  });
  page.on("pageerror", (error) => consoleErrors.push(`${name}: ${error.message}`));
  await page.goto(baseUrl, { waitUntil: "domcontentloaded", timeout: 30_000 });
  await page.waitForTimeout(1_500);
  if (anchor) {
    await page.locator(anchor).scrollIntoViewIfNeeded();
    await page.waitForTimeout(600);
  }
  const overlay = await page.locator("[data-nextjs-dialog], #webpack-dev-server-client-overlay").count();
  const bodyLength = (await page.locator("body").innerText()).trim().length;
  await page.screenshot({ path: `qa-screenshots/marketing-rebuild/${name}.png` });
  await context.close();
  return { name, overlay, bodyLength };
}

const results = [];
results.push(await capture("cinematic-desktop-hero", { width: 1440, height: 900 }));
results.push(await capture("cinematic-desktop-jarvis", { width: 1440, height: 900 }, "#jarvis"));
results.push(await capture("cinematic-mobile-hero", { width: 390, height: 844 }));
results.push(await capture("cinematic-mobile-surfaces", { width: 390, height: 844 }, "#surfaces"));

await browser.close();

console.log(JSON.stringify({ results, consoleErrors }, null, 2));
if (results.some((result) => result.overlay > 0 || result.bodyLength < 500) || consoleErrors.length > 0) {
  process.exitCode = 1;
}
