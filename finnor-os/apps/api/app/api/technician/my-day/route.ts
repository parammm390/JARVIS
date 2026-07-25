// D5.T1/T3 — a technician sees and completes only visits assigned through their
// explicit users.technician_id link. This route never falls back to tenant-wide visits.

import { households, serviceVisits, users, withTenant } from "@finnor/db";
import { and, asc, eq, gte, isNull, lt } from "drizzle-orm";
import { AuthError, errorResponse, requireContext } from "../../../../lib/auth";

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
    const visits = await withTenant(ctx.tenantId, (db) =>
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
    );
    return Response.json({ date, technicianId, visits });
  } catch (err) {
    return errorResponse(err);
  }
}

export async function POST(req: Request): Promise<Response> {
  try {
    const ctx = await requireContext(req);
    if (ctx.role !== "technician") throw new AuthError("Technician access required", 403);
    const technicianId = await technicianForUser(ctx.tenantId, ctx.userId);
    const body = (await req.json().catch(() => null)) as { visitId?: unknown; confirm?: unknown } | null;
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
