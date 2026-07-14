import { describe, it, expect } from "vitest";
import { PricingCatalogSchema } from "../../packages/domain-plugins/shared/pricing-catalog.schema";
import { priceForItem, isPricingCatalogReady } from "../../packages/domain-plugins/shared/pricing-catalog";
import { PLACEHOLDER_NEEDS_REAL_VALUE } from "@finnor/shared-types";

describe("pricing-catalog schema", () => {
  it("defaults to an empty, placeholder-gated catalog", () => {
    const catalog = PricingCatalogSchema.parse({});
    expect(catalog.items).toEqual([]);
    expect(catalog.laborRatePerHourUsd).toBe(PLACEHOLDER_NEEDS_REAL_VALUE);
    expect(catalog.taxRatePct).toBe(0);
  });

  it("accepts real numeric prices alongside the placeholder union", () => {
    const catalog = PricingCatalogSchema.parse({
      items: [{ sku: "SOFT-48K", label: "48k Grain Softener", priceUsd: 1899 }],
      laborRatePerHourUsd: 95,
    });
    expect(catalog.items[0]!.priceUsd).toBe(1899);
    expect(catalog.laborRatePerHourUsd).toBe(95);
  });
});

describe("priceForItem", () => {
  const catalog = PricingCatalogSchema.parse({
    items: [
      { sku: "SOFT-48K", label: "48k Grain Softener", priceUsd: 1899 },
      { sku: "RO-3STAGE", label: "3-Stage RO System", priceUsd: PLACEHOLDER_NEEDS_REAL_VALUE },
    ],
  });

  it("matches by exact sku", () => {
    expect(priceForItem(catalog, "SOFT-48K")).toBe(1899);
  });

  it("matches by case-insensitive label", () => {
    expect(priceForItem(catalog, "48k grain softener")).toBe(1899);
  });

  it("returns null for a placeholder-priced item — never guesses", () => {
    expect(priceForItem(catalog, "RO-3STAGE")).toBeNull();
  });

  it("returns null for an item not in the catalog", () => {
    expect(priceForItem(catalog, "unknown-item")).toBeNull();
  });
});

describe("isPricingCatalogReady", () => {
  it("is false for an empty catalog", () => {
    expect(isPricingCatalogReady(PricingCatalogSchema.parse({}))).toBe(false);
  });

  it("is false when any item still has a placeholder price", () => {
    const catalog = PricingCatalogSchema.parse({
      items: [{ sku: "A", label: "A", priceUsd: PLACEHOLDER_NEEDS_REAL_VALUE }],
    });
    expect(isPricingCatalogReady(catalog)).toBe(false);
  });

  it("is true once every item and the labor rate are real numbers", () => {
    const catalog = PricingCatalogSchema.parse({
      items: [{ sku: "A", label: "A", priceUsd: 100 }],
      laborRatePerHourUsd: 95,
    });
    expect(isPricingCatalogReady(catalog)).toBe(true);
  });
});
