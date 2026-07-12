// GET /api/stats — one aggregate payload for the JARVIS command center: queue counts,
// inventory, workflow states, recent audit trail, comms. One request, one round trip.

import {
  withTenant,
  domainActions,
  actionLog,
  sandboxOutbox,
  inventoryItems,
  workflowStates,
  invoices,
} from "@finnor/db";
import { desc, eq, inArray, sql } from "drizzle-orm";
import { requireContext, errorResponse } from "../../../lib/auth";

export async function GET(req: Request): Promise<Response> {
  try {
    const ctx = await requireContext(req);
    const data = await withTenant(ctx.tenantId, async (db) => {
      const [pending, blocked, recentActions, recentAudit, outbox, inventory, workflows, invoiceRows] =
        await Promise.all([
          db.select({ n: sql<number>`count(*)::int` }).from(domainActions).where(eq(domainActions.status, "pending")),
          db
            .select({ n: sql<number>`count(*)::int` })
            .from(domainActions)
            .where(inArray(domainActions.status, ["needs_human_review", "blocked_integration_unavailable"])),
          db
            .select({
              id: domainActions.id,
              actionType: domainActions.actionType,
              status: domainActions.status,
              summary: domainActions.summary,
              createdAt: domainActions.createdAt,
            })
            .from(domainActions)
            .orderBy(desc(domainActions.createdAt))
            .limit(8),
          db
            .select({ step: actionLog.step, timestamp: actionLog.timestamp, domainActionId: actionLog.domainActionId })
            .from(actionLog)
            .orderBy(desc(actionLog.timestamp))
            .limit(30),
          db.select().from(sandboxOutbox).orderBy(desc(sandboxOutbox.createdAt)).limit(8),
          db.select().from(inventoryItems).limit(12),
          db.select().from(workflowStates).orderBy(desc(workflowStates.updatedAt)).limit(8),
          db
            .select({ amountUsd: invoices.amountUsd, status: invoices.status, createdAt: invoices.createdAt })
            .from(invoices)
            .orderBy(desc(invoices.createdAt))
            .limit(50),
        ]);
      return {
        pending: pending[0]?.n ?? 0,
        blocked: blocked[0]?.n ?? 0,
        recentActions,
        recentAudit,
        outbox,
        inventory,
        workflows,
        invoices: invoiceRows,
      };
    });
    return Response.json(data, { headers: { "cache-control": "no-store" } });
  } catch (err) {
    return errorResponse(err);
  }
}
