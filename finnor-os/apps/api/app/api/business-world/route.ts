import { BUSINESS_SCENES, type BusinessScene } from "@finnor/shared-types";
import { businessWorld } from "@finnor/read-models";
import { AuthError, errorResponse, requireContext } from "../../../lib/auth";

export async function GET(req: Request): Promise<Response> {
  try {
    const ctx = await requireContext(req);
    const scene = new URL(req.url).searchParams.get("scene");
    if (!scene || !BUSINESS_SCENES.includes(scene as BusinessScene)) {
      throw new AuthError(`scene must be one of: ${BUSINESS_SCENES.join(", ")}`, 400);
    }
    // The existing tenant-wide dispatch surface is owner/dispatcher-only. This
    // projection must not broaden it; technicians keep using their assignment-
    // scoped /api/technician/my-day contract.
    if (scene === "schedule" && ctx.role === "technician") throw new AuthError("Dispatch access required", 403);
    const data = await businessWorld(ctx.tenantId, scene as BusinessScene);
    return Response.json({ data }, { headers: { "cache-control": "private, no-store" } });
  } catch (error) {
    return errorResponse(error);
  }
}
