import { SetOutcomePackEnabledSchema } from "@finnor/policy-schema";
import { setOutcomePackEnabled } from "@finnor/orchestration";
import { errorResponse, requireContext } from "../../../../lib/auth";

export async function POST(req: Request): Promise<Response> {
  try {
    const ctx = await requireContext(req);
    if (ctx.role !== "owner") return Response.json({ error: "Only owners can enable or disable Outcome Packs" }, { status: 403 });
    const parsed = SetOutcomePackEnabledSchema.safeParse(await req.json().catch(() => ({})));
    if (!parsed.success) return Response.json({ error: parsed.error.issues.map((issue) => issue.message).join("; ") }, { status: 400 });
    await setOutcomePackEnabled({ tenantId: ctx.tenantId, actorId: ctx.employeeId ?? ctx.userId, ...parsed.data });
    return Response.json({ updated: true });
  } catch (error) {
    return errorResponse(error);
  }
}
