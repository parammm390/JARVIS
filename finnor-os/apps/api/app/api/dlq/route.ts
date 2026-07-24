// GET /api/dlq — the dead-letter queue (§2.3). Owner-only: a DLQ entry is a terminal
// external-effect failure the platform gave up retrying — replaying/discarding it is a
// judgment call this codebase reserves for `canApprove(ctx, "*")`, same gate as any
// other owner-scoped action.

import { withTenant, deadLetters, outboxEvents, workflowSteps } from "@finnor/db";
import { and, desc, eq, inArray } from "drizzle-orm";
import { z } from "zod";
import { requireContext, canApprove, errorResponse } from "../../../lib/auth";

const QuerySchema = z.object({
  status: z.enum(["open", "replayed", "discarded"]).default("open"),
  limit: z.coerce.number().int().min(1).max(200).default(50),
});

export async function GET(req: Request): Promise<Response> {
  try {
    const ctx = await requireContext(req);
    if (!(await canApprove(ctx, "*"))) {
      return Response.json({ error: `Your role (${ctx.role}) cannot view the dead-letter queue` }, { status: 403 });
    }
    const url = new URL(req.url);
    const parsed = QuerySchema.safeParse({
      status: url.searchParams.get("status") ?? undefined,
      limit: url.searchParams.get("limit") ?? undefined,
    });
    if (!parsed.success) return Response.json({ error: "Invalid query" }, { status: 400 });

    const rows = await withTenant(ctx.tenantId, (db) =>
      db
        .select()
        .from(deadLetters)
        .where(and(eq(deadLetters.tenantId, ctx.tenantId), eq(deadLetters.status, parsed.data.status)))
        .orderBy(desc(deadLetters.firstSeenAt))
        .limit(parsed.data.limit),
    );
    // A DLQ row can link directly to a workflow step or indirectly through its
    // outbox event. Resolve that relationship in one bounded set of queries so the
    // theater can offer an honest "view linked workflow" jump after replay.
    const outboxIds = rows.flatMap((row) => (row.relatedOutboxEventId ? [row.relatedOutboxEventId] : []));
    const linkedOutbox = outboxIds.length
      ? await withTenant(ctx.tenantId, (db) =>
          db
            .select({ id: outboxEvents.id, workflowStepId: outboxEvents.workflowStepId })
            .from(outboxEvents)
            .where(and(eq(outboxEvents.tenantId, ctx.tenantId), inArray(outboxEvents.id, outboxIds))),
        )
      : [];
    const outboxStepById = new Map(linkedOutbox.map((row) => [row.id, row.workflowStepId]));
    const stepIds = [...new Set(rows.flatMap((row) => {
      const stepId = row.relatedWorkflowStepId ?? (row.relatedOutboxEventId ? outboxStepById.get(row.relatedOutboxEventId) : null);
      return stepId ? [stepId] : [];
    }))];
    const linkedSteps = stepIds.length
      ? await withTenant(ctx.tenantId, (db) =>
          db
            .select({ id: workflowSteps.id, workflowRunId: workflowSteps.workflowRunId })
            .from(workflowSteps)
            .where(and(eq(workflowSteps.tenantId, ctx.tenantId), inArray(workflowSteps.id, stepIds))),
        )
      : [];
    const runByStepId = new Map(linkedSteps.map((row) => [row.id, row.workflowRunId]));

    return Response.json({
      deadLetters: rows.map((row) => {
        const stepId = row.relatedWorkflowStepId ?? (row.relatedOutboxEventId ? outboxStepById.get(row.relatedOutboxEventId) : null);
        return { ...row, relatedWorkflowRunId: stepId ? runByStepId.get(stepId) ?? null : null };
      }),
    });
  } catch (err) {
    return errorResponse(err);
  }
}
