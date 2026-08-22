import { getComputerRunBundle, requestComputerCancellation } from "@finnor/computer";
import { canApprove, errorResponse, requireContext } from "../../../../../../lib/auth";

/** Cancellation is durable. The worker checks this flag before every next primitive,
 * releases the ephemeral session, and preserves all prior steps/evidence. */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }): Promise<Response> {
  try {
    const { id } = await params;
    const ctx = await requireContext(req);
    const bundle = await getComputerRunBundle(ctx.tenantId, id);
    if (!bundle) return Response.json({ error: "Computer run not found" }, { status: 404 });
    if (bundle.run.actorId !== ctx.userId && !(await canApprove(ctx, "computer_task"))) {
      return Response.json({ error: "You cannot cancel this computer run" }, { status: 403 });
    }
    const run = await requestComputerCancellation(ctx.tenantId, id);
    return Response.json({ run: run ?? bundle.run, cancellationRequested: Boolean(run) });
  } catch (error) {
    return errorResponse(error);
  }
}
