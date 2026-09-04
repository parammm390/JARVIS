import { randomUUID } from "node:crypto"
import { chromium } from "playwright"
import { resolve } from "node:path"
import { fileURLToPath } from "node:url"
import { assertCanonicalRelease, loadContract, readGitRelease } from "./release-policy.mjs"
import { GOLDEN_JOURNEYS, materializeGoldenInstruction, validateGoldenMatrix } from "./product-truth-golden-matrix.mjs"
import {
  HUMAN_OPERABILITY_MATRIX,
  HUMAN_OPERABILITY_SCENARIOS,
  materializeHumanOperabilityInstruction,
  validateHumanOperabilityArtifact,
} from "./human-operability-matrix.mjs"

const repoRoot = resolve(fileURLToPath(new URL("../..", import.meta.url)))
const contract = loadContract()
const gitRelease = readGitRelease(repoRoot, contract)
assertCanonicalRelease(gitRelease)

const token = process.env.PRODUCT_TRUTH_AUTH_BEARER?.trim()
if (!token) throw new Error("PRODUCT_TRUTH_AUTH_BEARER is required for deployed certification")
const bypass = process.env.VERCEL_AUTOMATION_BYPASS_SECRET?.trim()
const frontendUrl = (process.env.PRODUCT_TRUTH_FRONTEND_URL?.trim() || contract.topology.frontend.productionUrl).replace(/\/$/, "")
const apiUrl = (process.env.PRODUCT_TRUTH_API_URL?.trim() || contract.topology.api.productionUrl).replace(/\/$/, "")
const worker = contract.topology.worker
const workerUrl = (process.env.PRODUCT_TRUTH_WORKER_URL?.trim() || contract.topology.worker.sseGatewayUrl).replace(/\/$/, "")
const expectedSha = gitRelease.head
const commonHeaders = {
  authorization: `Bearer ${token}`,
  ...(bypass ? { "x-vercel-protection-bypass": bypass } : {}),
}
const fixtureKey = process.env.PRODUCT_TRUTH_CERTIFICATION_KEY?.trim()
const certificationRun = Number(process.env.PRODUCT_TRUTH_CERTIFICATION_RUN ?? "1")
const certificationMode = process.env.PRODUCT_TRUTH_CERTIFICATION_MODE?.trim() || "full"
if (!["full", "smoke"].includes(certificationMode)) throw new Error("PRODUCT_TRUTH_CERTIFICATION_MODE must be full or smoke")
if (certificationMode === "full" && ![1, 2].includes(certificationRun)) throw new Error("PRODUCT_TRUTH_CERTIFICATION_RUN must be 1 or 2")
if (certificationMode === "smoke" && certificationRun !== 1) throw new Error("production smoke must use certification run 1")

async function fetchJson(url, init = {}) {
  const response = await fetch(url, {
    ...init,
    headers: { accept: "application/json", ...commonHeaders, ...(init.headers ?? {}) },
    signal: init.signal ?? AbortSignal.timeout(70_000),
  })
  const text = await response.text()
  let body = null
  try { body = text ? JSON.parse(text) : null } catch { /* reported below */ }
  if (!response.ok) throw new Error(`${init.method ?? "GET"} ${url} returned ${response.status}: ${text.slice(0, 500)}`)
  return { response, body }
}

async function fetchPublicJson(url) {
  const response = await fetch(url, { headers: { accept: "application/json" }, signal: AbortSignal.timeout(20_000) })
  const body = await response.json().catch(() => null)
  if (!response.ok || !body) throw new Error(`GET ${url} returned ${response.status}`)
  return { response, body }
}

function requireRelease(name, release) {
  if (release?.commitSha !== expectedSha) throw new Error(`${name} release SHA ${release?.commitSha ?? "<missing>"} does not match ${expectedSha}`)
  if (release?.environment !== "production") throw new Error(`${name} is not reporting production environment`)
}

async function submitInstruction(label) {
  const instructionId = randomUUID()
  const startedAt = Date.now()
  const { body } = await fetchJson(`${frontendUrl}/api/jarvis/actions`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      instruction: `hello — deployed product-truth certification ${label} ${instructionId}`,
      channel: "console",
      instructionId,
      idempotencyKey: `product-truth:${expectedSha}:${instructionId}`,
    }),
  })
  if (!body?.workId || !body?.instructionId || !body?.threadId || !body?.assistantMessage?.semanticKind) {
    throw new Error("/api/actions did not return the canonical instruction response contract")
  }
  return { ...body, submittedAt: startedAt, responseAt: Date.now() }
}

function startSseCollector(response, controller) {
  const deltas = []
  const errors = []
  let lastCursor = null
  const seen = new Set()
  const pump = (async () => {
    if (!response.body) throw new Error("operational stream has no body")
    const reader = response.body.getReader()
    const decoder = new TextDecoder()
    let buffer = ""
    try {
      while (!controller.signal.aborted) {
        const { done, value } = await reader.read()
        if (done) break
        buffer += decoder.decode(value, { stream: true }).replace(/\r\n/g, "\n")
        const frames = buffer.split("\n\n")
        buffer = frames.pop() ?? ""
        for (const frame of frames) {
          if (!frame.trim() || frame.startsWith(":")) continue
          let event = "message"
          let id = null
          const dataLines = []
          for (const line of frame.split("\n")) {
            if (line.startsWith("event: ")) event = line.slice(7)
            else if (line.startsWith("id: ")) id = line.slice(4)
            else if (line.startsWith("data: ")) dataLines.push(line.slice(6))
          }
          if (event !== "operational_delta" || !id || dataLines.length === 0) continue
          const data = JSON.parse(dataLines.join("\n"))
          if (data.cursor !== id) throw new Error("SSE frame id/cursor mismatch")
          if (seen.has(id)) throw new Error(`duplicate operational delta cursor ${id}`)
          seen.add(id)
          lastCursor = id
          deltas.push({ ...data, receivedAt: Date.now() })
        }
      }
    } catch (error) {
      if (!controller.signal.aborted) errors.push(error instanceof Error ? error.message : String(error))
    } finally {
      await reader.cancel().catch(() => undefined)
    }
  })()
  return { deltas, errors, seen, pump, get lastCursor() { return lastCursor } }
}

async function openStream(lastEventId) {
  const controller = new AbortController()
  const response = await fetch(`${frontendUrl}/api/jarvis/operational-stream`, {
    headers: { ...commonHeaders, ...(lastEventId ? { "last-event-id": lastEventId } : {}) },
    cache: "no-store",
    signal: controller.signal,
  })
  if (response.status !== 200 || !response.headers.get("content-type")?.includes("text/event-stream")) {
    controller.abort()
    throw new Error(`operational stream is unhealthy: HTTP ${response.status} ${response.headers.get("content-type") ?? "<no content-type>"}`)
  }
  return { controller, collector: startSseCollector(response, controller) }
}

