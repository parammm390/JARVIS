// Shared pricing-catalog read helper. One domain_policies row per tenant
// (action_type = PRICING_CATALOG_ACTION_TYPE), read by every plugin that needs to
// price a line item — never guessed, never duplicated per plugin.

import { withTenant, domainPolicies } from "@finnor/db";
import { and, eq } from "drizzle-orm";
import { containsPlaceholder } from "./plugin-interface";
import { PricingCatalogSchema, type PricingCatalog } from "./pricing-catalog.schema";

export const PRICING_CATALOG_ACTION_TYPE = "pricing_catalog";

export async function loadPricingCatalog(tenantId: string): Promise<PricingCatalog> {
  const row = await withTenant(tenantId, async (db) => {
    const [r] = await db
      .select()
      .from(domainPolicies)
      .where(and(eq(domainPolicies.tenantId, tenantId), eq(domainPolicies.actionType, PRICING_CATALOG_ACTION_TYPE)));
    return r;
  });
  return PricingCatalogSchema.parse(row?.policy ?? {});
}

/** Null = not priced — never guessed. Matches by sku first, then case-insensitive label. */
export function priceForItem(catalog: PricingCatalog, itemKey: string): number | null {
  const hit = catalog.items.find((i) => i.sku === itemKey || i.label.toLowerCase() === itemKey.toLowerCase());
  return hit && typeof hit.priceUsd === "number" ? hit.priceUsd : null;
}

export function isPricingCatalogReady(catalog: PricingCatalog): boolean {
  return catalog.items.length > 0 && !containsPlaceholder(catalog);
}
