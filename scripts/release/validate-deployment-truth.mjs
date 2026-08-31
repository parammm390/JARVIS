import { existsSync, readFileSync, readdirSync, statSync } from "node:fs"
import { extname, join, relative, resolve } from "node:path"
import { fileURLToPath } from "node:url"
import { loadContract } from "./release-policy.mjs"

const repoRoot = resolve(fileURLToPath(new URL("../..", import.meta.url)))
const contract = loadContract()
const failures = []
const fail = (message) => failures.push(message)

if (contract.schemaVersion !== 2 || contract.environment !== "production") fail("contract schema/environment is invalid")
if (contract.canonicalGit.branch !== "main" || contract.canonicalGit.remote !== "origin") fail("canonical Git target must be origin/main")
if (!contract.canonicalGit.requireCleanWorktree) fail("production contract must require a clean worktree")
if (contract.release.concurrencyGroup !== "finnor-production-release") fail("production concurrency lock changed")
if (!/^\d{4}_.+\.sql$/.test(contract.release.requiredMigrationHead)) fail("required migration head is invalid")

for (const name of ["frontend", "api", "worker", "orchestrator", "database"]) {
  if (!contract.topology[name]) fail(`topology is missing ${name}`)
}
if (contract.topology.frontend.provider !== "vercel" || contract.topology.api.provider !== "vercel") fail("frontend/API provider must be Vercel")
for (const name of ["frontend", "api"]) {
  const target = contract.topology[name]
  if (!target.releaseWorkingDirectory || target.installCommand !== "npm ci") fail(`${name} must use a source-locked npm ci build contract`)
}
if (contract.topology.worker.provider !== "azure-vm") fail("worker provider must be Azure VM")
for (const key of ["tenantId", "subscriptionId", "resourceGroup", "resourceName", "resourceId", "vmId", "systemdUnit"]) {
  if (!contract.topology.worker[key]) fail(`Azure worker contract is missing ${key}`)
}
if (contract.topology.worker.sseGatewayEnabled !== true) fail("Azure worker SSE gateway must be enabled")
if (!Number.isInteger(contract.topology.worker.sseGatewayPort) || contract.topology.worker.sseGatewayPort < 1024) fail("Azure worker SSE gateway port is invalid")
if (contract.topology.worker.sseGatewayUrl !== `https://${contract.topology.worker.sseGatewayHostname}`) fail("Azure worker SSE URL/hostname drifted")
if (contract.topology.orchestrator.separateDeployment === false && contract.topology.orchestrator.mode !== "embedded-worker") {
  fail("non-separate orchestrator must be embedded in the worker")
}
if (!contract.release.requiredComponents.includes("worker")) fail("worker must be required for every production release")

const migrationPath = join(repoRoot, "finnor-os/packages/db/migrations", contract.release.requiredMigrationHead)
if (!existsSync(migrationPath)) fail(`required migration does not exist: ${relative(repoRoot, migrationPath)}`)

for (const obsolete of ["finnor-os/railway.json", "finnor-os/railway.staging.json", "finnor-os/infra/deployment/worker-service.yaml"]) {
  if (existsSync(join(repoRoot, obsolete))) fail(`obsolete deployment surface still exists: ${obsolete}`)
}

