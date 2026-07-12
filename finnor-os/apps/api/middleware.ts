// Edge middleware: CORS for the console origin + cheap auth shape check. Real auth +
// tenant resolution happens in lib/auth.ts inside route handlers (needs Postgres,
// which the edge runtime cannot reach).

import { NextResponse, type NextRequest } from "next/server";

const ALLOWED_ORIGINS = (process.env.CONSOLE_ORIGIN ?? "http://localhost:3101")
  .split(",")
  .map((o) => o.trim());

function corsHeaders(requestOrigin: string | null): Record<string, string> {
  const origin = requestOrigin && ALLOWED_ORIGINS.includes(requestOrigin) ? requestOrigin : ALLOWED_ORIGINS[0]!;
  return {
    "Access-Control-Allow-Origin": origin,
    "Access-Control-Allow-Methods": "GET, POST, PUT, OPTIONS",
    "Access-Control-Allow-Headers": "authorization, content-type, x-tenant-id, x-user-id, x-user-role",
    "Access-Control-Max-Age": "86400",
  };
}

export function middleware(req: NextRequest) {
  const origin = req.headers.get("origin");
  if (req.method === "OPTIONS") {
    return new NextResponse(null, { status: 204, headers: corsHeaders(origin) });
  }
  const isWebhook =
    req.nextUrl.pathname.startsWith("/api/webhooks/") ||
    req.nextUrl.pathname.startsWith("/api/admin/"); // admin routes carry their own ADMIN_SECRET check
  const hasAuth =
    req.headers.has("authorization") ||
    (process.env.AUTH_DEV_BYPASS === "1" && req.headers.has("x-tenant-id"));
  if (!isWebhook && !hasAuth) {
    return NextResponse.json(
      { error: "Missing Authorization header" },
      { status: 401, headers: corsHeaders(origin) },
    );
  }
  const res = NextResponse.next();
  for (const [k, v] of Object.entries(corsHeaders(origin))) res.headers.set(k, v);
  return res;
}

export const config = { matcher: "/api/:path*" };
