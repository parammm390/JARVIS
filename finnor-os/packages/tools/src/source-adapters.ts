import type { TenantCredentialContext } from "@finnor/security";
import type {
  CanonicalSourceRecord,
  SourceSyncCursor,
  SourceSyncPage,
} from "@finnor/shared-types";
import { IntegrationError } from "./errors";
import {
  queryQuickBooksObjects,
  readQuickBooksChanges,
  readQuickBooksObject,
  type QuickBooksCredentialContext,
  type QuickBooksReadRecord,
} from "./quickbooks";
import { readStripeCheckoutSession, type StripeCredentialContext } from "./stripe";
import { readVapiCall, listVapiCalls, type VapiCredentialContext } from "./vapi-rest";

export interface SourceAdapterContext {
  tenantId: string;
  integrationId: string;
  config: Readonly<Record<string, unknown>>;
  credentialContext: TenantCredentialContext;
}

export interface SourceAdapter {
  readonly provider: string;
  readonly scopes: readonly string[];
  readPage(scope: string, cursor: SourceSyncCursor, context: SourceAdapterContext): Promise<SourceSyncPage>;
  readObject(objectType: string, externalId: string, context: SourceAdapterContext): Promise<CanonicalSourceRecord | null>;
}

export class SourceAdapterRegistry {
  private readonly adapters = new Map<string, SourceAdapter>();

  register(adapter: SourceAdapter): this {
    if (this.adapters.has(adapter.provider)) throw new Error(`source adapter already registered: ${adapter.provider}`);
    this.adapters.set(adapter.provider, adapter);
    return this;
  }

  get(provider: string): SourceAdapter {
    const adapter = this.adapters.get(provider);
    if (!adapter) throw new IntegrationError(provider, "no source-truth adapter is registered", false, "config");
    return adapter;
  }
}

function assertCredential<P extends TenantCredentialContext["provider"]>(
  context: SourceAdapterContext,
  provider: P,
): asserts context is SourceAdapterContext & { credentialContext: TenantCredentialContext<P> } {
  if (context.tenantId !== context.credentialContext.tenantId || context.credentialContext.provider !== provider) {
    throw new IntegrationError(provider, "source credential context does not match tenant/provider", false, "auth");
  }
  if (context.credentialContext.integration.id && context.credentialContext.integration.id !== context.integrationId) {
    throw new IntegrationError(provider, "source credential context does not match configured integration account", false, "auth");
  }
}

