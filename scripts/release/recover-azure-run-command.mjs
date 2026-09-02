import { execFileSync } from "node:child_process"
import { writeFileSync } from "node:fs"
import { resolve } from "node:path"
import { fileURLToPath } from "node:url"
import { assertCanonicalRelease, assertResolvedTarget, expectedRelease, loadContract, readGitRelease } from "./release-policy.mjs"

const OWNED_COMMAND = /^finnor-(?:probe|preflight|deploy|parity)-[0-9a-f]{12}$/
const NOT_FOUND = /(?:ResourceNotFound|could not be found|was not found|does not exist)/i
const DELETE_IN_PROGRESS = /(?:AnotherOperationInProgress|OperationPreempted|Conflict|HTTP\s+409|operation.*in progress)/i
const TERMINAL_FAILURE_STATES = new Set(["Failed", "Canceled", "Cancelled", "TimedOut", "Timedout"])
const POLL_INTERVAL_MS = 5_000
const INITIAL_CLEANUP_MS = 45_000
const FINAL_CLEANUP_MS = 2 * 60_000
const RESTART_TIMEOUT_MS = 10 * 60_000
const EXTENSION_RESET_TIMEOUT_MS = 5 * 60_000
const READY_TIMEOUT_MS = 5 * 60_000
const GUEST_AGENT_SETTLE_MS = 20_000
const PROBE_TIMEOUT_MS = 90_000
const PROBE_GUEST_TIMEOUT_SECONDS = 30

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

