import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import pg from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "../../packages/db/migrate";
import { MIGRATIONS } from "../../packages/db/migrations-bundle";
import * as schema from "../../packages/db/schema";
import type { Db } from "@finnor/db";
import { CanonicalImportError, writeCanonicalImportRow } from "../../packages/data-platform/src/import-writes";

const SOURCE_URL = process.env.DATABASE_URL ?? "postgres://finnor:finnor@localhost:5432/finnor";
async function dbUp(): Promise<boolean> {
  const client = new pg.Client({ connectionString: SOURCE_URL, connectionTimeoutMillis: 2_000 });
  try { await client.connect(); await client.end(); return true; } catch { return false; }
}
const available = await dbUp();
const databaseUrl = (name: string) => { const url = new URL(SOURCE_URL); url.pathname = `/${name}`; return url.toString(); };

describe.skipIf(!available).sequential("Phase-1 Property/Asset additive upgrade and import convergence", () => {
  const upgradeDatabase = `finnor_phase1_asset_${randomUUID().replaceAll("-", "_")}`;
  const freshDatabase = `finnor_phase1_fresh_${randomUUID().replaceAll("-", "_")}`;
  const upgradeUrl = databaseUrl(upgradeDatabase);
  const freshUrl = databaseUrl(freshDatabase);
  const tenantId = randomUUID();
  const otherTenantId = randomUUID();
  const householdId = randomUUID();
  const unresolvedHouseholdId = randomUUID();
  const legacyEquipmentId = randomUUID();
  const unresolvedEquipmentId = randomUUID();
  const legacyAppointmentId = randomUUID();
  let client: pg.Client;
  let db: Db;

  beforeAll(async () => {
    const admin = new pg.Client({ connectionString: SOURCE_URL });
    await admin.connect();
    await admin.query(`CREATE DATABASE ${upgradeDatabase}`);
    await admin.query(`CREATE DATABASE ${freshDatabase}`);
    await admin.end();

    await migrate(upgradeUrl, MIGRATIONS.filter(({ name }) => name < "0102_phase1_property_asset_planning_ir.sql"));
    client = new pg.Client({ connectionString: upgradeUrl });
    await client.connect();
    await client.query("INSERT INTO finnor_os.tenants(id,client_key,name) VALUES ($1,$2,'Asset Upgrade'),($3,$4,'Other Tenant')", [tenantId, `asset-${tenantId}`, otherTenantId, `asset-${otherTenantId}`]);
    await client.query("INSERT INTO finnor_os.households(id,tenant_id,address) VALUES ($1,$2,'10 Stable Service Rd'),($3,$2,'  Not   Provided  ')", [householdId, tenantId, unresolvedHouseholdId]);
    // This is the exact pre-Phase-1 legacy import shape: no property column exists.
    await client.query("INSERT INTO finnor_os.equipment(id,tenant_id,household_id,type,model,source) VALUES ($1,$2,$3,'softener','S-100','competitor'),($4,$2,$5,'pump','P-9','finnor')", [legacyEquipmentId, tenantId, householdId, unresolvedEquipmentId, unresolvedHouseholdId]);
    await client.query("INSERT INTO finnor_os.appointments(id,tenant_id,subject_type,subject_id,status,scheduled_at) VALUES ($1,$2,'household',$3,'confirmed','2026-09-01T15:00:00Z')", [legacyAppointmentId, tenantId, householdId]);
    await migrate(upgradeUrl, MIGRATIONS);
    db = drizzle(client, { schema }) as Db;
    await migrate(freshUrl, MIGRATIONS);
  }, 180_000);

  afterAll(async () => {
    await client?.end();
    const admin = new pg.Client({ connectionString: SOURCE_URL });
    await admin.connect();
    await admin.query(`DROP DATABASE IF EXISTS ${upgradeDatabase} WITH (FORCE)`);
    await admin.query(`DROP DATABASE IF EXISTS ${freshDatabase} WITH (FORCE)`);
    await admin.end();
  }, 30_000);

  it("fresh migration installs tenant-forced Property/Asset and Planning-IR tables", async () => {
    const fresh = new pg.Client({ connectionString: freshUrl });
    await fresh.connect();
    const rows = await fresh.query(`
      SELECT c.relname,c.relrowsecurity,c.relforcerowsecurity
      FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
      WHERE n.nspname='finnor_os' AND c.relname IN ('properties','asset_measurements','planning_ir_artifacts')
      ORDER BY c.relname
    `);
    await fresh.end();
    expect(rows.rows).toEqual([
      { relname: "asset_measurements", relrowsecurity: true, relforcerowsecurity: true },
      { relname: "planning_ir_artifacts", relrowsecurity: true, relforcerowsecurity: true },
      { relname: "properties", relrowsecurity: true, relforcerowsecurity: true },
    ]);
  });

  it("preserves existing equipment ids and leaves weak historical relationships UNRESOLVED", async () => {
    const resolved = await client.query("SELECT id,property_id,property_link_status,asset_domain FROM finnor_os.equipment WHERE id=$1", [legacyEquipmentId]);
    expect(resolved.rows[0]).toMatchObject({ id: legacyEquipmentId, property_link_status: "RESOLVED", asset_domain: "UNRESOLVED" });
    expect(resolved.rows[0].property_id).toMatch(/^[0-9a-f-]{36}$/);
    const unresolved = await client.query("SELECT id,property_id,property_link_status FROM finnor_os.equipment WHERE id=$1", [unresolvedEquipmentId]);
    expect(unresolved.rows[0]).toEqual({ id: unresolvedEquipmentId, property_id: null, property_link_status: "UNRESOLVED" });
    expect((await client.query("SELECT count(*)::int count FROM finnor_os.properties WHERE household_id=$1", [unresolvedHouseholdId])).rows[0].count).toBe(0);
    const appointment = await client.query("SELECT id,property_id FROM finnor_os.appointments WHERE id=$1", [legacyAppointmentId]);
    expect(appointment.rows[0]).toEqual({ id: legacyAppointmentId, property_id: resolved.rows[0].property_id });
  });

  it("converges import-before-migration, migration, and the same import to one canonical equipment id", async () => {
    const result = await writeCanonicalImportRow(db, {
      tenantId, entity: "equipment", data: { type: "softener", model: "S-100", source: "competitor", assetDomain: "WATER" },
      relationships: { householdId }, sourceOwned: false, updateMode: "fill_missing", provenance: { sourceSystem: "legacy-assets", sourceId: "legacy-softener-1" },
    });
    expect(result.entityId).toBe(legacyEquipmentId);
    expect((await client.query("SELECT count(*)::int count FROM finnor_os.equipment WHERE tenant_id=$1 AND type='softener' AND model='S-100'", [tenantId])).rows[0].count).toBe(1);
  });

  it("keeps equivalent assets distinct at two real properties and rejects ambiguous property-less imports", async () => {
    const primary = (await client.query("SELECT id FROM finnor_os.properties WHERE tenant_id=$1 AND household_id=$2", [tenantId, householdId])).rows[0].id as string;
    const second = randomUUID();
    await client.query("INSERT INTO finnor_os.properties(id,tenant_id,household_id,address,kind,link_status) VALUES ($1,$2,$3,'20 Second Service Rd','residential','RESOLVED')", [second, tenantId, householdId]);
    const first = await writeCanonicalImportRow(db, { tenantId, entity: "equipment", data: { type: "filter", model: "EQ-2", assetDomain: "HVAC" }, relationships: { householdId, propertyId: primary }, sourceOwned: true, updateMode: "source_owned", provenance: { sourceSystem: "asset-source", sourceId: "property-one-filter" } });
    const secondAsset = await writeCanonicalImportRow(db, { tenantId, entity: "equipment", data: { type: "filter", model: "EQ-2", assetDomain: "HVAC" }, relationships: { householdId, propertyId: second }, sourceOwned: true, updateMode: "source_owned", provenance: { sourceSystem: "asset-source", sourceId: "property-two-filter" } });
    expect(secondAsset.entityId).not.toBe(first.entityId);
    const repeated = await writeCanonicalImportRow(db, { tenantId, entity: "equipment", data: { type: "filter", model: "EQ-2", assetDomain: "HVAC" }, relationships: { householdId, propertyId: second }, sourceOwned: false, updateMode: "fill_missing", provenance: { sourceSystem: "asset-source", sourceId: "property-two-filter" } });
    expect(repeated.entityId).toBe(secondAsset.entityId);
    await expect(writeCanonicalImportRow(db, { tenantId, entity: "equipment", data: { type: "filter", model: "EQ-2" }, relationships: { householdId }, sourceOwned: false, updateMode: "fill_missing", provenance: { sourceSystem: "ambiguous", sourceId: "ambiguous-filter" } })).rejects.toMatchObject({ code: "ambiguous_match", field: "propertyId" } satisfies Partial<CanonicalImportError>);
    expect((await client.query("SELECT count(*)::int count FROM finnor_os.equipment WHERE tenant_id=$1 AND type='filter' AND model='EQ-2'", [tenantId])).rows[0].count).toBe(2);
  });

  it("rejects a cross-tenant property relationship before an asset can be written", async () => {
    const otherHousehold = randomUUID();
    const otherProperty = randomUUID();
    await client.query("INSERT INTO finnor_os.households(id,tenant_id,address) VALUES ($1,$2,'Other Tenant Rd')", [otherHousehold, otherTenantId]);
    await client.query("INSERT INTO finnor_os.properties(id,tenant_id,household_id,address,kind,link_status) VALUES ($1,$2,$3,'Other Tenant Rd','residential','RESOLVED')", [otherProperty, otherTenantId, otherHousehold]);
    await expect(writeCanonicalImportRow(db, { tenantId, entity: "equipment", data: { type: "pump", model: "P-CROSS" }, relationships: { householdId, propertyId: otherProperty }, sourceOwned: false, updateMode: "fill_missing", provenance: { sourceSystem: "forged", sourceId: "cross-tenant" } })).rejects.toMatchObject({ code: "invalid_relationship", field: "propertyId" } satisfies Partial<CanonicalImportError>);
  });
});
