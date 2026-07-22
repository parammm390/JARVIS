// B1.T2 — the SSE gateway. A small, hand-rolled Node http server (no new dependency —
// SSE is just a long-lived text/event-stream response, nothing a framework buys much
// for here) that runs on its own port on Railway, since Vercel's serverless functions
// can't hold a connection open (§10 risk note). GET /events verifies the caller's own
// Supabase JWT (reusing @finnor/security's resolveTenantFromBearerToken — the same
// logic apps/api/lib/auth.ts's requireContext() now shares, see packages/security/src/
// auth.ts), tenant-scopes the relay, and forwards jarvis_events NOTIFYs — IDs only, per
// B1.T1's own design ("listeners refetch via authz'd APIs"): a client that receives an
// event does not trust its payload for data, it just knows something changed and
// refetches through the REST API it already has tenant-scoped access to.
//
// Auth transport note: native EventSource cannot set custom headers, so the browser
// client (src/lib/jarvis/useLiveQuery.ts) has no way to attach `Authorization: Bearer`.
// This endpoint therefore also accepts the token as a `?token=` query parameter for
// EventSource callers — the standard, widely-used workaround for this exact browser
// limitation (GitHub/Notion/Intercom-style SSE auth). The header path stays available
// for curl/fetch-based callers and is what this session's own verification uses.
// AUTH_DEV_BYPASS follows the identical convention as apps/api/lib/auth.ts's
// requireContext() (header OR query param, gated on NODE_ENV !== "production") so
// integration tests can run against a real HTTP server without a real Supabase account
// — the same standing pattern every other test in this repo already uses.
//
// Reconnect contract: each event carries a monotonic `id:` field, so a browser
// EventSource reconnecting after a drop sends `Last-Event-ID` automatically. This
// gateway does not replay missed events on reconnect — NOTIFY itself isn't persisted,
// so there is nothing to replay from. A client that misses events during a gap relies
// on useLiveQuery's polling fallback (already implemented, C1.T2) to catch up; the
// Last-Event-ID header is read and logged for observability but otherwise honestly
// unused, not silently ignored without saying so.

import http, { type IncomingMessage, type ServerResponse } from "node:http";
import type { Role, TenantContext } from "@finnor/shared-types";
import { resolveTenantFromBearerToken, AuthVerificationError } from "@finnor/security";
import { getLogger } from "@finnor/tools";
import { onJarvisEvent, type JarvisEvent } from "./listener";

type IdentityContext = Omit<TenantContext, "correlationId">;

const HEARTBEAT_MS = 15_000;

function allowedOrigins(): string[] {
  return (process.env.JARVIS_SSE_ALLOWED_ORIGINS ?? "http://localhost:3000,https://finnorai.com")
    .split(",")
    .map((o) => o.trim())
    .filter(Boolean);
}

function corsHeaders(requestOrigin: string | undefined): Record<string, string> {
  const origins = allowedOrigins();
  const origin = requestOrigin && origins.includes(requestOrigin) ? requestOrigin : origins[0]!;
  return {
    "access-control-allow-origin": origin,
    "access-control-allow-methods": "GET, OPTIONS",
    "access-control-allow-headers": "authorization",
    "access-control-max-age": "86400",
    vary: "origin",
  };
}

async function authenticate(req: IncomingMessage, url: URL): Promise<IdentityContext> {
  if (process.env.AUTH_DEV_BYPASS === "1" && process.env.NODE_ENV !== "production") {
    const tenantId = (req.headers["x-tenant-id"] as string | undefined) ?? url.searchParams.get("tenantId") ?? undefined;
    if (tenantId) {
      const userId = (req.headers["x-user-id"] as string | undefined) ?? url.searchParams.get("userId") ?? "00000000-0000-4000-8000-0000000000aa";
      const role = ((req.headers["x-user-role"] as string | undefined) ?? url.searchParams.get("role") ?? "owner") as Role;
      return { tenantId, userId, role };
    }
  }

  const authHeader = req.headers["authorization"];
  const bearer = typeof authHeader === "string" && authHeader.startsWith("Bearer ") ? authHeader.slice("Bearer ".length) : undefined;
  const token = bearer ?? url.searchParams.get("token") ?? undefined;
  if (!token) throw new AuthVerificationError("Missing bearer token", 401);
  return resolveTenantFromBearerToken(token);
}

function handleEvents(req: IncomingMessage, res: ServerResponse, url: URL): void {
  authenticate(req, url)
    .then((ctx) => {
      const lastEventId = req.headers["last-event-id"];
      if (lastEventId) {
        getLogger().info({ tenantId: ctx.tenantId, lastEventId }, "[sse] client reconnected with Last-Event-ID (no replay — polling fallback covers the gap)");
      }

      res.writeHead(200, {
        "content-type": "text/event-stream",
        "cache-control": "no-cache, no-transform",
        connection: "keep-alive",
        "x-accel-buffering": "no",
        ...corsHeaders(req.headers.origin),
      });
      res.write(": connected\n\n");

      let eventCounter = 0;
      const unsubscribe = onJarvisEvent((event: JarvisEvent) => {
        if (event.tenantId !== ctx.tenantId) return;
        eventCounter += 1;
        res.write(`id: ${eventCounter}\n`);
        res.write(`data: ${JSON.stringify(event)}\n\n`);
      });

      const heartbeat = setInterval(() => {
        res.write(": heartbeat\n\n");
      }, HEARTBEAT_MS);

      const cleanup = () => {
        clearInterval(heartbeat);
        unsubscribe();
      };
      req.on("close", cleanup);
      res.on("error", cleanup);
    })
    .catch((err) => {
      const status = err instanceof AuthVerificationError ? err.status : 401;
      const message = err instanceof Error ? err.message : "Unauthorized";
      res.writeHead(status, { "content-type": "application/json", ...corsHeaders(req.headers.origin) });
      res.end(JSON.stringify({ error: message }));
    });
}

export function createSseGateway(): http.Server {
  return http.createServer((req, res) => {
    const url = new URL(req.url ?? "/", "http://internal");
    if (req.method === "OPTIONS") {
      res.writeHead(204, corsHeaders(req.headers.origin));
      res.end();
      return;
    }
    if (req.method === "GET" && url.pathname === "/healthz") {
      res.writeHead(200, { "content-type": "text/plain" });
      res.end("ok");
      return;
    }
    if (req.method === "GET" && url.pathname === "/events") {
      handleEvents(req, res, url);
      return;
    }
    res.writeHead(404, { "content-type": "application/json" });
    res.end(JSON.stringify({ error: "Not found" }));
  });
}
