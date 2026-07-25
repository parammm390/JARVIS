// D5.T2 — dispatch data is sourced from stored coordinates and B3's completed route
// receipt. Missing coordinates and absent optimizer evidence remain visible as such.

import { decisionReceipts, domainActions, households, serviceVisits, technicians, tenantSettings, withTenant } from "@finnor/db";
import { and, asc, desc, eq, gte, isNull, lt } from "drizzle-orm";
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
      const stops = await db.select({
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
        .innerJoin(technicians, eq(technicians.id, serviceVisits.technicianId))
        .where(and(gte(serviceVisits.scheduledAt, start), lt(serviceVisits.scheduledAt, end), isNull(serviceVisits.completedAt)))
        .orderBy(asc(serviceVisits.scheduledAt));
      const receiptRows = await db.select({ actualResult: decisionReceipts.actualResult, payload: domainActions.payload })
        .from(decisionReceipts)
        .innerJoin(domainActions, eq(domainActions.id, decisionReceipts.domainActionId))
        .where(and(eq(domainActions.tenantId, ctx.tenantId), eq(domainActions.actionType, "route_suggestion")))
        .orderBy(desc(decisionReceipts.createdAt));
      return { isDealerZero: settings?.isDealerZero ?? false, stops, receiptRows };
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
    const stops = data.stops.map((stop) => ({ ...stop, optimized: optimized.get(stop.visitId) ?? null }));
    const firstMetric = [...optimized.values()][0] ?? null;
    return Response.json({
      date,
      synthetic: data.isDealerZero,
      stops,
      unplacedStops: stops.filter((stop) => stop.latitude === null || stop.longitude === null).length,
      route: firstMetric ? { naiveKm: firstMetric.naiveKm, optimizedKm: firstMetric.optimizedKm, kmSaved: firstMetric.kmSaved } : null,
    });
  } catch (err) {
    return errorResponse(err);
  }
}
