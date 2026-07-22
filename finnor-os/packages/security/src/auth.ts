// Supabase-JWT verification + tenant resolution (§17), extracted out of
// apps/api/lib/auth.ts so B1.T2's SSE gateway (apps/worker, a plain Node HTTP server,
// not a Next.js Request) can authenticate callers the exact same way — one Supabase
// client + one users-table lookup, not two copies of the same logic. apps/api/lib/
// auth.ts's requireContext() now calls into resolveTenantFromBearerToken() below for
// the bearer-token path; its dev-bypass branch, rate limiting, and Sentry tagging stay
// there since those are Next.js-Request-specific concerns, not identity verification.
//
// Deviation from JARVIS-MAESTRO-PLAN.md §5 B1's "Read: packages/security (JWT verify)"
// line: this logic did not actually live here before B1 — it was inlined inside
// apps/api/lib/auth.ts's requireContext(). Moved here rather than duplicated, which is
// what "Read: packages/security (JWT verify)" implied should already be true.

import { createClient } from "@supabase/supabase-js";
import { getPool } from "@finnor/db";
import type { TenantContext, Role } from "@finnor/shared-types";

export class AuthVerificationError extends Error {
  constructor(
    message: string,
    public readonly status: number,
  ) {
    super(message);
  }
}

export type IdentityContext = Omit<TenantContext, "correlationId">;

/** Verifies a Supabase-issued bearer token and returns the caller's email. Throws
 *  AuthVerificationError (never a bare Error) so every caller can map it to the right
 *  HTTP status without knowing anything about Supabase's own error shape. */
export async function verifyBearerToken(token: string): Promise<{ email: string }> {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new AuthVerificationError("Auth is not configured (SUPABASE_URL / key missing)", 500);
  const supabase = createClient(url, key, { auth: { persistSession: false } });
  const { data, error } = await supabase.auth.getUser(token);
  if (error || !data.user?.email) throw new AuthVerificationError("Invalid or expired token", 401);
  return { email: data.user.email };
}

/** Identity → tenant lookup. Outside any withTenant() scope deliberately — tenant
 *  identity is not yet known at this point, it's the bootstrap step. */
export async function resolveTenantContextByEmail(email: string): Promise<IdentityContext | null> {
  const { rows } = await getPool().query(`SELECT id, tenant_id, role FROM users WHERE email = $1`, [email]);
  const row = rows[0];
  if (!row) return null;
  return { userId: row.id, tenantId: row.tenant_id, role: row.role as Role };
}

/** Bearer token → tenant context in one call. No Next.js Request dependency, so any
 *  Node HTTP surface (Next.js route handlers, apps/worker's SSE gateway) can use it. */
export async function resolveTenantFromBearerToken(token: string): Promise<IdentityContext> {
  const { email } = await verifyBearerToken(token);
  const ctx = await resolveTenantContextByEmail(email);
  if (!ctx) throw new AuthVerificationError("User has no tenant — contact your administrator", 403);
  return ctx;
}
