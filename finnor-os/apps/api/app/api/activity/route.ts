// GET /api/activity?since=<cursor>&limit=<n> (A2.T6) — merged, tenant-scoped feed of
// action_log + workflow_steps + calls, for D1.T3's live Activity Theater
// (SSE-first, cursor-delta polling fallback per C1.T2). Distinct from the existing
// GET /api/events (business_events — a separate, already-populated cross-entity
// timeline; see packages/data-platform/src/events.ts's own comment on why that table
// deliberately excludes exactly these three sources): this merges 3 raw tables that
// have no shared event log of their own.
//
// Forward-only keyset cursor (occurredAt, id), opposite direction from /api/events'
// backward `before` paging — "what's new since I last polled", not "load older
// history". Each source is one indexed, tenant-scoped query; merged and re-limited in
// app code, never a cross-table SQL UNION (three very different row shapes).

import { withTenant, actionLog, workflowSteps, calls } from "@finnor/db";
import { and, asc, eq, gt, or, sql, type SQL } from "drizzle-orm";
import { z } from "zod";
import { requireContext, errorResponse, AuthError } from "../../../lib/auth";

const QuerySchema = z.object({
  since: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(50).default(50),
});

interface Cursor {
  occurredAt: Date;
  id: string;
}

function decodeCursor(raw: string): Cursor {
  const sep = raw.lastIndexOf("|");
  if (sep === -1) throw new AuthError("Malformed since cursor", 400);
  const ts = raw.slice(0, sep);
  const id = raw.slice(sep + 1);
  const occurredAt = new Date(ts);
  if (Number.isNaN(occurredAt.getTime()) || !id) throw new AuthError("Malformed since cursor", 400);
  return { occurredAt, id };
}

function encodeCursor(occurredAt: Date, id: string): string {
  return `${occurredAt.toISOString()}|${id}`;
}

interface ActivityItem {
  source: "action_log" | "workflow_step" | "call";
  id: string;
  occurredAt: Date;
  detail: Record<string, unknown>;
}

// Keyset predicate for (occurredAt, id) > cursor, tie-broken on id so same-timestamp
// rows never get silently skipped or duplicated across pages. The column is truncated
// to millisecond precision before comparing: Postgres timestamptz stores microseconds,
// but the cursor was encoded from a JS Date (pg's driver already rounds to
// milliseconds on read) — comparing raw would let a row's own hidden sub-millisecond
// remainder make it look "strictly after" the cursor it itself produced, re-serving
// the exact boundary row on the next page.
function afterCursor(occurredAtCol: unknown, idCol: unknown, cursor: Cursor | null): SQL | undefined {
  if (!cursor) return undefined;
  const col = occurredAtCol as Parameters<typeof gt>[0];
  const idc = idCol as Parameters<typeof gt>[0];
  const truncated = sql`date_trunc('milliseconds', ${col})`;
  return or(gt(truncated, cursor.occurredAt), and(eq(truncated, cursor.occurredAt), gt(idc, cursor.id)));
}

export async function GET(req: Request): Promise<Response> {
  try {
    const ctx = await requireContext(req);
    const url = new URL(req.url);
    const parsed = QuerySchema.safeParse({
      since: url.searchParams.get("since") ?? undefined,
      limit: url.searchParams.get("limit") ?? undefined,
    });
    if (!parsed.success) return Response.json({ error: "Invalid query" }, { status: 400 });
    const cursor = parsed.data.since ? decodeCursor(parsed.data.since) : null;
    const { limit } = parsed.data;

    const [actionLogRows, stepRows, callRows] = await withTenant(ctx.tenantId, async (db) => {
      return Promise.all([
        db
          .select()
          .from(actionLog)
          .where(and(eq(actionLog.tenantId, ctx.tenantId), afterCursor(actionLog.timestamp, actionLog.id, cursor)))
          .orderBy(asc(actionLog.timestamp), asc(actionLog.id))
          .limit(limit),
        db
          .select()
          .from(workflowSteps)
          .where(and(eq(workflowSteps.tenantId, ctx.tenantId), afterCursor(workflowSteps.updatedAt, workflowSteps.id, cursor)))
          .orderBy(asc(workflowSteps.updatedAt), asc(workflowSteps.id))
          .limit(limit),
        db
          .select()
          .from(calls)
          .where(and(eq(calls.tenantId, ctx.tenantId), afterCursor(calls.createdAt, calls.id, cursor)))
          .orderBy(asc(calls.createdAt), asc(calls.id))
          .limit(limit),
      ]);
    });

    const items: ActivityItem[] = [
      ...actionLogRows.map((r) => ({
        source: "action_log" as const,
        id: r.id,
        occurredAt: r.timestamp,
        detail: { domainActionId: r.domainActionId, step: r.step, output: r.output },
      })),
      ...stepRows.map((r) => ({
        source: "workflow_step" as const,
        id: r.id,
        occurredAt: r.updatedAt,
        detail: { workflowRunId: r.workflowRunId, stepType: r.stepType, status: r.status, terminalReason: r.terminalReason },
      })),
      ...callRows.map((r) => ({
        source: "call" as const,
        id: r.id,
        occurredAt: r.createdAt,
        detail: { direction: r.direction, endedReason: r.endedReason, fromNumber: r.fromNumber, toNumber: r.toNumber },
      })),
    ]
      .sort((a, b) => a.occurredAt.getTime() - b.occurredAt.getTime() || a.id.localeCompare(b.id))
      .slice(0, limit);

    const last = items[items.length - 1];
    const nextCursor = last ? encodeCursor(last.occurredAt, last.id) : (parsed.data.since ?? null);

    return Response.json(
      { items, nextCursor, hasMore: [actionLogRows, stepRows, callRows].some((rows) => rows.length === limit) },
      { headers: { "cache-control": "no-store" } },
    );
  } catch (err) {
    return errorResponse(err);
  }
}
