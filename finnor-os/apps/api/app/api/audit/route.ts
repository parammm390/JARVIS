// GET /api/audit — paginated, filterable, read-only audit log (§8, §19).

import { withTenant, actionLog, domainActions } from "@finnor/db";
import { AuditQuerySchema } from "@finnor/policy-schema";
import { desc, eq } from "drizzle-orm";
import { requireContext, errorResponse } from "../../../lib/auth";

export async function GET(req: Request): Promise<Response> {
  try {
    const ctx = await requireContext(req);
    const url = new URL(req.url);
    const q = AuditQuerySchema.safeParse(Object.fromEntries(url.searchParams));
    if (!q.success) return Response.json({ error: "Invalid query" }, { status: 400 });

    const rows = await withTenant(ctx.tenantId, (db) => {
      const query = db
        .select({
          id: actionLog.id,
          domainActionId: actionLog.domainActionId,
          step: actionLog.step,
          input: actionLog.input,
          output: actionLog.output,
          timestamp: actionLog.timestamp,
          actionType: domainActions.actionType,
          status: domainActions.status,
        })
        .from(actionLog)
        .innerJoin(domainActions, eq(actionLog.domainActionId, domainActions.id))
        .orderBy(desc(actionLog.timestamp))
        .limit(q.data.limit)
        .offset(q.data.offset);
      return q.data.actionType
        ? query.where(eq(domainActions.actionType, q.data.actionType))
        : query;
    });
    return Response.json({ entries: rows, limit: q.data.limit, offset: q.data.offset });
  } catch (err) {
    return errorResponse(err);
  }
}
