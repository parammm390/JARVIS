import { chromium } from "playwright"
import { mkdirSync, readFileSync, writeFileSync } from "node:fs"

function readEnv(path) {
  return Object.fromEntries(readFileSync(path, "utf8").split(/\r?\n/).flatMap((raw) => {
    const line = raw.trim()
    if (!line || line.startsWith("#") || !line.includes("=")) return []
    const index = line.indexOf("=")
    const key = line.slice(0, index).trim()
    let value = line.slice(index + 1).trim()
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) value = value.slice(1, -1)
    return [[key, value]]
  }))
}

const env = readEnv(new URL("../.env.local", import.meta.url))
const email = process.env.TEST_OWNER_EMAIL ?? env.TEST_OWNER_EMAIL
const password = process.env.TEST_OWNER_PASSWORD ?? env.TEST_OWNER_PASSWORD
const baseURL = process.env.PLAYWRIGHT_BASE_URL ?? "http://localhost:3000"
const outputDir = process.env.JARVIS_CHAIN_OUTPUT ?? "evidence/system-audit-command-chain"
const scheduledAt = process.env.JARVIS_CHAIN_SCHEDULED_AT ?? `${new Date().toISOString().slice(0, 10)}T16:30:00.000Z`
const instruction = process.env.JARVIS_CHAIN_INSTRUCTION ?? `Schedule a water test for Evidence Audit at 88 Proof Trail, Cedar Falls, IA, phone +13195559809, at ${scheduledAt}.`
const resumeActionId = process.env.JARVIS_CHAIN_RESUME_ACTION_ID ?? null

if (!email || !password) throw new Error("TEST_OWNER_EMAIL and TEST_OWNER_PASSWORD are required")
mkdirSync(outputDir, { recursive: true })

const browser = await chromium.launch({ headless: true })
const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } })
const page = await context.newPage()
page.setDefaultNavigationTimeout(90_000)
const consoleErrors = []
let observedBearer = null
page.on("console", (message) => {
  if (message.type() === "error") consoleErrors.push({ url: page.url(), message: message.text() })
})
page.on("request", (request) => {
  const requestUrl = new URL(request.url())
  const appOrigin = new URL(baseURL).origin
  if (requestUrl.origin !== appOrigin || !requestUrl.pathname.startsWith("/api/jarvis/")) return
  const authorization = request.headers()["authorization"]
  if (authorization?.startsWith("Bearer ")) observedBearer = authorization
})

await page.goto(`${baseURL}/jarvis/login`, { waitUntil: "networkidle" })
await page.getByPlaceholder(/you@example.com/i).pressSequentially(email, { delay: 5 })
await page.getByPlaceholder(/•+/i).pressSequentially(password, { delay: 5 })
await page.getByRole("button", { name: /sign in/i }).click()
await page.waitForURL("**/jarvis", { timeout: 30_000 })
await page.goto(`${baseURL}/jarvis/next`, { waitUntil: "domcontentloaded" })

for (let attempt = 0; attempt < 40 && !observedBearer; attempt += 1) await page.waitForTimeout(250)
let bearer = observedBearer
if (!bearer?.startsWith("Bearer ")) throw new Error("No authenticated JARVIS request carried a bearer token")

async function api(path) {
  return page.evaluate(async ({ target, authorization }) => {
    const response = await fetch(`/api/jarvis/${target}`, { cache: "no-store", headers: { authorization } })
    return { status: response.status, body: await response.json().catch(() => null) }
  }, { target: path, authorization: bearer })
}