async function waitFor(predicate, message, timeoutMs = 30_000) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    const value = predicate()
    if (value) return value
    await new Promise((resolveDelay) => setTimeout(resolveDelay, 50))
  }
  throw new Error(message)
}

async function waitForAsync(predicate, message, timeoutMs = 30_000) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if (await predicate()) return true
    await new Promise((resolveDelay) => setTimeout(resolveDelay, 250))
  }
  throw new Error(message)
}

function decodeJwt(value) {
  const payload = value.split(".")[1]
  if (!payload) throw new Error("PRODUCT_TRUTH_AUTH_BEARER is not a JWT")
  return JSON.parse(Buffer.from(payload, "base64url").toString("utf8"))
}

function browserSession(value) {
  const claims = decodeJwt(value)
  const issuer = new URL(claims.iss)
  const projectRef = issuer.hostname.split(".")[0]
  const nowSeconds = Math.floor(Date.now() / 1000)
  return {
    storageKey: `sb-${projectRef}-auth-token`,
    session: {
      access_token: value,
      refresh_token: "deployed-certification-no-refresh",
      token_type: "bearer",
      expires_in: Math.max(1, Number(claims.exp) - nowSeconds),
      expires_at: Number(claims.exp),
      user: {
        id: claims.sub,
        aud: claims.aud,
        role: claims.role ?? "authenticated",
        email: claims.email,
        app_metadata: claims.app_metadata ?? {},
        user_metadata: claims.user_metadata ?? {},
        created_at: new Date((claims.iat ?? nowSeconds) * 1000).toISOString(),
      },
    },
  }
}

async function prepareBrowserPage(browser, { degradeRealtime = false, disconnectOnce = false, path = "/jarvis" } = {}) {
  const context = await browser.newContext()
  const page = await context.newPage()
  // Staged Vercel deployments retain Deployment Protection.  HTTP probes and
  // server-side relays already carry the automation bypass, but Playwright
  // navigation/static/SSE requests are a separate client and must carry it as
  // well.  Without this header every scenario burns its full selector timeout
  // against the Vercel login page, making the matrix appear hung.
  if (bypass) await page.setExtraHTTPHeaders({ "x-vercel-protection-bypass": bypass })
  const auth = browserSession(token)
  let disconnected = 0
  await page.addInitScript(({ storageKey, session }) => {
    window.localStorage.setItem(storageKey, JSON.stringify(session))
    window.__PRODUCT_TRUTH_CERT__ = { deltas: [], pixels: [], realtime: [] }
    window.addEventListener("jarvis:operational-delta", (event) => window.__PRODUCT_TRUTH_CERT__.deltas.push(event.detail))
    window.addEventListener("jarvis:realtime-status", (event) => window.__PRODUCT_TRUTH_CERT__.realtime.push(event.detail))
    const observe = () => {
      const record = () => {
        const node = document.querySelector("[data-thread-document][data-jarvis-work-id]")
        if (!node) return
        window.__PRODUCT_TRUTH_CERT__.pixels.push({
          at: Date.now(),
          workId: node.getAttribute("data-jarvis-work-id"),
          objectiveLoopId: node.getAttribute("data-jarvis-objective-loop-id"),
          executionModel: node.getAttribute("data-jarvis-execution-model"),
          assistantSemanticKind: node.getAttribute("data-jarvis-assistant-semantic-kind"),
          objectiveState: node.getAttribute("data-jarvis-objective-state"),
          instructionState: node.getAttribute("data-jarvis-instruction-state"),
          workPosture: node.getAttribute("data-jarvis-work-posture"),
          transport: node.getAttribute("data-jarvis-transport"),
        })
      }
      new MutationObserver(record).observe(document.documentElement, { subtree: true, childList: true, attributes: true })
      record()
    }
    if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", observe, { once: true })
    else observe()
  }, auth)
  if (degradeRealtime) {
    await page.route("**/api/jarvis/operational-stream", (route) => route.fulfill({
      status: 503,
      contentType: "application/json",
      body: JSON.stringify({ error: "certification-forced-realtime-outage" }),
    }))
  } else if (disconnectOnce) {
    await page.route("**/api/jarvis/operational-stream", (route) => {
      if (disconnected === 0) {
        disconnected += 1
        return route.abort("connectionreset")
      }
      return route.continue()
    })
  }
  await page.goto(`${frontendUrl}${path}`, { waitUntil: "domcontentloaded", timeout: 45_000 })
  const input = path === "/jarvis/work"
    ? page.locator("#jarvis-work-objective")
    : page.getByPlaceholder("Tell JARVIS what you need")
  await input.waitFor({ state: "visible", timeout: 30_000 })
  return { context, page, input, getDisconnected: () => disconnected }
}

async function browserJourney(browser, degradeRealtime) {
  const { context, page, input } = await prepareBrowserPage(browser, { degradeRealtime })
  const workFetches = []
  page.on("request", (request) => {
    const url = new URL(request.url())
    if (url.pathname === "/api/jarvis/read-models/work-cases" && url.searchParams.get("workId")) {
      workFetches.push({ at: Date.now(), workId: url.searchParams.get("workId") })
    }
  })
  try {
    const expectedTransport = degradeRealtime ? "polling" : "live"
    await page.waitForFunction(
      (expected) => window.__JARVIS_REALTIME_STATUS__?.status === expected,
      expectedTransport,
      { timeout: 30_000 },
    )

    const instruction = `Inspect current operations and then verify a read-only summary for deployed certification ${randomUUID()}; do not create, approve, or execute a business action.`
    await input.fill(instruction)
    const responsePromise = page.waitForResponse((response) => response.url().includes("/api/jarvis/actions") && response.request().method() === "POST", { timeout: 70_000 })
    await input.press("Enter")
    const actionResponse = await responsePromise
    const actionBody = await actionResponse.json()
    if (!actionResponse.ok() || !actionBody.workId || actionBody.executionModel !== "OBJECTIVE") {
      throw new Error(`browser Objective submission failed canonical routing: HTTP ${actionResponse.status()} ${JSON.stringify(actionBody).slice(0, 500)}`)
    }
    const responseAt = Date.now()
    await page.locator(`[data-thread-document][data-jarvis-work-id="${actionBody.workId}"]`).first().waitFor({ state: "attached", timeout: 30_000 })
    const pixelAt = Date.now()
    let delta = null
    if (!degradeRealtime) {
      await waitForAsync(
        () => page.evaluate((workId) => window.__PRODUCT_TRUTH_CERT__?.deltas?.some((entry) => entry.workId === workId) === true, actionBody.workId),
        `browser received no operational delta for Work ${actionBody.workId}`,
        30_000,
      )
      const diagnostics = await page.evaluate(() => window.__PRODUCT_TRUTH_CERT__)
      delta = [...diagnostics.deltas].reverse().find((entry) => entry.workId === actionBody.workId) ?? null
    }
    if (degradeRealtime) {
      await waitFor(() => workFetches.find((entry) => entry.workId === actionBody.workId), `fallback made no active-Work projection request for ${actionBody.workId}`, 5_000)
      const firstFetch = workFetches.find((entry) => entry.workId === actionBody.workId)
      if (firstFetch.at - responseAt > 2_000) throw new Error(`active-Work fallback fetch exceeded 2s (${firstFetch.at - responseAt}ms)`)
    }
    return {
      mode: degradeRealtime ? "polling" : "sse",
      workId: actionBody.workId,
      objectiveLoopId: actionBody.objectiveLoopId,
      pixelState: await page.locator(`[data-thread-document][data-jarvis-work-id="${actionBody.workId}"]`).first().getAttribute("data-jarvis-instruction-state"),
      responseToPixelMs: pixelAt - responseAt,
      commitToPixelMs: delta ? pixelAt - Date.parse(delta.occurredAt) : null,
      deltaCursor: delta?.cursor ?? null,
      activeWorkFallbackMs: degradeRealtime ? workFetches.find((entry) => entry.workId === actionBody.workId).at - responseAt : null,
    }
  } finally {
    await context.close()
  }
}

