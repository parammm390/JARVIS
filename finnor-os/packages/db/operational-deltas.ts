import { sql } from "drizzle-orm";
import type { CanonicalEntityRef, OperationalDelta, OperationalDeltaPage, OperationalDeltaPriority } from "@finnor/shared-types";
import { withTenant } from "./index";

export const OPERATIONAL_DELTA_RETENTION_DAYS = 7;
export const OPERATIONAL_DELTA_MAX_PAGE = 250;

export class OperationalCursorError extends Error {
  constructor(public readonly code: "invalid_cursor" | "scope_mismatch") {
    super(code === "invalid_cursor" ? "Invalid operational delta cursor" : "Operational delta cursor belongs to a different tenant scope");
  }
}

export interface DecodedOperationalCursor { scope: string; seq: bigint }

export function encodeOperationalCursor(scope: string, seq: bigint): string {
  return `${scope}:${seq.toString()}`;
}

export function decodeOperationalCursor(value: string): DecodedOperationalCursor {
  const match = /^([0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}):(0|[1-9][0-9]*)$/i.exec(value);
  if (!match) throw new OperationalCursorError("invalid_cursor");
  return { scope: match[1]!, seq: BigInt(match[2]!) };
}

interface DeltaRow extends Record<string, unknown> {
  seq: string;
  change_type: string;
  priority: OperationalDeltaPriority;
  entity_refs: unknown;
  work_id: string | null;
  projection_tags: string[];
  occurred_at: Date | string;
}

function safeRefs(value: unknown): CanonicalEntityRef[] {
  if (!Array.isArray(value)) return [];
  return value.slice(0, 8).flatMap((item) => {
    if (!item || typeof item !== "object" || Array.isArray(item)) return [];
    const row = item as Record<string, unknown>;
    return typeof row.entityType === "string" && typeof row.entityId === "string"
      ? [{ entityType: row.entityType, entityId: row.entityId } as CanonicalEntityRef]
      : [];
  });
}

/** Reads one RLS-scoped replay page. A missing cursor deliberately establishes at
 * the current high-water mark rather than replaying a tenant's full retained past. */
export async function readOperationalDeltas(
  tenantId: string,
  cursorValue?: string | null,
  requestedLimit = OPERATIONAL_DELTA_MAX_PAGE,
): Promise<OperationalDeltaPage> {
  const limit = Math.max(1, Math.min(Math.trunc(requestedLimit) || OPERATIONAL_DELTA_MAX_PAGE, OPERATIONAL_DELTA_MAX_PAGE));
  const decoded = cursorValue ? decodeOperationalCursor(cursorValue) : null;
  return withTenant(tenantId, async (db) => {
    const cursorResult = await db.execute<{ scope: string; last_seq: string }>(sql`
      SELECT scope,last_seq::text FROM finnor_os.ensure_operational_delta_cursor(${tenantId}::uuid)
    `);
    const state = cursorResult.rows[0];
    if (!state) throw new Error("Operational cursor could not be established");
    if (decoded && decoded.scope !== state.scope) throw new OperationalCursorError("scope_mismatch");
    const highWater = BigInt(state.last_seq);
    if (!decoded) {
      return {
        status: "ok",
        cursor: encodeOperationalCursor(state.scope, highWater),
        deltas: [],
        hasMore: false,
        retentionDays: OPERATIONAL_DELTA_RETENTION_DAYS,
      };
    }

    const minimumResult = await db.execute<{ minimum: string | null }>(sql`
      SELECT min(seq)::text AS minimum FROM finnor_os.operational_deltas WHERE tenant_id=${tenantId}::uuid
    `);
    const minimum = minimumResult.rows[0]?.minimum ? BigInt(minimumResult.rows[0]!.minimum!) : highWater + 1n;
    if (decoded.seq < minimum - 1n) {
      return {
        status: "resync_required",
        cursor: encodeOperationalCursor(state.scope, highWater),
        deltas: [],
        hasMore: false,
        retentionDays: OPERATIONAL_DELTA_RETENTION_DAYS,
      };
    }

    const result = await db.execute<DeltaRow>(sql`
      SELECT d.seq::text,d.change_type,d.priority,d.entity_refs,d.work_id,d.projection_tags,d.occurred_at
      FROM finnor_os.operational_deltas AS d
      WHERE d.tenant_id=${tenantId}::uuid AND d.seq>${decoded.seq.toString()}::bigint
      ORDER BY d.seq ASC LIMIT ${limit + 1}
    `);
    const hasMore = result.rows.length > limit;
    const rows = result.rows.slice(0, limit);
    const deltas: OperationalDelta[] = rows.map((row) => ({
      cursor: encodeOperationalCursor(state.scope, BigInt(row.seq)),
      changeType: row.change_type,
      priority: row.priority,
      entityRefs: safeRefs(row.entity_refs),
      workId: row.work_id,
      projectionTags: row.projection_tags.slice(0, 16),
      occurredAt: row.occurred_at instanceof Date ? row.occurred_at.toISOString() : new Date(row.occurred_at).toISOString(),
    }));
    return {
      status: "ok",
      cursor: deltas.at(-1)?.cursor ?? encodeOperationalCursor(state.scope, decoded.seq),
      deltas,
      hasMore,
      retentionDays: OPERATIONAL_DELTA_RETENTION_DAYS,
    };
  });
}
