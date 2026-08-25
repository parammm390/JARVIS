// Same-origin, non-buffering relay to the always-on worker SSE gateway. The browser
// sends its bearer token as a header; neither tokens nor tenant ids enter the URL.
export const runtime = "edge"

const SSE_GATEWAY = process.env.JARVIS_SSE_GATEWAY_URL

export async function GET(req: Request): Promise<Response> {
  const authorization = req.headers.get("authorization")
  if (!authorization?.startsWith("Bearer ")) return Response.json({ error: "Sign in required" }, { status: 401 })
  if (!SSE_GATEWAY) {
    return Response.json({ error: "BLOCKED-CONFIG: JARVIS_SSE_GATEWAY_URL is not configured" }, { status: 503 })
  }

  const headers: Record<string, string> = { authorization }
  const lastEventId = req.headers.get("last-event-id")
  if (lastEventId) headers["last-event-id"] = lastEventId
  const upstreamUrl = new URL("/events", SSE_GATEWAY)
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
