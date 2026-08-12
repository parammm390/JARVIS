// B3.T1 — a route suggestion is advisory. It is still drafted through the normal
// confirmation gate because a dispatcher may choose to operationalize it.

import type { DomainEnginePlugin } from "../shared/plugin-interface";
import type { DomainPolicy, DraftAction, ExecutionResult, ValidationResult } from "@finnor/shared-types";
import { withTenant, households, serviceVisits, technicians } from "@finnor/db";
import { geocodeAddress } from "@finnor/tools";
import { optimizeRoute, osrmMatrix, type RoutePoint } from "@finnor/read-models";
import { and, asc, eq, gte, isNull, lt } from "drizzle-orm";
import { z } from "zod";

export const ROUTE_SUGGESTION_ACTION = "route_suggestion";
export const RouteSuggestionSchema = z.object({
  technicianId: z.string().uuid(),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "date must be YYYY-MM-DD"),
});

function dayBounds(date: string): [Date, Date] {
  const start = new Date(`${date}T00:00:00.000Z`);
  return [start, new Date(start.getTime() + 86_400_000)];
}

export const routeOptimizationPlugin: DomainEnginePlugin = {
  name: "route-optimization",
  actionTypes: [ROUTE_SUGGESTION_ACTION],
  payloadSchemas: { [ROUTE_SUGGESTION_ACTION]: RouteSuggestionSchema },
  canHandle: (actionType) => actionType === ROUTE_SUGGESTION_ACTION,
  validate(actionType, payload): ValidationResult {
    if (actionType !== ROUTE_SUGGESTION_ACTION) return { valid: false, errors: [`unhandled action ${actionType}`] };
    const parsed = RouteSuggestionSchema.safeParse(payload);
    return parsed.success ? { valid: true, errors: [] } : { valid: false, errors: parsed.error.issues.map((issue) => `payload.${issue.path.join(".")}: ${issue.message}`) };
  },
  async draft(_actionType, payload, policy: DomainPolicy): Promise<DraftAction> {
    const input = RouteSuggestionSchema.parse(payload);
    const [start, end] = dayBounds(input.date);
    const { tech, visits } = await withTenant(policy.tenantId, async (db) => {
      const tech = await db.select({ name: technicians.name }).from(technicians).where(and(eq(technicians.id, input.technicianId), eq(technicians.tenantId, policy.tenantId))).limit(1);
      const visits = await db.select({ id: serviceVisits.id }).from(serviceVisits).where(and(eq(serviceVisits.technicianId, input.technicianId), gte(serviceVisits.scheduledAt, start), lt(serviceVisits.scheduledAt, end), isNull(serviceVisits.completedAt))).orderBy(asc(serviceVisits.scheduledAt));
      return { tech, visits };
    });
    return {
      actionType: ROUTE_SUGGESTION_ACTION,
      summary: `Review the ${input.date} route suggestion for ${tech[0]?.name ?? "the selected technician"} (${visits.length} scheduled stop${visits.length === 1 ? "" : "s"}).`,
      payload: { ...input, tenantId: policy.tenantId },
      requiresConfirmation: policy.requiresConfirmation,
    };
  },
  simulate(_actionType, payload) {
    const input = RouteSuggestionSchema.parse(payload);
    return { mode: "schema" as const, summary: `A route proposal for ${input.date} will be calculated from scheduled visit addresses; no visit is changed.`, predicted: { fieldChanges: [] } };
  },
  async execute(draft): Promise<ExecutionResult> {
    const input = RouteSuggestionSchema.parse(draft.payload);
    const [start, end] = dayBounds(input.date);
    const visits = await withTenant(String(draft.payload.tenantId ?? ""), (db) =>
      db.select({ id: serviceVisits.id, address: households.address, scheduledAt: serviceVisits.scheduledAt })
        .from(serviceVisits).innerJoin(households, eq(households.id, serviceVisits.householdId))
        .where(and(eq(serviceVisits.technicianId, input.technicianId), gte(serviceVisits.scheduledAt, start), lt(serviceVisits.scheduledAt, end), isNull(serviceVisits.completedAt)))
        .orderBy(asc(serviceVisits.scheduledAt)),
    );
    if (visits.length < 2) return { status: "success", output: { route: [], reason: "Fewer than two unfinished scheduled stops; no ordering improvement is possible." } };
    // Nominatim is rate-limited. Sequential requests make the daily proposal a good
    // citizen; a failed geocode fails the advisory action rather than silently routing
    // to a guessed location.
    const points: RoutePoint[] = [];
    for (const visit of visits) {
      const geo = await geocodeAddress(visit.address);
      points.push({ id: visit.id, label: visit.address, lat: geo.lat, lon: geo.lon });
      if (points.length < visits.length) await new Promise((resolve) => setTimeout(resolve, 1_100));
    }
    const optimized = optimizeRoute(await osrmMatrix(points));
    return {
      status: "success",
      output: {
        date: input.date,
        technicianId: input.technicianId,
        route: optimized.order.map((index, sequence) => ({ visitId: points[index]!.id, address: points[index]!.label, sequence: sequence + 1 })),
        naiveKm: Number((optimized.naiveMeters / 1000).toFixed(1)),
        optimizedKm: Number((optimized.optimizedMeters / 1000).toFixed(1)),
        kmSaved: Number((optimized.savedMeters / 1000).toFixed(1)),
        assumptions: "Comparison keeps the existing first scheduled stop as the start and excludes an unrecorded depot/return leg.",
      },
    };
  },
};

export default routeOptimizationPlugin;
