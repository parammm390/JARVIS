import { execFileSync } from "node:child_process"
import { writeFileSync } from "node:fs"
import { resolve } from "node:path"
import { fileURLToPath } from "node:url"
import { assertCanonicalRelease, assertResolvedTarget, expectedRelease, loadContract, readGitRelease } from "./release-policy.mjs"

const OWNED_COMMAND = /^finnor-(?:preflight|deploy|parity)-[0-9a-f]{12}$/
const NOT_FOUND = /(?:ResourceNotFound|could not be found|was not found|does not exist)/i
const DELETE_IN_PROGRESS = /(?:AnotherOperationInProgress|OperationPreempted|Conflict|HTTP\s+409|operation.*in progress)/i
const POLL_INTERVAL_MS = 5_000
const INITIAL_CLEANUP_MS = 60_000
const FINAL_CLEANUP_MS = 6 * 60_000
const RESTART_TIMEOUT_MS = 10 * 60_000
const READY_TIMEOUT_MS = 5 * 60_000
const HEALTH_TIMEOUT_MS = 3 * 60_000

function defaultSleep(ms) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms)
}

function diagnostic(error) {
  const stdout = typeof error?.stdout === "string" ? error.stdout.trim() : ""
  const stderr = typeof error?.stderr === "string" ? error.stderr.trim() : ""
  return [stdout, stderr].filter(Boolean).join("\n") || (error instanceof Error ? error.message : String(error))
}

function runAz(exec, az, args, timeout = 90_000) {
  return exec(az, [...args, "--only-show-errors", "-o", "json"], {
    encoding: "utf8",
    maxBuffer: 32 * 1024 * 1024,
    timeout,
  })
}

function azJson(exec, az, args, timeout) {
  const raw = runAz(exec, az, args, timeout)
  return raw.trim() ? JSON.parse(raw) : null
}

function ownedCommands(exec, az, worker) {
  const rows = azJson(exec, az, [
    "vm", "run-command", "list",
    "--resource-group", worker.resourceGroup,
    "--vm-name", worker.resourceName,
  ]) ?? []
  return rows
    .map((row) => row.name)
    .filter((name) => typeof name === "string" && OWNED_COMMAND.test(name))
    .sort()
}

function issueDeletes(exec, az, worker, names) {
  for (const name of names) {
    try {
      runAz(exec, az, [
        "vm", "run-command", "delete",
        "--resource-group", worker.resourceGroup,
        "--vm-name", worker.resourceName,
        "--run-command-name", name,
        "--yes",
        "--no-wait",
      ])
    } catch (error) {
      const detail = diagnostic(error)
      if (!NOT_FOUND.test(detail) && !DELETE_IN_PROGRESS.test(detail)) {
        throw new Error(`could not request cleanup for FINNOR RunCommand ${name}:\n${detail}`, { cause: error })
      }
    }
  }
}

function waitForNoOwnedCommands(exec, az, worker, timeoutMs, sleep, now) {
  const deadline = now() + timeoutMs
  let remaining = ownedCommands(exec, az, worker)
  while (remaining.length && now() < deadline) {
    sleep(POLL_INTERVAL_MS)
    remaining = ownedCommands(exec, az, worker)
  }
  return remaining
}

function workerState(exec, az, worker) {
  const view = azJson(exec, az, [
    "vm", "get-instance-view",
    "--resource-group", worker.resourceGroup,
    "--name", worker.resourceName,
  ])
  const statuses = view?.statuses ?? view?.instanceView?.statuses ?? []
  const agentStatuses = view?.vmAgent?.statuses ?? view?.instanceView?.vmAgent?.statuses ?? []
  return {
    power: statuses.find((status) => status.code?.startsWith("PowerState/"))?.displayStatus,
    agentReady: agentStatuses.some((status) => status.code === "ProvisioningState/succeeded" || status.displayStatus === "Ready"),
  }
}

function waitForWorkerReady(exec, az, worker, sleep, now) {
  const deadline = now() + READY_TIMEOUT_MS
  let state = workerState(exec, az, worker)
  while ((state.power !== "VM running" || !state.agentReady) && now() < deadline) {
    sleep(POLL_INTERVAL_MS)
    state = workerState(exec, az, worker)
  }
  if (state.power !== "VM running" || !state.agentReady) {
    throw new Error(`Azure worker did not return ready after transport recovery (power=${state.power ?? "unknown"}, agentReady=${state.agentReady})`)
  }
}

