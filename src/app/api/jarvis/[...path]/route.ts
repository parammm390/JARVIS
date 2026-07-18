// Server-side proxy between the public /jarvis marketing page and the finnor-os API.
// The finnor-os backend requires a real Supabase bearer token in production (header-
// based demo auth is intentionally disabled there) — this route holds that token
// server-side only and forwards a strict allowlist of §4 endpoints. GET reads are
// open (read-only, safe to expose publicly); POST writes require x-jarvis-key to
// match JARVIS_ADMIN_KEY so only the owner can approve/reject/instruct from the
// browser. No finnor-os code is touched by this file.
import { NextRequest } from "next/server"
import { getServiceToken } from "@/lib/jarvis/proxy-auth"

const OS_API = process.env.NEXT_PUBLIC_OS_API_URL

const READ_MODEL_VIEWS = new Set([
  "pipeline-health",
  "technician-load",
  "stock-risk",
  "cash-collections",
  "service-due",
  "sla-breaches",
  "follow-up-debt",
  "data-quality",
  "household-360",
])
const RESOURCE_KINDS = new Set(["households", "inventory", "invoices", "technicians", "visits", "compliance-policy", "workflows"])

function isAllowedGet(segments: string[]): boolean {
  const [a, b, c] = segments
  if (segments.length === 1 && a === "stats") return true
  if (segments.length === 2 && a === "actions" && b === "pending") return true
  if (segments.length === 2 && a === "workflows" && b === "runs") return true
  if (segments.length === 1 && a === "events") return true
  if (segments.length === 2 && a === "read-models" && READ_MODEL_VIEWS.has(b!)) return true
  if (segments.length === 1 && a === "comms") return true
  if (segments.length === 1 && a === "insights") return true
  if (segments.length === 2 && a === "setup" && b === "status") return true
  if (segments.length === 2 && a === "integrations" && b === "status") return true
  if (segments.length === 2 && a === "resources" && RESOURCE_KINDS.has(b!)) return true
  if (segments.length === 1 && a === "audit") return true
  void c
  return false
}

function isAllowedPost(segments: string[]): boolean {
  const [a, b, c] = segments
  if (segments.length === 1 && a === "actions") return true
  if (segments.length === 3 && a === "actions" && (c === "confirm" || c === "reject")) return true
  void b
  return false
}

async function forward(req: NextRequest, segments: string[], method: "GET" | "POST"): Promise<Response> {
  if (!OS_API) return Response.json({ error: "Jarvis proxy is not configured" }, { status: 500 })
  let token: string
  try {
    token = await getServiceToken()
  } catch {
    return Response.json({ error: "Jarvis proxy auth unavailable" }, { status: 502 })
  }

  const url = new URL(`${OS_API}/api/${segments.join("/")}`)
  req.nextUrl.searchParams.forEach((v, k) => url.searchParams.set(k, v))

  const init: RequestInit = {
    method,
    headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
    cache: "no-store",
  }
  if (method === "POST") {
    const body = await req.text()
    init.body = body.length > 0 ? body : "{}"
  }

  const upstream = await fetch(url.toString(), init)
  const text = await upstream.text()
  return new Response(text, { status: upstream.status, headers: { "content-type": "application/json" } })
}

export async function GET(req: NextRequest, { params }: { params: { path: string[] } }): Promise<Response> {
  const segments = params.path
  if (!isAllowedGet(segments)) return Response.json({ error: "Not found" }, { status: 404 })
  return forward(req, segments, "GET")
}

export async function POST(req: NextRequest, { params }: { params: { path: string[] } }): Promise<Response> {
  const segments = params.path
  if (!isAllowedPost(segments)) return Response.json({ error: "Not found" }, { status: 404 })
  const key = req.headers.get("x-jarvis-key")
  if (!key || key !== process.env.JARVIS_ADMIN_KEY) {
    return Response.json({ error: "Admin key required" }, { status: 401 })
  }
  return forward(req, segments, "POST")
}
