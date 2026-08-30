import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import test from "node:test"
import { assertCanonicalRelease, assertDeploymentPlan, assertResolvedTarget, assertRuntimeParity, expectedRelease, loadContract } from "./release-policy.mjs"

const contract = loadContract()
const sha = "a".repeat(40)
const release = { ...expectedRelease(sha), traceable: true }
const productionWorkflow = readFileSync(new URL("../../.github/workflows/production-release.yml", import.meta.url), "utf8")
const workerDeployScript = readFileSync(new URL("./azure/deploy-worker.sh", import.meta.url), "utf8")
const ingressScript = readFileSync(new URL("./configure-azure-sse-ingress.mjs", import.meta.url), "utf8")
const workerGateway = readFileSync(new URL("../../finnor-os/apps/worker/src/sse/gateway.ts", import.meta.url), "utf8")

test("production release from a non-main SHA is rejected", () => {
  assert.throws(() => assertCanonicalRelease({ head: sha, remoteMain: "b".repeat(40), dirty: "" }), /not canonical remote main/)
})

test("dirty production release is rejected", () => {
  assert.throws(() => assertCanonicalRelease({ head: sha, remoteMain: sha, dirty: " M file" }), /clean worktree/)
})

test("worker omission rejects the release", () => {
  assert.throws(() => assertDeploymentPlan(contract, ["frontend", "api"]), /worker/)
})

test("separate orchestrator omission rejects the release", () => {
  const separate = structuredClone(contract)
  separate.topology.orchestrator.separateDeployment = true
  assert.throws(() => assertDeploymentPlan(separate, ["frontend", "api", "worker"]), /orchestrator/)
})

test("stale or unknown deployment target is rejected", () => {
  const expected = contract.topology.worker
  assert.throws(
    () => assertResolvedTarget("Azure worker", expected, { ...expected, resourceName: "stale-worker" }, ["resourceId", "resourceName", "vmId"]),
    /differs from canonical contract/,
  )
})

test("runtime SHA mismatch rejects parity", () => {
  const observed = {
    frontend: release,
    api: { ...release, commitSha: "b".repeat(40) },
    worker: { ...release, capabilities: ["orchestration"] },
    migrationHead: contract.release.requiredMigrationHead,
  }
  assert.throws(() => assertRuntimeParity(contract, expectedRelease(sha), observed), /api.commitSha/)
})

test("complete canonical parity passes", () => {
  const observed = {
    frontend: release,
    api: release,
    worker: { ...release, capabilities: ["orchestration"] },
    migrationHead: contract.release.requiredMigrationHead,
  }
  assert.doesNotThrow(() => assertRuntimeParity(contract, expectedRelease(sha), observed))
})

test("production release installs both locked dependency trees with npm ci", () => {
  assert.equal(productionWorkflow.includes("npm install --no-package-lock"), false)
  assert.equal((productionWorkflow.match(/run: npm ci --no-audit --no-fund/g) ?? []).length, 2)
})

test("production preparation consumes the exact commit core-certification artifact", () => {
  const produce = productionWorkflow.indexOf("Produce commit-locked FINNOR core certification")
  const upload = productionWorkflow.indexOf("Export core certification to the release job")
  const download = productionWorkflow.indexOf("Download commit-locked FINNOR core certification")
  const bind = productionWorkflow.indexOf("FINNOR_CORE_CERTIFICATION_FILE=")
  const prepare = productionWorkflow.indexOf("deploy-production.mjs frontend --prepare-only")
  assert.ok(produce > -1 && upload > produce)
  assert.ok(download > upload && bind > download && prepare > bind)
  assert.match(productionWorkflow, /release:certify -- core --core-sha="\$RELEASE_COMMIT_SHA"/)
  assert.match(productionWorkflow, /artifact\.canonicalCoreSha!==process\.env\.RELEASE_COMMIT_SHA/)
})

test("production certification uses the explicit deferred-load profile", () => {
  assert.match(productionWorkflow, /FINNOR_RELEASE_PROFILE:\s*production/)
  assert.match(productionWorkflow, /name: Materialize protected load identities[\s\S]*if: env\.FINNOR_RELEASE_PROFILE != 'production'/)
})

