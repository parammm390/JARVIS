import { execFileSync } from "node:child_process"
import { createHash } from "node:crypto"
import { existsSync, readFileSync, writeFileSync } from "node:fs"
import { join, resolve } from "node:path"
import { fileURLToPath } from "node:url"
import { loadContract, readGitRelease } from "./release-policy.mjs"

const repoRoot = resolve(fileURLToPath(new URL("../..", import.meta.url)))
const contract = loadContract()
const outputIndex = process.argv.indexOf("--output-file")
const outputFile = outputIndex >= 0 ? process.argv[outputIndex + 1] : undefined
if (!outputFile) throw new Error("Usage: node scripts/release/capture-production-state.mjs --output-file <path>")

const token = process.env.VERCEL_TOKEN?.trim()
if (!token) throw new Error("VERCEL_TOKEN is required to capture production rollback state")
const gitRelease = readGitRelease(repoRoot, contract)

async function vercel(path) {
  const response = await fetch(`https://api.vercel.com${path}`, {
    headers: { authorization: `Bearer ${token}`, accept: "application/json" },
    signal: AbortSignal.timeout(20_000),
  })
  const body = await response.json().catch(() => null)
  if (!response.ok || !body) throw new Error(`Vercel rollback-state lookup failed (${response.status}) for ${path}`)
  return body
}

async function currentDeployment(component) {
  const target = contract.topology[component]
  const query = new URLSearchParams({ projectId: target.projectId, teamId: target.organizationId, target: "production", limit: "20" })
  const body = await vercel(`/v6/deployments?${query}`)
  const deployments = (body.deployments ?? [])
    .filter((deployment) => ["READY", "READY_STATE"].includes(deployment.readyState ?? deployment.state))
    .sort((a, b) => Number(b.createdAt ?? 0) - Number(a.createdAt ?? 0))
  const deployment = deployments[0]
  if (!deployment) throw new Error(`no READY production deployment found for ${component}`)
  const id = deployment.uid ?? deployment.id
  if (typeof id !== "string" || !/^dpl_/.test(id)) throw new Error(`production ${component} deployment has no rollback id`)
  const url = typeof deployment.url === "string" && deployment.url
    ? `https://${deployment.url}`
    : Array.isArray(deployment.alias) && deployment.alias[0] ? `https://${deployment.alias[0]}` : null
  return { id, url, createdAt: deployment.createdAt ?? null }
}

function awsJson(service, args) {
  const output = execFileSync("aws", [service, ...args, "--region", contract.topology.worker.region, "--output", "json", "--no-cli-pager"], {
    cwd: repoRoot,
    encoding: "utf8",
    maxBuffer: 8 * 1024 * 1024,
    timeout: 60_000,
    env: { ...process.env, AWS_PAGER: "" },
  })
  return JSON.parse(output)
}

if (!existsSync(join(repoRoot, "infra/deployment/production.contract.json"))) throw new Error("canonical production contract is missing")
const worker = contract.topology.worker
const service = awsJson("ecs", ["describe-services", "--cluster", worker.clusterName, "--services", worker.serviceName]).services?.[0]
const taskDefinition = service?.deployments?.find((deployment) => deployment.status === "PRIMARY")?.taskDefinition
if (!taskDefinition || !/^arn:aws:ecs:[^:]+:\d+:task-definition\//.test(taskDefinition)) throw new Error("current ECS primary task definition is missing")

const state = {
  schema: "finnor.production-rollback-state/v1",
  capturedAt: new Date().toISOString(),
  commitSha: gitRelease.head,
  remoteMain: gitRelease.remoteMain,
  contractSha256: createHash("sha256").update(readFileSync(join(repoRoot, "infra/deployment/production.contract.json"))).digest("hex"),
  frontend: await currentDeployment("frontend"),
  api: await currentDeployment("api"),
  worker: {
    clusterName: worker.clusterName,
    serviceName: worker.serviceName,
    taskDefinition,
    desiredCount: service.desiredCount,
  },
}
writeFileSync(resolve(outputFile), `${JSON.stringify(state, null, 2)}\n`, { mode: 0o600 })
console.log(JSON.stringify({ ok: true, outputFile, capturedAt: state.capturedAt, frontend: state.frontend.id, api: state.api.id, workerTaskDefinition: taskDefinition }, null, 2))
