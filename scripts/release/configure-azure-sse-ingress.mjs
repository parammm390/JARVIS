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
const azText = (args) => execFileSync(az, [...args, "--only-show-errors", "-o", "tsv"], {
  encoding: "utf8",
  timeout: 5 * 60_000,
}).trim()

const publicIpId = azText([
  "vm", "list-ip-addresses",
  "--resource-group", worker.resourceGroup,
  "--name", worker.resourceName,
  "--query", "[0].virtualMachine.network.publicIpAddresses[0].id",
])
if (!publicIpId.startsWith("/subscriptions/")) throw new Error("Azure worker has no attached public IP resource")

azText(["network", "public-ip", "update", "--ids", publicIpId, "--dns-name", worker.sseGatewayDnsLabel])
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
if (observed !== worker.sseGatewayHostname) {
  throw new Error(`Azure SSE hostname mismatch: expected ${worker.sseGatewayHostname}, observed ${observed || "<missing>"}`)
}
console.log(JSON.stringify({ ok: true, publicIpId, hostname: observed, gatewayUrl: worker.sseGatewayUrl }, null, 2))
