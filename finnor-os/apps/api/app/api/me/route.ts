// GET /api/me — the caller's own identity + role (Phase 7 MAESTRO PACK §7.4: role
// views). The server remains the sole authorizer everywhere else (every RBAC-gated
// route re-checks canApprove independently) — this route only lets the frontend know
// which role-specific surfaces to show, as defense-in-depth on top of real 403s, not a
// new authority.

import { requireContext, errorResponse } from "../../../lib/auth";

export async function GET(req: Request): Promise<Response> {
  try {
    const ctx = await requireContext(req);
    return Response.json({ userId: ctx.userId, tenantId: ctx.tenantId, role: ctx.role });
  } catch (err) {
    return errorResponse(err);
  }
}
