import { execFileSync } from "node:child_process"
import { resolve } from "node:path"
import { fileURLToPath } from "node:url"
import { assertCanonicalRelease, loadContract, readGitRelease } from "./release-policy.mjs"

const repoRoot = resolve(fileURLToPath(new URL("../..", import.meta.url)))
const contract = loadContract()
assertCanonicalRelease(readGitRelease(repoRoot, contract))
const worker = contract.topology.worker
if (!worker.sseGatewayEnabled || !worker.sseGatewayDnsLabel || !worker.sseGatewayHostname || !worker.sseGatewayUrl) {
  throw new Error("Production worker SSE ingress is incomplete in the deployment contract")
}

const az = process.env.AZURE_CLI || "az"
const transientCliFailure = /_ModuleLock|deadlock detected|requests\.structures/i
const azText = (args) => {
  let lastError
  // Azure CLI is a Python process on the hosted runner.  Its Python 3.14
  // requests import has a rare module-lock race; retry only that known
  // transient failure so a real authorization/topology error still fails fast.
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      return execFileSync(az, [...args, "--only-show-errors", "-o", "tsv"], {
        encoding: "utf8",
        timeout: 5 * 60_000,
      }).trim()
    } catch (error) {
      lastError = error
      const diagnostic = [error?.stdout, error?.stderr, error instanceof Error ? error.message : String(error)]
        .filter((value) => typeof value === "string")
        .join("\n")
      if (attempt === 3 || !transientCliFailure.test(diagnostic)) throw error
      execFileSync("sleep", [String(attempt)])
    }
  }
  throw lastError
}
const azOptionalText = (args) => {
  try { return azText(args) } catch { return "" }
}

const nicId = azText([
  "vm", "show",
  "--resource-group", worker.resourceGroup,
  "--name", worker.resourceName,
  "--query", "networkProfile.networkInterfaces[0].id",
])
if (!nicId.startsWith("/subscriptions/")) throw new Error("Azure worker has no primary network interface")
const nicName = nicId.split("/").filter(Boolean).at(-1)
if (!nicName) throw new Error("Unable to resolve Azure worker NIC name")

const ipConfigId = azText(["network", "nic", "show", "--ids", nicId, "--query", "ipConfigurations[0].id"])
if (!ipConfigId.startsWith("/subscriptions/")) throw new Error("Azure worker NIC has no primary IP configuration")
const ipConfigName = ipConfigId.split("/").filter(Boolean).at(-1)
if (!ipConfigName) throw new Error("Unable to resolve Azure worker IP configuration name")

let publicIpId = azOptionalText(["network", "nic", "show", "--ids", nicId, "--query", "ipConfigurations[0].publicIPAddress.id"])
let createdPublicIp = false
if (!publicIpId.startsWith("/subscriptions/")) {
  const publicIpName = `${worker.resourceName}-sse-ip`
  publicIpId = azOptionalText([
    "network", "public-ip", "show",
    "--resource-group", worker.resourceGroup,
    "--name", publicIpName,
    "--query", "id",
  ])
  if (!publicIpId.startsWith("/subscriptions/")) {
    azText([
      "network", "public-ip", "create",
      "--resource-group", worker.resourceGroup,
      "--name", publicIpName,
      "--sku", "Standard",
      "--allocation-method", "Static",
      "--version", "IPv4",
      "--dns-name", worker.sseGatewayDnsLabel,
      "--query", "publicIp.id",
    ])
    publicIpId = azText([
      "network", "public-ip", "show",
      "--resource-group", worker.resourceGroup,
      "--name", publicIpName,
      "--query", "id",
    ])
    createdPublicIp = true
  }
  if (!publicIpId.startsWith("/subscriptions/")) throw new Error("Unable to provision Azure worker public IP resource")
  azText([
    "network", "nic", "ip-config", "update",
    "--resource-group", worker.resourceGroup,
    "--nic-name", nicName,
    "--name", ipConfigName,
    "--public-ip-address", publicIpId,
    "--query", "publicIPAddress.id",
  ])
}

azText(["network", "public-ip", "update", "--ids", publicIpId, "--dns-name", worker.sseGatewayDnsLabel, "--query", "id"])
for (const [port, priority] of [["80", "320"], ["443", "321"]]) {
  azText([
    "vm", "open-port",
    "--resource-group", worker.resourceGroup,
    "--name", worker.resourceName,
    "--port", port,
    "--priority", priority,
  ])
}

const observed = azText(["network", "public-ip", "show", "--ids", publicIpId, "--query", "dnsSettings.fqdn"])
const publicIpAddress = azText(["network", "public-ip", "show", "--ids", publicIpId, "--query", "ipAddress"])
const attachedPublicIpId = azText(["network", "nic", "show", "--ids", nicId, "--query", "ipConfigurations[0].publicIPAddress.id"])
if (attachedPublicIpId.toLowerCase() !== publicIpId.toLowerCase()) {
  throw new Error("Azure worker public IP was not attached to the primary NIC configuration")
}
if (observed !== worker.sseGatewayHostname) {
  throw new Error(`Azure SSE hostname mismatch: expected ${worker.sseGatewayHostname}, observed ${observed || "<missing>"}`)
}
if (!publicIpAddress) throw new Error("Azure SSE public IP has no assigned address")
console.log(JSON.stringify({
  ok: true,
  publicIpId,
  publicIpAddress,
  createdPublicIp,
  nicId,
  hostname: observed,
  gatewayUrl: worker.sseGatewayUrl,
}, null, 2))
