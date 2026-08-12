import { works, withTenant } from "@finnor/db";
import { and, desc, eq } from "drizzle-orm";
import { errorResponse, requireContext } from "../../../lib/auth";

/** Small discovery API for reconnecting a typed or voice surface to active Work. */
export async function GET(req: Request): Promise<Response> {
  try {
    const ctx = await requireContext(req);
    const url = new URL(req.url);
    const sessionId = url.searchParams.get("sessionId");
    const activeOnly = url.searchParams.get("active") === "true";
    const rows = await withTenant(ctx.tenantId, (db) => db
      .select()
      .from(works)
      .where(and(
        eq(works.tenantId, ctx.tenantId),
        ...(sessionId ? [eq(works.sessionId, sessionId)] : []),
      ))
      .orderBy(desc(works.updatedAt))
      .limit(100));
    const filtered = activeOnly ? rows.filter((work) => work.status !== "completed") : rows;
    return Response.json({ works: filtered });
  } catch (err) {
    return errorResponse(err);
  }
}
