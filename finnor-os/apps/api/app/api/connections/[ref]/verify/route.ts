import { ConnectionError, verifyConnectionHealth } from "@finnor/security";
import { errorResponse, requireContext } from "../../../../../lib/auth";

export async function POST(req: Request, { params }: { params: Promise<{ ref: string }> }): Promise<Response> {
  try {
    const [ctx, route] = await Promise.all([requireContext(req), params]);
    const result = await verifyConnectionHealth({ tenantId: ctx.tenantId, actorId: ctx.userId, authProfileRef: route.ref });
    return Response.json(result, { status: result.usable ? 200 : 409, headers: { "cache-control": "no-store" } });
  } catch (error) {
    if (error instanceof ConnectionError) return Response.json({ error: error.message, code: error.code }, { status: error.status });
    return errorResponse(error);
  }
}
