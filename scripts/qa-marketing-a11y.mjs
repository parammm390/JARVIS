import { createRequire } from "node:module";
import { chromium } from "playwright";

const require = createRequire(import.meta.url);
const axePath = require.resolve("axe-core");
const baseUrl = process.env.FINNOR_QA_URL ?? "http://127.0.0.1:3200";
const routes = [
  "/",
  "/product",
  "/capabilities",
  "/how-it-works",
  "/pricing",
  "/faq",
  "/resources",
  "/resources/operating-glossary",
  "/resources/operational-drag-estimator",
  "/resources/deployment-readiness-checklist",
  "/trust-safety",
  "/privacy",
  "/terms",
];
const viewports = [
  { label: "desktop", width: 1440, height: 900 },
  { label: "mobile", width: 390, height: 844 },
];

const browser = await chromium.launch({ headless: true });
const results = [];

for (const viewport of viewports) {
  const context = await browser.newContext({ viewport, reducedMotion: "reduce" });
  for (const route of routes) {
    const page = await context.newPage();
    await page.goto(`${baseUrl}${route}`, { waitUntil: "domcontentloaded", timeout: 30_000 });
    await page.waitForTimeout(450);
    await page.addScriptTag({ path: axePath });
    const result = await page.evaluate(async () => {
      const report = await window.axe.run(document, { runOnly: { type: "tag", values: ["wcag2a", "wcag2aa"] } });
      return report.violations.map((violation) => ({
        id: violation.id,
        impact: violation.impact,
        help: violation.help,
        targets: violation.nodes.map((node) => node.target),
      }));
    });
    results.push({ viewport: viewport.label, route, violations: result });
    await page.close();
  }
  await context.close();
}

await browser.close();
const violationCount = results.reduce((total, result) => total + result.violations.length, 0);
console.log(JSON.stringify({ violationCount, results }, null, 2));
if (violationCount > 0) process.exitCode = 1;
