// D5.T1/T3 — a technician sees and completes only visits assigned through their
// explicit users.technician_id link. This route never falls back to tenant-wide visits.

import { households, serviceVisits, users, withTenant, workOrders } from "@finnor/db";
import { recordBusinessEvent } from "@finnor/data-platform";
import { and, asc, eq, gte, isNull, lt } from "drizzle-orm";
import { AuthError, errorResponse, requireContext } from "../../../../lib/auth";
import { getOrchestrator } from "../../../../lib/orchestrator";

function dayBounds(value: string): [Date, Date] {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new AuthError("date must be YYYY-MM-DD", 400);
  const start = new Date(`${value}T00:00:00.000Z`);
  if (Number.isNaN(start.getTime())) throw new AuthError("date must be YYYY-MM-DD", 400);
  return [start, new Date(start.getTime() + 86_400_000)];
}

async function technicianForUser(tenantId: string, userId: string): Promise<string> {
  const [user] = await withTenant(tenantId, (db) =>
    db.select({ technicianId: users.technicianId }).from(users).where(and(eq(users.id, userId), eq(users.tenantId, tenantId))).limit(1),
  );
  if (!user?.technicianId) throw new AuthError("Your account is not linked to a technician record", 403);
  return user.technicianId;
}

export async function GET(req: Request): Promise<Response> {
  try {
    const ctx = await requireContext(req);
    if (ctx.role !== "technician") throw new AuthError("Technician access required", 403);
    const technicianId = await technicianForUser(ctx.tenantId, ctx.userId);
    const date = new URL(req.url).searchParams.get("date") ?? new Date().toISOString().slice(0, 10);
    const [start, end] = dayBounds(date);
    const [visits, workOrdersForDay] = await withTenant(ctx.tenantId, (db) => Promise.all([
      db.select({
        id: serviceVisits.id,
        type: serviceVisits.type,
        scheduledAt: serviceVisits.scheduledAt,
        completedAt: serviceVisits.completedAt,
        notes: serviceVisits.notes,
        householdId: households.id,
        address: households.address,
        latitude: households.latitude,
        longitude: households.longitude,
      })
        .from(serviceVisits)
        .innerJoin(households, eq(households.id, serviceVisits.householdId))
        .where(and(eq(serviceVisits.technicianId, technicianId), gte(serviceVisits.scheduledAt, start), lt(serviceVisits.scheduledAt, end)))
        .orderBy(asc(serviceVisits.scheduledAt)),
      db.select({
        id: workOrders.id,
        type: workOrders.type,
        status: workOrders.status,
        scheduledAt: workOrders.scheduledAt,
        completedAt: workOrders.completedAt,
        householdId: households.id,
        address: households.address,
      })
        .from(workOrders)
        .innerJoin(households, eq(households.id, workOrders.householdId))
        .where(and(eq(workOrders.tenantId, ctx.tenantId), eq(workOrders.technicianId, technicianId), gte(workOrders.scheduledAt, start), lt(workOrders.scheduledAt, end)))
        .orderBy(asc(workOrders.scheduledAt)),
    ]));
    return Response.json({ date, technicianId, visits, workOrders: workOrdersForDay });
  } catch (err) {
    return errorResponse(err);
  }
}

export async function POST(req: Request): Promise<Response> {
  try {
    const ctx = await requireContext(req);
    if (ctx.role !== "technician") throw new AuthError("Technician access required", 403);
    const technicianId = await technicianForUser(ctx.tenantId, ctx.userId);
    const body = (await req.json().catch(() => null)) as { visitId?: unknown; confirm?: unknown; workOrderId?: unknown; action?: unknown; report?: unknown; issue?: unknown } | null;
    if (body?.workOrderId && typeof body.workOrderId === "string" && typeof body.action === "string") {
      const workOrder = await withTenant(ctx.tenantId, async (db) => {
        const [row] = await db.select().from(workOrders).where(and(eq(workOrders.id, body.workOrderId as string), eq(workOrders.tenantId, ctx.tenantId), eq(workOrders.technicianId, technicianId))).limit(1);
        return row ?? null;
      });
      if (!workOrder) throw new AuthError("Work order was not found or is not assigned to you", 404);
      if (body.action === "arrive") {
        if (workOrder.status !== "scheduled") throw new AuthError("Only a scheduled work order can be marked arrived", 409);
        await withTenant(ctx.tenantId, async (db) => {
          await db.update(workOrders).set({ status: "in_progress" }).where(eq(workOrders.id, workOrder.id));
          await recordBusinessEvent(db, { tenantId: ctx.tenantId, entityType: "work_order", entityId: workOrder.id, eventType: "technician_arrived", payload: { technicianId } });
        });
        return Response.json({ workOrder: { id: workOrder.id, status: "in_progress" } });
      }
      if (body.action === "report") {
        if (typeof body.report !== "string") throw new AuthError("report is required", 400);
        const { action, result } = await getOrchestrator().draftKnownAction(
          "log_visit_report",
          { householdId: workOrder.householdId, report: body.report, markCompleted: false },
          ctx.tenantId,
          { source: "technician_mobile", initiatedBy: ctx.userId, authorityContext: { role: ctx.role, technicianId, workOrderId: workOrder.id } },
        );
        return Response.json({ actionId: action.id, result });
      }
      if (body.action === "flag") {
        if (typeof body.issue !== "string") throw new AuthError("issue is required", 400);
        const { action, result } = await getOrchestrator().draftKnownAction(
          "flag_visit_issue",
          { issue: body.issue },
          ctx.tenantId,
          { source: "technician_mobile", initiatedBy: ctx.userId, authorityContext: { role: ctx.role, technicianId, workOrderId: workOrder.id } },
        );
        return Response.json({ actionId: action.id, result });
      }
      if (body.action === "done") {
        if (workOrder.status !== "in_progress") throw new AuthError("Only an in-progress work order can be completed", 409);
        await withTenant(ctx.tenantId, async (db) => {
          await db.update(workOrders).set({ status: "completed", completedAt: new Date() }).where(eq(workOrders.id, workOrder.id));
          await recordBusinessEvent(db, { tenantId: ctx.tenantId, entityType: "work_order", entityId: workOrder.id, eventType: "work_order_completed", payload: { technicianId } });
        });
        return Response.json({ workOrder: { id: workOrder.id, status: "completed" } });
      }
      throw new AuthError("Unsupported technician work-order action", 400);
    }
    if (!body || typeof body.visitId !== "string" || body.confirm !== true) {
      throw new AuthError("visitId and confirm: true are required to complete a visit", 400);
    }
    const visitId = body.visitId;
    const completed = await withTenant(ctx.tenantId, async (db) => {
      const rows = await db
        .update(serviceVisits)
        .set({ completedAt: new Date() })
        .where(and(eq(serviceVisits.id, visitId), eq(serviceVisits.technicianId, technicianId), isNull(serviceVisits.completedAt)))
        .returning({ id: serviceVisits.id, completedAt: serviceVisits.completedAt });
      return rows[0] ?? null;
    });
    if (!completed) throw new AuthError("Visit was not found, is not assigned to you, or was already completed", 409);
    return Response.json({ visit: completed });
  } catch (err) {
    return errorResponse(err);
  }
}
