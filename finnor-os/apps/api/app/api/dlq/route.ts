// GET /api/dlq — the dead-letter queue (§2.3). Owner-only: a DLQ entry is a terminal
// external-effect failure the platform gave up retrying — replaying/discarding it is a
// judgment call this codebase reserves for `canApprove(ctx, "*")`, same gate as any
// other owner-scoped action.

import { withTenant, deadLetters } from "@finnor/db";
import { and, desc, eq } from "drizzle-orm";
import { z } from "zod";
import { requireContext, canApprove, errorResponse } from "../../../lib/auth";

const QuerySchema = z.object({
  status: z.enum(["open", "replayed", "discarded"]).default("open"),
  limit: z.coerce.number().int().min(1).max(200).default(50),
});

export async function GET(req: Request): Promise<Response> {
  try {
    const ctx = await requireContext(req);
    if (!(await canApprove(ctx, "*"))) {
      return Response.json({ error: `Your role (${ctx.role}) cannot view the dead-letter queue` }, { status: 403 });
    }
    const url = new URL(req.url);
    const parsed = QuerySchema.safeParse({
      status: url.searchParams.get("status") ?? undefined,
      limit: url.searchParams.get("limit") ?? undefined,
    });
    if (!parsed.success) return Response.json({ error: "Invalid query" }, { status: 400 });

    const rows = await withTenant(ctx.tenantId, (db) =>
      db
        .select()
        .from(deadLetters)
        .where(and(eq(deadLetters.tenantId, ctx.tenantId), eq(deadLetters.status, parsed.data.status)))
        .orderBy(desc(deadLetters.firstSeenAt))
        .limit(parsed.data.limit),
    );
    return Response.json({ deadLetters: rows });
  } catch (err) {
    return errorResponse(err);
  }
}
