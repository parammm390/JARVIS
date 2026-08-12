import { reconcileWorkStatus, workAggregate } from "@finnor/db";
import { errorResponse, requireContext } from "../../../../lib/auth";

/** Canonical Work read: one tenant-scoped aggregate with every durable causal edge. */
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }): Promise<Response> {
  try {
    const { id } = await params;
    const ctx = await requireContext(req);
    const aggregate = await workAggregate(ctx.tenantId, id);
    if (!aggregate) return Response.json({ error: "Work not found" }, { status: 404 });
    await reconcileWorkStatus(ctx.tenantId, id);
    const reconciled = await workAggregate(ctx.tenantId, id);
    return Response.json({ work: reconciled });
  } catch (err) {
    return errorResponse(err);
  }
}
