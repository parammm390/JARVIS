// scan_low_inventory job: no mutating action_type exists for "reorder this" (the
// inventory plugin's actions are all reads/computations — check_stock_level,
// flag_reorder_needed, log_stock_used_on_visit) — inventing a bespoke one wasn't
// worth it for a v1 proactive pass, so this writes a real finding for the owner
// digest instead. Real data (a real query against real thresholds), just not a
// gated action, because there's no real "do something" step to gate yet.

import { withTenant, inventoryItems, scanFindings } from "@finnor/db";
import { and, eq, lt } from "drizzle-orm";
import type { JobHandler } from "../queue";

export const scanLowInventory: JobHandler = async (payload) => {
  const tenantId = String(payload.tenantId ?? "");
  if (!tenantId) throw new Error("scan_low_inventory requires tenantId");

  // Explicit tenantId filter, not just RLS scoping — defense in depth (a role that
  // owns these tables, as local dev connections typically do, bypasses RLS entirely
  // regardless of FORCE ROW LEVEL SECURITY; production's app role doesn't own the
  // tables so RLS is enforced there, but this query should be correct either way).
  const low = await withTenant(tenantId, (db) =>
    db
      .select({ name: inventoryItems.name, quantity: inventoryItems.quantity, threshold: inventoryItems.reorderThreshold })
      .from(inventoryItems)
      .where(and(eq(inventoryItems.tenantId, tenantId), lt(inventoryItems.quantity, inventoryItems.reorderThreshold))),
  );
  if (low.length === 0) return;

  await withTenant(tenantId, (db) =>
    db.insert(scanFindings).values({
      tenantId,
      scanType: "low_inventory",
      summary: `${low.length} item${low.length === 1 ? "" : "s"} below reorder threshold: ${low
        .slice(0, 5)
        .map((i) => `${i.name} (${i.quantity}/${i.threshold})`)
        .join(", ")}${low.length > 5 ? ", and more" : ""}.`,
      details: { items: low },
    }),
  );
};
