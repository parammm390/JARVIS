import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import test from "node:test"
import { managedRunCommandName, runManagedAzureCommand } from "./azure-managed-run-command.mjs"
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

test("production release requires final P0-P6 descendant certification without enabling P5 or P6", () => {
  assert.match(productionWorkflow, /FINNOR_CERTIFICATION_P0_P6_LINEAGE:\s*"1"/)
  assert.match(productionWorkflow, /name: Verify immutable P0-P6 production lineage[\s\S]*npm run p6:lineage[\s\S]*npm run p5:certify[\s\S]*npm run p6:certify[\s\S]*npm run test:p0-p6:replay/)
  assert.doesNotMatch(productionWorkflow, /P5_AUTHORITATIVE|P6_AUTHORITATIVE|PROCEDURE_CANDIDATE_EXECUTION_ENABLED/)
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
  const deploy = productionWorkflow.indexOf("deploy-azure-worker.mjs")
  const parity = productionWorkflow.indexOf("Verify cross-runtime release and migration parity")
  assert.ok(deploy > -1 && parity > deploy)
})

test("production worker reserves interactive capacity", () => {
  assert.match(workerDeployScript, /WORKER_CONCURRENCY=2/)
  assert.match(workerDeployScript, /WORKER_INTERACTIVE_RESERVED_CONCURRENCY=1/)
  assert.match(workerDeployScript, /FINNOR_DB_POOL_MAX=4/)
})

test("Azure worker deployment bounds remote package and ingress operations", () => {
  assert.match(workerDeployScript, /deploy_deadline=\$\(\( \$\(date \+%s\) \+ 25 \* 60 \)\)/)
  assert.match(workerDeployScript, /run_bounded "git-clone" 300/)
  assert.match(workerDeployScript, /run_bounded "npm-ci" 900/)
  assert.match(workerDeployScript, /run_bounded "apt-install-ingress" 600/)
  assert.match(workerDeployScript, /run_bounded "certbot" 300/)
  assert.match(workerDeployScript, /timeout --signal=TERM --kill-after=30s/)
})

test("Azure release stages use bounded, self-cleaning managed RunCommand resources", () => {
  const preflight = readFileSync(new URL("./preflight-production.mjs", import.meta.url), "utf8")
  const deploy = readFileSync(new URL("./deploy-azure-worker.mjs", import.meta.url), "utf8")
  const parity = readFileSync(new URL("./verify-production-parity.mjs", import.meta.url), "utf8")
  const managed = readFileSync(new URL("./azure-managed-run-command.mjs", import.meta.url), "utf8")
  assert.match(preflight, /AZURE_COMMAND_TIMEOUT_MS = 5 \* 60 \* 1000/)
  assert.match(preflight, /timeout: AZURE_COMMAND_TIMEOUT_MS/)
  for (const source of [preflight, deploy, parity]) {
    assert.match(source, /runManagedAzureCommand/)
    assert.doesNotMatch(source, /"run-command",\s*"invoke"/)
  }
  assert.match(managed, /"run-command", "create"/)
  assert.match(managed, /"--async-execution", "true"/)
  assert.match(managed, /"--no-wait"/)
  assert.match(managed, /"--timeout-in-seconds"/)
  assert.match(managed, /"run-command", "show"/)
  assert.match(managed, /"--instance-view"/)
  assert.match(managed, /TRANSIENT_CONTROL_PLANE/)
  assert.match(managed, /"run-command", "delete"/)
  assert.match(managed, /finally/)
})

test("managed RunCommand detaches execution, retries transient control-plane failures, and cleans up", () => {
  const worker = { resourceGroup: "canonical-rg", resourceName: "canonical-vm", location: "North Central US" }
  const calls = []
  let exists = false
  let executionShows = 0
  const exec = (_az, args) => {
    calls.push(args)
    const operation = args[2]
    if (operation === "delete") {
      if (!exists) throw Object.assign(new Error("missing"), { stderr: "ResourceNotFound: command was not found" })
      exists = false
      return "{}"
    }
    if (operation === "create") {
      exists = true
      return "{}"
    }
    if (operation === "show") {
      if (!exists) throw Object.assign(new Error("missing"), { stderr: "ResourceNotFound" })
      executionShows += 1
      if (executionShows === 1) throw Object.assign(new Error("control plane timeout"), { stderr: "ETIMEDOUT" })
      return JSON.stringify({ instanceView: { executionState: "Succeeded", exitCode: 0, output: "FINNOR_OK", error: "" } })
    }
    throw new Error(`unexpected Azure operation: ${operation}`)
  }
  const commitSha = "b".repeat(40)
  assert.equal(managedRunCommandName("preflight", commitSha), "finnor-preflight-bbbbbbbbbbbb")
  assert.deepEqual(runManagedAzureCommand(
    { stage: "preflight", commitSha, script: "echo FINNOR_OK", timeoutSeconds: 60, worker },
    { exec, sleep: () => {} },
  ), {
    name: "finnor-preflight-bbbbbbbbbbbb",
    executionState: "Succeeded",
    exitCode: 0,
    output: "FINNOR_OK",
    error: "",
  })
  const create = calls.find((args) => args[2] === "create")
  assert.equal(create[create.indexOf("--async-execution") + 1], "true")
  assert.ok(create.includes("--no-wait"))
  assert.ok(calls.filter((args) => args[2] === "show").length >= 3)
  assert.equal(exists, false)
})

