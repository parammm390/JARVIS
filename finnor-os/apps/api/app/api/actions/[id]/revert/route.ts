// POST /api/actions/:id/revert — true durable cancellation. A consequential approval
// immediately owns a workflow run, so this route uses the run's optimistic control:
// before effect commit it guarantees no mutation; after possible effect it records a
// cancellation request and reconciliation rather than pretending to roll back.

import { withTenant, domainActions, actionLog, workflowRuns, workflowSteps } from "@finnor/db";
import { cancelRun } from "@finnor/workflow-runtime";
import { z } from "zod";
import { and, eq, inArray } from "drizzle-orm";
import { requireContext, canApprove, errorResponse } from "../../../../../lib/auth";

const RevertActionSchema = z.object({ note: z.string().optional() });

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }): Promise<Response> {
  try {
    const { id } = await params;
    const ctx = await requireContext(req);
    const body = RevertActionSchema.safeParse(await req.json().catch(() => ({})));
    if (!body.success) return Response.json({ error: "Invalid body" }, { status: 400 });

    const snapshot = await withTenant(ctx.tenantId, async (db) => {
      const [r] = await db
        .select()
        .from(domainActions)
        .where(and(eq(domainActions.id, id), eq(domainActions.tenantId, ctx.tenantId)));
      if (!r) return null;
      const [run] = await db.select({ id: workflowRuns.id, version: workflowRuns.version, status: workflowRuns.status })
        .from(workflowRuns)
        .innerJoin(workflowSteps, eq(workflowSteps.workflowRunId, workflowRuns.id))
        .where(and(
          eq(workflowRuns.tenantId, ctx.tenantId),
          eq(workflowSteps.domainActionId, id),
          inArray(workflowRuns.status, ["running", "paused"]),
        )).limit(1);
      return { action: r, run };
    });
    if (!snapshot) return Response.json({ error: "Action not found" }, { status: 404 });
    if (!(await canApprove(ctx, snapshot.action.actionType))) {
      return Response.json({ error: `Your role (${ctx.role}) cannot undo a decision on ${snapshot.action.actionType}` }, { status: 403 });
    }
    if (snapshot.run) {
      const cancelled = await cancelRun(ctx.tenantId, snapshot.run.id, snapshot.run.version, ctx.userId);
      if (!cancelled.ok) return Response.json({ error: cancelled.reason }, { status: 409 });
      return Response.json({ status: "cancelled", reverted: true, workflowRunId: snapshot.run.id });
    }

    const transition = await withTenant(ctx.tenantId, async (db) => {
      const [claimed] = await db
        .update(domainActions)
        .set({ status: "pending" })
        .where(and(eq(domainActions.id, id), eq(domainActions.tenantId, ctx.tenantId), eq(domainActions.status, "approved")))
        .returning();
      if (!claimed) {
        const [current] = await db
          .select()
          .from(domainActions)
          .where(and(eq(domainActions.id, id), eq(domainActions.tenantId, ctx.tenantId)));
        return { claimed: null as typeof claimed | null, current };
      }
      await db.insert(actionLog).values({
        tenantId: ctx.tenantId,
        domainActionId: id,
        step: "reverted",
        input: { by: ctx.userId },
        output: { note: body.data.note ?? null },
      });
      return { claimed, current: claimed };
    });

    if (!transition.claimed) {
      const status = transition.current?.status ?? "unknown";
      return Response.json(
        { error: `Action has already been claimed (${status}) and has no cancellable durable run.`, status },
        { status: 409 },
      );
    }
    return Response.json({ status: "pending", reverted: true });
  } catch (err) {
    return errorResponse(err);
  }
}
