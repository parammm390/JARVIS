// B3.T7 — usage-rate advisory scan. It consumes only event-backed stock usage and
// drafts the existing gated, read-only reorder-review action; it never places an
// order or changes inventory.

import { withTenant, businessEvents, domainPolicies, inventoryItems, scanFindings } from "@finnor/db";
import { ewmaReorderSuggestion } from "@finnor/read-models";
import { and, eq, gte } from "drizzle-orm";
import { FinnorOrchestrator } from "@finnor/orchestration";
import type { JobHandler } from "../queue";

let orchestrator: FinnorOrchestrator | null = null;

const DAY_MS = 86_400_000;
const HISTORY_DAYS = 14;

const dayKey = (date: Date) => date.toISOString().slice(0, 10);

export const scanEwmaReorder: JobHandler = async (payload) => {
  const tenantId = String(payload.tenantId ?? "");
  if (!tenantId) throw new Error("scan_ewma_reorder requires tenantId");
  orchestrator ??= new FinnorOrchestrator();

  const today = new Date();
  const start = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate() - HISTORY_DAYS + 1));
  const [items, usageEvents, policies] = await withTenant(tenantId, (db) =>
    Promise.all([
      db.select().from(inventoryItems).where(eq(inventoryItems.tenantId, tenantId)),
      db.select({ entityId: businessEvents.entityId, payload: businessEvents.payload, occurredAt: businessEvents.occurredAt })
        .from(businessEvents)
        .where(and(eq(businessEvents.tenantId, tenantId), eq(businessEvents.entityType, "inventory_item"), eq(businessEvents.eventType, "stock_used_on_visit"), gte(businessEvents.occurredAt, start))),
      db.select().from(domainPolicies).where(and(eq(domainPolicies.tenantId, tenantId), eq(domainPolicies.actionType, "flag_reorder_needed"))).limit(1),
    ]),
  );
  const usageByItemDay = new Map<string, Map<string, number>>();
  for (const event of usageEvents) {
    const quantity = Number((event.payload as Record<string, unknown>).quantity);
    if (!Number.isFinite(quantity) || quantity <= 0) continue;
    const byDay = usageByItemDay.get(event.entityId) ?? new Map<string, number>();
    const key = dayKey(event.occurredAt);
    byDay.set(key, (byDay.get(key) ?? 0) + quantity);
    usageByItemDay.set(event.entityId, byDay);
  }
  const dates = Array.from({ length: HISTORY_DAYS }, (_, index) => dayKey(new Date(start.getTime() + index * DAY_MS)));
  const candidates = items.flatMap((item) => {
    const byDay = usageByItemDay.get(item.id);
    if (!byDay) return [];
    const suggestion = ewmaReorderSuggestion(dates.map((date) => byDay.get(date) ?? 0), item.quantity);
    return suggestion ? [{ item, suggestion }] : [];
  });
  if (candidates.length === 0) return;

  const autoDraft = (policies[0]?.policy as Record<string, unknown> | undefined)?.autoDraftReorderFlags === true;
  for (const { item, suggestion } of candidates) {
    const reasoning = `EWMA usage is ${suggestion.dailyUsage}/day from ${HISTORY_DAYS} days of recorded stock use; the explicit ${suggestion.horizonDays}-day planning horizon gives a reorder point of ${suggestion.reorderPoint}.`;
    let draftedActionId: string | undefined;
    if (autoDraft) {
      const { action } = await orchestrator.draftKnownAction(
        "flag_reorder_needed",
        { sku: item.sku, name: item.name, reasoning, suggestedQuantity: suggestion.suggestedQuantity },
        tenantId,
        { source: "scan_ewma_reorder" },
      );
      draftedActionId = action.id;
    }
    await withTenant(tenantId, (db) => db.insert(scanFindings).values({
      tenantId,
      scanType: "ewma_reorder",
      severity: "warning",
      summary: `${item.name}: ${reasoning} Current stock is ${item.quantity}; review ${suggestion.suggestedQuantity} additional unit${suggestion.suggestedQuantity === 1 ? "" : "s"}.`,
      details: { sku: item.sku, currentQuantity: item.quantity, ...suggestion, autoDrafted: autoDraft },
      draftedActionId,
    }));
  }
};
