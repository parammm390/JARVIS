import { execFileSync } from "node:child_process"
import { existsSync, readFileSync } from "node:fs"
import { join, resolve } from "node:path"
import { fileURLToPath } from "node:url"
import { loadContract } from "./release-policy.mjs"

const repoRoot = resolve(fileURLToPath(new URL("../..", import.meta.url)))
const contract = loadContract()
const stateIndex = process.argv.indexOf("--state-file")
const stateFile = stateIndex >= 0 ? process.argv[stateIndex + 1] : undefined
if (!stateFile) throw new Error("Usage: node scripts/release/rollback-production.mjs --state-file <path>")
if (!existsSync(stateFile)) {
  console.log(JSON.stringify({ ok: true, skipped: true, reason: "no production mutation state was captured" }, null, 2))
  process.exit(0)
}

const state = JSON.parse(readFileSync(resolve(stateFile), "utf8"))
if (state.schema !== "finnor.production-rollback-state/v1") throw new Error("rollback state schema is invalid")
const token = process.env.VERCEL_TOKEN?.trim()
if (!token) throw new Error("VERCEL_TOKEN is required for Vercel rollback")

function run(command, args, cwd = repoRoot) {
  const output = execFileSync(command, args, {
    cwd,
    encoding: "utf8",
    maxBuffer: 8 * 1024 * 1024,
    timeout: 180_000,
    env: { ...process.env, AWS_PAGER: "" },
  })
  if (output) process.stdout.write(output)
}

for (const component of ["frontend", "api"]) {
  const target = contract.topology[component]
  const deployment = state[component]
  const reference = deployment?.url || deployment?.id
  if (!reference) throw new Error(`rollback state has no ${component} deployment reference`)
  run("vercel", ["rollback", reference, "--yes", "--scope", target.organizationId, "--token", token], resolve(repoRoot, target.releaseWorkingDirectory))
}

const worker = contract.topology.worker
const previousTaskDefinition = state.worker?.taskDefinition
if (!previousTaskDefinition) throw new Error("rollback state has no previous ECS task definition")
run("aws", [
  "ecs", "update-service",
  "--cluster", worker.clusterName,
  "--service", worker.serviceName,
  "--task-definition", previousTaskDefinition,
  "--desired-count", String(state.worker.desiredCount ?? worker.desiredCount),
  "--region", worker.region,
  "--no-cli-pager",
])

const deadline = Date.now() + 180_000
let stable = false
while (Date.now() < deadline) {
  const raw = execFileSync("aws", ["ecs", "describe-services", "--cluster", worker.clusterName, "--services", worker.serviceName, "--region", worker.region, "--output", "json", "--no-cli-pager"], {
    cwd: repoRoot,
    encoding: "utf8",
    maxBuffer: 8 * 1024 * 1024,
    timeout: 60_000,
    env: { ...process.env, AWS_PAGER: "" },
  })
  const service = JSON.parse(raw).services?.[0]
  const primary = service?.deployments?.find((deployment) => deployment.status === "PRIMARY")
  if (service?.desiredCount === Number(state.worker.desiredCount ?? worker.desiredCount)
    && service.runningCount === service.desiredCount
    && service.pendingCount === 0
    && service.deployments?.length === 1
    && primary?.taskDefinition === previousTaskDefinition) {
    stable = true
    break
  }
  await new Promise((resolveDelay) => setTimeout(resolveDelay, 5_000))
}
if (!stable) throw new Error("ECS worker did not stabilize on the previous task definition during rollback")
console.log(JSON.stringify({ ok: true, rolledBack: true, frontend: state.frontend.id, api: state.api.id, workerTaskDefinition: previousTaskDefinition }, null, 2))
