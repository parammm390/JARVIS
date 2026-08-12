// Real, queryable cross-entity timeline. Every repository write in this package records
// one of these in the same transaction — see schema.ts's businessEvents comment for why
// this can't just be actionLog (requires a non-null domain_action_id) or scanFindings
// (a transient digest-once queue, not history).

import { businessEvents, type Db } from "@finnor/db";
import { CANONICAL_ENTITY_TYPES, type CanonicalEntityType } from "@finnor/shared-types";
import { sql } from "drizzle-orm";

export interface RecordEventParams {
  tenantId: string;
  entityType: string;
  entityId: string;
  eventType: string;
  payload?: Record<string, unknown>;
  source?: string;
}

export async function recordBusinessEvent(db: Db, params: RecordEventParams): Promise<void> {
  if (CANONICAL_ENTITY_TYPES.includes(params.entityType as CanonicalEntityType)) {
    const resolved = await db.execute<{ tenant_id: string | null }>(sql`
      SELECT finnor_os.canonical_entity_tenant(${params.entityType}, ${params.entityId}::uuid)::text AS tenant_id
    `);
    if (resolved.rows[0]?.tenant_id !== params.tenantId) {
      throw new Error("Business event canonical entity does not belong to tenant");
    }
  }
  await db.insert(businessEvents).values({
    tenantId: params.tenantId,
    entityType: params.entityType,
    entityId: params.entityId,
    eventType: params.eventType,
    payload: params.payload ?? {},
    source: params.source ?? null,
  });
}
