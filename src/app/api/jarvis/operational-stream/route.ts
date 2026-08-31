// Same-origin, non-buffering relay to the always-on worker SSE gateway. The browser
// sends its bearer token as a header; neither tokens nor tenant ids enter the URL.
export const runtime = "edge"

// Vercel currently terminates this route at 300 seconds. The client already owns
// replay + reconnect from the operational cursor, so rotate the relay before the
// platform hard timeout instead of turning a healthy long-lived SSE session into
// a FUNCTION_INVOCATION_TIMEOUT.
const STREAM_LEASE_MS = 240_000

function configuredGateway(): URL | null {
  for (const value of [process.env.JARVIS_SSE_GATEWAY_URL, process.env.NEXT_PUBLIC_JARVIS_SSE_URL]) {
    const candidate = value?.trim()
    if (!candidate) continue
    try {
      const url = new URL(candidate)
      if (url.protocol === "http:" || url.protocol === "https:") return url
    } catch {
      // Keep the relay fail-closed for malformed deployment configuration.
    }
  }
  return null
}

const SSE_GATEWAY = configuredGateway()

function leasedStream(body: ReadableStream<Uint8Array>, clientSignal: AbortSignal): ReadableStream<Uint8Array> {
  let reader: ReadableStreamDefaultReader<Uint8Array> | null = null
  let leaseTimer: ReturnType<typeof setTimeout> | null = null
  let closed = false
  let abortListener: (() => void) | null = null

  return new ReadableStream<Uint8Array>({
    start(controller) {
      reader = body.getReader()

      const finish = async (error?: unknown) => {
        if (closed) return
        closed = true
        if (leaseTimer !== null) clearTimeout(leaseTimer)
        if (abortListener) clientSignal.removeEventListener("abort", abortListener)
        await reader?.cancel().catch(() => undefined)
        try {
          if (error !== undefined) controller.error(error)
          else controller.close()
        } catch {
          // The downstream may have disconnected while cleanup was in flight.
        }
      }

      abortListener = () => { void finish() }
      clientSignal.addEventListener("abort", abortListener, { once: true })
      leaseTimer = setTimeout(() => { void finish() }, STREAM_LEASE_MS)

      void (async () => {
        try {
          while (!closed) {
            const { done, value } = await reader!.read()
            if (done) {
              await finish()
              return
            }
            if (value) controller.enqueue(value)
          }
        } catch (error) {
          if (!closed) await finish(error)
        }
      })()
    },
    async cancel() {
      if (closed) return
      closed = true
      if (leaseTimer !== null) clearTimeout(leaseTimer)
      if (abortListener) clientSignal.removeEventListener("abort", abortListener)
      await reader?.cancel().catch(() => undefined)
    },
  })
}

export async function GET(req: Request): Promise<Response> {
  const authorization = req.headers.get("authorization")
  if (!authorization?.startsWith("Bearer ")) return Response.json({ error: "Sign in required" }, { status: 401 })
  if (!SSE_GATEWAY) {
    return Response.json({ error: "BLOCKED-CONFIG: JARVIS_SSE_GATEWAY_URL is not configured with a valid HTTP(S) URL" }, { status: 503 })
  }

  const headers: Record<string, string> = { authorization }
  const lastEventId = req.headers.get("last-event-id")
  if (lastEventId) headers["last-event-id"] = lastEventId
  try {
    const upstreamUrl = new URL("/events", SSE_GATEWAY)
    const upstream = await fetch(upstreamUrl, { headers, cache: "no-store" })
    const body = upstream.body ? leasedStream(upstream.body, req.signal) : null
    return new Response(body, {
      status: upstream.status,
      headers: {
        "content-type": upstream.headers.get("content-type") ?? "text/event-stream",
        "cache-control": "no-cache, no-transform",
        connection: "keep-alive",
        "x-jarvis-stream-lease-ms": String(STREAM_LEASE_MS),
      },
    })
  } catch {
    return Response.json({ error: "Realtime gateway unavailable" }, { status: 503 })
  }
}
