// scan_low_inventory job: the inventory plugin's actions are all reads/computations
// (check_stock_level, flag_reorder_needed, log_stock_used_on_visit) — flag_reorder_needed
// itself is just a check, not a reorder, but it's a real gated action a dealer can
// choose to have auto-drafted per below-threshold item once they've configured that
// they want it (config over code, same rule scan_cold_leads uses for its win-back
// script). Absent that config, this still writes a real finding for the owner digest
// instead of silently doing nothing.

import { withTenant, domainPolicies, domainActions, inventoryItems, scanFindings } from "@finnor/db";
import { and, eq, lt, inArray, sql } from "drizzle-orm";
import { FinnorOrchestrator } from "@finnor/orchestration";
import type { JobHandler } from "../queue";

// A row this scan already drafted for a still-below-threshold item is still doing
// its job — re-drafting on every 24h run (with no dedup) piled up one fresh
// flag_reorder_needed per item per day for as long as the item stayed unrestocked,
// flooding the activity feed with what reads as the same finding over and over.
// These are the "still open" statuses; once an action leaves this set (approved →
// completed/failed, or rejected) the item is fair game for a fresh flag again.
const OPEN_ACTION_STATUSES = ["draft", "pending", "approved", "executing", "needs_human_review", "blocked_integration_unavailable"] as const;

let orchestrator: FinnorOrchestrator | null = null;

export const scanLowInventory: JobHandler = async (payload) => {
  const tenantId = String(payload.tenantId ?? "");
  if (!tenantId) throw new Error("scan_low_inventory requires tenantId");
  orchestrator ??= new FinnorOrchestrator();

  // Explicit tenantId filter, not just RLS scoping — defense in depth (a role that
  // owns these tables, as local dev connections typically do, bypasses RLS entirely
  // regardless of FORCE ROW LEVEL SECURITY; production's app role doesn't own the
  // tables so RLS is enforced there, but this query should be correct either way).
  const low = await withTenant(tenantId, (db) =>
    db
      .select({ sku: inventoryItems.sku, name: inventoryItems.name, quantity: inventoryItems.quantity, threshold: inventoryItems.reorderThreshold })
      .from(inventoryItems)
      .where(and(eq(inventoryItems.tenantId, tenantId), lt(inventoryItems.quantity, inventoryItems.reorderThreshold))),
  );
  if (low.length === 0) return;

  const [policy] = await withTenant(tenantId, (db) =>
    db
      .select()
      .from(domainPolicies)
      .where(and(eq(domainPolicies.tenantId, tenantId), eq(domainPolicies.actionType, "flag_reorder_needed")))
      .limit(1),
  );
  const autoDraft = (policy?.policy as Record<string, unknown> | undefined)?.autoDraftReorderFlags === true;

  if (autoDraft) {
    // Which of today's low-stock SKUs already have an unresolved flag_reorder_needed
    // sitting open from a previous run — checked once for the whole batch rather than
    // once per item.
    const openSkus = new Set(
      (
        await withTenant(tenantId, (db) =>
          db
            .select({ sku: sql<string>`${domainActions.payload}->>'sku'` })
            .from(domainActions)
            .where(
              and(
                eq(domainActions.tenantId, tenantId),
                eq(domainActions.actionType, "flag_reorder_needed"),
                inArray(domainActions.status, OPEN_ACTION_STATUSES),
              ),
            ),
        )
      ).map((r) => r.sku),
    );

    // One gated action per item, drafted through the real plugin pipeline — payload
    // conforms to the inventory plugin's own ReorderCheckSchema (sku/name only, both
    // optional but at least one supplied here), never a bespoke shape.
    for (const item of low) {
      if (item.sku && openSkus.has(item.sku)) continue;
      const { action } = await orchestrator.draftKnownAction(
        "flag_reorder_needed",
        { sku: item.sku, name: item.name },
        tenantId,
        { source: "scan_low_inventory" },
      );
      await withTenant(tenantId, (db) =>
        db.insert(scanFindings).values({
          tenantId,
          scanType: "low_inventory",
          severity: "warning",
          summary: `${item.name} is below its reorder threshold (${item.quantity}/${item.threshold}).`,
          details: { item },
          draftedActionId: action.id,
        }),
      );
    }
    return;
  }

  await withTenant(tenantId, (db) =>
    db.insert(scanFindings).values({
      tenantId,
      scanType: "low_inventory",
      severity: "warning",
      summary: `${low.length} item${low.length === 1 ? "" : "s"} below reorder threshold: ${low
        .slice(0, 5)
        .map((i) => `${i.name} (${i.quantity}/${i.threshold})`)
        .join(", ")}${low.length > 5 ? ", and more" : ""} — set domain_policies.flag_reorder_needed.policy.autoDraftReorderFlags to auto-draft reorder flags.`,
      details: { items: low },
    }),
  );
};