test("managed RunCommand surfaces remote failure and still removes the command", () => {
  const worker = { resourceGroup: "canonical-rg", resourceName: "canonical-vm", location: "North Central US" }
  let exists = false
  let deletes = 0
  const exec = (_az, args) => {
    const operation = args[2]
    if (operation === "delete") {
      deletes += 1
      if (!exists) throw Object.assign(new Error("missing"), { stderr: "ResourceNotFound" })
      exists = false
      return "{}"
    }
    if (operation === "create") {
      exists = true
      return "{}"
    }
    if (operation === "show") {
      if (!exists) throw Object.assign(new Error("missing"), { stderr: "ResourceNotFound" })
      return JSON.stringify({ instanceView: { executionState: "Failed", exitCode: 23, output: "", error: "remote failure" } })
    }
    throw new Error(`unexpected Azure operation: ${operation}`)
  }
  const commitSha = "c".repeat(40)
  assert.throws(
    () => runManagedAzureCommand(
      { stage: "deploy", commitSha, script: "exit 23", timeoutSeconds: 60, worker },
      { exec, sleep: () => {} },
    ),
    /state=Failed, exit=23.*remote failure/s,
  )
  assert.equal(exists, false)
  assert.ok(deletes >= 2)
})

test("managed RunCommand fails closed when cleanup cannot converge", () => {
  const worker = { resourceGroup: "canonical-rg", resourceName: "canonical-vm", location: "North Central US" }
  let clock = 0
  let created = false
  const exec = (_az, args) => {
    const operation = args[2]
    if (operation === "delete") {
      if (!created) throw Object.assign(new Error("missing"), { stderr: "ResourceNotFound" })
      throw Object.assign(new Error("delete timeout"), { stderr: "ETIMEDOUT" })
    }
    if (operation === "create") {
      created = true
      return "{}"
    }
    if (operation === "show") {
      if (!created) throw Object.assign(new Error("missing"), { stderr: "ResourceNotFound" })
      return JSON.stringify({ instanceView: { executionState: "Succeeded", exitCode: 0, output: "FINNOR_OK", error: "" } })
    }
    throw new Error(`unexpected Azure operation: ${operation}`)
  }
  const now = () => clock
  const sleep = (ms) => { clock += Math.max(ms, 60_000) }
  assert.throws(
    () => runManagedAzureCommand(
      { stage: "parity", commitSha: "d".repeat(40), script: "echo FINNOR_OK", timeoutSeconds: 60, worker },
      { exec, sleep, now },
    ),
    /cleanup timed out|could not be cleaned up/,
  )
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
  const firstMutation = Math.min(
    productionWorkflow.indexOf("release:migrate:production"),
    productionWorkflow.indexOf("configure-azure-sse-ingress.mjs"),
  )
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

test("production promotion waits for staged Vercel verification and worker verification", () => {
  const preflight = productionWorkflow.indexOf("preflight-production.mjs")
  const prepare = productionWorkflow.indexOf("deploy-production.mjs frontend --prepare-only")
  const migration = productionWorkflow.indexOf("release:migrate:production")
  const stagedFrontend = productionWorkflow.indexOf("deploy-production.mjs frontend --stage-only")
  const verifiedFrontend = productionWorkflow.indexOf("Verify staged frontend artifact")
  const stagedApi = productionWorkflow.indexOf("deploy-production.mjs api --stage-only")
  const verifiedApi = productionWorkflow.indexOf("Verify staged API artifact")
  const ingress = productionWorkflow.indexOf("configure-azure-sse-ingress.mjs")
  const worker = productionWorkflow.indexOf("deploy-azure-worker.mjs")
  const promoteFrontend = productionWorkflow.indexOf("deploy-production.mjs frontend --promote-only")
  const promoteApi = productionWorkflow.indexOf("deploy-production.mjs api --promote-only")
  const parity = productionWorkflow.indexOf("verify-production-parity.mjs")
  assert.ok(preflight > -1 && prepare > preflight && migration > prepare)
  assert.ok(stagedFrontend > migration && verifiedFrontend > stagedFrontend)
  assert.ok(stagedApi > verifiedFrontend && verifiedApi > stagedApi)
  assert.ok(ingress > verifiedApi && worker > ingress)
  assert.ok(promoteFrontend > worker && promoteApi > promoteFrontend && parity > promoteApi)
})

test("operational closure requires two complete deployed Human Black-Box runs on one SHA", () => {
  assert.match(productionWorkflow, /npm run release:human-operability -- --check/)
  assert.match(productionWorkflow, /for run in 1 2; do/)
  assert.match(productionWorkflow, /PRODUCT_TRUTH_CERTIFICATION_RUN="\$run" node scripts\/release\/certify-product-truth-deployed\.mjs/)
  assert.match(productionWorkflow, /verify-consecutive-human-certifications\.mjs/)
  assert.match(productionWorkflow, /human-black-box-certification-\$\{\{ github\.sha \}\}/)
})
