// Same-origin, non-buffering relay to the always-on worker SSE gateway. The browser
// sends its bearer token as a header; neither tokens nor tenant ids enter the URL.
import deploymentTruth from "../../../../../infra/deployment/production.contract.json"

export const runtime = "edge"

function sseGateway(): string | undefined {
  if (process.env.JARVIS_SSE_GATEWAY_URL) return process.env.JARVIS_SSE_GATEWAY_URL
  // Production's non-secret gateway address is canonical deployment topology,
  // not an independently maintained Vercel setting. Local/staging stays fail-closed
  // unless explicitly configured so degraded-transport tests remain real.
  return process.env.VERCEL_ENV === "production" ? deploymentTruth.topology.worker.sseGatewayUrl : undefined
}

export async function GET(req: Request): Promise<Response> {
  const authorization = req.headers.get("authorization")
  if (!authorization?.startsWith("Bearer ")) return Response.json({ error: "Sign in required" }, { status: 401 })
  const gateway = sseGateway()
  if (!gateway) {
    return Response.json({ error: "BLOCKED-CONFIG: JARVIS_SSE_GATEWAY_URL is not configured" }, { status: 503 })
  }

  const headers: Record<string, string> = { authorization }
  const lastEventId = req.headers.get("last-event-id")
  if (lastEventId) headers["last-event-id"] = lastEventId
  const upstreamUrl = new URL("/events", gateway)
  const upstream = await fetch(upstreamUrl, { headers, cache: "no-store" })
  return new Response(upstream.body, {
    status: upstream.status,
    headers: {
      "content-type": upstream.headers.get("content-type") ?? "text/event-stream",
      "cache-control": "no-cache, no-transform",
      connection: "keep-alive",
    },
  })
}
