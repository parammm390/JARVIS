import assert from "node:assert/strict"
import test from "node:test"
import { recoverAzureRunCommandTransport } from "./recover-azure-run-command.mjs"
import { loadContract } from "./release-policy.mjs"

const contract = loadContract()

function workerFixture() {
  return {
    ...contract.topology.worker,
    sseGatewayUrl: "https://worker.example.invalid",
  }
}

function baseAzureResponses(worker, calls) {
  return (args) => {
    calls.push(args)
    if (args[0] === "account") return JSON.stringify({ id: worker.subscriptionId, tenantId: worker.tenantId })
    if (args[0] === "vm" && args[1] === "show") return JSON.stringify({
      id: worker.resourceId,
      vmId: worker.vmId,
      location: worker.location,
      osProfile: { adminUsername: worker.adminUsername },
    })
    if (args[0] === "vm" && args[1] === "get-instance-view") return JSON.stringify({
      statuses: [{ code: "PowerState/running", displayStatus: "VM running" }],
      vmAgent: { statuses: [{ code: "ProvisioningState/succeeded", displayStatus: "Ready" }] },
    })
    return null
  }
}

test("Azure transport recovery resets RunCommandLinux when a stale FINNOR command cannot be deleted, then proves the transport", async () => {
  const sha = "a".repeat(40)
  const worker = workerFixture()
  let clock = 0
  let stale = true
  let extensionPresent = true
  let probeCreated = false
  const calls = []
  const base = baseAzureResponses(worker, calls)

  const exec = (_az, args) => {
    const common = base(args)
    if (common !== null) return common

    if (args[0] === "vm" && args[1] === "run-command" && args[2] === "list") {
      const rows = []
      if (stale) rows.push({ name: `finnor-preflight-${sha.slice(0, 12)}` })
      if (probeCreated) rows.push({ name: `finnor-probe-${sha.slice(0, 12)}` })
      return JSON.stringify(rows)
    }
    if (args[0] === "vm" && args[1] === "run-command" && args[2] === "delete") {
      const name = args[args.indexOf("--run-command-name") + 1]
      if (name?.startsWith("finnor-probe-")) probeCreated = false
      if (name?.startsWith("finnor-preflight-") && !extensionPresent) stale = false
      return "{}"
    }
    if (args[0] === "vm" && args[1] === "run-command" && args[2] === "create") {
      probeCreated = true
      return "{}"
    }
    if (args[0] === "vm" && args[1] === "run-command" && args[2] === "show") {
      return JSON.stringify({
        provisioningState: "Succeeded",
        instanceView: {
          executionState: "Succeeded",
          exitCode: 0,
          output: `FINNOR_AZURE_TRANSPORT_OK ${sha}`,
          error: "",
        },
      })
    }
    if (args[0] === "vm" && args[1] === "extension" && args[2] === "list") {
      return JSON.stringify(extensionPresent ? [{
        name: "RunCommandLinux",
        publisher: "Microsoft.CPlat.Core",
        typePropertiesType: "RunCommandLinux",
      }] : [])
    }
    if (args[0] === "vm" && args[1] === "extension" && args[2] === "delete") {
      extensionPresent = false
      stale = false
      probeCreated = false
      return "{}"
    }
    throw new Error(`unexpected Azure operation: ${args.join(" ")}`)
  }

  const result = await recoverAzureRunCommandTransport(
    { worker, expectedCommitSha: sha },
    {
      exec,
      sleep: (ms) => { clock += Math.max(ms, 60_000) },
      now: () => clock,
    },
  )

  assert.equal(result.action, "RUNCOMMAND_EXTENSION_CONTROL_PLANE_RESET_AND_CLEANUP")
  assert.equal(result.transportProbe, "PASS")
  assert.equal(result.priorReleaseSha, null)
  assert.equal(stale, false)
  assert.equal(extensionPresent, false)
  assert.equal(probeCreated, false)
  assert.ok(calls.some((args) => args[0] === "vm" && args[1] === "extension" && args[2] === "delete"))
  assert.ok(calls.some((args) => args[0] === "vm" && args[1] === "run-command" && args[2] === "create"))
  assert.equal(calls.some((args) => args[0] === "vm" && args[1] === "run-command" && args[2] === "invoke"), false)
  assert.equal(calls.some((args) => args[0] === "ssh"), false)
})

test("Azure transport recovery does not trust a ready VM agent: a wedged clean transport is canaried, reset, and re-probed before release", async () => {
  const sha = "b".repeat(40)
  const worker = workerFixture()
  let clock = 0
  let extensionPresent = true
  let probeCreated = false
  let probeAttempt = 0
  const calls = []
  const base = baseAzureResponses(worker, calls)

  const exec = (_az, args) => {
    const common = base(args)
    if (common !== null) return common

    if (args[0] === "vm" && args[1] === "run-command" && args[2] === "list") {
      return JSON.stringify(probeCreated ? [{ name: `finnor-probe-${sha.slice(0, 12)}` }] : [])
    }
    if (args[0] === "vm" && args[1] === "run-command" && args[2] === "delete") {
      if (!extensionPresent || probeAttempt > 1) probeCreated = false
      return "{}"
    }
    if (args[0] === "vm" && args[1] === "run-command" && args[2] === "create") {
      probeAttempt += 1
      probeCreated = true
      return "{}"
    }
    if (args[0] === "vm" && args[1] === "run-command" && args[2] === "show") {
      if (probeAttempt === 1) {
        return JSON.stringify({ provisioningState: "Succeeded", instanceView: { executionState: "Running" } })
      }
      return JSON.stringify({
        provisioningState: "Succeeded",
        instanceView: {
          executionState: "Succeeded",
          exitCode: 0,
          output: `FINNOR_AZURE_TRANSPORT_OK ${sha}`,
          error: "",
        },
      })
    }
    if (args[0] === "vm" && args[1] === "extension" && args[2] === "list") {
      return JSON.stringify(extensionPresent ? [{
        name: "RunCommandLinux",
        publisher: "Microsoft.CPlat.Core",
        typePropertiesType: "RunCommandLinux",
      }] : [])
    }
    if (args[0] === "vm" && args[1] === "extension" && args[2] === "delete") {
      extensionPresent = false
      probeCreated = false
      return "{}"
    }
    throw new Error(`unexpected Azure operation: ${args.join(" ")}`)
  }

  const result = await recoverAzureRunCommandTransport(
    { worker, expectedCommitSha: sha },
    {
      exec,
      sleep: (ms) => { clock += Math.max(ms, 100_000) },
      now: () => clock,
    },
  )

  assert.equal(result.action, "RUNCOMMAND_EXTENSION_CONTROL_PLANE_RESET_AND_CLEANUP")
  assert.equal(result.transportProbe, "PASS")
  assert.equal(probeAttempt, 2)
  assert.equal(probeCreated, false)
  assert.ok(calls.some((args) => args[0] === "vm" && args[1] === "extension" && args[2] === "delete"))
  assert.equal(calls.some((args) => args[0] === "ssh"), false)
})