test("Azure worker rollback restores release identity before restarting previous code", () => {
  assert.match(workerDeployScript, /previous_release_env_exists=0/)
  assert.match(workerDeployScript, /if \[ "\$release_env_written" -eq 1 \]; then[\s\S]*install -o root -g finnor -m 0644 "\$previous_release_env" "\$release_env"/)
  const restoreIdentity = workerDeployScript.indexOf('install -o root -g finnor -m 0644 "$previous_release_env" "$release_env"')
  const restoreCheckout = workerDeployScript.indexOf('ln -sfn "$previous_target" "$next_link"')
  const restartPrevious = workerDeployScript.indexOf('systemctl restart "$unit_name" || true')
  assert.ok(restoreIdentity > -1 && restoreCheckout > restoreIdentity && restartPrevious > restoreCheckout)
})

test("Azure worker verifies TLS over loopback and leaves public reachability to parity verification", () => {
  assert.match(workerDeployScript, /--resolve "\$\{sse_hostname\}:443:127\.0\.0\.1"/)
  assert.doesNotMatch(workerDeployScript, /curl --fail --silent --max-time 15 "https:\/\/\$\{sse_hostname\}\/healthz"/)
  const deploy = productionWorkflow.indexOf("Deploy Azure worker and embedded orchestrator")
  const parity = productionWorkflow.indexOf("Verify cross-runtime release and migration parity")
  assert.ok(deploy > -1 && parity > deploy)
})

test("production worker reserves interactive capacity", () => {
  assert.match(workerDeployScript, /WORKER_CONCURRENCY=2/)
  assert.match(workerDeployScript, /WORKER_INTERACTIVE_RESERVED_CONCURRENCY=1/)
  assert.match(workerDeployScript, /FINNOR_DB_POOL_MAX=4/)
})

test("Azure ingress retries only the known hosted-CLI module-lock transient", () => {
  assert.match(ingressScript, /const transientCliFailure = \/.*_ModuleLock/)
  assert.match(ingressScript, /deadlock detected/)
  assert.match(ingressScript, /requests\\\.structures/)
  assert.match(ingressScript, /for \(let attempt = 1; attempt <= 3; attempt\+\+\)/)
  assert.match(ingressScript, /attempt === 3 \|\| !transientCliFailure\.test\(diagnostic\)/)
})

test("worker health contract exposes realtime capability", () => {
  assert.match(workerGateway, /const capabilities = Array\.from\(new Set\(/)
  assert.match(workerGateway, /["']realtime["']/)
  assert.match(workerGateway, /["']sse["']/)
  assert.match(workerGateway, /JSON\.stringify\(\{ ok: true, realtime: true, capabilities, release \}\)/)
})

test("all deployed-certification credentials are required before the first production mutation", () => {
  const credentialGate = productionWorkflow.indexOf("Require production credentials before any mutation")
  const firstMutation = productionWorkflow.indexOf("configure-azure-sse-ingress.mjs")
  assert.ok(credentialGate > -1 && firstMutation > credentialGate)
  const block = productionWorkflow.slice(credentialGate, productionWorkflow.indexOf("- name:", credentialGate + 8))
  for (const name of [
    "VERCEL_TOKEN",
    "AZURE_CLIENT_ID",
    "AZURE_TENANT_ID",
    "AZURE_SUBSCRIPTION_ID",
    "PRODUCT_TRUTH_AUTH_BEARER",
    "PRODUCT_TRUTH_OTHER_AUTH_BEARER",
    "PRODUCT_TRUTH_CERTIFICATION_KEY",
  ]) assert.match(block, new RegExp(`\\b${name}\\b`))
})

test("operational closure requires two complete deployed Human Black-Box runs on one SHA", () => {
  assert.match(productionWorkflow, /npm run release:human-operability -- --check/)
  assert.match(productionWorkflow, /for run in 1 2; do/)
  assert.match(productionWorkflow, /PRODUCT_TRUTH_CERTIFICATION_RUN="\$run" node scripts\/release\/certify-product-truth-deployed\.mjs/)
  assert.match(productionWorkflow, /verify-consecutive-human-certifications\.mjs/)
  assert.match(productionWorkflow, /human-black-box-certification-\$\{\{ github\.sha \}\}/)
})