function durableModelFor(model) {
  return model === "QUERY" ? "query"
    : model === "CONVERSATION" ? "conversation"
      : model === "ATOMIC_ACTION" ? "atomic_action"
      : model === "CLARIFY" ? "clarify"
        : "objective"
}

function responseHasCanonicalIdentity(body) {
  return Boolean(body
    && typeof body === "object"
    && typeof body.workId === "string"
    && typeof body.workInputId === "string"
    && typeof body.instructionId === "string"
    && typeof body.threadId === "string"
    && body.assistantMessage
    && typeof body.assistantMessage === "object"
    && typeof body.assistantMessage.id === "string"
    && typeof body.assistantMessage.originalText === "string"
    && ["ANSWER", "ACKNOWLEDGEMENT", "CLARIFICATION"].includes(body.assistantMessage.semanticKind))
}

function assertExpectedCapability(row, responseBody) {
  if (!row.expectedCapability) return null
  const observed = responseBody.executionModel === "QUERY"
    ? responseBody.query?.request?.intent ?? responseBody.query?.intent ?? responseBody.answer?.intent
    : responseBody.executionModel === "CLARIFY"
      ? responseBody.actions?.find((action) => action.actionType === "clarification_request")?.actionType
      : responseBody.actions?.find((action) => action.actionType === row.expectedCapability)?.actionType
  if (observed !== row.expectedCapability) {
    throw new Error(`${row.id} compiled capability ${observed ?? "<missing>"}; expected ${row.expectedCapability}`)
  }
  return observed
}

async function fetchWorkCase(workId, headers = commonHeaders) {
  const response = await fetch(`${frontendUrl}/api/jarvis/read-models/work-cases?workId=${encodeURIComponent(workId)}`, {
    headers: { accept: "application/json", ...headers },
    signal: AbortSignal.timeout(20_000),
  })
  const body = await response.json().catch(() => null)
  if (!response.ok) {
    const error = new Error(`Work projection returned HTTP ${response.status}`)
    error.status = response.status
    const retryAfterSeconds = Number(response.headers.get("retry-after"))
    error.retryAfterMs = Number.isFinite(retryAfterSeconds)
      ? Math.max(0, Math.ceil(retryAfterSeconds * 1_000))
      : null
    throw error
  }
  return body && Array.isArray(body.data) ? body.data[0] ?? null : null
}

async function waitForWorkCase(workId, timeoutMs = 45_000) {
  const deadline = Date.now() + timeoutMs
  let latest = null
  while (Date.now() < deadline) {
    try {
      latest = await fetchWorkCase(workId)
    } catch (error) {
      // A durable limiter response is temporary, and the proxy now preserves
      // Retry-After. Honor that window instead of turning a single 429 into a
      // 400ms request amplifier across every fresh certification context.
      if (error?.status === 429) {
        const remainingMs = Math.max(0, deadline - Date.now())
        const retryMs = Math.min(remainingMs, Math.max(400, error.retryAfterMs ?? 1_000))
        if (retryMs > 0) await new Promise((resolveDelay) => setTimeout(resolveDelay, retryMs))
        continue
      }
      latest = null
    }
    if (latest?.durableWork?.id === workId) return latest
    await new Promise((resolveDelay) => setTimeout(resolveDelay, 400))
  }
  throw new Error(`no canonical Work projection was readable for ${workId}: ${JSON.stringify(latest).slice(0, 300)}`)
}

async function applyGoldenFixture(workId, row, nonce) {
  if (!row.fixture) return null
  if (!fixtureKey) throw new Error(`${row.id} requires PRODUCT_TRUTH_CERTIFICATION_KEY for deterministic canonical setup`)
  const { body } = await fetchJson(`${frontendUrl}/api/jarvis/certification/product-truth`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-product-truth-certification-key": fixtureKey,
    },
    body: JSON.stringify({ workId, scenario: row.fixture, nonce }),
  })
  if (!body?.ok || body.scenario !== row.fixture || body.workId !== workId || body.nonce !== nonce) {
    throw new Error(`${row.id} deterministic fixture did not return its canonical Work identity: ${JSON.stringify(body).slice(0, 500)}`)
  }
  return body
}

