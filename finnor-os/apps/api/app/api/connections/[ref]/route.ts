import { ConnectionError, getConnectionStatus, revokeConnection } from "@finnor/security";
import { errorResponse, requireContext } from "../../../../lib/auth";

function connectionError(error: unknown): Response {
  if (error instanceof ConnectionError) return Response.json({ error: error.message, code: error.code }, { status: error.status });
  return errorResponse(error);
}
export async function GET(req: Request, { params }: { params: Promise<{ ref: string }> }): Promise<Response> {
  try {
    const [ctx, route] = await Promise.all([requireContext(req), params]);
    const status = await getConnectionStatus({ tenantId: ctx.tenantId, actorId: ctx.userId, authProfileRef: route.ref });
    return Response.json(status, { headers: { "cache-control": "no-store" } });
  } catch (error) {
    return connectionError(error);
  }
}

export async function DELETE(req: Request, { params }: { params: Promise<{ ref: string }> }): Promise<Response> {
  try {
    const [ctx, route] = await Promise.all([requireContext(req), params]);
    const result = await revokeConnection({ tenantId: ctx.tenantId, actorId: ctx.userId, authProfileRef: route.ref, traceId: ctx.correlationId });
    return Response.json(result, { headers: { "cache-control": "no-store" } });
  } catch (error) {
    return connectionError(error);
  }
}
