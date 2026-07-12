// Shared tenant-scoped lookups for native plugins. Read-only helpers — writes stay
// inside each plugin's execute().

import { withTenant, households, technicians, inventoryItems } from "@finnor/db";
import { eq, sql, or, ilike } from "drizzle-orm";

export async function findHousehold(
  tenantId: string,
  by: { householdId?: string; phone?: string },
): Promise<{ id: string; address: string; contactInfo: Record<string, unknown> } | null> {
  return withTenant(tenantId, async (db) => {
    const [row] = by.householdId
      ? await db.select().from(households).where(eq(households.id, by.householdId))
      : by.phone
        ? await db.select().from(households).where(sql`${households.contactInfo} ->> 'phone' = ${by.phone}`)
        : [];
    return row
      ? { id: row.id, address: row.address, contactInfo: row.contactInfo as Record<string, unknown> }
      : null;
  });
}

export async function findTechnician(
  tenantId: string,
  by: { technicianId?: string; name?: string },
): Promise<{ id: string; name: string; availability: Record<string, unknown> } | null> {
  return withTenant(tenantId, async (db) => {
    const [row] = by.technicianId
      ? await db.select().from(technicians).where(eq(technicians.id, by.technicianId))
      : by.name
        ? await db.select().from(technicians).where(ilike(technicians.name, `%${by.name}%`))
        : [];
    return row ? { id: row.id, name: row.name, availability: row.availability as Record<string, unknown> } : null;
  });
}

export async function findInventoryItem(
  tenantId: string,
  by: { sku?: string; name?: string },
): Promise<{ id: string; sku: string; name: string; quantity: number; reorderThreshold: number } | null> {
  return withTenant(tenantId, async (db) => {
    const shape = (row: typeof inventoryItems.$inferSelect) => ({
      id: row.id,
      sku: row.sku,
      name: row.name,
      quantity: row.quantity,
      reorderThreshold: row.reorderThreshold,
    });
    if (by.sku) {
      const [row] = await db.select().from(inventoryItems).where(eq(inventoryItems.sku, by.sku)).limit(1);
      if (row) return shape(row);
    }
    const query = (by.name ?? by.sku ?? "").trim();
    if (!query) return null;
    // Exact-ish first, then token match: spoken queries arrive as "RO membranes",
    // "sediment filters" — plural, partial, reordered. Every meaningful token
    // (singular-normalized) must appear in the item name.
    const [direct] = await db
      .select()
      .from(inventoryItems)
      .where(or(ilike(inventoryItems.name, `%${query}%`), eq(inventoryItems.sku, query)))
      .limit(1);
    if (direct) return shape(direct);
    const tokens = query
      .toLowerCase()
      .split(/\W+/)
      .filter((t) => t.length > 1)
      .map((t) => t.replace(/s$/, ""));
    if (tokens.length === 0) return null;
    const all = await db.select().from(inventoryItems);
    const match = all.find((row) => {
      const name = row.name.toLowerCase();
      return tokens.every((t) => name.includes(t));
    });
    return match ? shape(match) : null;
  });
}
