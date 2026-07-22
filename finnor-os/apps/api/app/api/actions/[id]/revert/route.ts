// POST /api/actions/:id/revert — D2.T4 honest undo: approved -> pending, ONLY while
// unclaimed. domain_actions has no `version` column (unlike workflow_runs, which run-
// control-route.ts keys on), so the optimistic-concurrency guard here is the atomic
// conditional UPDATE itself, keyed on status="approved" — the same "conditional
// UPDATE is the single winner" pattern FinnorOrchestrator.decide()/runAction() already
// use, just reusing status as the version.
//
// Real architectural finding (see the D2 STATE block for the full writeup): decide()
// calls runAction() synchronously in the SAME request that approves an action, and
// runAction()'s own atomic UPDATE claims approved -> executing before that request
// even returns. So for every action type today, the "approved" window is sub-
// millisecond by the time this route could ever be called — this endpoint will
// almost always, honestly, report 409 "already claimed." That is not a bug in this
// route; it is what "already-claimed says so truthfully" (the plan's own words) looks
// like given today's synchronous approve-then-execute architecture. Building a real
// grace-period before execution would be an architecture change, out of scope for a
// frontend-cockpit session — flagged for Param, not improvised here.

import { withTenant, domainActions, actionLog } from "@finnor/db";
import { z } from "zod";
import { and, eq } from "drizzle-orm";
import { requireContext, canApprove, errorResponse } from "../../../../../lib/auth";

const RevertActionSchema = z.object({ note: z.string().optional() });

export async function POST(req: Request, { params }: { params: { id: string } }): Promise<Response> {
  try {
    const ctx = await requireContext(req);
    const body = RevertActionSchema.safeParse(await req.json().catch(() => ({})));
    if (!body.success) return Response.json({ error: "Invalid body" }, { status: 400 });

    const row = await withTenant(ctx.tenantId, async (db) => {
      const [r] = await db
        .select()
        .from(domainActions)
        .where(and(eq(domainActions.id, params.id), eq(domainActions.tenantId, ctx.tenantId)));
      return r;
    });
    if (!row) return Response.json({ error: "Action not found" }, { status: 404 });
    if (!(await canApprove(ctx, row.actionType))) {
      return Response.json({ error: `Your role (${ctx.role}) cannot undo a decision on ${row.actionType}` }, { status: 403 });
    }

    const transition = await withTenant(ctx.tenantId, async (db) => {
      const [claimed] = await db
        .update(domainActions)
        .set({ status: "pending" })
        .where(and(eq(domainActions.id, params.id), eq(domainActions.tenantId, ctx.tenantId), eq(domainActions.status, "approved")))
        .returning();
      if (!claimed) {
        const [current] = await db
          .select()
          .from(domainActions)
          .where(and(eq(domainActions.id, params.id), eq(domainActions.tenantId, ctx.tenantId)));
        return { claimed: null as typeof claimed | null, current };
      }
      await db.insert(actionLog).values({
        tenantId: ctx.tenantId,
        domainActionId: params.id,
        step: "reverted",
        input: { by: ctx.userId },
        output: { note: body.data.note ?? null },
      });
      return { claimed, current: claimed };
    });

    if (!transition.claimed) {
      const status = transition.current?.status ?? "unknown";
      return Response.json(
        { error: `Action is ${status} — it's already been claimed and can no longer be undone.`, status },
        { status: 409 },
      );
    }
    return Response.json({ status: "pending", reverted: true });
  } catch (err) {
    return errorResponse(err);
  }
}
