// Real, queryable cross-entity timeline. Every repository write in this package records
// one of these in the same transaction — see schema.ts's businessEvents comment for why
// this can't just be actionLog (requires a non-null domain_action_id) or scanFindings
// (a transient digest-once queue, not history).

import { businessEvents, type Db } from "@finnor/db";

export interface RecordEventParams {
  tenantId: string;
  entityType: string;
  entityId: string;
  eventType: string;
  payload?: Record<string, unknown>;
  source?: string;
}

export async function recordBusinessEvent(db: Db, params: RecordEventParams): Promise<void> {
  await db.insert(businessEvents).values({
    tenantId: params.tenantId,
    entityType: params.entityType,
    entityId: params.entityId,
    eventType: params.eventType,
    payload: params.payload ?? {},
    source: params.source ?? null,
  });
}
