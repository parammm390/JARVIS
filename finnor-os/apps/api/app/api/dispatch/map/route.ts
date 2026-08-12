// D5.T2 — dispatch data is sourced from stored coordinates and B3's completed route
// receipt. Missing coordinates and absent optimizer evidence remain visible as such.

import { appointments, decisionReceipts, domainActions, households, serviceVisits, technicians, tenantSettings, withTenant } from "@finnor/db";
import { and, asc, desc, eq, gte, isNull, lt, or } from "drizzle-orm";
import { AuthError, errorResponse, requireContext } from "../../../../lib/auth";

function dayBounds(value: string): [Date, Date] {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new AuthError("date must be YYYY-MM-DD", 400);
  const start = new Date(`${value}T00:00:00.000Z`);
  if (Number.isNaN(start.getTime())) throw new AuthError("date must be YYYY-MM-DD", 400);
  return [start, new Date(start.getTime() + 86_400_000)];
}

type RouteOutput = { route?: Array<{ visitId?: unknown; sequence?: unknown }>; naiveKm?: unknown; optimizedKm?: unknown; kmSaved?: unknown };

export async function GET(req: Request): Promise<Response> {
  try {
    const ctx = await requireContext(req);
    if (ctx.role !== "owner" && ctx.role !== "dispatcher") throw new AuthError("Dispatch access required", 403);
    const date = new URL(req.url).searchParams.get("date") ?? new Date().toISOString().slice(0, 10);
    const [start, end] = dayBounds(date);
    const data = await withTenant(ctx.tenantId, async (db) => {
      const [settings] = await db.select({ isDealerZero: tenantSettings.isDealerZero }).from(tenantSettings).where(eq(tenantSettings.tenantId, ctx.tenantId)).limit(1);
      const techniciansForTenant = await db.select({ id: technicians.id, name: technicians.name }).from(technicians).where(eq(technicians.tenantId, ctx.tenantId)).orderBy(asc(technicians.name));
      const legacyStops = await db.select({
        visitId: serviceVisits.id,
        technicianId: technicians.id,
        technicianName: technicians.name,
        householdId: households.id,
        address: households.address,
        latitude: households.latitude,
        longitude: households.longitude,
        type: serviceVisits.type,
        scheduledAt: serviceVisits.scheduledAt,
        notes: serviceVisits.notes,
      })
        .from(serviceVisits)
        .innerJoin(households, eq(households.id, serviceVisits.householdId))
        // Unassigned visits are the dispatcher's exception queue, not missing data.
        // An inner join hid the exact visits this surface exists to assign.
        .leftJoin(technicians, eq(technicians.id, serviceVisits.technicianId))
        .where(and(gte(serviceVisits.scheduledAt, start), lt(serviceVisits.scheduledAt, end), isNull(serviceVisits.completedAt)))
        .orderBy(asc(serviceVisits.scheduledAt));
      const canonicalStops = await db.select({
        visitId: appointments.id,
        technicianId: technicians.id,
        technicianName: technicians.name,
        householdId: households.id,
        address: households.address,
        latitude: households.latitude,
        longitude: households.longitude,
        scheduledAt: appointments.scheduledAt,
        notes: appointments.notes,
      })
        .from(appointments)
        .innerJoin(households, eq(households.id, appointments.subjectId))
        .leftJoin(technicians, eq(technicians.id, appointments.technicianId))
        .where(and(
          eq(appointments.subjectType, "household"),
          gte(appointments.scheduledAt, start),
          lt(appointments.scheduledAt, end),
          or(eq(appointments.status, "hold"), eq(appointments.status, "confirmed")),
        ))
        .orderBy(asc(appointments.scheduledAt));
      const receiptRows = await db.select({ actualResult: decisionReceipts.actualResult, payload: domainActions.payload })
        .from(decisionReceipts)
        .innerJoin(domainActions, eq(domainActions.id, decisionReceipts.domainActionId))
        .where(and(eq(domainActions.tenantId, ctx.tenantId), eq(domainActions.actionType, "route_suggestion")))
        .orderBy(desc(decisionReceipts.createdAt));
      const stops = [
        ...legacyStops.map((stop) => ({ ...stop, sourceKind: "service_visit" as const, type: stop.type })),
        ...canonicalStops.map((stop) => ({ ...stop, sourceKind: "appointment" as const, type: "appointment" })),
      ].sort((a, b) => (a.scheduledAt?.getTime() ?? 0) - (b.scheduledAt?.getTime() ?? 0));
      return { isDealerZero: settings?.isDealerZero ?? false, stops, receiptRows, technicians: techniciansForTenant };
    });
    const optimized = new Map<string, { sequence: number; naiveKm: number | null; optimizedKm: number | null; kmSaved: number | null }>();
    for (const row of data.receiptRows) {
      if ((row.payload as { date?: unknown } | null)?.date !== date) continue;
      const result = row.actualResult as { output?: RouteOutput } | null;
      const output = result?.output;
      if (!output?.route) continue;
      const metrics = {
        naiveKm: typeof output.naiveKm === "number" ? output.naiveKm : null,
        optimizedKm: typeof output.optimizedKm === "number" ? output.optimizedKm : null,
        kmSaved: typeof output.kmSaved === "number" ? output.kmSaved : null,
      };
      for (const item of output.route) {
        if (typeof item.visitId === "string" && typeof item.sequence === "number" && !optimized.has(item.visitId)) optimized.set(item.visitId, { sequence: item.sequence, ...metrics });
      }
    }
    const stops = data.stops.map((stop) => ({
      ...stop,
      // B3 route receipts currently carry pre-canonical service-visit IDs.
      optimized: stop.sourceKind === "service_visit" ? optimized.get(stop.visitId) ?? null : null,
    }));
    const firstMetric = [...optimized.values()][0] ?? null;
    return Response.json({
      date,
      synthetic: data.isDealerZero,
      stops,
      technicians: data.technicians,
      unplacedStops: stops.filter((stop) => stop.latitude === null || stop.longitude === null).length,
      route: firstMetric ? { naiveKm: firstMetric.naiveKm, optimizedKm: firstMetric.optimizedKm, kmSaved: firstMetric.kmSaved } : null,
    });
  } catch (err) {
    return errorResponse(err);
  }
}

