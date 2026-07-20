// Server-side proxy between the public /jarvis marketing page and the finnor-os API.
// The finnor-os backend requires a real Supabase bearer token in production (header-
// based demo auth is intentionally disabled there). Phase 1.4: private paths now
// forward the CALLER's own bearer token verbatim — the backend's own requireContext/
// canApprove RBAC is the sole authorizer, this file makes no authorization decisions
// beyond "is there a token at all" and "is this path on the allowlist". Only the 3
// public aggregate paths (see isPublicGet) use the shared service-account token, and
// only they accept anonymous requests.
import { NextRequest } from "next/server"
import { z } from "zod"
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
  "reliability",
])
const RESOURCE_KINDS = new Set(["households", "inventory", "invoices", "technicians", "visits", "compliance-policy", "workflows"])

function isPublicGet(segments: string[]): boolean {
  const [a, b] = segments
  if (segments.length === 1 && a === "stats") return true
  if (segments.length === 2 && a === "setup" && b === "status") return true
  if (segments.length === 2 && a === "integrations" && b === "status") return true
  return false
}

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

// --- Boundary validation (§0.3.1): path segments and query params are constrained to
// a safe shape before anything downstream (the allowlist checks, the upstream fetch)
// ever sees them. The backend has its own zod schemas per route (e.g. AuditQuerySchema)
// — this is a proxy-layer floor, not a replacement for that.
const SegmentSchema = z.string().min(1).max(80).regex(/^[a-zA-Z0-9_-]+$/);
const QueryValueSchema = z.string().max(200).regex(/^[^\r\n]*$/);
const QueryKeySchema = z.string().min(1).max(40).regex(/^[a-zA-Z0-9_]+$/);

function validSegments(segments: string[]): boolean {
  return segments.length > 0 && segments.length <= 3 && segments.every((s) => SegmentSchema.safeParse(s).success);
}

function validQuery(url: URL): boolean {
  for (const [key, value] of url.searchParams) {
    if (!QueryKeySchema.safeParse(key).success) return false;
    if (!QueryValueSchema.safeParse(value).success) return false;
  }
  return true;
}

// --- Per-IP rate limiting on the public (keyless) tier only. Best-effort: an
// in-memory sliding window scoped to one warm serverless instance, not a distributed
// guarantee — proportionate here because the public tier is aggregate-only, no PII,
// and this is defense-in-depth against abuse, not the primary auth control.
const RATE_LIMIT_WINDOW_MS = 60_000;
const RATE_LIMIT_MAX = 60;
const rateBuckets = new Map<string, { count: number; windowStart: number }>();

function checkRateLimit(ip: string): boolean {
  const now = Date.now();
  const bucket = rateBuckets.get(ip);
  if (!bucket || now - bucket.windowStart > RATE_LIMIT_WINDOW_MS) {
    rateBuckets.set(ip, { count: 1, windowStart: now });
    return true;
  }
  bucket.count += 1;
  return bucket.count <= RATE_LIMIT_MAX;
}

function clientIp(req: NextRequest): string {
  return req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? req.headers.get("x-real-ip") ?? "unknown";
}

async function doForward(req: NextRequest, segments: string[], method: "GET" | "POST", authorization: string): Promise<Response> {
  if (!OS_API) return Response.json({ error: "Jarvis proxy is not configured" }, { status: 500 });

  const url = new URL(`${OS_API}/api/${segments.join("/")}`);
  req.nextUrl.searchParams.forEach((v, k) => url.searchParams.set(k, v));

  const init: RequestInit = {
    method,
    headers: { authorization, "content-type": "application/json" },
    cache: "no-store",
  };
  if (method === "POST") {
    const body = await req.text();
    init.body = body.length > 0 ? body : "{}";
  }

  const upstream = await fetch(url.toString(), init);
  const text = await upstream.text();
  return new Response(text, { status: upstream.status, headers: { "content-type": "application/json" } });
}

async function forwardPublic(req: NextRequest, segments: string[]): Promise<Response> {
  let token: string;
  try {
    token = await getServiceToken();
  } catch {
    return Response.json({ error: "Jarvis proxy auth unavailable" }, { status: 502 });
  }
  return doForward(req, segments, "GET", `Bearer ${token}`);
}

export async function GET(req: NextRequest, { params }: { params: { path: string[] } }): Promise<Response> {
  const segments = params.path;
  if (!validSegments(segments) || !validQuery(req.nextUrl)) return Response.json({ error: "Invalid request" }, { status: 400 });
  if (!isAllowedGet(segments)) return Response.json({ error: "Not found" }, { status: 404 });

  if (isPublicGet(segments)) {
    if (!checkRateLimit(clientIp(req))) return Response.json({ error: "Rate limit exceeded — slow down and try again shortly." }, { status: 429 });
    return forwardPublic(req, segments);
  }

  const auth = req.headers.get("authorization");
  if (!auth?.startsWith("Bearer ")) return Response.json({ error: "Sign in required" }, { status: 401 });
  return doForward(req, segments, "GET", auth);
}

export async function POST(req: NextRequest, { params }: { params: { path: string[] } }): Promise<Response> {
  const segments = params.path;
  if (!validSegments(segments)) return Response.json({ error: "Invalid request" }, { status: 400 });
  if (!isAllowedPost(segments)) return Response.json({ error: "Not found" }, { status: 404 });

  const auth = req.headers.get("authorization");
  if (!auth?.startsWith("Bearer ")) return Response.json({ error: "Sign in required" }, { status: 401 });
  return doForward(req, segments, "POST", auth);
}
