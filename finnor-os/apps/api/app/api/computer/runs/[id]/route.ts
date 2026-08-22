import { getComputerRunBundle } from "@finnor/computer";
import { errorResponse, requireContext } from "../../../../../lib/auth";

/** Safe durable reconstruction for live reconnect. Provider session/profile handles,
 * browser state, artifact bytes, and credential material are absent by construction. */
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }): Promise<Response> {
  try {
    const { id } = await params;
    const ctx = await requireContext(req);
    const bundle = await getComputerRunBundle(ctx.tenantId, id);
    if (!bundle) return Response.json({ error: "Computer run not found" }, { status: 404 });
    return Response.json(bundle);
  } catch (error) {
    return errorResponse(error);
  }
}