function object(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function text(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function observedTime(row: Record<string, unknown>, fallback = new Date().toISOString()): string {
  const metadata = object(row.MetaData);
  const value = text(row.dateUpdated) ?? text(row.updatedAt) ?? text(metadata.LastUpdatedTime) ?? text(row.dateAdded) ?? text(row.createdAt) ?? text(metadata.CreateTime);
  return value && !Number.isNaN(new Date(value).getTime()) ? new Date(value).toISOString() : fallback;
}

function timeSequence(value: string): string | undefined {
  const millis = new Date(value).getTime();
  return Number.isFinite(millis) && millis >= 0 ? String(millis) : undefined;
}

function addressText(row: Record<string, unknown>): string | undefined {
  return [row.address1, row.city, row.state, row.postalCode].map(text).filter(Boolean).join(", ") || undefined;
}

function normalizeGhlContact(row: Record<string, unknown>, context: SourceAdapterContext, scope = "contacts"): CanonicalSourceRecord {
  const id = text(row.id);
  if (!id) throw new IntegrationError("ghl", "contact observation has no id", false, "validation");
  const updatedAt = observedTime(row);
  const phone = text(row.phone);
  const email = text(row.email)?.toLowerCase();
  return {
    tenantId: context.tenantId,
    integrationId: context.integrationId,
    provider: "ghl",
    sourceScope: scope,
    externalObjectType: "contact",
    externalId: id,
    canonicalEntity: "customer",
    sourceVersion: text(row.dateUpdated),
    sourceSequence: timeSequence(updatedAt),
    observedAt: updatedAt,
    deleted: row.deleted === true,
    identityKey: email ? `email:${email}` : phone ? `phone:${phone.replace(/\D/g, "")}` : undefined,
    data: {
      name: text(row.contactName) ?? text(row.name) ?? [text(row.firstName), text(row.lastName)].filter(Boolean).join(" "),
      firstName: text(row.firstName),
      lastName: text(row.lastName),
      phone,
      email,
      address: addressText(row),
    },
    ownership: { default: "external", direction: "inbound" },
    provenance: { locationId: context.credentialContext.credentials && "locationId" in context.credentialContext.credentials ? context.credentialContext.credentials.locationId : undefined },
  };
}

function normalizeGhlAppointment(row: Record<string, unknown>, context: SourceAdapterContext): CanonicalSourceRecord {
  const id = text(row.id);
  const contactId = text(row.contactId);
  const startTime = text(row.startTime);
  if (!id || !contactId || !startTime) throw new IntegrationError("ghl", "appointment observation is missing id/contact/startTime", false, "validation");
  const observedAt = observedTime(row);
  const endTime = text(row.endTime);
  const statusValue = (text(row.status) ?? "confirmed").toLowerCase();
  const status = statusValue.includes("cancel") ? "canceled"
    : statusValue.includes("complete") ? "completed"
      : statusValue.includes("show") ? "no_show"
        : "confirmed";
  const durationMinutes = endTime
    ? Math.max(1, Math.round((new Date(endTime).getTime() - new Date(startTime).getTime()) / 60_000))
    : undefined;
  return {
    tenantId: context.tenantId,
    integrationId: context.integrationId,
    provider: "ghl",
    sourceScope: "appointments",
    externalObjectType: "appointment",
    externalId: id,
    canonicalEntity: "appointment",
    sourceVersion: text(row.dateUpdated),
    sourceSequence: timeSequence(observedAt),
    observedAt,
    deleted: row.deleted === true,
    data: { scheduledAt: new Date(startTime).toISOString(), durationMinutes, notes: text(row.notes) ?? text(row.title), status },
    relationships: { householdId: { entity: "household", externalObjectType: "contact", externalId: contactId, required: true } },
    ownership: { default: "external", direction: "bidirectional_governed" },
    provenance: { calendarId: text(row.calendarId) },
  };
}

function normalizeGhlMessage(row: Record<string, unknown>, context: SourceAdapterContext): CanonicalSourceRecord {
  const id = text(row.id);
  const contactId = text(row.contactId);
  if (!id || !contactId) throw new IntegrationError("ghl", "message observation is missing id/contactId", false, "validation");
  const observedAt = observedTime(row);
  const status = (text(row.status) ?? "unknown").toLowerCase();
  const delivered = ["connected", "delivered", "opened", "read", "sent", "clicked"].includes(status)
    ? true : ["failed", "undelivered", "opt_out"].includes(status) ? false : undefined;
  return {
    tenantId: context.tenantId,
    integrationId: context.integrationId,
    provider: "ghl",
    sourceScope: "messages",
    externalObjectType: "message",
    externalId: id,
    canonicalEntity: "message",
    sourceSequence: timeSequence(observedAt),
    observedAt,
    data: {
      contactId,
      conversationId: text(row.conversationId),
      body: text(row.body),
      direction: text(row.direction),
      status,
      deliverySucceeded: delivered,
      from: text(row.from),
      to: text(row.to),
    },
    ownership: { default: "external", direction: "inbound" },
    provenance: { messageType: text(row.messageType), source: text(row.source) },
  };
}

async function ghlGet<T>(path: string, context: SourceAdapterContext, version = "2021-07-28"): Promise<T | null> {
  assertCredential(context, "ghl");
  const response = await fetch(`https://services.leadconnectorhq.com${path}`, {
    headers: {
      Authorization: `Bearer ${context.credentialContext.credentials.apiKey}`,
      Accept: "application/json",
      Version: version,
    },
    signal: AbortSignal.timeout(10_000),
  });
  if (response.status === 404) return null;
  if (!response.ok) {
    const authFailure = response.status === 401 || response.status === 403;
    const retryable = !authFailure && (response.status === 429 || response.status >= 500);
    const retryAfter = response.headers.get("retry-after");
    throw new IntegrationError("ghl", `source read failed (${response.status})${retryAfter ? `; retry-after=${retryAfter}` : ""}`, retryable, authFailure ? "auth" : retryable ? "retryable" : "terminal");
  }
  return response.json() as Promise<T>;
}

export const ghlSourceAdapter: SourceAdapter = {
  provider: "ghl",
  scopes: ["contacts", "appointments", "messages"],
  async readPage(scope, cursor, context) {
    if (scope !== "contacts") {
      // GHL appointment list semantics are calendar/range-specific. Appointment
      // incremental truth is webhook-driven and read back by exact provider id.
      return { scope, records: [], nextCursor: cursor, hasMore: false };
    }
    assertCredential(context, "ghl");
    const locationId = context.credentialContext.credentials.locationId;
    if (!locationId) throw new IntegrationError("ghl", "contact discovery requires configured locationId", false, "config");
    const query = new URLSearchParams({ locationId, limit: "100" });
    if (typeof cursor.afterId === "string" && cursor.afterId) query.set("startAfterId", cursor.afterId);
    if (typeof cursor.token === "string" && cursor.token) query.set("startAfter", cursor.token);
    const payload = await ghlGet<{ contacts?: Record<string, unknown>[]; meta?: Record<string, unknown> }>(`/contacts/?${query.toString()}`, context);
    const contacts = payload?.contacts ?? [];
    const last = contacts.at(-1);
    const afterId = last ? text(last.id) : undefined;
    const meta = object(payload?.meta);
    const total = typeof meta.total === "number" ? meta.total : undefined;
    const currentStart = typeof cursor.page === "number" ? cursor.page * 100 : 0;
    const hasMore = contacts.length === 100 && (total === undefined || currentStart + contacts.length < total);
    return {
      scope,
      records: contacts.map((row) => normalizeGhlContact(row, context)),
      nextCursor: { version: 1, ...(afterId ? { afterId } : {}), page: (typeof cursor.page === "number" ? cursor.page : 0) + 1 },
      hasMore,
      highWatermark: new Date().toISOString(),
    };
  },
  async readObject(objectType, externalId, context) {
    if (objectType === "contact") {
      const payload = await ghlGet<{ contact?: Record<string, unknown> }>(`/contacts/${encodeURIComponent(externalId)}`, context);
      return payload?.contact ? normalizeGhlContact(payload.contact, context) : null;
    }
    if (objectType === "appointment") {
      const payload = await ghlGet<Record<string, unknown> | { event?: Record<string, unknown> }>(
        `/calendars/events/appointments/${encodeURIComponent(externalId)}`,
        context,
        "2021-04-15",
      );
      const row = payload && "event" in payload ? object(payload.event) : object(payload);
      return Object.keys(row).length > 0 ? normalizeGhlAppointment(row, context) : null;
    }
    if (objectType === "message") {
      const payload = await ghlGet<Record<string, unknown> | { message?: Record<string, unknown> }>(
        `/conversations/messages/${encodeURIComponent(externalId)}`,
        context,
        "v3",
      );
      const row = payload && "message" in payload ? object(payload.message) : object(payload);
      return Object.keys(row).length > 0 ? normalizeGhlMessage(row, context) : null;
    }
    return null;
  },
};

function qboMeta(row: QuickBooksReadRecord): { observedAt: string; version?: string; sequence?: string } {
  const observedAt = observedTime(row);
  return { observedAt, version: text(row.SyncToken), sequence: timeSequence(observedAt) };
}

function qboRef(value: unknown): string | undefined {
  return text(object(value).value);
}

function normalizeQboCustomer(row: QuickBooksReadRecord, context: SourceAdapterContext, scope: string): CanonicalSourceRecord {
  const meta = qboMeta(row);
  const phone = text(object(row.PrimaryPhone).FreeFormNumber);
  const email = text(object(row.PrimaryEmailAddr).Address)?.toLowerCase();
  const address = object(row.BillAddr);
  return {
    tenantId: context.tenantId, integrationId: context.integrationId, provider: "quickbooks", sourceScope: scope,
    externalObjectType: "customer", externalId: row.Id, canonicalEntity: "customer", sourceVersion: meta.version,
    sourceSequence: meta.sequence, observedAt: meta.observedAt, deleted: row.Active === false,
    identityKey: email ? `email:${email}` : phone ? `phone:${phone.replace(/\D/g, "")}` : undefined,
    data: {
      name: text(row.DisplayName), firstName: text(row.GivenName), lastName: text(row.FamilyName), phone, email,
      address: [address.Line1, address.City, address.CountrySubDivisionCode, address.PostalCode].map(text).filter(Boolean).join(", ") || undefined,
    },
    ownership: { default: "external", direction: "inbound" }, provenance: { realmId: (context.credentialContext.credentials as { realmId?: string }).realmId },
  };
}

function normalizeQboInvoice(row: QuickBooksReadRecord, context: SourceAdapterContext, scope: string): CanonicalSourceRecord {
  const meta = qboMeta(row);
  const customerId = qboRef(row.CustomerRef);
  const deleted = row.status === "Deleted";
  if (!customerId && !deleted) throw new IntegrationError("quickbooks", "invoice observation has no CustomerRef", false, "validation");
  const balance = Number(row.Balance ?? 0);
  const voided = row.PrivateNote === "Voided" || Number(row.TotalAmt ?? 0) === 0;
  return {
    tenantId: context.tenantId, integrationId: context.integrationId, provider: "quickbooks", sourceScope: scope,
    externalObjectType: "invoice", externalId: row.Id, canonicalEntity: "invoice", sourceVersion: meta.version,
    sourceSequence: meta.sequence, observedAt: meta.observedAt, deleted,
    data: {
      amountUsd: Number(row.TotalAmt ?? 0), status: voided ? "void" : balance <= 0 ? "paid" : "sent",
      memo: text(row.CustomerMemo && object(row.CustomerMemo).value) ?? text(row.PrivateNote), dueDate: text(row.DueDate),
    },
    ...(customerId ? { relationships: { householdId: { entity: "household", externalObjectType: "customer", externalId: customerId, required: true } } } : {}),
    ownership: { default: "external", direction: "bidirectional_governed" }, provenance: { docNumber: text(row.DocNumber) },
  };
}

function normalizeQboPayment(row: QuickBooksReadRecord, context: SourceAdapterContext, scope: string): CanonicalSourceRecord {
  const meta = qboMeta(row);
  const linked = Array.isArray(row.Line)
    ? row.Line.flatMap((line) => Array.isArray(object(line).LinkedTxn) ? object(line).LinkedTxn as unknown[] : [])
    : Array.isArray(row.LinkedTxn) ? row.LinkedTxn : [];
  const invoiceLink = linked.map(object).find((item) => item.TxnType === "Invoice");
  const invoiceId = text(invoiceLink?.TxnId);
  const deleted = row.status === "Deleted";
  if (!invoiceId && !deleted) throw new IntegrationError("quickbooks", "payment observation has no linked Invoice", false, "validation");
  return {
    tenantId: context.tenantId, integrationId: context.integrationId, provider: "quickbooks", sourceScope: scope,
    externalObjectType: "payment", externalId: row.Id, canonicalEntity: "payment", sourceVersion: meta.version,
    sourceSequence: meta.sequence, observedAt: meta.observedAt, deleted,
    data: { amountUsd: Number(row.TotalAmt ?? 0), method: "other", status: "succeeded", receivedAt: text(row.TxnDate) ?? meta.observedAt },
    ...(invoiceId ? { relationships: { invoiceId: { entity: "invoice", externalObjectType: "invoice", externalId: invoiceId, required: true } } } : {}),
    ownership: { default: "external", direction: "inbound" }, provenance: {},
  };
}

function normalizeQbo(type: "Customer" | "Invoice" | "Payment", row: QuickBooksReadRecord, context: SourceAdapterContext, scope: string): CanonicalSourceRecord {
  return type === "Customer" ? normalizeQboCustomer(row, context, scope)
    : type === "Invoice" ? normalizeQboInvoice(row, context, scope)
      : normalizeQboPayment(row, context, scope);
}

export const quickBooksSourceAdapter: SourceAdapter = {
  provider: "quickbooks",
  scopes: ["customers", "invoices", "payments", "accounting_changes"],
  async readPage(scope, cursor, context) {
    assertCredential(context, "quickbooks");
    const credential = context.credentialContext as QuickBooksCredentialContext;
    if (scope === "accounting_changes") {
      const changedSince = typeof cursor.changedSince === "string" ? cursor.changedSince : new Date(Date.now() - 29 * 86_400_000).toISOString();
      const changes = await readQuickBooksChanges(changedSince, credential);
      const records = [
        ...changes.customers.map((row) => normalizeQbo("Customer", row, context, scope)),
        ...changes.invoices.map((row) => normalizeQbo("Invoice", row, context, scope)),
        ...changes.payments.map((row) => normalizeQbo("Payment", row, context, scope)),
      ];
      return { scope, records, nextCursor: { version: 1, changedSince: changes.changedAt }, hasMore: false, highWatermark: changes.changedAt };
    }
    const type = scope === "customers" ? "Customer" : scope === "invoices" ? "Invoice" : scope === "payments" ? "Payment" : null;
    if (!type) throw new IntegrationError("quickbooks", `unsupported source scope ${scope}`, false, "config");
    const page = typeof cursor.page === "number" ? Math.max(0, cursor.page) : 0;
    const rows = await queryQuickBooksObjects(type, page * 250 + 1, credential, 250);
    return {
      scope,
      records: rows.map((row) => normalizeQbo(type, row, context, scope)),
      nextCursor: { version: 1, page: page + 1 },
      hasMore: rows.length === 250,
      highWatermark: new Date().toISOString(),
    };
  },
  async readObject(objectType, externalId, context) {
    assertCredential(context, "quickbooks");
    const type = objectType === "customer" ? "Customer" : objectType === "invoice" ? "Invoice" : objectType === "payment" ? "Payment" : null;
    if (!type) return null;
    const row = await readQuickBooksObject(objectType as "customer" | "invoice" | "payment", externalId, context.credentialContext as QuickBooksCredentialContext);
    return row ? normalizeQbo(type, row, context, `read_back:${objectType}`) : null;
  },
};

export const stripeSourceAdapter: SourceAdapter = {
  provider: "stripe",
  scopes: ["checkout_sessions"],
  async readPage(scope, cursor) {
    return { scope, records: [], nextCursor: cursor, hasMore: false };
  },
  async readObject(objectType, externalId, context) {
    if (objectType !== "checkout_session") return null;
    assertCredential(context, "stripe");
    const session = await readStripeCheckoutSession(externalId, context.credentialContext as StripeCredentialContext);
    if (!session) return null;
    const observedAt = new Date().toISOString();
    return {
      tenantId: context.tenantId, integrationId: context.integrationId, provider: "stripe", sourceScope: "checkout_sessions",
      externalObjectType: "checkout_session", externalId, canonicalEntity: "payment", observedAt,
      data: { status: session.payment_status, amountUsd: Number(session.amount_total ?? 0) / 100, currency: session.currency, metadata: session.metadata },
      ownership: { default: "external", direction: "inbound" }, provenance: { mechanism: "checkout_session" },
    };
  },
};

export const vapiSourceAdapter: SourceAdapter = {
  provider: "vapi",
  scopes: ["calls"],
  async readPage(scope, cursor, context) {
    assertCredential(context, "vapi");
    const createdAtGe = typeof cursor.changedSince === "string" ? cursor.changedSince : new Date(Date.now() - 7 * 86_400_000).toISOString();
    const calls = await listVapiCalls(context.credentialContext as VapiCredentialContext, { createdAtGe, limit: 100 });
    const highWatermark = new Date().toISOString();
    return {
      scope,
      records: calls.map((call) => ({
        tenantId: context.tenantId, integrationId: context.integrationId, provider: "vapi", sourceScope: scope,
        externalObjectType: "call", externalId: call.id, canonicalEntity: "call", sourceVersion: text(call.updatedAt),
        sourceSequence: timeSequence(observedTime(call)), observedAt: observedTime(call), data: { status: call.status, endedAt: call.endedAt },
        ownership: { default: "external", direction: "inbound" }, provenance: { metadata: object(call.metadata) },
      })),
      nextCursor: { version: 1, changedSince: highWatermark }, hasMore: false, highWatermark,
    };
  },
  async readObject(objectType, externalId, context) {
    if (objectType !== "call") return null;
    assertCredential(context, "vapi");
    const call = await readVapiCall(externalId, context.credentialContext as VapiCredentialContext);
    if (!call) return null;
    return {
      tenantId: context.tenantId, integrationId: context.integrationId, provider: "vapi", sourceScope: "calls",
      externalObjectType: "call", externalId, canonicalEntity: "call", sourceVersion: text(call.updatedAt),
      sourceSequence: timeSequence(observedTime(call)), observedAt: observedTime(call), data: { status: call.status, endedAt: call.endedAt },
      ownership: { default: "external", direction: "inbound" }, provenance: { metadata: object(call.metadata) },
    };
  },
};

export function createSourceAdapterRegistry(): SourceAdapterRegistry {
  return new SourceAdapterRegistry()
    .register(ghlSourceAdapter)
    .register(quickBooksSourceAdapter)
    .register(stripeSourceAdapter)
    .register(vapiSourceAdapter);
}
