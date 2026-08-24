import { RevokeAutonomyGrantSchema } from "@finnor/policy-schema";
import { revokeAutonomyGrant } from "@finnor/orchestration";
import { errorResponse, requireContext } from "../../../../../lib/auth";

export async function DELETE(req: Request, { params }: { params: Promise<{ id: string }> }): Promise<Response> {
  try {
    const ctx = await requireContext(req);
    if (ctx.role !== "owner") return Response.json({ error: "Only owners can revoke autonomy grants" }, { status: 403 });
    const parsed = RevokeAutonomyGrantSchema.safeParse(await req.json().catch(() => ({})));
    if (!parsed.success) return Response.json({ error: parsed.error.issues.map((issue) => issue.message).join("; ") }, { status: 400 });
    const actorId = ctx.employeeId ?? ctx.userId;
    const revoked = await revokeAutonomyGrant({ tenantId: ctx.tenantId, grantId: (await params).id, actorId, reason: parsed.data.reason });
    return revoked ? Response.json({ revoked: true }) : Response.json({ error: "Active grant not found" }, { status: 404 });
  } catch (error) {
    return errorResponse(error);
  }
}
