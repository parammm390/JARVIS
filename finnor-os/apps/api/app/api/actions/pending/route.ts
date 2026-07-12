// GET /api/actions/pending — the Confirmation Queue feed (§8). Includes the "blocked"
// and needs_human_review items so nothing is ever silently dropped (§30).

import { withTenant, domainActions } from "@finnor/db";
import { inArray, desc } from "drizzle-orm";
import { requireContext, errorResponse } from "../../../../lib/auth";

export async function GET(req: Request): Promise<Response> {
  try {
    const ctx = await requireContext(req);
    const url = new URL(req.url);
    const filter = url.searchParams.get("filter");
    const statuses =
      filter === "blocked"
        ? (["blocked_integration_unavailable", "needs_human_review"] as const)
        : (["pending"] as const);
    const rows = await withTenant(ctx.tenantId, (db) =>
      db
        .select()
        .from(domainActions)
        .where(inArray(domainActions.status, [...statuses]))
        .orderBy(desc(domainActions.createdAt))
        .limit(100),
    );
    return Response.json({ actions: rows });
  } catch (err) {
    return errorResponse(err);
  }
}
