// GET /api/resources/:kind — tenant-scoped reads for the JARVIS console panels.
// Whitelisted tables only; everything flows through withTenant → RLS.

import {
  withTenant,
  households,
  inventoryItems,
  invoices,
  workflowStates,
  serviceVisits,
  technicians,
  domainPolicies,
} from "@finnor/db";
import { desc, eq } from "drizzle-orm";
import { requireContext, errorResponse } from "../../../../lib/auth";

export async function GET(req: Request, { params }: { params: { kind: string } }): Promise<Response> {
  try {
    const ctx = await requireContext(req);
    const rows = await withTenant(ctx.tenantId, async (db) => {
      switch (params.kind) {
        case "households":
          return db.select().from(households).orderBy(desc(households.createdAt)).limit(50);
        case "inventory":
          return db.select().from(inventoryItems).limit(50);
        case "invoices":
          return db.select().from(invoices).orderBy(desc(invoices.createdAt)).limit(50);
        case "workflows":
          return db.select().from(workflowStates).orderBy(desc(workflowStates.updatedAt)).limit(50);
        case "visits":
          return db
            .select({
              id: serviceVisits.id,
              type: serviceVisits.type,
              scheduledAt: serviceVisits.scheduledAt,
              completedAt: serviceVisits.completedAt,
              notes: serviceVisits.notes,
              address: households.address,
            })
            .from(serviceVisits)
            .innerJoin(households, eq(serviceVisits.householdId, households.id))
            .orderBy(desc(serviceVisits.scheduledAt))
            .limit(50);
        case "technicians":
          return db.select().from(technicians).limit(50);
        case "compliance-policy": {
          const [row] = await db
            .select()
            .from(domainPolicies)
            .where(eq(domainPolicies.actionType, "generate_compliance_summary"))
            .limit(1);
          return row ? [row] : [];
        }
        default:
          return null;
      }
    });
    if (rows === null) return Response.json({ error: "Unknown resource" }, { status: 404 });
    return Response.json({ rows }, { headers: { "cache-control": "no-store" } });
  } catch (err) {
    return errorResponse(err);
  }
}