export async function POST(req: Request): Promise<Response> {
  try {
    const ctx = await requireContext(req);
    if (ctx.role !== "owner" && ctx.role !== "dispatcher") throw new AuthError("Dispatch access required", 403);
    const body = (await req.json().catch(() => null)) as { visitId?: unknown; technicianId?: unknown; sourceKind?: unknown } | null;
    if (!body || typeof body.visitId !== "string" || typeof body.technicianId !== "string") throw new AuthError("visitId and technicianId are required", 400);
    const sourceKind = body.sourceKind === "appointment" ? "appointment" : "service_visit";
    const assigned = await withTenant(ctx.tenantId, async (db) => {
      const [technician] = await db.select({ id: technicians.id }).from(technicians).where(and(eq(technicians.id, body.technicianId as string), eq(technicians.tenantId, ctx.tenantId))).limit(1);
      if (!technician) return null;
      if (sourceKind === "appointment") {
        const [appointment] = await db.update(appointments).set({ technicianId: technician.id }).where(eq(appointments.id, body.visitId as string)).returning({ id: appointments.id, technicianId: appointments.technicianId });
        return appointment ? { ...appointment, sourceKind } : null;
      }
      const [visit] = await db.update(serviceVisits).set({ technicianId: technician.id }).where(eq(serviceVisits.id, body.visitId as string)).returning({ id: serviceVisits.id, technicianId: serviceVisits.technicianId });
      return visit ? { ...visit, sourceKind } : null;
    });
    if (!assigned) throw new AuthError("Schedule record or technician was not found", 404);
    return Response.json({ visit: assigned });
  } catch (err) {
    return errorResponse(err);
  }
}
