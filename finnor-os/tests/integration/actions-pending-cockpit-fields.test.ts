// D2.T1 acceptance: GET /api/actions/pending now also embeds `critic` (the async
// critic_review verdict, real but honestly null when none has run) and
// `priceBookProvenance` (payload {sku, price} pairs compared against this tenant's
// real price_book_items rows) — see finnor-os/apps/api/lib/price-book-provenance.ts
// and the route file's own header for why these are scoped the way they are.

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import pg from "pg";
import { migrate } from "../../packages/db/migrate";
import { withTenant, closePool, tenants, domainActions, actionLog, priceBookItems } from "@finnor/db";
import { GET as pendingGET } from "../../apps/api/app/api/actions/pending/route";

const DB_URL = process.env.DATABASE_URL ?? "postgres://finnor:finnor@localhost:5432/finnor";
const TENANT_ID = "00000000-0000-4000-8000-0000000000ec";

async function dbUp(): Promise<boolean> {
  const c = new pg.Client({ connectionString: DB_URL, connectionTimeoutMillis: 2000 });
  try {
    await c.connect();
    await c.end();
    return true;
  } catch {
    return false;
  }
}
const available = await dbUp();

function req(): Request {
  return new Request("http://localhost/api/actions/pending", { headers: { "x-tenant-id": TENANT_ID, "x-user-role": "owner" } });
}

describe.skipIf(!available)("GET /api/actions/pending — critic + price-book provenance (D2.T1)", () => {
  beforeAll(async () => {
    process.env.DATABASE_URL = DB_URL;
    process.env.AUTH_DEV_BYPASS = "1";
    await migrate(DB_URL);
    await withTenant(TENANT_ID, (db) => db.insert(tenants).values({ id: TENANT_ID, name: "Cockpit Fields Test" }).onConflictDoNothing());
  });
  afterAll(async () => {
    await closePool();
  });

  it("critic is null when no critic_review episode exists", async () => {
    const [action] = await withTenant(TENANT_ID, (db) =>
      db.insert(domainActions).values({ tenantId: TENANT_ID, actionType: "send_service_reminder", payload: {}, status: "pending", summary: "no critic yet" }).returning(),
    );
    const res = await pendingGET(req());
    const body = await res.json();
    const found = body.actions.find((a: { id: string }) => a.id === action!.id);
    expect(found.critic).toBeNull();
  });

  it("critic surfaces the latest critic_review verdict when one exists", async () => {
    const [action] = await withTenant(TENANT_ID, (db) =>
      db.insert(domainActions).values({ tenantId: TENANT_ID, actionType: "create_invoice", payload: {}, status: "pending", summary: "has critic" }).returning(),
    );
    await withTenant(TENANT_ID, (db) =>
      db.insert(actionLog).values({
        tenantId: TENANT_ID,
        domainActionId: action!.id,
        step: "critic_review",
        input: { instruction: "test" },
        output: { flagged: true, reason: "amount looks wrong" },
      }),
    );
    const res = await pendingGET(req());
    const body = await res.json();
    const found = body.actions.find((a: { id: string }) => a.id === action!.id);
    expect(found.critic).toEqual({ flagged: true, reason: "amount looks wrong" });
  });

  it("priceBookProvenance is empty when the payload carries no sku", async () => {
    const [action] = await withTenant(TENANT_ID, (db) =>
      db.insert(domainActions).values({ tenantId: TENANT_ID, actionType: "send_service_reminder", payload: { note: "hi" }, status: "pending", summary: "no sku" }).returning(),
    );
    const res = await pendingGET(req());
    const body = await res.json();
    const found = body.actions.find((a: { id: string }) => a.id === action!.id);
    expect(found.priceBookProvenance).toEqual([]);
  });

  it("priceBookProvenance flags an override when the payload price differs from the real price_book_items row", async () => {
    await withTenant(TENANT_ID, (db) =>
      db.insert(priceBookItems).values({ tenantId: TENANT_ID, sku: "FILTER-5MICRON", label: "5-Micron Sediment Filter", priceUsd: "24.99" }).onConflictDoNothing(),
    );
    const [action] = await withTenant(TENANT_ID, (db) =>
      db
        .insert(domainActions)
        .values({
          tenantId: TENANT_ID,
          actionType: "create_quote",
          payload: { lineItems: [{ sku: "FILTER-5MICRON", label: "filter", unitPriceUsd: 19.99 }] },
          status: "pending",
          summary: "quote with an override",
        })
        .returning(),
    );
    const res = await pendingGET(req());
    const body = await res.json();
    const found = body.actions.find((a: { id: string }) => a.id === action!.id);
    expect(found.priceBookProvenance).toEqual([
      { sku: "FILTER-5MICRON", label: "5-Micron Sediment Filter", priceBookPriceUsd: 24.99, payloadPriceUsd: 19.99, matches: false },
    ]);
  });

  it("priceBookProvenance reports matches:true when the payload price agrees with the price book", async () => {
    await withTenant(TENANT_ID, (db) =>
      db.insert(priceBookItems).values({ tenantId: TENANT_ID, sku: "SALT-40LB", label: "40lb Water Softener Salt", priceUsd: "12.50" }).onConflictDoNothing(),
    );
    const [action] = await withTenant(TENANT_ID, (db) =>
      db
        .insert(domainActions)
        .values({
          tenantId: TENANT_ID,
          actionType: "create_quote",
          payload: { sku: "SALT-40LB", priceUsd: 12.5 },
          status: "pending",
          summary: "quote matching price book",
        })
        .returning(),
    );
    const res = await pendingGET(req());
    const body = await res.json();
    const found = body.actions.find((a: { id: string }) => a.id === action!.id);
    expect(found.priceBookProvenance).toEqual([{ sku: "SALT-40LB", label: "40lb Water Softener Salt", priceBookPriceUsd: 12.5, payloadPriceUsd: 12.5, matches: true }]);
  });

  it("a sku with no matching price_book_items row is silently omitted (not fabricated)", async () => {
    const [action] = await withTenant(TENANT_ID, (db) =>
      db
        .insert(domainActions)
        .values({ tenantId: TENANT_ID, actionType: "create_quote", payload: { sku: "NO-SUCH-SKU", priceUsd: 5 }, status: "pending", summary: "unknown sku" })
        .returning(),
    );
    const res = await pendingGET(req());
    const body = await res.json();
    const found = body.actions.find((a: { id: string }) => a.id === action!.id);
    expect(found.priceBookProvenance).toEqual([]);
  });
});