let action
let planStatus
let planBody
let alreadyCompleted = false
if (resumeActionId) {
  const pending = await api("actions/pending?filter=pending")
  const rows = pending.body?.actions ?? pending.body?.pending ?? pending.body?.data ?? []
  action = rows.find((item) => item.id === resumeActionId) ?? null
  if (action) {
    planStatus = "restored-from-durable-pending-queue"
    planBody = pending.body
  } else {
    const projected = await api("read-models/work-cases")
    const completedCase = (projected.body?.data ?? []).find((item) => item.actions?.some((candidate) => candidate.id === resumeActionId))
    action = completedCase?.actions?.find((candidate) => candidate.id === resumeActionId) ?? null
    alreadyCompleted = Boolean(action && completedCase?.receipts?.length)
    planStatus = "restored-from-completed-work-projection"
    planBody = projected.body
  }
} else {
  const rail = page.getByPlaceholder("Tell JARVIS what you need")
  await rail.waitFor({ state: "visible", timeout: 30_000 })
  await rail.fill(instruction)
  await page.screenshot({ path: `${outputDir}/01-instruction.png`, fullPage: true })
  const [planRequest] = await Promise.all([
    page.waitForRequest((request) => request.method() === "POST" && new URL(request.url()).pathname.replace(/\/$/, "") === "/api/jarvis/actions", { timeout: 120_000 }),
    rail.press("Enter"),
  ])
  await Promise.race([
    page.waitForEvent("requestfinished", { predicate: (request) => request === planRequest, timeout: 120_000 }),
    page.waitForEvent("requestfailed", { predicate: (request) => request === planRequest, timeout: 120_000 }),
  ])
  const planResponse = await planRequest.response()
  if (!planResponse) throw new Error(`The instruction request ended without an HTTP response: ${planRequest.failure()?.errorText ?? "unknown failure"}`)
  planBody = await planResponse.json()
  bearer = planResponse.request().headers()["authorization"]
  if (!bearer?.startsWith("Bearer ")) throw new Error("The authenticated instruction request did not carry a bearer token")
  planStatus = planResponse.status()
  if (planStatus !== 201) throw new Error(`Planning failed (${planStatus}): ${JSON.stringify(planBody)}`)
  action = Array.isArray(planBody.planned) ? planBody.planned.find((item) => item?.actionType === "schedule_water_test") : null
}
if (!action?.id || action.actionType !== "schedule_water_test") throw new Error(`Planner/durable projections did not produce schedule_water_test: ${JSON.stringify(planBody)}`)

let decisionStatus = 200
let decisionBody = { recoveredFromCompletedProjection: true }
if (!alreadyCompleted) {
  const actionCard = page.getByLabel(/schedule water test/i).filter({ has: page.getByText(action.id.slice(0, 8), { exact: false }) }).first()
  const fallbackCard = page.getByLabel(/schedule water test/i).first()
  let card = await actionCard.isVisible().catch(() => false) ? actionCard : fallbackCard
  if (!(await card.isVisible().catch(() => false))) {
    await page.getByRole("button", { name: /Review approval:.*water test/i }).first().click()
    card = page.getByLabel(/schedule water test/i).first()
  }
  await card.waitFor({ state: "visible", timeout: 30_000 })
  await page.screenshot({ path: `${outputDir}/02-plan-approval.png`, fullPage: true })

  const [decisionRequest] = await Promise.all([
    page.waitForRequest((request) => request.method() === "POST" && new URL(request.url()).pathname === `/api/jarvis/actions/${action.id}/confirm`, { timeout: 120_000 }),
    card.getByRole("button", { name: /^Approve$/ }).click(),
  ])
  await Promise.race([
    page.waitForEvent("requestfinished", { predicate: (request) => request === decisionRequest, timeout: 120_000 }),
    page.waitForEvent("requestfailed", { predicate: (request) => request === decisionRequest, timeout: 120_000 }),
  ])
  const decisionResponse = await decisionRequest.response()
  if (!decisionResponse) throw new Error(`Approval request ended without a response: ${decisionRequest.failure()?.errorText ?? "unknown failure"}`)
  decisionStatus = decisionResponse.status()
  decisionBody = await decisionResponse.json()
  if (!decisionResponse.ok()) throw new Error(`Approval/execution failed (${decisionStatus}): ${JSON.stringify(decisionBody)}`)
}

await page.getByText("WHAT ACTUALLY HAPPENED").waitFor({ state: "visible", timeout: 90_000 }).catch(() => {})
await page.screenshot({ path: `${outputDir}/03-execution-receipt.png`, fullPage: true })

