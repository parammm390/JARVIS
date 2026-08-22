import assert from "node:assert/strict"
import test from "node:test"
import { assertCanonicalRelease, assertDeploymentPlan, assertResolvedTarget, assertRuntimeParity, expectedRelease, loadContract } from "./release-policy.mjs"

const contract = loadContract()
const sha = "a".repeat(40)
const release = { ...expectedRelease(sha), traceable: true }

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