function assertGoldenFixture(canonical, row, fixture) {
  if (!row.fixture) return null
  if (!fixture || fixture.scenario !== row.canonicalAssertion) throw new Error(`${row.id} did not report the declared deterministic fixture`)
  const work = canonical?.durableWork
  const loop = canonical?.objectiveLoop
  const iterations = loop?.iterations ?? []
  const waits = loop?.eventWaits ?? []
  const actions = canonical?.actions ?? []
  const receipts = canonical?.receipts ?? []
  const effects = canonical?.businessEffects ?? []
  const require = (condition, message) => { if (!condition) throw new Error(`${row.id} canonical assertion failed: ${message}`) }
  const fixtureStep = iterations.find((iteration) => iteration.id === fixture.objectiveStepId)
  switch (row.canonicalAssertion) {
    case "external-wait": {
      const wait = waits.find((candidate) => candidate.id === fixture.waitId)
      require(work?.status === "waiting", `durable Work status=${work?.status ?? "<missing>"}`)
      require(loop?.state === "waiting", `Objective state=${loop?.state ?? "<missing>"}`)
      require(wait?.status === "waiting", "durable event wait is not waiting")
      require(wait?.expectedEventType === fixture.expectedEventType, "event type/correlation fixture mismatch")
      require(wait?.conditionSummary === fixture.conditionSummary, "wait condition summary is not the injected canonical condition")
      return { waitId: wait.id, status: wait.status, expectedEventType: wait.expectedEventType }
    }
    case "external-wake": {
      const wait = waits.find((candidate) => candidate.id === fixture.waitId)
      const wake = (loop?.wakeClaims ?? []).find((candidate) => candidate.id === fixture.wakeClaimId)
      require(wait?.status === "satisfied", "durable event wait was not satisfied")
      require(wait?.matchedEventId === fixture.eventId, "wait was not matched by the injected integration event")
      require(Boolean(wake), "semantic wake claim is missing")
      require(wake.waitId === wait.id && wake.integrationEventId === fixture.eventId, "wake claim does not point to the matched event")
      require(loop?.state !== "waiting", "Objective remained waiting after the canonical wake")
      return { waitId: wait.id, status: wait.status, wakeClaimId: wake.id, eventId: wake.integrationEventId }
    }
    case "blocked-objective": {
      require(work?.status === "blocked", `durable Work status=${work?.status ?? "<missing>"}`)
      require(loop?.state === "blocked", `Objective state=${loop?.state ?? "<missing>"}`)
      require(!effects.some((effect) => ["verified", "executed"].includes(effect.status)), "blocked Work contains a verified effect")
      require(receipts.length === 0, "blocked fixture unexpectedly finalized a receipt")
      return { status: work.status, objectiveState: loop.state, receiptCount: receipts.length }
    }
    case "provider-unavailable": {
      const attempts = iterations.flatMap((iteration) => iteration.plannerAttempts ?? [])
      const failedAttempt = attempts.find((attempt) => attempt.id && attempt.failure?.code === "provider_unavailable")
      require(work?.status === "blocked", `durable Work status=${work?.status ?? "<missing>"}`)
      require(loop?.state === "blocked", `Objective state=${loop?.state ?? "<missing>"}`)
      require(Boolean(failedAttempt), "no canonical planner attempt recorded provider_unavailable")
      require(work?.failure?.code === "provider_unavailable", "durable Work failure does not identify provider_unavailable")
      require(!effects.some((effect) => ["verified", "executed"].includes(effect.status)), "provider outage fixture contains a verified effect")
      return { status: work.status, objectiveState: loop.state, plannerFailure: failedAttempt.failure }
    }
    case "failed-action-recovery": {
      const action = actions.find((candidate) => candidate.id === fixture.actionId)
      require(action?.status === "failed", "failed provider action is not canonical")
      require(work?.status === "recovery", `durable Work status=${work?.status ?? "<missing>"}`)
      require(Boolean(iterations.find((iteration) => iteration.recoveryKind === "recover")), "Objective iteration has no recover transition")
      require(work?.recovery?.failedActionId === fixture.actionId, "Work recovery does not point to failed action")
      require(loop?.state !== "completed", "failed action was incorrectly marked completed")
      return { actionId: action.id, actionStatus: action.status, recoveryKind: fixtureStep?.recoveryKind ?? "recover" }
    }
    case "completed-verified-outcome": {
      const action = actions.find((candidate) => candidate.id === fixture.actionId)
      const effect = effects.find((candidate) => candidate.id === fixture.effectId)
      const receipt = receipts.find((candidate) => candidate.id === fixture.receiptId)
      require(work?.status === "completed", `durable Work status=${work?.status ?? "<missing>"}`)
      require(loop?.state === "completed", `Objective state=${loop?.state ?? "<missing>"}`)
      require(Boolean(loop?.successVerifiedAt), "Objective has no successVerifiedAt")
      require(loop?.successVerification?.state === "verified", "Objective success verification is not verified")
      require(action?.status === "completed", "verified outcome action is not completed")
      require(effect?.status === "verified" && effect?.verification?.state === "verified", "business effect is not verified")
      require(Boolean(receipt?.finalizedAt) && receipt?.verification?.state === "verified", "decision receipt is not finalized and verified")
      return { actionId: action.id, effectId: effect.id, receiptId: receipt.id, verifiedAt: loop.successVerifiedAt }
    }
    default:
      throw new Error(`${row.id} has no canonical assertion implementation`)
  }
}

function pixelSnapshot(node) {
  return {
    workId: node.getAttribute("data-jarvis-work-id"),
    objectiveLoopId: node.getAttribute("data-jarvis-objective-loop-id"),
    executionModel: node.getAttribute("data-jarvis-execution-model"),
    assistantSemanticKind: node.getAttribute("data-jarvis-assistant-semantic-kind"),
    objectiveState: node.getAttribute("data-jarvis-objective-state"),
    instructionState: node.getAttribute("data-jarvis-instruction-state"),
    workPosture: node.getAttribute("data-jarvis-work-posture"),
    transport: node.getAttribute("data-jarvis-transport"),
  }
}

async function assertBrowserProjection(page, workId, responseBody, canonical, row) {
  const node = page.locator(`[data-thread-document][data-jarvis-work-id="${workId}"]`).first()
  await node.waitFor({ state: "attached", timeout: 45_000 })
  const pixel = await node.evaluate(pixelSnapshot)
  const canonicalModel = canonical?.durableWork?.executionModel ?? null
  const expectedModel = String(responseBody.executionModel ?? "")
  if (!row.expectedModels.includes(expectedModel)) {
    throw new Error(`${row.id} returned ${expectedModel}; expected ${row.expectedModels.join("|")}`)
  }
  if (pixel.workId !== workId) throw new Error(`${row.id} pixel Work id does not match canonical response`)
  if (pixel.executionModel !== expectedModel) throw new Error(`${row.id} pixel route ${pixel.executionModel} does not match ${expectedModel}`)
  if (canonicalModel !== durableModelFor(expectedModel)) {
    throw new Error(`${row.id} durable Work route ${canonicalModel ?? "<missing>"} does not match ${durableModelFor(expectedModel)}`)
  }
  if (expectedModel === "OBJECTIVE") {
    if (!responseBody.objectiveLoopId || pixel.objectiveLoopId !== responseBody.objectiveLoopId) throw new Error(`${row.id} Objective identity was not projected to the same pixel`)
    if (canonical?.objectiveLoop?.id !== responseBody.objectiveLoopId) throw new Error(`${row.id} canonical Objective identity differs from the response`)
    if (pixel.objectiveState && canonical?.objectiveLoop?.state && pixel.objectiveState !== canonical.objectiveLoop.state) throw new Error(`${row.id} Objective state pixel drifted from Work projection`)
    if (pixel.instructionState === "executing" && ["waiting", "blocked", "cancelled"].includes(canonical?.objectiveLoop?.state)) throw new Error(`${row.id} waiting/blocked/cancelled Work was painted as executing`)
  }
  if (responseBody.assistantMessage?.semanticKind === "ACKNOWLEDGEMENT" && pixel.assistantSemanticKind === "ANSWER") throw new Error(`${row.id} acknowledgement was promoted to an Answer pixel`)
  return pixel
}

