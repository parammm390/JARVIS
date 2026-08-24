import { CreateAutonomyGrantSchema } from "@finnor/policy-schema";
import { createAutonomyGrant } from "@finnor/orchestration";
import { autonomyGrants, withTenant } from "@finnor/db";
import { desc, eq } from "drizzle-orm";
import { errorResponse, requireContext } from "../../../../lib/auth";

export async function GET(req: Request): Promise<Response> {
  try {
    const ctx = await requireContext(req);
    if (ctx.role !== "owner") return Response.json({ error: "Only owners can inspect autonomy grants" }, { status: 403 });
    const grants = await withTenant(ctx.tenantId, (db) => db.select().from(autonomyGrants).where(eq(autonomyGrants.tenantId, ctx.tenantId)).orderBy(desc(autonomyGrants.createdAt)));
    return Response.json({ grants });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function POST(req: Request): Promise<Response> {
  try {
    const ctx = await requireContext(req);
    if (ctx.role !== "owner") return Response.json({ error: "Only owners can create autonomy grants" }, { status: 403 });
    const parsed = CreateAutonomyGrantSchema.safeParse(await req.json().catch(() => ({})));
    if (!parsed.success) return Response.json({ error: parsed.error.issues.map((issue) => issue.message).join("; ") }, { status: 400 });
    const grant = await createAutonomyGrant({ ctx, ...parsed.data });
    return Response.json({ grant }, { status: 201 });
  } catch (error) {
    return errorResponse(error);
  }
}
