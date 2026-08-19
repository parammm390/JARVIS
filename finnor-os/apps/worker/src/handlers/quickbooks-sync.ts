// quickbooks_sync job: best-effort sync of a native Finnor invoice out to QuickBooks
// Online, if connected. Fired async/non-blocking right after the native invoice write
// (packages/domain-plugins/accounting/index.ts) — Finnor's own `invoices` table is
// always the system of record; this can fail, retry, or dead-letter without the
// customer-facing invoice creation ever knowing or caring. If QuickBooks isn't
// connected, this is a silent no-op (not an error) — nothing was promised to sync.

import { withTenant, invoices, households } from "@finnor/db";
import { eq } from "drizzle-orm";
import { syncInvoiceToQuickBooks } from "@finnor/tools";
import { resolveTenantCredentialContext, TenantCredentialError } from "@finnor/security";
import type { JobHandler } from "../queue";

export const quickbooksSync: JobHandler = async (payload) => {
  const tenantId = String(payload.tenantId ?? "");
  const invoiceId = String(payload.invoiceId ?? "");
  if (!tenantId || !invoiceId) throw new Error("quickbooks_sync requires tenantId and invoiceId");
  let credentialContext;
  try {
    credentialContext = await resolveTenantCredentialContext(tenantId, "quickbooks");
  } catch (error) {
    if (error instanceof TenantCredentialError && error.code === "integration_not_bound") return;
    throw error;
  }

  const inv = await withTenant(tenantId, async (db) => {
    const [row] = await db.select().from(invoices).where(eq(invoices.id, invoiceId));
    return row ?? null;
  });
  if (!inv) return; // invoice no longer exists — nothing to sync

  const hh = await withTenant(tenantId, async (db) => {
    const [row] = await db.select().from(households).where(eq(households.id, inv.householdId));
    return row ?? null;
  });
  const contact = (hh?.contactInfo ?? {}) as Record<string, unknown>;
  const customerName = String(contact.name ?? hh?.address ?? "Unknown customer");

  await syncInvoiceToQuickBooks({
    customerName,
    customerPhone: contact.phone ? String(contact.phone) : undefined,
    amountUsd: Number(inv.amountUsd),
    memo: inv.memo ?? undefined,
  }, credentialContext);
};