async function submitFromBrowser(page, input, row, instruction) {
  const replayKey = `product-truth:golden:${expectedSha}:${row.id}:${randomUUID()}`
  let submittedBody = null
  let firstRequestBody = null
  if (row.replay) {
    await page.route("**/api/jarvis/actions", async (route) => {
      const request = route.request()
      if (!firstRequestBody) {
        const parsed = JSON.parse(request.postData() ?? "{}")
        parsed.idempotencyKey = replayKey
        firstRequestBody = parsed
        await route.continue({
          headers: { ...request.headers(), "content-type": "application/json" },
          postData: JSON.stringify(parsed),
        })
        return
      }
      await route.continue()
    })
  }
  const responsePromise = page.waitForResponse((response) => response.url().includes("/api/jarvis/actions") && response.request().method() === "POST", { timeout: 70_000 })
  if (row.entrypoint === "palette") {
    await page.keyboard.press("Control+k")
    const dialog = page.getByRole("dialog", { name: "Command palette" })
    await dialog.waitFor({ state: "visible", timeout: 10_000 })
    await dialog.getByRole("button", { name: "Instruct" }).click()
    const paletteInput = dialog.getByPlaceholder(/Describe what you need/i)
    await paletteInput.fill(instruction)
    await paletteInput.press("Enter")
  } else if (row.entrypoint === "legacy") {
    await input.fill(instruction)
    await page.getByRole("button", { name: "Assign objective" }).click()
  } else {
    await input.fill(instruction)
    await input.press("Enter")
  }
  const actionResponse = await responsePromise
  submittedBody = await actionResponse.json().catch(() => null)
  if (!actionResponse.ok() || !responseHasCanonicalIdentity(submittedBody)) {
    throw new Error(`${row.id} browser submission failed: HTTP ${actionResponse.status()} ${JSON.stringify(submittedBody).slice(0, 500)}`)
  }
  let replayBody = null
  if (row.replay) {
    if (!firstRequestBody) throw new Error(`${row.id} did not capture the UI request body for idempotency replay`)
    replayBody = await page.evaluate(async ({ body, bypassSecret, token }) => {
      const response = await fetch("/api/jarvis/actions", {
        method: "POST",
        headers: {
          accept: "application/json",
          "content-type": "application/json",
          authorization: `Bearer ${token}`,
          ...(bypassSecret ? { "x-vercel-protection-bypass": bypassSecret } : {}),
        },
        body: JSON.stringify(body),
      })
      return { status: response.status, body: await response.json().catch(() => null) }
    }, { body: firstRequestBody, bypassSecret: bypass, token })
    if (![200, 202].includes(replayBody.status) || replayBody.body?.workId !== submittedBody.workId || replayBody.body?.instructionId !== submittedBody.instructionId) {
      throw new Error(`${row.id} idempotency replay did not return the original canonical Work`)
    }
  }
  return { response: submittedBody, requestBody: firstRequestBody, replay: replayBody }
}