async function waitForWorkerHealth(fetchImpl, worker, sleepAsync, now) {
  const deadline = now() + HEALTH_TIMEOUT_MS
  let last = "no response"
  while (now() < deadline) {
    try {
      const response = await fetchImpl(`${worker.sseGatewayUrl}/healthz`, {
        headers: { accept: "application/json", "cache-control": "no-cache" },
        signal: AbortSignal.timeout(10_000),
      })
      const body = await response.json().catch(() => null)
      if (response.ok && body?.ok === true && body?.realtime === true && typeof body?.release?.commitSha === "string") {
        return body.release.commitSha
      }
      last = `HTTP ${response.status}`
    } catch (error) {
      last = diagnostic(error)
    }
    await sleepAsync(POLL_INTERVAL_MS)
  }
  throw new Error(`Azure worker did not recover its prior healthy release after restart: ${last}`)
}

export async function recoverAzureRunCommandTransport({ worker, expectedCommitSha, az = process.env.AZURE_CLI || "az" }, {
  exec = execFileSync,
  fetchImpl = globalThis.fetch,
  sleep = defaultSleep,
  sleepAsync = (ms) => new Promise((resolveDelay) => setTimeout(resolveDelay, ms)),
  now = Date.now,
} = {}) {
  if (!/^[0-9a-f]{40}$/.test(expectedCommitSha)) throw new Error("transport recovery requires the exact lowercase release SHA")

  const account = azJson(exec, az, ["account", "show"])
  if (account?.id?.toLowerCase() !== worker.subscriptionId.toLowerCase() || account?.tenantId?.toLowerCase() !== worker.tenantId.toLowerCase()) {
    throw new Error("transport recovery Azure account differs from the canonical contract")
  }
  const vm = azJson(exec, az, ["vm", "show", "--resource-group", worker.resourceGroup, "--name", worker.resourceName])
  assertResolvedTarget("Azure worker transport recovery", worker, {
    resourceId: vm?.id,
    vmId: vm?.vmId,
    location: vm?.location,
    adminUsername: vm?.osProfile?.adminUsername,
  }, ["resourceId", "vmId", "location", "adminUsername"])

  const initial = ownedCommands(exec, az, worker)
  if (!initial.length) {
    const state = workerState(exec, az, worker)
    if (state.power !== "VM running" || !state.agentReady) {
      throw new Error(`Azure worker is not ready and has no FINNOR-owned stale RunCommand to justify recovery (power=${state.power ?? "unknown"}, agentReady=${state.agentReady})`)
    }
    return { ok: true, commitSha: expectedCommitSha, action: "NONE", staleCommands: [], priorReleaseSha: null }
  }

  issueDeletes(exec, az, worker, initial)
  let remaining = waitForNoOwnedCommands(exec, az, worker, INITIAL_CLEANUP_MS, sleep, now)
  if (!remaining.length) {
    return { ok: true, commitSha: expectedCommitSha, action: "CLEANUP_ONLY", staleCommands: initial, priorReleaseSha: null }
  }

  runAz(exec, az, ["vm", "restart", "--ids", worker.resourceId], RESTART_TIMEOUT_MS)
  waitForWorkerReady(exec, az, worker, sleep, now)
  const priorReleaseSha = await waitForWorkerHealth(fetchImpl, worker, sleepAsync, now)

  remaining = ownedCommands(exec, az, worker)
  issueDeletes(exec, az, worker, remaining)
  remaining = waitForNoOwnedCommands(exec, az, worker, FINAL_CLEANUP_MS, sleep, now)
  if (remaining.length) {
    throw new Error(`Azure RunCommand transport recovery left FINNOR-owned resources after restart: ${remaining.join(", ")}`)
  }

  return { ok: true, commitSha: expectedCommitSha, action: "RESTART_AND_CLEANUP", staleCommands: initial, priorReleaseSha }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const outputIndex = process.argv.indexOf("--output-file")
  const outputPath = outputIndex >= 0 ? process.argv[outputIndex + 1] : undefined
  if (!outputPath) throw new Error("Usage: node scripts/release/recover-azure-run-command.mjs --output-file <path>")

  const repoRoot = resolve(fileURLToPath(new URL("../..", import.meta.url)))
  const contract = loadContract()
  const gitRelease = readGitRelease(repoRoot, contract)
  assertCanonicalRelease(gitRelease)
  const expected = expectedRelease(gitRelease.head, process.env.FINNOR_RELEASE_SOURCE || "github-actions")
  const result = await recoverAzureRunCommandTransport({ worker: contract.topology.worker, expectedCommitSha: expected.commitSha })
  const evidence = { ...result, checkedAt: new Date().toISOString(), resourceId: contract.topology.worker.resourceId }
  writeFileSync(resolve(outputPath), `${JSON.stringify(evidence, null, 2)}\n`, { mode: 0o600 })
  console.log(JSON.stringify(evidence, null, 2))
}
