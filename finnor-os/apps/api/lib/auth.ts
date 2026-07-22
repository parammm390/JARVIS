// Auth + tenant resolution (§17): Supabase Auth verifies the JWT; the users table maps
// identity → tenant_id + role. Every request context carries TenantContext from here on.
// AUTH_DEV_BYPASS=1 allows header-based identity for local dev and integration tests only.

import { randomUUID } from "node:crypto";
import { getPool } from "@finnor/db";
import type { TenantContext, Role } from "@finnor/shared-types";
import { ensureSecretsLoaded, resolveTenantFromBearerToken, AuthVerificationError } from "@finnor/security";
import { initObservability, Sentry, logWithTrace } from "@finnor/tools";
import { checkRateLimit } from "./rate-limit";
import { redactText } from "@finnor/security";

export class AuthError extends Error {
  constructor(
    message: string,
    public readonly status: number,
  ) {
    super(message);
  }
}

/** Phase 16(e): forward an inbound trace id (a caller's own retry/proxy hop) or mint a
 *  fresh one. Tagged onto the current Sentry scope so every breadcrumb/error this
 *  request produces — here and later in the worker, once threaded through enqueueJob —
 *  carries the same id, without adding any new tracing vendor. */
function resolveCorrelationId(req: Request): string {
  const correlationId = req.headers.get("x-correlation-id") ?? randomUUID();
  Sentry.getCurrentScope().setTag("correlation_id", correlationId);
  return correlationId;
}

export async function requireContext(req: Request): Promise<TenantContext> {
  await ensureSecretsLoaded();
  const correlationId = resolveCorrelationId(req);
  // Dev-bypass never applies in production, REGARDLESS of the env var's value — a
  // misconfigured prod deploy that left AUTH_DEV_BYPASS=1 set must not accept forged
  // x-tenant-id headers just because the flag was never flipped off.
  if (process.env.AUTH_DEV_BYPASS === "1" && process.env.NODE_ENV !== "production") {
    const tenantId = req.headers.get("x-tenant-id");
    const userId = req.headers.get("x-user-id") ?? "00000000-0000-4000-8000-0000000000aa";
    const role = (req.headers.get("x-user-role") ?? "owner") as Role;
    if (tenantId) {
      await enforceRateLimit(`tenant:${tenantId}`);
      return { tenantId, userId, role, correlationId };
    }
  }

  const auth = req.headers.get("authorization");
  if (!auth?.startsWith("Bearer ")) throw new AuthError("Missing bearer token", 401);
  const token = auth.slice("Bearer ".length);

  let ctx: Awaited<ReturnType<typeof resolveTenantFromBearerToken>>;
  try {
    ctx = await resolveTenantFromBearerToken(token);
  } catch (err) {
    if (err instanceof AuthVerificationError) throw new AuthError(err.message, err.status);
    throw err;
  }
  await enforceRateLimit(`tenant:${ctx.tenantId}`);
  return { ...ctx, correlationId };
}

async function enforceRateLimit(bucketKey: string): Promise<void> {
  const ok = await checkRateLimit(bucketKey);
  if (!ok) throw new AuthError("Rate limit exceeded — slow down and try again shortly.", 429);
}

/** RBAC (§18): can this role approve this action_type for this tenant? Config, not code. */
export async function canApprove(ctx: TenantContext, actionType: string): Promise<boolean> {
  const { rows } = await getPool().query(
    `SELECT can_approve FROM role_permissions
     WHERE tenant_id = $1 AND role = $2 AND (action_type = $3 OR action_type = '*')
     ORDER BY action_type = $3 DESC LIMIT 1`,
    [ctx.tenantId, ctx.role, actionType],
  );
  if (rows.length === 0) return ctx.role === "owner"; // safe default: only owners
  return Boolean(rows[0].can_approve);
}

export function errorResponse(err: unknown): Response {
  if (err instanceof AuthError) {
    return Response.json({ error: err.message }, { status: err.status });
  }
  initObservability();
  const message = err instanceof Error ? redactText(err.message).value : "Unexpected route failure";
  Sentry.captureException(new Error(message));
  // A2.T2: same correlation_id resolveCorrelationId() already tagged onto this
  // request's Sentry scope — reading it back here means this chokepoint (the one
  // every route's catch already flows through) needs no signature change anywhere.
  const traceId = Sentry.getCurrentScope().getScopeData().tags.correlation_id as string | undefined;
  logWithTrace({ traceId }).error({ err: message }, "unhandled route failure");
  // Plain language outward, details stay in server logs (§22).
  return Response.json({ error: "Something went wrong on our side. Try again shortly." }, { status: 500 });
}
