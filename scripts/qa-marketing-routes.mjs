import { chromium } from "playwright";

const baseUrl = process.env.FINNOR_QA_URL ?? "http://127.0.0.1:3200";
const routes = [
  "/",
  "/product",
  "/capabilities",
  "/how-it-works",
  "/pricing",
  "/faq",
  "/resources",
  "/resources/dispatch-ai-glossary",
  "/resources/admissions-ai-glossary",
  "/resources/missed-call-cost-calculator",
  "/resources/pilot-setup-checklist",
  "/trust-safety",
  "/privacy",
  "/terms",
  "/demo",
  "/demo/lifecycle",
  "/demo/legacy",
  "/jarvis",
  "/jarvis/login",
  "/jarvis/reset-password",
  "/jarvis/work",
  "/jarvis/customers",
  "/jarvis/schedule",
  "/jarvis/money",
  "/jarvis/agents",
  "/jarvis/bridge",
  "/jarvis/classic",
  "/jarvis/next",
  "/jarvis/showtime",
];

const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({ viewport: { width: 1280, height: 800 }, reducedMotion: "reduce" });
const results = [];

for (const route of routes) {
  const page = await context.newPage();
  const runtimeErrors = [];
  const expectedAuthDenials = [];
  page.on("pageerror", (error) => runtimeErrors.push(error.message));
  page.on("console", (message) => {
    if (message.type() !== "error") return;
    const value = message.text();
    if (route === "/jarvis/bridge" && (/status of 401 \(Unauthorized\)/i.test(value) || value.includes("Sign in required"))) {
      expectedAuthDenials.push(value);
      return;
    }
    runtimeErrors.push(value);
  });

  try {
    const response = await page.goto(`${baseUrl}${route}`, { waitUntil: "domcontentloaded", timeout: 30_000 });
    await page.waitForLoadState("load");
    await page.waitForTimeout(route.startsWith("/jarvis") ? 900 : 450);
    const status = response?.status() ?? 0;
    const metrics = await page.evaluate(() => ({
      bodyLength: (document.body.textContent ?? "").trim().length,
      title: document.title,
      overlay: Boolean(document.querySelector("[data-nextjs-dialog], #webpack-dev-server-client-overlay")),
      horizontalOverflow: Math.max(0, document.documentElement.scrollWidth - document.documentElement.clientWidth),
    }));
    const allowedStatus = route === "/jarvis/next" ? [200, 404] : [200];
    const minimumBodyLength = route.startsWith("/jarvis") || status === 404 ? 10 : 120;
    results.push({
      route,
      finalPath: new URL(page.url()).pathname,
      status,
      ...metrics,
      runtimeErrors,
      expectedAuthDenials,
      passed:
        allowedStatus.includes(status) &&
        !metrics.overlay &&
        metrics.bodyLength > minimumBodyLength &&
        metrics.horizontalOverflow <= 2 &&
        runtimeErrors.length === 0,
    });
  } catch (error) {
    results.push({ route, passed: false, error: error instanceof Error ? error.message : String(error) });
  }

  await page.close();
}

await context.close();
await browser.close();

const failed = results.filter((result) => !result.passed);
console.log(JSON.stringify({ routeCount: results.length, failedCount: failed.length, results }, null, 2));
if (failed.length) process.exitCode = 1;
