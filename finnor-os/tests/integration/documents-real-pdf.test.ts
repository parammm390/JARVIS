// Phase 4 (§4.2): documents domain internal real implementation — proves the "no real
// PDF bytes anywhere" gap (docusign.ts's own header comment, pre-existing) is actually
// closed, not just that the workflow doesn't crash with DOCUMENTS_BINDING unset
// (vertical-workflows-phase4.test.ts never sets it, so it never exercises this path).

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import pg from "pg";
import { migrate } from "../../packages/db/migrate";
import { withTenant, closePool, tenants, households, quotes, quoteLineItems, proposals, documents, documentContents } from "@finnor/db";
import { eq } from "drizzle-orm";
import { generateDocumentNativeBinding } from "../../packages/tools/src/capabilities/documents";
import { getDocumentContent } from "@finnor/data-platform";
import { GET as documentRoute } from "../../apps/api/app/api/documents/[id]/route";

const DB_URL = process.env.DATABASE_URL ?? "postgres://finnor:finnor@localhost:5432/finnor";
const TENANT_ID = "00000000-0000-4000-8000-0000000000f5";

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

function req(id: string): Request {
  return new Request(`http://localhost/api/documents/${id}`, { headers: { "x-tenant-id": TENANT_ID, "x-user-role": "owner" } });
}

describe.skipIf(!available)("Phase 4 §4.2: real PDF documents (native binding)", () => {
  beforeAll(async () => {
    process.env.DATABASE_URL = DB_URL;
    process.env.AUTH_DEV_BYPASS = "1";
    await migrate(DB_URL);
    await withTenant(TENANT_ID, (db) => db.insert(tenants).values({ id: TENANT_ID, name: "Documents Real PDF Test" }).onConflictDoNothing());
  }, 30_000);
  afterAll(async () => {
    await closePool();
  });

  it("generic document: real, parseable PDF bytes (not a placeholder string) are stored and retrievable", async () => {
    const result = await generateDocumentNativeBinding.call({
      tenantId: TENANT_ID,
      kind: "compliance_report",
      title: "Well Compliance Report",
      idempotencyKey: `doc-generic-${Date.now()}`,
    });
    expect(result.documentId).toBeTruthy();
    expect(result.storageRef).toBe(`internal://documents/${result.documentId}`);

    const content = await withTenant(TENANT_ID, (db) => getDocumentContent(db, result.documentId));
    expect(content).toBeTruthy();
    expect(content!.bytes.subarray(0, 5).toString("latin1")).toBe("%PDF-");
    expect(content!.bytes.byteLength).toBeGreaterThan(200); // a real rendered page, not an empty stub
    expect(content!.contentType).toBe("application/pdf");
  });

  it("proposal document: real line items and total from quotes/quote_line_items render into the PDF, retrievable via the real API route", async () => {
    const [hh] = await withTenant(TENANT_ID, (db) => db.insert(households).values({ tenantId: TENANT_ID, address: "77 Real PDF Ln", contactInfo: {} }).returning());
    const [quote] = await withTenant(TENANT_ID, (db) => db.insert(quotes).values({ tenantId: TENANT_ID, householdId: hh!.id, status: "sent", totalUsd: "1847.50" }).returning());
    await withTenant(TENANT_ID, (db) =>
      db.insert(quoteLineItems).values([
        { tenantId: TENANT_ID, quoteId: quote!.id, label: "Whole-Home RO System", quantity: 1, unitPriceUsd: "1499.00" },
        { tenantId: TENANT_ID, quoteId: quote!.id, label: "Installation Labor", quantity: 4, unitPriceUsd: "87.125" },
      ]),
    );
    const [proposal] = await withTenant(TENANT_ID, (db) => db.insert(proposals).values({ householdId: hh!.id, quoteId: quote!.id, content: {}, status: "draft" }).returning());

    const result = await generateDocumentNativeBinding.call({
      tenantId: TENANT_ID,
      kind: "proposal_pdf",
      title: `Proposal ${proposal!.id.slice(0, 8)}`,
      idempotencyKey: `doc-proposal-${Date.now()}`,
      sourceEntityType: "proposal",
      sourceEntityId: proposal!.id,
    });

    const res = await documentRoute(req(result.documentId), { params: { id: result.documentId } });
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("application/pdf");
    const bytes = Buffer.from(await res.arrayBuffer());
    expect(bytes.subarray(0, 5).toString("latin1")).toBe("%PDF-");
    expect(bytes.byteLength).toBeGreaterThan(400); // real line-item table, bigger than the generic single-line page

    // Cleanup
    await withTenant(TENANT_ID, async (db) => {
      await db.delete(documentContents).where(eq(documentContents.documentId, result.documentId));
      await db.delete(documents).where(eq(documents.id, result.documentId));
      await db.delete(proposals).where(eq(proposals.id, proposal!.id));
      await db.delete(quoteLineItems).where(eq(quoteLineItems.quoteId, quote!.id));
      await db.delete(quotes).where(eq(quotes.id, quote!.id));
      await db.delete(households).where(eq(households.id, hh!.id));
    });
  });

  it("a request for another tenant's document 404s (tenant-scoped, not just a bare lookup)", async () => {
    const result = await generateDocumentNativeBinding.call({
      tenantId: TENANT_ID,
      kind: "generic",
      title: "Tenant Isolation Probe",
      idempotencyKey: `doc-isolation-${Date.now()}`,
    });
    const otherTenantReq = new Request(`http://localhost/api/documents/${result.documentId}`, {
      headers: { "x-tenant-id": "00000000-0000-4000-8000-0000000000f6", "x-user-role": "owner" },
    });
    const res = await documentRoute(otherTenantReq, { params: { id: result.documentId } });
    expect(res.status).toBe(404);

    await withTenant(TENANT_ID, async (db) => {
      await db.delete(documentContents).where(eq(documentContents.documentId, result.documentId));
      await db.delete(documents).where(eq(documents.id, result.documentId));
    });
  });
});