const scanRoots = [
  ".github/workflows",
  "scripts/release",
  "infra/deployment",
]
const textExtensions = new Set([".js", ".mjs", ".ts", ".tsx", ".json", ".yml", ".yaml", ".md"])
const forbidden = /railway|render\.com|render[- ]class|render blueprint|(?:provider|platform|host)(?:\s+is|\s*[:=])\s*["']?render\b/i

function scan(path) {
  if (!existsSync(path)) return
  const info = statSync(path)
  if (info.isDirectory()) {
    for (const name of readdirSync(path)) {
      if (name === "node_modules" || name === ".git" || name === "migrations-bundle.ts") continue
      scan(join(path, name))
    }
    return
  }
  if (!textExtensions.has(extname(path))) return
  const rel = relative(repoRoot, path)
  if (["infra/deployment/production.contract.json", "scripts/release/validate-deployment-truth.mjs"].includes(rel)) return
  const content = readFileSync(path, "utf8")
  if (forbidden.test(content)) fail(`active deployment truth mentions a retired provider: ${rel}`)
}
for (const entry of scanRoots) scan(join(repoRoot, entry))

const workflow = readFileSync(join(repoRoot, ".github/workflows/production-release.yml"), "utf8")
const vercelDeployScript = readFileSync(join(repoRoot, "scripts/release/deploy-production.mjs"), "utf8")
const azureDeployScript = readFileSync(join(repoRoot, "scripts/release/azure/deploy-worker.sh"), "utf8")
const managedRunCommand = readFileSync(join(repoRoot, "scripts/release/azure-managed-run-command.mjs"), "utf8")
const workerDeployClient = readFileSync(join(repoRoot, "scripts/release/deploy-azure-worker.mjs"), "utf8")
const preflightScript = readFileSync(join(repoRoot, "scripts/release/preflight-production.mjs"), "utf8")
const parityScript = readFileSync(join(repoRoot, "scripts/release/verify-production-parity.mjs"), "utf8")
for (const invariant of [
  'sudo -u finnor git -C "$staging_dir" rev-parse HEAD',
  'sudo -u finnor git -C "$staging_dir" status --porcelain=v1 --untracked-files=all',
  'sudo -u finnor git -C "$release_dir" rev-parse HEAD',
  'sudo -u finnor git -C "$release_dir" status --porcelain=v1 --untracked-files=all',
]) {
  if (!azureDeployScript.includes(invariant)) fail(`Azure release verification lost runtime-owner Git guard: ${invariant}`)
}
if (!parityScript.includes("sudo -u finnor git -C '${worker.currentSymlink}' rev-parse HEAD")) {
  fail("Azure parity verification must inspect the runtime-owned checkout as finnor")
}
for (const [label, source] of [["preflight", preflightScript], ["worker deploy", workerDeployClient], ["parity", parityScript]]) {
  if (!source.includes("runManagedAzureCommand")) fail(`Azure ${label} must use managed RunCommand`)
  if (/"run-command",\s*"invoke"/.test(source)) fail(`Azure ${label} still uses the legacy single-active action RunCommand`)
}
for (const invariant of [
  '"run-command", "create"',
  '"--async-execution", "false"',
  '"--timeout-in-seconds"',
  '"run-command", "show"',
  '"--instance-view"',
  '"run-command", "delete"',
  "finally",
]) {
  if (!managedRunCommand.includes(invariant)) fail(`managed RunCommand lost bounded cleanup invariant: ${invariant}`)
}
if (!parityScript.includes("heartbeatDeadline = Date.now() + 120_000") || !parityScript.includes("observedCommit === expected.commitSha")) {
  fail("runtime parity must wait for a fresh heartbeat carrying the canonical release SHA")
}
if (/\b(?:prj_|team_)[A-Za-z0-9]+/.test(workflow)) {
  fail("production workflow must resolve Vercel target IDs from the canonical contract")
}
if (!workflow.includes("production.contract.json').topology.api") || !vercelDeployScript.includes("infra/deployment/production.contract.json")) {
  fail("Vercel release stages must consume the canonical deployment contract")
}
if (!/VERCEL_ORG_ID:\s*TEAM_ID/.test(vercelDeployScript) || !/VERCEL_PROJECT_ID:\s*app\.projectId/.test(vercelDeployScript)) {
  fail("Vercel release commands must be scoped to the exact canonical organization and project IDs")
}
for (const invariant of [
  "node scripts/release/preflight-production.mjs",
  "npm run release:human-operability -- --check",
  "npm run release:migrate:production",
  "node scripts/release/deploy-production.mjs frontend",
  "node scripts/release/deploy-production.mjs api",
  "node scripts/release/deploy-azure-worker.mjs",
  "node scripts/release/configure-azure-sse-ingress.mjs",
  "node scripts/release/verify-production-parity.mjs",
  "node scripts/release/verify-consecutive-human-certifications.mjs",
]) {
  if (!workflow.includes(invariant)) fail(`production workflow omits guarded stage: ${invariant}`)
}
if (!/concurrency:\s*[\s\S]*group:\s*finnor-production-release/.test(workflow)) fail("production workflow lost its concurrency lock")
const credentialGateAt = workflow.indexOf("Require production credentials before any mutation")
const preflightAt = workflow.indexOf("preflight-production.mjs")
const prepareFrontendAt = workflow.indexOf("deploy-production.mjs frontend --prepare-only")
const prepareApiAt = workflow.indexOf("deploy-production.mjs api --prepare-only")
const migrationAt = workflow.indexOf("release:migrate:production")
const stageFrontendAt = workflow.indexOf("deploy-production.mjs frontend --stage-only")
const verifyStagedFrontendAt = workflow.indexOf("Verify staged frontend artifact")
const stageApiAt = workflow.indexOf("deploy-production.mjs api --stage-only")
const verifyStagedApiAt = workflow.indexOf("Verify staged API artifact")
const ingressAt = workflow.indexOf("configure-azure-sse-ingress.mjs")
const workerDeployAt = workflow.indexOf("deploy-azure-worker.mjs")
const promoteFrontendAt = workflow.indexOf("deploy-production.mjs frontend --promote-only")
const promoteApiAt = workflow.indexOf("deploy-production.mjs api --promote-only")
const parityAt = workflow.indexOf("verify-production-parity.mjs")
const firstProductionMutationAt = Math.min(...[migrationAt, ingressAt].filter((value) => value >= 0))
if (credentialGateAt < 0 || firstProductionMutationAt < 0 || credentialGateAt > firstProductionMutationAt) fail("production credentials are not gated before the first mutation")
const nextStepAt = workflow.indexOf("- name:", credentialGateAt + 8)
const credentialGate = workflow.slice(credentialGateAt, nextStepAt < 0 ? workflow.length : nextStepAt)
for (const credential of [
  "VERCEL_TOKEN",
  "AZURE_CLIENT_ID",
  "AZURE_TENANT_ID",
  "AZURE_SUBSCRIPTION_ID",
  "PRODUCT_TRUTH_AUTH_BEARER",
  "PRODUCT_TRUTH_OTHER_AUTH_BEARER",
  "PRODUCT_TRUTH_CERTIFICATION_KEY",
]) {
  if (!credentialGate.includes(credential)) fail(`pre-mutation credential gate omits ${credential}`)
}
if (preflightAt < 0 || migrationAt < 0 || preflightAt > migrationAt) fail("migration can run before production preflight")
if (prepareFrontendAt < preflightAt || prepareApiAt < prepareFrontendAt || migrationAt < prepareApiAt) fail("commit-locked Vercel preparation must finish after preflight and before migration")
if (stageFrontendAt < migrationAt || verifyStagedFrontendAt < stageFrontendAt || stageApiAt < verifyStagedFrontendAt || verifyStagedApiAt < stageApiAt) {
  fail("staged frontend/API artifacts must be created and verified in order after migration")
}
if (ingressAt < verifyStagedApiAt || workerDeployAt < ingressAt) fail("Azure ingress/worker mutation can run before both staged Vercel artifacts verify")
if (promoteFrontendAt < workerDeployAt || promoteApiAt < promoteFrontendAt || parityAt < promoteApiAt) fail("Vercel promotion or parity can run before the worker verifies")
if (!/for run in 1 2; do[\s\S]*PRODUCT_TRUTH_CERTIFICATION_RUN="\$run"[\s\S]*verify-consecutive-human-certifications\.mjs/.test(workflow)) {
  fail("operational closure must require two ordered deployed Human Black-Box runs")
}

if (failures.length) {
  console.error(`Deployment truth validation failed:\n- ${failures.join("\n- ")}`)
  process.exit(1)
}
console.log(JSON.stringify({ ok: true, contract: "infra/deployment/production.contract.json", topology: contract.topology }, null, 2))
