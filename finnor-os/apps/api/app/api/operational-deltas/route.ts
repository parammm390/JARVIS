import { OperationalCursorError, readOperationalDeltas } from "@finnor/db";
import { AuthError, errorResponse, requireContext } from "../../../lib/auth";

export async function GET(req: Request): Promise<Response> {
  try {
    const ctx = await requireContext(req);
    const search = new URL(req.url).searchParams;
    const limitValue = search.get("limit");
    const limit = limitValue === null ? undefined : Number(limitValue);
    if (limit !== undefined && (!Number.isInteger(limit) || limit < 1)) throw new AuthError("limit must be a positive integer", 400);
    const page = await readOperationalDeltas(ctx.tenantId, search.get("cursor"), limit);
    return Response.json(page, { headers: { "cache-control": "private, no-store" } });
  } catch (error) {
    if (error instanceof OperationalCursorError) {
      return Response.json({ error: error.message, code: error.code }, { status: error.code === "scope_mismatch" ? 409 : 400 });
    }
    return errorResponse(error);
  }
}