function runRawAz(exec, az, args, timeout = 90_000) {
  return exec(az, args, {
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

function runCommandExtensionNames(exec, az, worker) {
  const rows = azJson(exec, az, [
    "vm", "extension", "list",
    "--resource-group", worker.resourceGroup,
    "--vm-name", worker.resourceName,
  ]) ?? []
  return rows
    .filter((row) => {
      const publisher = row?.publisher ?? row?.properties?.publisher
      const type = row?.virtualMachineExtensionType ?? row?.typePropertiesType ?? row?.properties?.type
      return publisher === "Microsoft.CPlat.Core" && type === "RunCommandLinux"
    })
    .map((row) => row?.name)
    .filter((name) => typeof name === "string" && name.length > 0)
}

function resetRunCommandExtension(exec, az, worker, sleep, now) {
  const names = runCommandExtensionNames(exec, az, worker)
  if (!names.length) return false

  for (const name of names) {
    runAz(exec, az, [
      "vm", "extension", "delete",
      "--resource-group", worker.resourceGroup,
      "--vm-name", worker.resourceName,
      "--name", name,
      "--no-wait",
    ], EXTENSION_RESET_TIMEOUT_MS)
  }

  const deadline = now() + EXTENSION_RESET_TIMEOUT_MS
  let remaining = runCommandExtensionNames(exec, az, worker)
  while (remaining.length && now() < deadline) {
    sleep(POLL_INTERVAL_MS)
    remaining = runCommandExtensionNames(exec, az, worker)
  }
  if (remaining.length) {
    throw new Error(`Azure RunCommandLinux VM extension did not delete through the control plane: ${remaining.join(", ")}`)
  }
  sleep(GUEST_AGENT_SETTLE_MS)
  return true
}

function restartGuestAgentOverSsh(exec, az, worker) {
  runRawAz(exec, az, ["extension", "add", "--name", "ssh", "--yes", "--only-show-errors"], RESTART_TIMEOUT_MS)
  runRawAz(exec, az, [
    "ssh", "vm",
    "--resource-group", worker.resourceGroup,
    "--name", worker.resourceName,
    "--resource-type", "Microsoft.Compute/virtualMachines",
    "--yes-without-prompt",
    "--",
    "-o", "BatchMode=yes",
    "-o", "ConnectTimeout=30",
    "sudo sh -c 'systemctl restart walinuxagent.service || systemctl restart waagent.service'",
  ], RESTART_TIMEOUT_MS)
}

function showRunCommand(exec, az, worker, name) {
  try {
    return azJson(exec, az, [
      "vm", "run-command", "show",
      "--resource-group", worker.resourceGroup,
      "--vm-name", worker.resourceName,
      "--run-command-name", name,
      "--instance-view",
    ])
  } catch (error) {
    if (NOT_FOUND.test(diagnostic(error))) return null
    throw error
  }
}

function probeRunCommandTransport(exec, az, worker, expectedCommitSha, sleep, now) {
  const name = `finnor-probe-${expectedCommitSha.slice(0, 12)}`
  const marker = `FINNOR_AZURE_TRANSPORT_OK ${expectedCommitSha}`

  issueDeletes(exec, az, worker, [name])
  const preexisting = waitForNoOwnedCommands(exec, az, worker, INITIAL_CLEANUP_MS, sleep, now)
  if (preexisting.includes(name)) throw new Error(`Azure transport probe could not clear prior ${name}`)

  runAz(exec, az, [
    "vm", "run-command", "create",
    "--resource-group", worker.resourceGroup,
    "--vm-name", worker.resourceName,
    "--location", worker.location,
    "--run-command-name", name,
    "--async-execution", "false",
    "--no-wait",
    "--timeout-in-seconds", String(PROBE_GUEST_TIMEOUT_SECONDS),
    "--script", `printf '%s\\n' '${marker}'`,
  ])

  const deadline = now() + PROBE_TIMEOUT_MS
  let last = "command not visible"
  while (now() < deadline) {
    const result = showRunCommand(exec, az, worker, name)
    if (!result) {
      sleep(POLL_INTERVAL_MS)
      continue
    }
    const view = result.instanceView ?? result.properties?.instanceView
    const provisioningState = result.provisioningState ?? result.properties?.provisioningState
    const executionState = view?.executionState
    const exitCode = Number(view?.exitCode)
    const output = typeof view?.output === "string" ? view.output : ""
    const error = typeof view?.error === "string" ? view.error : ""
    last = `provisioning=${provisioningState ?? "unknown"}, execution=${executionState ?? "unknown"}, exit=${Number.isFinite(exitCode) ? exitCode : "missing"}`

    if (executionState === "Succeeded") {
      if (exitCode !== 0 || !output.includes(marker)) {
        throw new Error(`Azure transport probe returned an invalid terminal result (${last}):\n${error || output || "no output"}`)
      }
      issueDeletes(exec, az, worker, [name])
      const remaining = waitForNoOwnedCommands(exec, az, worker, FINAL_CLEANUP_MS, sleep, now)
      if (remaining.includes(name)) throw new Error(`Azure transport probe succeeded but ${name} could not be cleaned up`)
      return
    }
    if (TERMINAL_FAILURE_STATES.has(executionState) || TERMINAL_FAILURE_STATES.has(provisioningState)) {
      throw new Error(`Azure transport probe failed (${last}):\n${error || output || "no output"}`)
    }
    sleep(POLL_INTERVAL_MS)
  }
  throw new Error(`Azure transport probe did not reach terminal success within ${PROBE_TIMEOUT_MS / 1000}s (${last})`)
}

function cleanupOwnedCommands(exec, az, worker, timeoutMs, sleep, now) {
  const names = ownedCommands(exec, az, worker)
  issueDeletes(exec, az, worker, names)
  return waitForNoOwnedCommands(exec, az, worker, timeoutMs, sleep, now)
}

function recoverAndProbe(exec, az, worker, expectedCommitSha, sleep, now) {
  let extensionReset = false
  let usedSsh = false
  let extensionError = null

  try {
    extensionReset = resetRunCommandExtension(exec, az, worker, sleep, now)
  } catch (error) {
    extensionError = error
  }

  waitForWorkerReady(exec, az, worker, sleep, now)
  let remaining = cleanupOwnedCommands(exec, az, worker, FINAL_CLEANUP_MS, sleep, now)

  if (remaining.length || extensionError) {
    try {
      restartGuestAgentOverSsh(exec, az, worker)
      usedSsh = true
      sleep(GUEST_AGENT_SETTLE_MS)
      waitForWorkerReady(exec, az, worker, sleep, now)
      remaining = cleanupOwnedCommands(exec, az, worker, FINAL_CLEANUP_MS, sleep, now)
    } catch (sshError) {
      const prefix = extensionError ? `RunCommand extension reset failed (${diagnostic(extensionError)}); ` : ""
      throw new Error(`${prefix}guest-agent SSH recovery failed:\n${diagnostic(sshError)}`, { cause: sshError })
    }
  }

  if (remaining.length) {
    throw new Error(`Azure RunCommand transport recovery left FINNOR-owned resources: ${remaining.join(", ")}`)
  }

  try {
    probeRunCommandTransport(exec, az, worker, expectedCommitSha, sleep, now)
  } catch (probeError) {
    if (usedSsh) throw probeError
    try {
      restartGuestAgentOverSsh(exec, az, worker)
      usedSsh = true
      sleep(GUEST_AGENT_SETTLE_MS)
      waitForWorkerReady(exec, az, worker, sleep, now)
      remaining = cleanupOwnedCommands(exec, az, worker, FINAL_CLEANUP_MS, sleep, now)
      if (remaining.length) throw new Error(`stale FINNOR RunCommands remain after SSH recovery: ${remaining.join(", ")}`)
      probeRunCommandTransport(exec, az, worker, expectedCommitSha, sleep, now)
    } catch (sshError) {
      throw new Error(`Azure RunCommand transport remained unhealthy after control-plane recovery (${diagnostic(probeError)}); SSH fallback failed:\n${diagnostic(sshError)}`, { cause: sshError })
    }
  }

  return usedSsh
    ? "SSH_AGENT_RESTART_AND_CLEANUP"
    : extensionReset
      ? "RUNCOMMAND_EXTENSION_CONTROL_PLANE_RESET_AND_CLEANUP"
      : "TRANSPORT_PROBE_RECOVERY"
}

export async function recoverAzureRunCommandTransport({ worker, expectedCommitSha, az = process.env.AZURE_CLI || "az" }, {
  exec = execFileSync,
  sleep = defaultSleep,
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

  waitForWorkerReady(exec, az, worker, sleep, now)
  const initial = ownedCommands(exec, az, worker)
  let action = "NONE"

  if (initial.length) {
    issueDeletes(exec, az, worker, initial)
    const remaining = waitForNoOwnedCommands(exec, az, worker, INITIAL_CLEANUP_MS, sleep, now)
    if (!remaining.length) action = "CLEANUP_ONLY"
    else action = recoverAndProbe(exec, az, worker, expectedCommitSha, sleep, now)
  }

  if (action === "NONE" || action === "CLEANUP_ONLY") {
    try {
      probeRunCommandTransport(exec, az, worker, expectedCommitSha, sleep, now)
    } catch {
      action = recoverAndProbe(exec, az, worker, expectedCommitSha, sleep, now)
    }
  }

  return {
    ok: true,
    commitSha: expectedCommitSha,
    action,
    staleCommands: initial,
    priorReleaseSha: null,
    transportProbe: "PASS",
  }
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
