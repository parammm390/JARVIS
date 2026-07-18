// Auth + tenant resolution (§17): Supabase Auth verifies the JWT; the users table maps
// identity → tenant_id + role. Every request context carries TenantContext from here on.
// AUTH_DEV_BYPASS=1 allows header-based identity for local dev and integration tests only.

import { createClient } from "@supabase/supabase-js";
import { randomUUID } from "node:crypto";
import { getPool } from "@finnor/db";
import type { TenantContext, Role } from "@finnor/shared-types";
import { ensureSecretsLoaded } from "@finnor/security";
import { initObservability, Sentry } from "@finnor/tools";
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

/**
 * Identity → tenant lookup. This single query runs outside withTenant() because tenant
 * identity is not yet known — it is the bootstrap step, reads only the users table by
 * unique email, and returns the tenant context everything else is scoped by.
 */
async function resolveUserByEmail(email: string): Promise<TenantContext | null> {
  const { rows } = await getPool().query(
    `SELECT id, tenant_id, role FROM users WHERE email = $1`,
    [email],
  );
  const row = rows[0];
  if (!row) return null;
  return { userId: row.id, tenantId: row.tenant_id, role: row.role as Role };
}

/** Phase 16(e): forward an inbound trace id (a caller's own retry/proxy hop) or mint a
 *  fresh one. Tagged onto the current Sentry scope so every breadcrumb/error this
 *  request produces — here and later in the worker/Temporal, once threaded through
 *  enqueueJob — carries the same id, without adding any new tracing vendor. */
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

  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new AuthError("Auth is not configured (SUPABASE_URL / key missing)", 500);

  const supabase = createClient(url, key, { auth: { persistSession: false } });
  const { data, error } = await supabase.auth.getUser(token);
  if (error || !data.user?.email) throw new AuthError("Invalid or expired token", 401);

  const ctx = await resolveUserByEmail(data.user.email);
  if (!ctx) throw new AuthError("User has no tenant — contact your administrator", 403);
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
  console.error(err);
  // Plain language outward, details stay in server logs (§22).
  return Response.json({ error: "Something went wrong on our side. Try again shortly." }, { status: 500 });
}
