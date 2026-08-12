// B4.T5: copy only safe configuration from the explicitly labeled Dealer Zero tenant.
// Transactional/customer history and integration credentials are intentionally not
// copied; a practice tenant starts with synthetic configuration, not a data clone.
import { randomUUID } from "node:crypto";
import { domainPolicies, inventoryItems, priceBookItems, tenantSettings, tenants, withTenant } from "@finnor/db";
import { DEALER_ZERO_TENANT_ID } from "@finnor/shared-types";
import { eq } from "drizzle-orm";

export async function bootstrapTrainingTenant(name: string): Promise<{ tenantId: string; policies: number; inventoryItems: number; priceBookItems: number }> {
  const tenantId = randomUUID();
  const source = await withTenant(DEALER_ZERO_TENANT_ID, async (db) => ({
    policies: await db.select().from(domainPolicies).where(eq(domainPolicies.tenantId, DEALER_ZERO_TENANT_ID)),
    inventory: await db.select().from(inventoryItems).where(eq(inventoryItems.tenantId, DEALER_ZERO_TENANT_ID)),
    prices: await db.select().from(priceBookItems).where(eq(priceBookItems.tenantId, DEALER_ZERO_TENANT_ID)),
  }));
  // Dealer Zero's development history can contain superseded duplicate SKUs. The
  // target price-book constraint is the authoritative truth: retain the last source
  // row per SKU instead of failing a practice bootstrap or inventing a renamed SKU.
  const prices = [...new Map(source.prices.map((row) => [row.sku, row])).values()];
  await withTenant(tenantId, async (db) => {
    await db.insert(tenants).values({ id: tenantId, name, timezone: "America/Chicago" });
    await db.insert(tenantSettings).values({ tenantId, isDealerZero: false, simulatorEnabled: false, trainingMode: true });
    if (source.policies.length) await db.insert(domainPolicies).values(source.policies.map(({ id: _id, tenantId: _tenantId, ...row }) => ({ ...row, tenantId })));
    if (source.inventory.length) await db.insert(inventoryItems).values(source.inventory.map(({ id: _id, tenantId: _tenantId, ...row }) => ({ ...row, tenantId })));
    if (prices.length) await db.insert(priceBookItems).values(prices.map(({ id: _id, tenantId: _tenantId, createdAt: _createdAt, updatedAt: _updatedAt, ...row }) => ({ ...row, tenantId })));
  });
  return { tenantId, policies: source.policies.length, inventoryItems: source.inventory.length, priceBookItems: prices.length };
}
