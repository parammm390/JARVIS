// GET /api/dlq/:id — inspect a single dead-letter row (§2.3). Owner-only.

import { withTenant, deadLetters } from "@finnor/db";
import { and, eq } from "drizzle-orm";
import { requireContext, canApprove, errorResponse } from "../../../../lib/auth";

export async function GET(req: Request, { params }: { params: { id: string } }): Promise<Response> {
  try {
    const ctx = await requireContext(req);
    if (!(await canApprove(ctx, "*"))) {
      return Response.json({ error: `Your role (${ctx.role}) cannot view the dead-letter queue` }, { status: 403 });
    }
    const [row] = await withTenant(ctx.tenantId, (db) =>
      db.select().from(deadLetters).where(and(eq(deadLetters.id, params.id), eq(deadLetters.tenantId, ctx.tenantId))),
    );
    if (!row) return Response.json({ error: "Not found" }, { status: 404 });
    return Response.json({ deadLetter: row });
  } catch (err) {
    return errorResponse(err);
  }
}
