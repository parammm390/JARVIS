import { chromium } from "playwright";

const baseUrl = process.env.FINNOR_QA_URL ?? "http://127.0.0.1:3200";
const browser = await chromium.launch({ headless: true });
const errors = [];
const checks = [];

function record(name, passed, detail) {
  checks.push({ name, passed, detail });
  if (!passed) process.exitCode = 1;
}

const desktop = await browser.newContext({ viewport: { width: 1440, height: 900 }, reducedMotion: "reduce" });
const page = await desktop.newPage();
page.on("console", (message) => {
  if (message.type() === "error") errors.push(message.text());
});
page.on("pageerror", (error) => errors.push(error.message));

await page.goto(baseUrl, { waitUntil: "domcontentloaded", timeout: 30_000 });
await page.waitForTimeout(600);

const heroRun = page.getByRole("button", { name: /Run instruction/i });
await heroRun.click();
await page.waitForTimeout(5_800);
record("hero instruction reaches evidence", await page.getByText("VERIFIED", { exact: true }).first().isVisible(), "Hero operating model completed its seven-stage run.");

await page.evaluate(() => document.querySelector("#jarvis-surface")?.scrollIntoView({ block: "center" }));
await page.waitForTimeout(250);
await page.getByRole("button", { name: /Review consequence & approve/i }).click();
await page.waitForTimeout(3_500);
record("JARVIS executes approved plan", await page.getByText("5 / 5 actions", { exact: true }).isVisible(), "All five representative actions completed after scoped approval.");

const collector = page.getByRole("button", { name: /Payment collector/i });
await collector.click();
record("agent accordion exposes complete agent", (await collector.getAttribute("data-active")) === "true", "Payment collector opens as a complete bounded-agent panel.");

await page.getByRole("button", { name: "Verify alternate route" }).click();
await page.waitForTimeout(500);
record("recovery control verifies alternate route", await page.getByRole("heading", { name: "Alternate route verified" }).isVisible(), "Recovery state changed without losing the causal trace.");

await desktop.close();

const mobile = await browser.newContext({ viewport: { width: 390, height: 844 }, reducedMotion: "reduce" });
const mobilePage = await mobile.newPage();
await mobilePage.goto(baseUrl, { waitUntil: "domcontentloaded", timeout: 30_000 });
await mobilePage.getByRole("button", { name: "Open navigation" }).click();
record("mobile navigation opens", await mobilePage.getByRole("navigation", { name: "Mobile navigation" }).isVisible(), "Drawer is exposed with an explicit navigation landmark.");
await mobilePage.keyboard.press("Escape");
record("mobile navigation closes with Escape", !(await mobilePage.getByRole("navigation", { name: "Mobile navigation" }).isVisible()), "Escape closes the drawer and restores the compact rail.");
await mobile.close();

const marketing = await browser.newContext({ viewport: { width: 1280, height: 820 }, reducedMotion: "reduce" });
const marketingPage = await marketing.newPage();

await marketingPage.goto(`${baseUrl}/how-it-works`, { waitUntil: "domcontentloaded", timeout: 30_000 });
const recoveryStage = marketingPage.getByRole("button", { name: "Show Recovery stage" });
await recoveryStage.click();
record("how-it-works exposes recovery stage", (await recoveryStage.getAttribute("aria-pressed")) === "true", "The seven-stage execution chain is directly interactive.");

await marketingPage.goto(`${baseUrl}/capabilities`, { waitUntil: "domcontentloaded", timeout: 30_000 });
const recoverCapability = marketingPage.getByRole("button", { name: /Recover safely/i });
await recoverCapability.click();
record("capability accordion opens recovery", (await recoverCapability.getAttribute("aria-expanded")) === "true", "Capability detail is keyboard and pointer addressable.");

await marketingPage.goto(`${baseUrl}/faq`, { waitUntil: "domcontentloaded", timeout: 30_000 });
const failureQuestion = marketingPage.getByRole("button", { name: "What happens when a connected system fails?" });
await failureQuestion.click();
record("FAQ exposes failure answer", (await failureQuestion.getAttribute("aria-expanded")) === "true", "FAQ answer opens with an explicit accessible state.");

await marketingPage.goto(`${baseUrl}/pricing`, { waitUntil: "domcontentloaded", timeout: 30_000 });
await marketingPage.getByRole("heading", { name: /Price the scope of the operation/i }).waitFor();
record("pricing shows full deployment scope", await marketingPage.getByText("Quotes and proposals", { exact: true }).isVisible() && await marketingPage.getByText("Dispatch", { exact: true }).isVisible(), "Pricing names consequential operating deliverables without numeric shelf pricing.");
await marketing.close();

await browser.close();

record("runtime console remains clean", errors.length === 0, errors.length ? errors.join(" | ") : "No console or page errors.");
console.log(JSON.stringify({ checks, errors }, null, 2));
