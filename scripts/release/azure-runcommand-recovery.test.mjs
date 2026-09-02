import assert from "node:assert/strict"
import test from "node:test"
import { recoverAzureRunCommandTransport } from "./recover-azure-run-command.mjs"
import { loadContract } from "./release-policy.mjs"

const contract = loadContract()

test("Azure transport recovery deletes RunCommandLinux through the VM-extension control plane when restart is unauthorized", async () => {
  const sha = "a".repeat(40)
  const worker = {
    ...contract.topology.worker,
    sseGatewayUrl: "https://worker.example.invalid",
  }
  let clock = 0
  let stale = true
  let extensionPresent = true
  const calls = []

  const exec = (_az, args) => {
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
    if (args[0] === "vm" && args[1] === "restart") {
      throw Object.assign(new Error("restart denied"), {
        stderr: "AuthorizationFailed: Microsoft.Compute/virtualMachines/restart/action is not allowed",
      })
    }
    if (args[0] === "vm" && args[1] === "run-command" && args[2] === "list") {
      return JSON.stringify(stale ? [{ name: `finnor-preflight-${sha.slice(0, 12)}` }] : [])
    }
    if (args[0] === "vm" && args[1] === "run-command" && args[2] === "delete") {
      if (!extensionPresent) stale = false
      return "{}"
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
      return "{}"
    }
    throw new Error(`unexpected Azure operation: ${args.join(" ")}`)
  }

  const result = await recoverAzureRunCommandTransport(
    { worker, expectedCommitSha: sha },
    {
      exec,
      sleep: (ms) => { clock += Math.max(ms, 60_000) },
      sleepAsync: async () => {},
      now: () => clock,
      fetchImpl: async () => ({
        ok: true,
        status: 200,
        json: async () => ({ ok: true, realtime: true, release: { commitSha: "b".repeat(40) } }),
      }),
    },
  )

  assert.equal(result.action, "RUNCOMMAND_EXTENSION_CONTROL_PLANE_RESET_AND_CLEANUP")
  assert.equal(result.priorReleaseSha, "b".repeat(40))
  assert.equal(stale, false)
  assert.equal(extensionPresent, false)
  assert.ok(calls.some((args) => args[0] === "vm" && args[1] === "extension" && args[2] === "delete"))
  assert.equal(calls.some((args) => args[0] === "vm" && args[1] === "run-command" && args[2] === "invoke"), false)
  assert.equal(calls.some((args) => args[0] === "ssh"), false)
})
