import { businessOperationAggregate, domainActions, retryBusinessOperation, withTenant } from "@finnor/db";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { errorResponse, requireContext } from "../../../../../lib/auth";
import { evaluateAuthority } from "@finnor/authority";
import { resumeObjectiveForAction } from "@finnor/orchestration";

const RetryOperationSchema = z.object({ recoveryKey: z.string().min(1).max(200) });

/** Human-authorized recovery of only the failed retryable/config/review targets.
 * Succeeded and policy-skipped targets are immutable and can never be re-sent. */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }): Promise<Response> {
  try {
    const { id } = await params;
    const ctx = await requireContext(req);
    const body = RetryOperationSchema.safeParse(await req.json().catch(() => ({})));
    if (!body.success) return Response.json({ error: body.error.issues.map((issue) => issue.message).join("; ") }, { status: 400 });
    const aggregate = await businessOperationAggregate(ctx.tenantId, id);
    if (!aggregate) return Response.json({ error: "Business operation not found" }, { status: 404 });
    const operation = aggregate.operation as { domainActionId: string };
    const [action] = await withTenant(ctx.tenantId, (db) => db.select({ actionType: domainActions.actionType }).from(domainActions).where(and(
      eq(domainActions.tenantId, ctx.tenantId),
      eq(domainActions.id, operation.domainActionId),
    )).limit(1));
    if (!action) return Response.json({ error: "Business operation action not found" }, { status: 409 });
    const authority = await evaluateAuthority(ctx, { operation: "approval", capability: `approve:${action.actionType}`, resource: { type: "business_operation", id }, risk: "high", domainActionId: operation.domainActionId, operationId: id });
    if (authority.outcome !== "allowed") return Response.json({ error: `Authority denied: ${authority.reasonCode}`, authority }, { status: 403 });
    const result = await retryBusinessOperation({
      tenantId: ctx.tenantId,
      operationId: id,
      requestedBy: ctx.userId,
      recoveryKey: body.data.recoveryKey,
    });
    if (!result.duplicate) await resumeObjectiveForAction(ctx.tenantId, operation.domainActionId).catch(() => false);
    return Response.json({ result, operation: await businessOperationAggregate(ctx.tenantId, id) }, { status: result.duplicate ? 200 : 202 });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Business operation recovery failed";
    if (/not recoverable|no retryable/i.test(message)) return Response.json({ error: message }, { status: 409 });
    return errorResponse(err);
  }
}
