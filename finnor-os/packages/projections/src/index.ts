// B1.T3 — CQRS projections for the 3 hottest read-models: pipeline-health, reliability,
// activity-snapshot. The other 9 views named in the plan stay pure query-time (their
// own routes call @finnor/read-models directly) — these 3 get a cache row in
// read_model_projections (migration 0038) that a real API route can serve without
// redoing the aggregation query every request.
//
// Deviation from the plan's literal "projector job consumes outbox events": grepped
// the whole codebase (JARVIS-MAESTRO-STATE.md's B1 session log has the full evidence)
// and enqueueOutboxEvent() has zero call sites anywhere in application code — the
// outbox table is real, tested, wired into the job queue, and permanently empty today.
// Consuming it literally would mean this projector never fires. Adapted, not stopped:
// the incremental-update signal is B1.T1's jarvis_events NOTIFY (which IS actually
// populated by real writes) instead of the outbox specifically. The design goal —
// materialized views, updated incrementally, NOTIFY-driven, rebuildable from scratch —
// is unchanged; only the upstream event source differs because the named one turns
// out to be inert.
//
// "Incrementally maintains" here means recompute-on-signal (debounced per tenant+view),
// not field-level delta patching — the EXIT GATE's own "rebuild rows === query-time
// rows" diff test is trivially true this way (the write path IS the query-time
// function), and field-level patching for 3 fairly different aggregations would be a
// lot of bug surface for a first version. The cache still does its job: reads are a
// single-row lookup instead of a multi-table aggregation, and a periodic backstop (see
// rebuildAllProjections, wired to a worker job) keeps every view fresh even on the one
// coverage gap noted in migration 0037 (proposals has no tenant_id column, so it can't
// carry a NOTIFY trigger — that leg of pipeline-health only self-heals on the backstop
// tick, not live).

import { adminDb, readModelProjections, getPool } from "@finnor/db";
import { pipelineHealth, reliability, activitySnapshot, type PipelineHealth, type ReliabilityMetrics, type ActivitySnapshot } from "@finnor/read-models";
import { and, eq } from "drizzle-orm";
import { getLogger } from "@finnor/tools";
import type { JarvisEvent } from "@finnor/shared-types";

export const PROJECTED_VIEWS = ["pipeline-health", "reliability", "activity-snapshot"] as const;
export type ProjectedView = (typeof PROJECTED_VIEWS)[number];

export type ProjectionData<V extends ProjectedView> = V extends "pipeline-health"
  ? PipelineHealth
  : V extends "reliability"
    ? ReliabilityMetrics
    : ActivitySnapshot;

async function computeView(tenantId: string, view: ProjectedView): Promise<unknown> {
  switch (view) {
    case "pipeline-health":
      return pipelineHealth(tenantId);
    case "reliability":
      return reliability(tenantId);
    case "activity-snapshot":
      return activitySnapshot(tenantId);
  }
}

async function notifyProjectionUpdated(tenantId: string, view: ProjectedView): Promise<void> {
  const event: JarvisEvent = { tenantId, kind: "projection", id: view, ts: new Date().toISOString() };
  await getPool().query("SELECT pg_notify('jarvis_events', $1)", [JSON.stringify(event)]);
}

/** Recomputes a view live and upserts the cache row — the one function that IS the
 *  "rebuild from scratch" command the EXIT GATE asks for, and the same function both
 *  the debounced dirty-refresh and the periodic backstop call. */
export async function rebuildProjection<V extends ProjectedView>(tenantId: string, view: V): Promise<ProjectionData<V>> {
  const data = await computeView(tenantId, view);
  await adminDb()
    .insert(readModelProjections)
    .values({ tenantId, view, data: data as object, updatedAt: new Date() })
    .onConflictDoUpdate({
      target: [readModelProjections.tenantId, readModelProjections.view],
      set: { data: data as object, updatedAt: new Date() },
    });
  await notifyProjectionUpdated(tenantId, view);
  return data as ProjectionData<V>;
}

/** Read the cache; self-heals by computing live (and populating the cache) on a cold
 *  miss instead of ever returning nothing to an API caller. */
export async function getProjection<V extends ProjectedView>(tenantId: string, view: V): Promise<ProjectionData<V>> {
  const [row] = await adminDb()
    .select()
    .from(readModelProjections)
    .where(and(eq(readModelProjections.tenantId, tenantId), eq(readModelProjections.view, view)));
  if (row) return row.data as ProjectionData<V>;
  return rebuildProjection(tenantId, view);
}

/** One tenant, all 3 views — what the periodic backstop job (registered like every
 *  other proactive scan, one enqueue per tenant) actually calls. Exists as its own
 *  function (rather than every scheduled tick looping every tenant redundantly) to
 *  match this repo's established per-tenant job-scheduling convention. */
export async function refreshAllViewsForTenant(tenantId: string): Promise<void> {
  for (const view of PROJECTED_VIEWS) await rebuildProjection(tenantId, view);
}

/** CLI-callable full rebuild across every tenant — the manual/ops "rebuild from
 *  scratch" command the EXIT GATE asks for. Built on the same refreshAllViewsForTenant
 *  the scheduled backstop uses, so there is exactly one code path for "recompute
 *  everything," not two that could quietly drift apart. */
export async function rebuildAllProjections(): Promise<{ tenants: number; rebuilt: number }> {
  const { rows: tenantRows } = await getPool().query<{ id: string }>("SELECT id FROM tenants");
  for (const { id: tenantId } of tenantRows) await refreshAllViewsForTenant(tenantId);
  return { tenants: tenantRows.length, rebuilt: tenantRows.length * PROJECTED_VIEWS.length };
}

const DIRTY_VIEWS_BY_KIND: Record<string, ProjectedView[]> = {
  domain_action: ["reliability"],
  workflow_step: ["reliability", "activity-snapshot"],
  dead_letter: ["reliability"],
  action_log: ["activity-snapshot"],
  call: ["activity-snapshot"],
  lead: ["pipeline-health"],
  quote: ["pipeline-health"],
};

const DEBOUNCE_MS = 750;
const pendingRefreshes = new Map<string, ReturnType<typeof setTimeout>>();

function scheduleDebouncedRebuild(tenantId: string, view: ProjectedView): void {
  const key = `${tenantId}:${view}`;
  const existing = pendingRefreshes.get(key);
  if (existing) clearTimeout(existing);
  pendingRefreshes.set(
    key,
    setTimeout(() => {
      pendingRefreshes.delete(key);
      rebuildProjection(tenantId, view).catch((err) => {
        getLogger().error(
          { tenantId, view, err: err instanceof Error ? err.message : String(err) },
          "[projections] debounced rebuild failed",
        );
      });
    }, DEBOUNCE_MS),
  );
}

/** Wire this to onJarvisEvent (apps/worker/src/sse/listener.ts) — marks the views a
 *  given NOTIFY kind affects as dirty and debounces a real rebuild shortly after, so a
 *  burst of writes to the same tenant collapses into one recompute instead of one per
 *  row changed. */
export function onJarvisEventMarkProjectionsDirty(event: JarvisEvent): void {
  const views = DIRTY_VIEWS_BY_KIND[event.kind];
  if (!views) return;
  for (const view of views) scheduleDebouncedRebuild(event.tenantId, view);
}
