// Shared pricing-catalog read helper. Line items (sku/label/price) now live in the real
// price_book_items table (packages/data-platform) instead of a domain_policies JSONB
// blob — see docs/jarvis-90-execution-blueprint.md §1. laborRatePerHourUsd/taxRatePct
// stay in one domain_policies row per tenant (action_type = PRICING_CATALOG_ACTION_TYPE):
// they're genuine tenant-level scalar settings, not a list of records, so the existing
// "policy as data" pattern still fits. Exported signatures are unchanged so
// proposal-batch and tests/unit/pricing-catalog.test.ts need no changes.

import { withTenant, domainPolicies } from "@finnor/db";
import { and, eq } from "drizzle-orm";
import { listPriceBookItems } from "@finnor/data-platform";
import { containsPlaceholder } from "./plugin-interface";
import { PricingCatalogSchema, type PricingCatalog } from "./pricing-catalog.schema";

export const PRICING_CATALOG_ACTION_TYPE = "pricing_catalog";

export async function loadPricingCatalog(tenantId: string): Promise<PricingCatalog> {
  const [settingsRow, priceItems] = await withTenant(tenantId, async (db) => {
    const [r] = await db
      .select()
      .from(domainPolicies)
      .where(and(eq(domainPolicies.tenantId, tenantId), eq(domainPolicies.actionType, PRICING_CATALOG_ACTION_TYPE)));
    const items = await listPriceBookItems(db, tenantId);
    return [r, items] as const;
  });
  const settings = PricingCatalogSchema.parse(settingsRow?.policy ?? {});
  return {
    items: priceItems.map((i) => ({ sku: i.sku, label: i.label, priceUsd: Number(i.priceUsd) })),
    laborRatePerHourUsd: settings.laborRatePerHourUsd,
    taxRatePct: settings.taxRatePct,
  };
}

/** Null = not priced — never guessed. Matches by sku first, then case-insensitive label. */
export function priceForItem(catalog: PricingCatalog, itemKey: string): number | null {
  const hit = catalog.items.find((i) => i.sku === itemKey || i.label.toLowerCase() === itemKey.toLowerCase());
  return hit && typeof hit.priceUsd === "number" ? hit.priceUsd : null;
}

export function isPricingCatalogReady(catalog: PricingCatalog): boolean {
  return catalog.items.length > 0 && !containsPlaceholder(catalog);
}
