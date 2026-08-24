import { afterAll, beforeAll, describe, expect, it } from "vitest";
import pg from "pg";
import { randomUUID } from "node:crypto";
import { adminDb, closePool, inventoryItems, tenants } from "@finnor/db";
import { BUSINESS_SCENES } from "@finnor/shared-types";
import { businessWorld } from "@finnor/read-models";
import { migrate } from "../../packages/db/migrate";
import { GET as businessWorldRoute } from "../../apps/api/app/api/business-world/route";

const DB_URL = process.env.DATABASE_URL ?? "postgres://finnor:finnor@localhost:5432/finnor";
const PREVIOUS_AUTH_DEV_BYPASS = process.env.AUTH_DEV_BYPASS;
const available = await (async () => { const client = new pg.Client({ connectionString: DB_URL, connectionTimeoutMillis: 2_000 }); try { await client.connect(); await client.end(); return true; } catch { return false; } })();

describe.skipIf(!available)("one canonical Business World projection", () => {
  const tenantA = randomUUID();
  const tenantB = randomUUID();
  let ownItemId = "";
  let otherItemId = "";

  beforeAll(async () => {
    process.env.DATABASE_URL = DB_URL;
    // Exercise the role boundary after authentication using the repository's
    // explicit non-production integration-test identity seam.
    process.env.AUTH_DEV_BYPASS = "1";
    await migrate(DB_URL);
    await adminDb().insert(tenants).values([{ id: tenantA, name: "World Tenant A" }, { id: tenantB, name: "World Tenant B" }]);
    const [own] = await adminDb().insert(inventoryItems).values({ tenantId: tenantA, sku: "OWN-1", name: "Tenant A resin", quantity: 2, reorderThreshold: 3, unitCostUsd: "25.00" }).returning();
    const [other] = await adminDb().insert(inventoryItems).values({ tenantId: tenantB, sku: "OTHER-1", name: "Tenant B secret stock", quantity: 99, reorderThreshold: 1, unitCostUsd: "30.00" }).returning();
    ownItemId = own!.id;
    otherItemId = other!.id;
  });
  afterAll(async () => {
    if (PREVIOUS_AUTH_DEV_BYPASS === undefined) delete process.env.AUTH_DEV_BYPASS;
    else process.env.AUTH_DEV_BYPASS = PREVIOUS_AUTH_DEV_BYPASS;
    await closePool();
  });

  it("serves all six lenses through one bounded provenance contract", async () => {
    for (const scene of BUSINESS_SCENES) {
      const projection = await businessWorld(tenantA, scene);
      expect(projection).toMatchObject({ version: 1, scene, limits: { objects: 200, relationships: 500 }, source: { kind: "canonical_postgres" } });
      expect(projection.objects.length).toBeLessThanOrEqual(200);
      expect(projection.relationships.length).toBeLessThanOrEqual(500);
    }
  });

  it("exposes the exact inventory row with source provenance and never crosses tenant scope", async () => {
    const projection = await businessWorld(tenantA, "inventory");
    expect(projection.objects).toContainEqual(expect.objectContaining({ entityType: "inventory_item", entityId: ownItemId, label: "Tenant A resin", status: "low_stock", provenance: { kind: "canonical_postgres", table: "inventory_items" } }));
    expect(projection.objects.some((object) => object.entityId === otherItemId)).toBe(false);
    expect(JSON.stringify(projection)).not.toContain("Tenant B secret stock");
  });

  it("preserves the existing owner/dispatcher dispatch boundary", async () => {
    const response = await businessWorldRoute(new Request("http://localhost/api/business-world?scene=schedule", {
      headers: { "x-tenant-id": tenantA, "x-user-role": "technician" },
    }));
    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({ error: "Dispatch access required" });
  });
});
