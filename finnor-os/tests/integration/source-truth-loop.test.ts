import { randomUUID } from "node:crypto";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import {
  businessEvents,
  closePool,
  externalRefs,
  households,
  integrationSyncCheckpoints,
  operationalDeltas,
  reconciliationCases,
  tenantIntegrations,
  withTenant,
} from "@finnor/db";
import { materializeSourceRecord, SourceTruthError } from "@finnor/data-platform";
import type { CanonicalSourceRecord } from "@finnor/shared-types";
import { migrate } from "../../packages/db/migrate";

const DB_URL = process.env.DATABASE_URL ?? "postgres://finnor:finnor@localhost:5432/finnor";
const available = await (async () => {
  const client = new pg.Client({ connectionString: DB_URL, connectionTimeoutMillis: 2_000 });
  try { await client.connect(); await client.end(); return true; } catch { return false; }
})();

const tenantA = randomUUID();
const tenantB = randomUUID();
const integrationA = randomUUID();
const integrationB = randomUUID();

function contact(externalId: string, overrides: Partial<CanonicalSourceRecord> = {}): CanonicalSourceRecord {
  return {
    tenantId: tenantA,
    integrationId: integrationA,
    provider: "ghl",
    sourceScope: "contacts",
    externalObjectType: "contact",
    externalId,
    canonicalEntity: "customer",
    sourceSequence: "100",
    observedAt: "2026-08-24T12:00:00.000Z",
    identityKey: `email:${externalId}@example.test`,
    data: { name: `Customer ${externalId}`, email: `${externalId}@example.test`, address: "1 Source Truth Way" },
    ownership: { default: "external", direction: "inbound" },
    provenance: { fixture: true },
    ...overrides,
  };
}

