// GET /api/receipts — lookup decision receipts by domainActionId, workflowStepId, or
// workflowRunId (Phase 7 MAESTRO PACK §7.1/§7.3 — the Approval Inbox card and the
// live run timeline both need to resolve "their" receipt without knowing its own id
// up front). Tenant-scoped; any signed-in role may read (a receipt is the record of
// what already happened/was proposed, not a control surface).

import { withTenant, decisionReceipts } from "@finnor/db";
import { and, eq, desc } from "drizzle-orm";
import { z } from "zod";
import { requireContext, errorResponse } from "../../../lib/auth";

const QuerySchema = z
  .object({
    domainActionId: z.string().uuid().optional(),
    workflowStepId: z.string().uuid().optional(),
    workflowRunId: z.string().uuid().optional(),
  })
  .refine((v) => v.domainActionId || v.workflowStepId || v.workflowRunId, {
    message: "One of domainActionId, workflowStepId, workflowRunId is required",
  });

export async function GET(req: Request): Promise<Response> {
  try {
    const ctx = await requireContext(req);
    const url = new URL(req.url);
    const parsed = QuerySchema.safeParse({
      domainActionId: url.searchParams.get("domainActionId") ?? undefined,
      workflowStepId: url.searchParams.get("workflowStepId") ?? undefined,
      workflowRunId: url.searchParams.get("workflowRunId") ?? undefined,
    });
    if (!parsed.success) return Response.json({ error: parsed.error.issues[0]?.message ?? "Invalid query" }, { status: 400 });

    const { domainActionId, workflowStepId, workflowRunId } = parsed.data;
    const scope = domainActionId
      ? eq(decisionReceipts.domainActionId, domainActionId)
      : workflowStepId
        ? eq(decisionReceipts.workflowStepId, workflowStepId)
        : eq(decisionReceipts.workflowRunId, workflowRunId!);

    const rows = await withTenant(ctx.tenantId, (db) =>
      db
        .select()
        .from(decisionReceipts)
        .where(and(eq(decisionReceipts.tenantId, ctx.tenantId), scope))
        .orderBy(desc(decisionReceipts.createdAt))
        .limit(50),
    );
    return Response.json({ receipts: rows });
  } catch (err) {
    return errorResponse(err);
  }
}
