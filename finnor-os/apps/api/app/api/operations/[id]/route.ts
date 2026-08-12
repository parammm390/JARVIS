import { businessOperationAggregate } from "@finnor/db";
import { errorResponse, requireContext } from "../../../../lib/auth";

/** Tenant-scoped, continuously observable operation/cohort/target/evidence read. */
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }): Promise<Response> {
  try {
    const { id } = await params;
    const ctx = await requireContext(req);
    const operation = await businessOperationAggregate(ctx.tenantId, id);
    if (!operation) return Response.json({ error: "Business operation not found" }, { status: 404 });
    return Response.json({ operation });
  } catch (err) {
    return errorResponse(err);
  }
}