describe.skipIf(!available)("Phase 4 live company-twin source loop", () => {
  beforeAll(async () => {
    process.env.DATABASE_URL = DB_URL;
    await migrate(DB_URL);
    const admin = new pg.Client({ connectionString: DB_URL });
    await admin.connect();
    await admin.query("INSERT INTO finnor_os.tenants(id,name) VALUES ($1,'Source Tenant A'),($2,'Source Tenant B')", [tenantA, tenantB]);
    await admin.end();
    await withTenant(tenantA, (db) => db.insert(tenantIntegrations).values({
      id: integrationA,
      tenantId: tenantA,
      capability: "crm",
      binding: "ghl",
      mode: "sandbox",
      sourcePolicy: { default: "external", direction: "inbound" },
      freshnessPolicy: { scope: "contacts", maxAgeSeconds: 300, criticality: "operational", staleBehavior: "refresh_then_degrade" },
      syncScopes: ["contacts"],
      outcomePacks: ["customer_operations"],
    }));
    await withTenant(tenantB, (db) => db.insert(tenantIntegrations).values({
      id: integrationB,
      tenantId: tenantB,
      capability: "crm",
      binding: "ghl",
      mode: "sandbox",
    }));
  });

  afterAll(async () => { await closePool(); });

  it("initial sync maps one canonical customer with provenance and converges on replay", async () => {
    const first = await withTenant(tenantA, (db) => materializeSourceRecord(db, contact("initial")));
    const replay = await withTenant(tenantA, (db) => materializeSourceRecord(db, contact("initial")));
    expect(first).toMatchObject({ status: "created", canonicalEntityType: "household" });
    expect(replay).toMatchObject({ status: "duplicate", canonicalEntityId: first.canonicalEntityId });
    const [links, canonical, events] = await withTenant(tenantA, async (db) => Promise.all([
      db.select().from(externalRefs).where(and(eq(externalRefs.tenantId, tenantA), eq(externalRefs.externalId, "initial"))),
      db.select().from(households).where(and(eq(households.tenantId, tenantA), eq(households.id, first.canonicalEntityId!))),
      db.select().from(businessEvents).where(and(eq(businessEvents.tenantId, tenantA), eq(businessEvents.source, "ghl"))),
    ]));
    expect(links).toHaveLength(1);
    expect(links[0]).toMatchObject({ mappingStatus: "mapped", syncStatus: "reconciled", provider: "ghl", integrationId: integrationA });
    expect(canonical).toHaveLength(1);
    expect(events).toHaveLength(1);
  });

  it("external change applies source-owned fields and emits an operational delta", async () => {
    const before = await withTenant(tenantA, (db) => db.select().from(operationalDeltas).where(eq(operationalDeltas.tenantId, tenantA)));
    const changed = await withTenant(tenantA, (db) => materializeSourceRecord(db, contact("initial", {
      sourceSequence: "200",
      observedAt: "2026-08-24T12:01:00.000Z",
      data: { name: "Customer Initial Updated", email: "initial@example.test", address: "2 Reconciled Ave" },
    })));
    expect(changed.status).toBe("updated");
    const [canonical] = await withTenant(tenantA, (db) => db.select().from(households).where(eq(households.id, changed.canonicalEntityId!)));
    expect(canonical).toMatchObject({ address: "2 Reconciled Ave", contactInfo: expect.objectContaining({ name: "Customer Initial Updated" }) });
    const after = await withTenant(tenantA, (db) => db.select().from(operationalDeltas).where(eq(operationalDeltas.tenantId, tenantA)));
    expect(after.length).toBeGreaterThan(before.length);
    expect(after.slice(before.length).some((delta) =>
      delta.projectionTags.includes("customers") && delta.projectionTags.includes("queries"),
    )).toBe(true);
  });

  it("quarantines ambiguous deterministic candidates instead of merging", async () => {
    const candidates = await withTenant(tenantA, (db) => db.insert(households).values([
      { tenantId: tenantA, address: "10 Candidate A", contactInfo: {} },
      { tenantId: tenantA, address: "11 Candidate B", contactInfo: {} },
    ]).returning({ id: households.id }));
    const result = await withTenant(tenantA, (db) => materializeSourceRecord(db, contact("ambiguous", {
      candidateCanonicalIds: candidates.map((row) => row.id),
    })));
    expect(result.status).toBe("ambiguous");
    const [link, cases] = await withTenant(tenantA, async (db) => Promise.all([
      db.select().from(externalRefs).where(eq(externalRefs.id, result.sourceLinkId)).then((rows) => rows[0]),
      db.select().from(reconciliationCases).where(and(eq(reconciliationCases.tenantId, tenantA), eq(reconciliationCases.sourceLinkId, result.sourceLinkId))),
    ]));
    expect(link).toMatchObject({ mappingStatus: "ambiguous", conflictState: "ambiguous", internalId: null });
    expect(cases).toHaveLength(1);
  });

  it("rejects an older provider sequence without rolling canonical state backward", async () => {
    await withTenant(tenantA, (db) => materializeSourceRecord(db, contact("ordered", { sourceSequence: "500", data: { name: "Newest", email: "ordered@example.test" } })));
    const older = await withTenant(tenantA, (db) => materializeSourceRecord(db, contact("ordered", {
      sourceSequence: "499",
      observedAt: "2026-08-24T12:02:00.000Z",
      data: { name: "Older", email: "ordered@example.test" },
    })));
    expect(older.status).toBe("out_of_order");
    const [canonical] = await withTenant(tenantA, (db) => db.select().from(households).where(eq(households.id, older.canonicalEntityId!)));
    expect(canonical?.contactInfo).toMatchObject({ name: "Newest" });
  });

  it("applies explicit field ownership and opens drift instead of last-write-wins", async () => {
    await withTenant(tenantA, (db) => materializeSourceRecord(db, contact("ownership", {
      sourceSequence: "10",
      ownership: { default: "external", fields: { name: "finnor" }, direction: "bidirectional_governed" },
    })));
    const conflict = await withTenant(tenantA, (db) => materializeSourceRecord(db, contact("ownership", {
      sourceSequence: "11",
      observedAt: "2026-08-24T12:03:00.000Z",
      data: { name: "External Override", email: "ownership@example.test", address: "1 Source Truth Way" },
      ownership: { default: "external", fields: { name: "finnor" }, direction: "bidirectional_governed" },
    })));
    expect(conflict).toMatchObject({ status: "conflict", reason: "field ownership conflict" });
    const [sourceCase] = await withTenant(tenantA, (db) => db.select().from(reconciliationCases).where(and(
      eq(reconciliationCases.tenantId, tenantA),
      eq(reconciliationCases.sourceLinkId, conflict.sourceLinkId),
    )));
    expect(sourceCase).toMatchObject({ caseType: "external_drift", classification: "field_ownership_conflict", status: "open" });
  });

  it("tombstones a provider deletion while retaining canonical history", async () => {
    const created = await withTenant(tenantA, (db) => materializeSourceRecord(db, contact("deleted", { sourceSequence: "20" })));
    const deleted = await withTenant(tenantA, (db) => materializeSourceRecord(db, contact("deleted", {
      sourceSequence: "21",
      observedAt: "2026-08-24T12:04:00.000Z",
      deleted: true,
      data: {},
    })));
    expect(deleted).toMatchObject({ status: "tombstoned", canonicalEntityId: created.canonicalEntityId });
    const [link, canonical] = await withTenant(tenantA, async (db) => Promise.all([
      db.select().from(externalRefs).where(eq(externalRefs.id, deleted.sourceLinkId)).then((rows) => rows[0]),
      db.select().from(households).where(eq(households.id, created.canonicalEntityId!)).then((rows) => rows[0]),
    ]));
    expect(link).toMatchObject({ mappingStatus: "tombstoned", providerDeleted: true, syncStatus: "source_missing" });
    expect(canonical).toBeTruthy();
  });

  it("fails closed on cross-tenant integration and checkpoint forgery", async () => {
    await expect(withTenant(tenantB, (db) => materializeSourceRecord(db, contact("forged", {
      tenantId: tenantB,
      integrationId: integrationA,
    })))).rejects.toBeInstanceOf(SourceTruthError);
    await expect(withTenant(tenantB, (db) => db.insert(integrationSyncCheckpoints).values({
      tenantId: tenantB,
      integrationId: integrationA,
      sourceScope: "contacts",
    }))).rejects.toThrow();
    const foreign = await withTenant(tenantB, (db) => db.select().from(externalRefs).where(eq(externalRefs.externalId, "forged")));
    expect(foreign).toHaveLength(0);
  });
});
