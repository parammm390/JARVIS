import { compensationCases, integrationOperations, withTenant, workflowSteps } from "@finnor/db";
import { compensateStep } from "@finnor/workflow-runtime";
import { resolveCompensationCapability } from "@finnor/tools";
import { and, desc, eq } from "drizzle-orm";
import { z } from "zod";
import { canApprove, errorResponse, requireContext } from "../../../../../../lib/auth";

const BodySchema = z.object({ reason: z.string().trim().min(3).max(2_000) });

/** A narrow compensation boundary. Only a completed step with a successful, typed
 * integration result and a registered compensate() binding can cross it. */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }): Promise<Response> {
  try {
    const { id } = await params;
    const ctx = await requireContext(req);
    if (!(await canApprove(ctx, "*"))) return Response.json({ error: `Your role (${ctx.role}) cannot compensate workflow effects` }, { status: 403 });
    const parsed = BodySchema.safeParse(await req.json().catch(() => ({})));
    if (!parsed.success) return Response.json({ error: "A compensation reason of 3–2000 characters is required" }, { status: 400 });

    const loaded = await withTenant(ctx.tenantId, async (db) => {
      const [step] = await db.select().from(workflowSteps).where(and(eq(workflowSteps.tenantId, ctx.tenantId), eq(workflowSteps.id, id))).limit(1);
      if (!step) return null;
      const [existing] = await db.select().from(compensationCases).where(and(eq(compensationCases.tenantId, ctx.tenantId), eq(compensationCases.workflowStepId, id))).limit(1);
      const [operation] = await db.select().from(integrationOperations).where(and(eq(integrationOperations.tenantId, ctx.tenantId), eq(integrationOperations.workflowStepId, id))).orderBy(desc(integrationOperations.updatedAt)).limit(1);
      return { step, existing: existing ?? null, operation: operation ?? null };
    }, ctx.userId);
    if (!loaded) return Response.json({ error: "Workflow step not found" }, { status: 404 });
    if (loaded.existing) return Response.json({ caseId: loaded.existing.id, succeeded: loaded.existing.status === "succeeded", idempotent: true });
    if (loaded.step.status !== "completed") return Response.json({ error: `Only completed workflow steps may be compensated; current status is ${loaded.step.status}` }, { status: 409 });
    if (!loaded.operation || loaded.operation.status !== "succeeded" || !loaded.operation.response) return Response.json({ error: "No successful typed capability result is available for compensation" }, { status: 409 });

    const capability = await resolveCompensationCapability(ctx.tenantId, loaded.step.stepType, loaded.step.payload, loaded.operation.response).catch(() => null);
    if (!capability || !capability.binding.compensate) return Response.json({ error: `Step type ${loaded.step.stepType} has no supported compensation contract` }, { status: 409 });
    const result = await compensateStep(ctx.tenantId, id, parsed.data.reason, capability.contract, capability.binding, capability.input, capability.output, ctx.userId, ctx.role);
    return Response.json(result, { status: result.succeeded ? 200 : 502 });
  } catch (error) {
    return errorResponse(error);
  }
}