let workCase = null
let workResponse = null
for (let attempt = 0; attempt < 20; attempt += 1) {
  workResponse = await api("read-models/work-cases")
  const cases = workResponse.body?.data ?? []
  workCase = cases.find((item) => item.actions?.some((candidate) => candidate.id === action.id)) ?? null
  if (workCase?.receipts?.length) break
  await page.waitForTimeout(500)
}
if (!workCase) throw new Error(`No Work case projected action ${action.id}: ${JSON.stringify(workResponse)}`)

const householdId = workCase.linkedEntities?.find((entity) => entity.entityType === "household")?.entityId ?? null
const serviceVisitId = workCase.linkedEntities?.find((entity) => entity.entityType === "service_visit" || entity.entityType === "visit")?.entityId ?? null
if (!householdId || !serviceVisitId) throw new Error(`Work case lacks exact Household/Schedule IDs: ${JSON.stringify(workCase.linkedEntities)}`)

const [household, schedule, receipt, integrations] = await Promise.all([
  api(`read-models/household-360?householdId=${encodeURIComponent(householdId)}`),
  api(`dispatch/map?date=${encodeURIComponent(scheduledAt.slice(0, 10))}`),
  api(`receipts?domainActionId=${encodeURIComponent(action.id)}`),
  api("integrations/status"),
])
const scheduledStop = schedule.body?.stops?.find((stop) => stop.sourceKind === "service_visit" && stop.visitId === serviceVisitId) ?? null
if (household.status !== 200 || household.body?.data?.household?.id !== householdId) throw new Error(`Household projection mismatch: ${JSON.stringify(household)}`)
if (!scheduledStop) throw new Error(`Schedule projection lacks service visit ${serviceVisitId}: ${JSON.stringify(schedule)}`)
if (receipt.status !== 200 || !receipt.body?.receipts?.length) throw new Error(`Receipt missing for action ${action.id}: ${JSON.stringify(receipt)}`)

const surfacePaths = [
  ["04-work", `/jarvis/work?actionId=${encodeURIComponent(action.id)}&householdId=${encodeURIComponent(householdId)}&serviceVisitId=${encodeURIComponent(serviceVisitId)}`],
  ["05-household", `/jarvis/customers?householdId=${encodeURIComponent(householdId)}`],
  ["06-schedule", `/jarvis/schedule?householdId=${encodeURIComponent(householdId)}&serviceVisitId=${encodeURIComponent(serviceVisitId)}`],
  ["07-agent", `/jarvis/agents?instructionId=${encodeURIComponent(workCase.root.id)}&actionId=${encodeURIComponent(action.id)}`],
]
const visible = {}
for (const [name, path] of surfacePaths) {
  await page.goto(`${baseURL}${path}`, { waitUntil: "domcontentloaded" })
  await page.waitForTimeout(2_500)
  visible[name] = (await page.locator("body").innerText()).slice(0, 20_000)
  await page.screenshot({ path: `${outputDir}/${name}.png`, fullPage: true })
}

const artifact = {
  generatedAt: new Date().toISOString(),
  baseURL,
  instruction,
  plan: { status: planStatus, actionId: action.id, actionType: action.actionType, summary: action.summary, instructionId: workCase.root.id },
  approvalExecution: { status: decisionStatus, response: decisionBody },
  work: workCase,
  household,
  schedule: { responseStatus: schedule.status, scheduledStop },
  agent: { key: "jarvis", instructionId: workCase.root.id, actionId: action.id, outcome: workCase.status, integrations: integrations.body },
  receipt,
  exactIds: { actionId: action.id, workCaseId: workCase.id, instructionId: workCase.root.id, householdId, serviceVisitId, receiptIds: receipt.body.receipts.map((item) => item.id) },
  visible,
  consoleErrors,
}
writeFileSync(`${outputDir}/chain.json`, JSON.stringify(artifact, null, 2))
console.log(JSON.stringify({
  instruction,
  actionId: action.id,
  workCaseId: workCase.id,
  instructionId: workCase.root.id,
  householdId,
  serviceVisitId,
  scheduledStop: Boolean(scheduledStop),
  receiptIds: artifact.exactIds.receiptIds,
  workStatus: workCase.status,
  consoleErrors: consoleErrors.length,
  outputDir,
}, null, 2))

await context.close()
await browser.close()
