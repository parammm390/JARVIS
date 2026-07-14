// Shared pricing-catalog policy schema — read by both quotation.generate_quote and
// proposal-batch, so a dealer configures prices ONCE (domain_policies row keyed by
// the config-only pseudo action-type "pricing_catalog", never registered with the
// Planner/Gate/Executor) rather than duplicating a pricing shape per plugin.

import { z } from "zod";
import { PLACEHOLDER_NEEDS_REAL_VALUE } from "@finnor/shared-types";

const priceOrPlaceholder = z.union([z.number().nonnegative(), z.literal(PLACEHOLDER_NEEDS_REAL_VALUE)]);

export const PricingCatalogItemSchema = z.object({
  sku: z.string().min(1),
  label: z.string().min(1),
  priceUsd: priceOrPlaceholder,
});
export type PricingCatalogItem = z.infer<typeof PricingCatalogItemSchema>;

export const PricingCatalogSchema = z.object({
  items: z.array(PricingCatalogItemSchema).default([]),
  laborRatePerHourUsd: priceOrPlaceholder.default(PLACEHOLDER_NEEDS_REAL_VALUE),
  taxRatePct: z.number().min(0).max(100).default(0),
});
export type PricingCatalog = z.infer<typeof PricingCatalogSchema>;