async function objectiveControl(page, row, workId, instructionId) {
  const controls = page.locator("[data-jarvis-objective-controls]")
  await controls.waitFor({ state: "attached", timeout: 45_000 })
  const responsePromise = page.waitForResponse((response) => {
    const url = response.url()
    return response.request().method() === "POST" && (url.includes(`/api/jarvis/works/${workId}/objective`) || url.includes(`/api/jarvis/instructions/${instructionId}/cancel`) || url.includes("/api/jarvis/actions/"))
  }, { timeout: 30_000 })
  if (row.control === "cancel") {
    await controls.getByRole("button", { name: "Cancel future execution" }).click()
  } else if (row.control === "redirect") {
    const field = controls.getByPlaceholder("Redirect this same Objective")
    await field.fill(`Redirected certification objective ${randomUUID()}`)
    await controls.getByRole("button", { name: "Redirect" }).click()
  } else if (row.control === "interrupt-resume") {
    const interrupt = controls.getByRole("button", { name: "Interrupt" })
    if (await interrupt.isVisible().catch(() => false)) await interrupt.click()
    else await page.evaluate(async ({ workId: id, token: accessToken, bypassSecret }) => {
      await fetch(`/api/jarvis/works/${id}/objective`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${accessToken}`,
          ...(bypassSecret ? { "x-vercel-protection-bypass": bypassSecret } : {}),
        },
        body: JSON.stringify({ command: "interrupt" }),
      })
    }, { workId, token, bypassSecret: bypass })
    await controls.getByRole("button", { name: "Continue" }).waitFor({ state: "visible", timeout: 30_000 })
    await controls.getByRole("button", { name: "Continue" }).click()
  } else if (row.control === "approval") {
    const cockpit = page.locator("[data-jarvis-approval-cockpit]")
    await cockpit.waitFor({ state: "attached", timeout: 45_000 })
    if (row.id === "computer-write-approval") {
      if (process.env.PRODUCT_TRUTH_ALLOW_COMPUTER_WRITE !== "1") throw new Error(`${row.id} requires PRODUCT_TRUTH_ALLOW_COMPUTER_WRITE=1; certification will not approve a computer WRITE implicitly`)
      const approve = cockpit.getByRole("button", { name: "Approve" }).first()
      if (await approve.isVisible().catch(() => false)) await approve.click()
      else throw new Error(`${row.id} did not expose the approval control for the WRITE path`)
    } else {
      const reject = cockpit.getByRole("button", { name: "Reject" }).first()
      if (await reject.isVisible().catch(() => false)) await reject.click()
      else throw new Error(`${row.id} did not expose the approval cockpit for the gated path`)
    }
  }
  const controlResponse = await responsePromise
  if (!controlResponse.ok() && controlResponse.status() !== 409) throw new Error(`${row.id} control returned HTTP ${controlResponse.status()}`)
  return { status: controlResponse.status(), at: Date.now() }
}

async function crossTenantDenied(workId) {
  const otherToken = process.env.PRODUCT_TRUTH_OTHER_AUTH_BEARER?.trim()
  if (!otherToken) throw new Error("PRODUCT_TRUTH_OTHER_AUTH_BEARER is required for the cross-tenant golden journey")
  const response = await fetch(`${frontendUrl}/api/jarvis/read-models/work-cases?workId=${encodeURIComponent(workId)}`, {
    headers: {
      accept: "application/json",
      authorization: `Bearer ${otherToken}`,
      ...(bypass ? { "x-vercel-protection-bypass": bypass } : {}),
    },
    signal: AbortSignal.timeout(20_000),
  })
  if (![401, 403, 404].includes(response.status)) throw new Error(`cross-tenant Work ${workId} returned HTTP ${response.status}; expected an access denial`)
  return response.status
}

async function restartWorkerGateway() {
  if (process.env.PRODUCT_TRUTH_RUN_WORKER_RESTART !== "1") throw new Error("PRODUCT_TRUTH_RUN_WORKER_RESTART=1 is required for worker-restart certification")
  const { execFile } = await import("node:child_process")
  await new Promise((resolvePromise, reject) => {
    execFile("aws", [
      "ecs", "update-service",
      "--cluster", worker.clusterName,
      "--service", worker.serviceName,
      "--force-new-deployment",
      "--region", worker.region,
      "--no-cli-pager",
    ], { timeout: 120_000, env: { ...process.env, AWS_PAGER: "" } }, (error, stdout, stderr) => {
      if (error) reject(new Error(`ECS worker restart failed: ${String(stderr || stdout).slice(0, 400)}`))
      else resolve(stdout)
    })
  })
  await waitForAsync(async () => {
    const response = await fetch(`${workerUrl}/healthz`, { headers: { accept: "application/json" }, signal: AbortSignal.timeout(10_000) }).catch(() => null)
    if (!response?.ok) return false
    const body = await response.json().catch(() => null)
    return body?.release?.commitSha === expectedSha && body?.realtime === true
  }, "worker did not recover with the certified release after restart", 180_000)
  return true
}

async function browserGoldenJourney(browser, row, index) {
  const { context, page, input, getDisconnected } = await prepareBrowserPage(browser, {
    degradeRealtime: row.transport === "polling",
    disconnectOnce: row.reconnect === true,
    path: row.entrypoint === "legacy" ? "/jarvis/work" : "/jarvis",
  })
  const workFetches = []
  const actions = []
  page.on("request", (request) => {
    const url = new URL(request.url())
    if (url.pathname === "/api/jarvis/read-models/work-cases" && url.searchParams.get("workId")) workFetches.push({ at: Date.now(), workId: url.searchParams.get("workId") })
    if (url.pathname === "/api/jarvis/actions" && request.method() === "POST") actions.push({ at: Date.now(), body: request.postData() })
  })
  try {
    const expectedTransport = row.transport === "polling" ? "polling" : "live"
    await page.waitForFunction((expected) => window.__JARVIS_REALTIME_STATUS__?.status === expected, expectedTransport, { timeout: row.reconnect ? 45_000 : 30_000 })
    const instructionNonce = `${index + 1}-${randomUUID()}`
    const instruction = materializeGoldenInstruction(row, instructionNonce)
    const responseAt = Date.now()
    const submission = await submitFromBrowser(page, input, row, instruction)
    const responseBody = submission.response
    const compiledCapability = assertExpectedCapability(row, responseBody)
    const fixture = await applyGoldenFixture(responseBody.workId, row, instructionNonce)
    if (row.workerRestart) await restartWorkerGateway()
    const canonical = await waitForWorkCase(responseBody.workId)
    const fixtureEvidence = assertGoldenFixture(canonical, row, fixture)
    const pixel = await assertBrowserProjection(page, responseBody.workId, responseBody, canonical, row)
    let delta = null
    if (row.transport !== "polling") {
      // The browser can paint the canonical Work from the authoritative POST
      // response before the asynchronous realtime frame crosses the relay. Wait
      // for the frame explicitly; checking the diagnostics array immediately was
      // the structural source of the repeated false Human Black-Box failure.
      await waitForAsync(
        () => page.evaluate((workId) => window.__PRODUCT_TRUTH_CERT__?.deltas?.some((entry) => entry.workId === workId) === true, responseBody.workId),
        `${row.id} authenticated realtime delta did not reach the browser`,
        30_000,
      )
      const diagnostics = await page.evaluate(() => window.__PRODUCT_TRUTH_CERT__)
      delta = [...diagnostics.deltas].reverse().find((entry) => entry.workId === responseBody.workId) ?? null
    }
    if (row.transport === "polling") {
      const firstFetch = workFetches.find((entry) => entry.workId === responseBody.workId)
      if (!firstFetch || firstFetch.at - responseAt > 2_000) throw new Error(`${row.id} active Work polling did not refresh within 2s`)
    }
    if (row.reconnect && getDisconnected() < 1) throw new Error(`${row.id} did not exercise a real browser realtime disconnect`)
    let control = null
    if (row.control) {
      control = await objectiveControl(page, row, responseBody.workId, responseBody.instructionId)
      const afterControl = await waitForWorkCase(responseBody.workId)
      await assertBrowserProjection(page, responseBody.workId, responseBody, afterControl, row)
    }
    if (row.refresh) {
      await page.reload({ waitUntil: "domcontentloaded", timeout: 45_000 })
      const restored = page.locator(`[data-thread-document][data-jarvis-work-id="${responseBody.workId}"]`).first()
      await restored.waitFor({ state: "attached", timeout: 45_000 })
      const restoredPixel = await restored.evaluate(pixelSnapshot)
      if (restoredPixel.executionModel !== responseBody.executionModel || restoredPixel.workId !== responseBody.workId) throw new Error(`${row.id} refresh restore changed the canonical Work identity/model`)
    }
    if (row.recent) {
      await page.keyboard.press("Control+k")
      const dialog = page.getByRole("dialog", { name: "Command palette" })
      await dialog.getByRole("button", { name: "Recent threads" }).click()
      const recent = page.locator("[aria-label='Recent threads']")
      await recent.waitFor({ state: "visible", timeout: 15_000 })
      if (!(await recent.innerText()).includes(instruction.slice(0, 24))) throw new Error(`${row.id} recent threads did not contain the submitted Work`)
    }
    const denied = row.crossTenant ? await crossTenantDenied(responseBody.workId) : null
    const replay = submission.replay ? { status: submission.replay.status, workId: submission.replay.body?.workId, instructionId: submission.replay.body?.instructionId } : null
    return {
      id: row.id,
      index: index + 1,
      status: "PASS",
      workId: responseBody.workId,
      workInputId: responseBody.workInputId,
      instructionId: responseBody.instructionId,
      threadId: responseBody.threadId,
      executionModel: responseBody.executionModel,
      compiledCapability,
      objectiveLoopId: responseBody.objectiveLoopId ?? null,
      canonicalState: canonical?.objectiveLoop?.state ?? canonical?.durableWork?.status ?? canonical?.status ?? null,
      pixelState: pixel.instructionState,
      pixel,
      transport: row.transport === "polling" ? "polling" : "sse",
      deltaCursor: delta?.cursor ?? null,
      responseToPixelMs: Date.now() - responseAt,
      commitToPixelMs: delta ? Date.now() - Date.parse(delta.occurredAt) : null,
      activeWorkFallbackMs: row.transport === "polling" ? workFetches.find((entry) => entry.workId === responseBody.workId).at - responseAt : null,
      control,
      replay,
      crossTenantStatus: denied,
      reconnectAttempts: getDisconnected(),
      requestCount: actions.length,
      fixture: fixture?.scenario ?? null,
      fixtureEvidence,
    }
  } finally {
    await context.close()
  }
}

async function runGoldenBrowserMatrix(browser) {
  validateGoldenMatrix()
  const results = []
  const failures = []
  for (const [index, row] of GOLDEN_JOURNEYS.entries()) {
    try {
      results.push(await browserGoldenJourney(browser, row, index))
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      failures.push(`golden journey ${index + 1}/${GOLDEN_JOURNEYS.length} (${row.id}) failed: ${message}`)
    }
  }
  if (failures.length) throw new Error(`Product Truth golden browser matrix failures:\n${failures.map((failure) => `- ${failure}`).join("\n")}`)
  if (results.length !== GOLDEN_JOURNEYS.length || results.some((result) => result.status !== "PASS")) throw new Error("Product Truth golden browser matrix did not pass all 30 journeys")
  return results
}

async function clickCanonicalSurface(page, surface) {
  const href = surface === "home" ? "/jarvis" : `/jarvis/${surface}`
  const link = page.locator(`[data-jarvis-surface-nav] a[href="${href}"], [data-jarvis-surface-nav] a[href^="${href}?"]`).first()
  await link.waitFor({ state: "visible", timeout: 30_000 })
  await link.click()
  await page.waitForURL((url) => url.pathname === href, { timeout: 30_000 })
}

function assertSurfaceContext(page, surface, householdId, workId) {
  const url = new URL(page.url())
  const expectedPath = surface === "home" ? "/jarvis" : `/jarvis/${surface}`
  if (url.pathname !== expectedPath) throw new Error(`surface journey reached ${url.pathname}, expected ${expectedPath}`)
  if (surface !== "home" && url.searchParams.get("householdId") !== householdId) throw new Error(`${surface} lost the selected customer context`)
  if (surface !== "home" && url.searchParams.get("workCaseId") !== workId) throw new Error(`${surface} lost the canonical Work context`)
}

async function browserOperatingSurfaceJourney(browser, row, index) {
  const { context, page, input } = await prepareBrowserPage(browser)
  try {
    await page.waitForFunction(() => window.__JARVIS_REALTIME_STATUS__?.status === "live", null, { timeout: 30_000 })
    const instruction = materializeHumanOperabilityInstruction(row, `${index + 1}-${randomUUID()}`)
    const submission = await submitFromBrowser(page, input, row, instruction)
    const responseBody = submission.response
    const compiledCapability = assertExpectedCapability(row, responseBody)
    const canonical = await waitForWorkCase(responseBody.workId)
    const initialPixel = await assertBrowserProjection(page, responseBody.workId, responseBody, canonical, row)

    const sidebar = page.locator("#jarvis-thread-sidebar")
    await sidebar.waitFor({ state: "visible", timeout: 30_000 })
    await sidebar.locator('.jarvis-thread-sidebar__row[data-active="true"]').first().waitFor({ state: "visible", timeout: 30_000 })

    await clickCanonicalSurface(page, "customers")
    const firstCustomer = page.locator("[data-household-id]").first()
    await firstCustomer.waitFor({ state: "visible", timeout: 30_000 })
    const householdId = await firstCustomer.getAttribute("data-household-id")
    if (!householdId) throw new Error("Customers surface returned no selectable canonical household")
    await firstCustomer.click()
    await page.waitForURL((url) => url.pathname === "/jarvis/customers" && url.searchParams.get("householdId") === householdId && url.searchParams.get("workCaseId") === responseBody.workId, { timeout: 30_000 })
    assertSurfaceContext(page, "customers", householdId, responseBody.workId)

    const visited = ["customers"]
    for (const surface of ["money", "work"]) {
      await clickCanonicalSurface(page, surface)
      assertSurfaceContext(page, surface, householdId, responseBody.workId)
      visited.push(surface)
    }

    // Refresh on a deep surface proves that the selected thread, Work, and
    // customer are reconstructed independently of component lifetime.
    await page.reload({ waitUntil: "domcontentloaded", timeout: 45_000 })
    await page.locator(`[data-context-work="${responseBody.workId}"]`).waitFor({ state: "visible", timeout: 45_000 })
    await page.locator('#jarvis-thread-sidebar .jarvis-thread-sidebar__row[data-active="true"]').first().waitFor({ state: "visible", timeout: 45_000 })
    assertSurfaceContext(page, "work", householdId, responseBody.workId)

    await clickCanonicalSurface(page, "schedule")
    assertSurfaceContext(page, "schedule", householdId, responseBody.workId)
    visited.push("schedule")

    await page.locator('#jarvis-thread-sidebar .jarvis-thread-sidebar__row[data-active="true"]').first().click()
    await page.waitForURL((url) => url.pathname === "/jarvis", { timeout: 30_000 })
    await page.locator(`[data-thread-document][data-jarvis-work-id="${responseBody.workId}"]`).first().waitFor({ state: "attached", timeout: 45_000 })
    await page.locator(`[data-context-work="${responseBody.workId}"]`).waitFor({ state: "visible", timeout: 30_000 })

    return {
      id: row.id,
      index: index + 1,
      status: "PASS",
      executionModel: responseBody.executionModel,
      compiledCapability,
      workId: responseBody.workId,
      threadId: responseBody.threadId,
      householdId,
      visited,
      refreshedSurface: "work",
      returnedToThread: true,
      pixel: initialPixel,
    }
  } finally {
    await context.close()
  }
}

async function runHumanOperabilityMatrix(browser, goldenResults) {
  validateHumanOperabilityArtifact()
  const goldenById = new Map(goldenResults.map((result) => [result.id, result]))
  const results = []
  const failures = []
  for (const [index, row] of HUMAN_OPERABILITY_SCENARIOS.entries()) {
    try {
      if (row.linkedGoldenJourneyId) {
        const linked = goldenById.get(row.linkedGoldenJourneyId)
        if (!linked || linked.status !== "PASS") throw new Error(`linked real JARVIS journey ${row.linkedGoldenJourneyId} did not pass`)
        results.push({ id: row.id, index: index + 1, status: "PASS", category: row.category, linkedGoldenJourneyId: row.linkedGoldenJourneyId, workId: linked.workId, executionModel: linked.executionModel })
      } else if (row.surfaceJourney) {
        results.push({ ...(await browserOperatingSurfaceJourney(browser, row, GOLDEN_JOURNEYS.length + index)), category: row.category })
      } else {
        results.push({ ...(await browserGoldenJourney(browser, row, GOLDEN_JOURNEYS.length + index)), category: row.category, heldOut: row.heldOut === true })
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      failures.push(`human operability ${index + 1}/${HUMAN_OPERABILITY_SCENARIOS.length} (${row.id}) failed: ${message}`)
    }
  }
  if (failures.length) throw new Error(`Human Operability Matrix failures:\n${failures.map((failure) => `- ${failure}`).join("\n")}`)
  if (results.length !== HUMAN_OPERABILITY_SCENARIOS.length || results.some((result) => result.status !== "PASS")) throw new Error("Human Operability Matrix did not pass every executable scenario")
  return results
}

const PRODUCTION_SMOKE_IDS = Object.freeze([
  "hello",
  "deterministic-business-query",
  "atomic-email",
  "multi-step-objective",
  "approval-required",
  "refresh-mid-objective",
  "realtime-disconnect-reconnect",
])

async function runProductionSmoke(browser) {
  const byId = new Map(GOLDEN_JOURNEYS.map((row) => [row.id, row]))
  const rows = PRODUCTION_SMOKE_IDS.map((id) => {
    const row = byId.get(id)
    if (!row) throw new Error(`production smoke references unknown journey ${id}`)
    // The production smoke must exercise one approval/control path, while the
    // complete certification corpus remains the source of truth for the full
    // pre-promotion gate.
    return id === "approval-required" ? { ...row, id: "approval-control-smoke", control: "approval" } : row
  })
  const startedAt = Date.now()
  const results = []
  for (const [index, row] of rows.entries()) {
    if (Date.now() - startedAt > 300_000) throw new Error("production smoke exceeded its five-minute budget")
    results.push(await browserGoldenJourney(browser, row, index))
  }
  if (results.length !== rows.length || results.some((result) => result.status !== "PASS")) throw new Error("production smoke did not pass every required journey")
  return { startedAt: new Date(startedAt).toISOString(), durationMs: Date.now() - startedAt, journeys: results }
}

async function assertBrowserAccess(browser) {
  const { context, page, input } = await prepareBrowserPage(browser)
  try {
    const url = page.url()
    const visible = await input.isVisible().catch(() => false)
    if (url !== `${frontendUrl}/jarvis` || !visible) {
      throw new Error(`staged browser access resolved to ${url} without the canonical instruction rail`)
    }
    return { url, authenticated: true }
  } finally {
    await context.close()
  }
}

const [{ body: frontendRelease }, { body: apiRelease }, { body: readiness }, { body: workerHealth }] = await Promise.all([
  fetchJson(`${frontendUrl}/api/release`),
  fetchJson(`${apiUrl}/api/release`),
  fetchJson(`${apiUrl}/api/ready`),
  fetchPublicJson(`${workerUrl}/healthz`),
])
requireRelease("frontend", frontendRelease)
requireRelease("api", apiRelease)
requireRelease("worker gateway", workerHealth?.release)
if (readiness?.checks?.migrations?.detail !== contract.release.requiredMigrationHead || readiness?.checks?.workerFleet?.ok !== true) {
  throw new Error(`API readiness does not prove migration/worker parity: ${JSON.stringify(readiness)}`)
}
if (workerHealth?.realtime !== true || !workerHealth?.capabilities?.includes("sse")) throw new Error("worker gateway does not report realtime+sse capability")

if (certificationMode === "smoke") {
  const browser = await chromium.launch({ headless: true })
  let smoke
  try {
    smoke = await runProductionSmoke(browser)
  } finally {
    await browser.close()
  }
  console.log(JSON.stringify({
    ok: true,
    certificationStatus: "PRODUCTION_SMOKE_PASS",
    certificationRun,
    commitSha: expectedSha,
    releases: {
      frontend: frontendRelease,
      api: apiRelease,
      workerGateway: workerHealth.release,
      migrationHead: readiness.checks.migrations.detail,
    },
    browser: smoke,
    target: { frontendUrl, apiUrl, workerUrl },
  }, null, 2))
  process.exit(0)
}

const { body: baseline } = await fetchJson(`${frontendUrl}/api/jarvis/operational-deltas?limit=1`)
if (!baseline?.cursor) throw new Error("authenticated operational-delta cursor is missing")
const firstStream = await openStream(baseline.cursor)
const firstSubmission = await submitInstruction("live")
const firstDelta = await waitFor(
  () => firstStream.collector.deltas.find((delta) => delta.workId === firstSubmission.workId),
  `live SSE emitted no delta for ${firstSubmission.workId}`,
)
await new Promise((resolveDelay) => setTimeout(resolveDelay, 250))
const disconnectCursor = firstStream.collector.lastCursor
firstStream.controller.abort()
await firstStream.collector.pump
if (firstStream.collector.errors.length || !disconnectCursor) throw new Error(`first SSE collector failed: ${firstStream.collector.errors.join("; ")}`)

const missedSubmission = await submitInstruction("missed-while-disconnected")
const replayStream = await openStream(disconnectCursor)
const replayedDelta = await waitFor(
  () => replayStream.collector.deltas.find((delta) => delta.workId === missedSubmission.workId),
  `Last-Event-ID replay emitted no missed delta for ${missedSubmission.workId}`,
)
await new Promise((resolveDelay) => setTimeout(resolveDelay, 500))
replayStream.controller.abort()
await replayStream.collector.pump
if (replayStream.collector.errors.length) throw new Error(`replay SSE collector failed: ${replayStream.collector.errors.join("; ")}`)
if (replayStream.collector.deltas.filter((delta) => delta.cursor === replayedDelta.cursor).length !== 1) throw new Error("replayed delta was not delivered exactly once")

const browser = await chromium.launch({ headless: true })
let goldenMatrix
let humanOperabilityMatrix
try {
  const browserAccess = await assertBrowserAccess(browser)
  console.error(JSON.stringify({ ok: true, browserAccess }, null, 2))
  goldenMatrix = await runGoldenBrowserMatrix(browser)
  humanOperabilityMatrix = await runHumanOperabilityMatrix(browser, goldenMatrix)
} finally {
  await browser.close()
}

const latency = [
  firstDelta.receivedAt - Date.parse(firstDelta.occurredAt),
  replayedDelta.receivedAt - Date.parse(replayedDelta.occurredAt),
  ...goldenMatrix.map((journey) => journey.commitToPixelMs),
  ...humanOperabilityMatrix.map((journey) => journey.commitToPixelMs),
].filter((value) => Number.isFinite(value)).sort((a, b) => a - b)
const percentile = (p) => latency[Math.min(latency.length - 1, Math.max(0, Math.ceil(latency.length * p) - 1))]
console.log(JSON.stringify({
  ok: true,
  certificationStatus: "HUMAN_BLACK_BOX_RUN_PASS",
  certificationRun,
  commitSha: expectedSha,
  releases: {
    frontend: frontendRelease,
    api: apiRelease,
    workerGateway: workerHealth.release,
    migrationHead: readiness.checks.migrations.detail,
  },
  realtime: {
    gatewayUrl: workerUrl,
    authenticatedHttpStatus: 200,
    contentType: "text/event-stream",
    firstWorkId: firstSubmission.workId,
    firstCursor: firstDelta.cursor,
    replayedWorkId: missedSubmission.workId,
    replayedCursor: replayedDelta.cursor,
    duplicateReplayCursors: 0,
  },
  browser: {
    goldenMatrix,
    goldenJourneyCount: goldenMatrix.length,
    humanOperabilityMatrix,
    humanOperabilityScenarioCount: humanOperabilityMatrix.length,
    registeredCapabilityCount: HUMAN_OPERABILITY_MATRIX.capabilityCoverage.length,
    totalRealJarvisJourneys: goldenMatrix.length + humanOperabilityMatrix.filter((row) => !row.linkedGoldenJourneyId).length,
  },
  latencyMs: { samples: latency, p50: percentile(0.5), p95: percentile(0.95), p99: percentile(0.99) },
}, null, 2))
