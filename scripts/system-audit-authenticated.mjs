import { chromium } from "playwright"
import { mkdirSync, readFileSync, writeFileSync } from "node:fs"

function readEnv(path) {
  const values = {}
  for (const rawLine of readFileSync(path, "utf8").split(/\r?\n/)) {
    const line = rawLine.trim()
    if (!line || line.startsWith("#")) continue
    const separator = line.indexOf("=")
    if (separator < 1) continue
    const key = line.slice(0, separator).trim()
    let value = line.slice(separator + 1).trim()
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) value = value.slice(1, -1)
    values[key] = value
  }
  return values
}

const local = readEnv(new URL("../.env.local", import.meta.url))
const email = process.env.TEST_OWNER_EMAIL ?? local.TEST_OWNER_EMAIL
const password = process.env.TEST_OWNER_PASSWORD ?? local.TEST_OWNER_PASSWORD
const baseURL = process.env.PLAYWRIGHT_BASE_URL ?? "https://finnorai.com"
const outputDir = process.env.JARVIS_AUDIT_OUTPUT ?? "evidence/system-audit-authenticated"

if (!email || !password) throw new Error("TEST_OWNER_EMAIL and TEST_OWNER_PASSWORD are required")

const surfaces = [
  ["home", "/jarvis"],
  ["work", "/jarvis/work"],
  ["customers", "/jarvis/customers"],
  ["schedule", "/jarvis/schedule"],
  ["money", "/jarvis/money"],
  ["agents", "/jarvis/agents"],
]

mkdirSync(outputDir, { recursive: true })
const browser = await chromium.launch({ headless: true })
const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } })
const page = await context.newPage()
page.setDefaultNavigationTimeout(90_000)
const consoleErrors = []
const pageErrors = []
page.on("console", (message) => {
  if (message.type() === "error") consoleErrors.push({ at: new Date().toISOString(), url: page.url(), message: message.text() })
})
page.on("pageerror", (error) => pageErrors.push({ at: new Date().toISOString(), url: page.url(), message: error.message }))

await page.goto(`${baseURL}/jarvis/login`, { waitUntil: "domcontentloaded" })
await page.waitForLoadState("networkidle", { timeout: 60_000 })
// In local Next dev, DOMContentLoaded can precede hydration after a cold compile.
// Filling controlled inputs before hydration mutates the DOM but not React state,
// leaving the submit button disabled. Wait for one animation frame and re-fill until
// the controlled form itself reports enabled; production takes the first pass.
const emailInput = page.getByPlaceholder(/you@example.com/i)
const passwordInput = page.getByPlaceholder(/•+/i)
const signIn = page.getByRole("button", { name: /sign in/i })
for (let attempt = 0; attempt < 10 && !(await signIn.isEnabled()); attempt += 1) {
  await emailInput.fill(email)
  await passwordInput.fill(password)
  if (!(await signIn.isEnabled())) await page.waitForTimeout(250)
}
await signIn.click()
await page.waitForURL("**/jarvis", { timeout: 20_000 })

const results = []
for (const [name, path] of surfaces) {
  const api = []
  const listener = async (response) => {
    if (!response.url().includes("/api/jarvis/")) return
    let body = null
    try {
      const contentType = response.headers()["content-type"] ?? ""
      if (contentType.includes("application/json")) body = await response.json()
    } catch {
      body = null
    }
    api.push({
      method: response.request().method(),
      path: new URL(response.url()).pathname + new URL(response.url()).search,
      status: response.status(),
      body,
    })
  }
  page.on("response", listener)
  const response = await page.goto(`${baseURL}${path}`, { waitUntil: "domcontentloaded" })
  await page.waitForTimeout(6500)
  const bodyText = await page.locator("body").innerText()
  await page.screenshot({ path: `${outputDir}/${name}.png`, fullPage: true })
  page.off("response", listener)
  results.push({
    name,
    path,
    documentStatus: response?.status() ?? 0,
    title: await page.title(),
    visibleFailureLabels: bodyText.split("\n").filter((line) => /source unavailable|sign in|unavailable|could not|no .* yet|empty/i.test(line)).slice(0, 40),
    text: bodyText,
    api,
  })
}

const artifact = {
  generatedAt: new Date().toISOString(),
  baseURL,
  authenticated: true,
  results,
  consoleErrors,
  pageErrors,
}
writeFileSync(`${outputDir}/matrix.json`, JSON.stringify(artifact, null, 2))
console.log(JSON.stringify({
  outputDir,
  surfaces: results.map(({ name, documentStatus, visibleFailureLabels, api }) => ({
    name,
    documentStatus,
    visibleFailureLabels,
    api: api.map(({ method, path, status }) => ({ method, path, status })),
  })),
  consoleErrors: consoleErrors.length,
  pageErrors: pageErrors.length,
}, null, 2))

await context.close()
await browser.close()
