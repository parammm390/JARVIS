// Phase 7 MAESTRO PACK §7.7 — the cockpit's data-quality/contradiction queue: list
// individual unresolved findings, and let an owner mark one reviewed/handled
// ("resolve"). Resolving never auto-fixes the underlying contradiction (no safe
// generic fix exists for e.g. two conflicting phone numbers) — it records that a
// human checked it.

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import pg from "pg";
import { migrate } from "../../packages/db/migrate";
import { withTenant, closePool, tenants, dataQualityFindings } from "@finnor/db";
import { eq } from "drizzle-orm";
import { GET as findingsGET } from "../../apps/api/app/api/data-quality/findings/route";
import { POST as resolvePOST } from "../../apps/api/app/api/data-quality/findings/[id]/resolve/route";

const DB_URL = process.env.DATABASE_URL ?? "postgres://finnor:finnor@localhost:5432/finnor";
const TENANT_ID = "00000000-0000-4000-8000-0000000000f2";

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

function req(role: string, url = "http://localhost/api/test"): Request {
  return new Request(url, { headers: { "x-tenant-id": TENANT_ID, "x-user-role": role } });
}

describe.skipIf(!available)("data-quality findings (Phase 7.7)", () => {
  let openId: string;
  let resolvedId: string;

  beforeAll(async () => {
    process.env.DATABASE_URL = DB_URL;
    process.env.AUTH_DEV_BYPASS = "1";
    await migrate(DB_URL);
    await withTenant(TENANT_ID, (db) => db.insert(tenants).values({ id: TENANT_ID, name: "Data Quality Test" }).onConflictDoNothing());
    const [open] = await withTenant(TENANT_ID, (db) =>
      db
        .insert(dataQualityFindings)
        .values({ tenantId: TENANT_ID, findingType: "contradiction", entityType: "household", entityId: TENANT_ID, details: { note: "conflicting phone numbers" }, severity: "high" })
        .returning(),
    );
    openId = open!.id;
    const [alreadyResolved] = await withTenant(TENANT_ID, (db) =>
      db
        .insert(dataQualityFindings)
        .values({ tenantId: TENANT_ID, findingType: "stale_data", entityType: "household", entityId: TENANT_ID, resolvedAt: new Date() })
        .returning(),
    );
    resolvedId = alreadyResolved!.id;
  });

  afterAll(async () => {
    await withTenant(TENANT_ID, (db) => db.delete(dataQualityFindings).where(eq(dataQualityFindings.tenantId, TENANT_ID)));
    await closePool();
  });

  it("lists only unresolved findings", async () => {
    const res = await findingsGET(req("owner"));
    expect(res.status).toBe(200);
    const body = await res.json();
    const ids = body.findings.map((f: { id: string }) => f.id);
    expect(ids).toContain(openId);
    expect(ids).not.toContain(resolvedId);
  });

  it("a dispatcher cannot resolve a finding -> 403", async () => {
    const res = await resolvePOST(req("dispatcher"), { params: { id: openId } });
    expect(res.status).toBe(403);
  });

  it("an owner resolves a finding -> 200, then it drops out of the unresolved list", async () => {
    const res = await resolvePOST(req("owner"), { params: { id: openId } });
    expect(res.status).toBe(200);
    const list = await (await findingsGET(req("owner"))).json();
    expect(list.findings.map((f: { id: string }) => f.id)).not.toContain(openId);
  });

  it("resolving an already-resolved finding is idempotent", async () => {
    const res = await resolvePOST(req("owner"), { params: { id: openId } });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.idempotent).toBe(true);
  });

  it("unknown finding id -> 404", async () => {
    const res = await resolvePOST(req("owner"), { params: { id: "00000000-0000-4000-8000-0000000000ff" } });
    expect(res.status).toBe(404);
  });
});
