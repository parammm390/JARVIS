// GET /api/events — the business_events cross-entity timeline (Phase 10's console
// event feed). Optional ?entityType=&entityId= pair scopes to one entity (uses
// business_events_entity_idx); optional ?before=<iso> pages backward in time.

import { withTenant, businessEvents } from "@finnor/db";
import { and, desc, eq, lt } from "drizzle-orm";
import { requireContext, errorResponse, AuthError } from "../../../lib/auth";

export async function GET(req: Request): Promise<Response> {
  try {
    const ctx = await requireContext(req);
    const url = new URL(req.url);
    const entityType = url.searchParams.get("entityType");
    const entityId = url.searchParams.get("entityId");
    const before = url.searchParams.get("before");

    if ((entityType && !entityId) || (!entityType && entityId)) {
      throw new AuthError("entityType and entityId must be provided together", 400);
    }

    const beforeDate = before ? new Date(before) : null;
    if (before && (!beforeDate || Number.isNaN(beforeDate.getTime()))) {
      throw new AuthError("before must be a valid ISO timestamp", 400);
    }

    const rows = await withTenant(ctx.tenantId, (db) =>
      db
        .select()
        .from(businessEvents)
        .where(
          and(
            eq(businessEvents.tenantId, ctx.tenantId),
            entityType && entityId ? eq(businessEvents.entityType, entityType) : undefined,
            entityType && entityId ? eq(businessEvents.entityId, entityId) : undefined,
            beforeDate ? lt(businessEvents.occurredAt, beforeDate) : undefined,
          ),
        )
        .orderBy(desc(businessEvents.occurredAt))
        .limit(50),
    );

    return Response.json({
      events: rows.map((r) => ({
        id: r.id,
        entityType: r.entityType,
        entityId: r.entityId,
        eventType: r.eventType,
        payload: r.payload,
        occurredAt: r.occurredAt,
        source: r.source,
      })),
    });
  } catch (err) {
    return errorResponse(err);
  }
}
