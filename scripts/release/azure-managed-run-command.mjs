import { execFileSync } from "node:child_process"

const NOT_FOUND = /(?:ResourceNotFound|could not be found|was not found|does not exist)/i
const CONTROL_PLANE_TIMEOUT_MS = 5 * 60 * 1000

function errorDiagnostic(error) {
  const stdout = typeof error?.stdout === "string" ? error.stdout.trim() : ""
  const stderr = typeof error?.stderr === "string" ? error.stderr.trim() : ""
  return [stdout, stderr].filter(Boolean).join("\n") || (error instanceof Error ? error.message : String(error))
}

function runAz(exec, az, args, timeout) {
  return exec(az, [...args, "--only-show-errors", "-o", "json"], {
    encoding: "utf8",
    maxBuffer: 32 * 1024 * 1024,
    timeout,
  })
}

function deleteCommand({ exec, az, worker, name, allowMissing }) {
  try {
    runAz(exec, az, [
      "vm", "run-command", "delete",
      "--resource-group", worker.resourceGroup,
      "--vm-name", worker.resourceName,
      "--run-command-name", name,
      "--yes",
    ], CONTROL_PLANE_TIMEOUT_MS)
  } catch (error) {
    const diagnostic = errorDiagnostic(error)
    if (allowMissing && NOT_FOUND.test(diagnostic)) return
    throw new Error(`Azure managed RunCommand cleanup failed for ${name}:\n${diagnostic}`, { cause: error })
  }
}

export function managedRunCommandName(stage, commitSha) {
  if (!/^[a-z][a-z0-9-]{0,23}$/.test(stage)) throw new Error(`invalid managed RunCommand stage: ${stage}`)
  if (!/^[0-9a-f]{40}$/.test(commitSha)) throw new Error("managed RunCommand requires a full lowercase Git SHA")
  return `finnor-${stage}-${commitSha.slice(0, 12)}`
}

/**
 * Execute recurrent release work through Azure's managed RunCommand resource,
 * not the legacy single-active action extension. A deterministic per-stage/SHA
 * resource is removed before and after use. Azure documents that deleting a
 * managed command terminates an in-progress execution, which gives retries a
 * bounded cancellation path instead of leaving the VM extension permanently
 * busy after a hosted-runner timeout.
 */
export function runManagedAzureCommand({
  stage,
  commitSha,
  script,
  timeoutSeconds,
  worker,
  az = process.env.AZURE_CLI || "az",
}, { exec = execFileSync } = {}) {
  if (!worker?.resourceGroup || !worker?.resourceName || !worker?.location) {
    throw new Error("managed RunCommand requires the canonical worker resource group, name, and location")
  }
  if (typeof script !== "string" || script.length === 0) throw new Error("managed RunCommand script is empty")
  if (!Number.isInteger(timeoutSeconds) || timeoutSeconds < 1 || timeoutSeconds > 60 * 60) {
    throw new Error(`managed RunCommand timeout is invalid: ${timeoutSeconds}`)
  }

  const name = managedRunCommandName(stage, commitSha)
  deleteCommand({ exec, az, worker, name, allowMissing: true })

  let primaryError
  try {
    const clientTimeoutMs = Math.max(CONTROL_PLANE_TIMEOUT_MS, (timeoutSeconds + 5 * 60) * 1000)
    runAz(exec, az, [
      "vm", "run-command", "create",
      "--resource-group", worker.resourceGroup,
      "--vm-name", worker.resourceName,
      "--location", worker.location,
      "--run-command-name", name,
      "--async-execution", "false",
      "--timeout-in-seconds", String(timeoutSeconds),
      "--script", script,
    ], clientTimeoutMs)

    const raw = runAz(exec, az, [
      "vm", "run-command", "show",
      "--resource-group", worker.resourceGroup,
      "--vm-name", worker.resourceName,
      "--run-command-name", name,
      "--instance-view",
    ], CONTROL_PLANE_TIMEOUT_MS)
    const result = JSON.parse(raw)
    const view = result.instanceView ?? result.properties?.instanceView
    const executionState = view?.executionState
    const exitCode = Number(view?.exitCode)
    const output = typeof view?.output === "string" ? view.output : ""
    const error = typeof view?.error === "string" ? view.error : ""
    if (executionState !== "Succeeded" || exitCode !== 0) {
      throw new Error(`Azure managed RunCommand ${name} failed (state=${executionState ?? "missing"}, exit=${Number.isFinite(exitCode) ? exitCode : "missing"}):\n${error || output || "no command output"}`)
    }
    return { name, executionState, exitCode, output, error }
  } catch (error) {
    primaryError = error
    throw error
  } finally {
    try {
      deleteCommand({ exec, az, worker, name, allowMissing: true })
    } catch (cleanupError) {
      if (primaryError) throw new AggregateError([primaryError, cleanupError], `Azure managed RunCommand ${name} failed and could not be cleaned up`)
      throw cleanupError
    }
  }
}
