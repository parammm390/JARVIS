// Signed GHL webhook reconciliation: trusted route resolves the tenant from the
// configured location, then this worker reads provider truth, materializes canonical
// state, and wakes exact effects waiting on the observed provider object.

import {
  enqueueJob,
  externalOperations,
  integrationOperations,
  tenantIntegrations,
  withTenant,
} from "@finnor/db";
import { materializeSourceRecord } from "@finnor/data-platform";
import { createSourceAdapterRegistry, logWithTrace } from "@finnor/tools";
import { ingestIntegrationEvent } from "@finnor/orchestration";
import { and, eq, sql } from "drizzle-orm";
import type { CanonicalSourceRecord } from "@finnor/shared-types";
import type { JobHandler } from "../queue";
import { loadSourceCredentialContext } from "./sync-source";

function object(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function providerObject(type: string, payload: Record<string, unknown>): { objectType: "contact" | "appointment" | "message"; id: string } | null {
  const normalized = type.toLowerCase();
  if (normalized.includes("message")) {
    const id = typeof payload.messageId === "string" ? payload.messageId
      : typeof payload.id === "string" ? payload.id : "";
    return id ? { objectType: "message", id } : null;
  }
  if (normalized.includes("appointment")) {
    const id = typeof payload.id === "string" ? payload.id
      : typeof payload.appointmentId === "string" ? payload.appointmentId : "";
    return id ? { objectType: "appointment", id } : null;
  }
  if (normalized.includes("contact")) {
    const id = typeof payload.contactId === "string" ? payload.contactId
      : typeof payload.id === "string" ? payload.id : "";
    return id ? { objectType: "contact", id } : null;
  }
  return null;
}

export const reconciliation: JobHandler = async (payload) => {
  const type = String(payload.type ?? "unknown");
  const tenantId = typeof payload.tenantId === "string" ? payload.tenantId : "";
  const providerEventId = typeof payload._providerEventId === "string" ? payload._providerEventId : "";
  const locationId = typeof payload.locationId === "string" ? payload.locationId : "";
  if (!tenantId || !providerEventId || !locationId) throw new Error("GHL reconciliation requires resolved tenant, location, and provider event id");

  const target = providerObject(type, payload);
  const candidates = await withTenant(tenantId, (db) => db.select().from(tenantIntegrations).where(and(
    eq(tenantIntegrations.tenantId, tenantId),
    eq(tenantIntegrations.binding, "ghl"),
    sql`(${tenantIntegrations.config}->>'locationId'=${locationId} OR ${tenantIntegrations.credentialMetadata}->>'locationId'=${locationId})`,
  )));
  const preferredCapability = target?.objectType === "appointment" ? "scheduling"
    : target?.objectType === "message" ? "communications" : "crm";
  const integration = candidates.find((row) => row.capability === preferredCapability)
    ?? candidates.find((row) => row.capability === "crm")
    ?? (candidates.length === 1 ? candidates[0] : undefined);
  if (!integration) throw new Error("GHL event does not map to one configured tenant integration/account");

  let record: CanonicalSourceRecord | null = null;
  let readbackUnavailable = false;
  if (target) {
    const deleted = /delete/i.test(type);
    if (deleted) {
      record = {
        tenantId,
        integrationId: integration.id,
        provider: "ghl",
        sourceScope: target.objectType === "contact" ? "contacts" : target.objectType === "appointment" ? "appointments" : "messages",
        externalObjectType: target.objectType,
        externalId: target.id,
        canonicalEntity: target.objectType === "contact" ? "customer" : target.objectType,
        observedAt: new Date().toISOString(),
        deleted: true,
        data: {},
        ownership: { default: "external", direction: target.objectType === "appointment" ? "bidirectional_governed" : "inbound" },
        provenance: { providerEventId },
      };
    } else {
      try {
        const credentialContext = await loadSourceCredentialContext(tenantId, { ...integration, binding: "ghl" });
        record = await createSourceAdapterRegistry().get("ghl").readObject(target.objectType, target.id, {
          tenantId,
          integrationId: integration.id,
          config: object(integration.config),
          credentialContext,
        });
        if (!record) readbackUnavailable = true;
      } catch {
        // A valid signed event is still durable evidence even when credentials are
        // revoked or provider read-back is temporarily unavailable. Preserve and
        // deduplicate the event, but label source truth degraded—never healthy/fresh.
        readbackUnavailable = true;
      }
    }
    if (record && target.objectType !== "message") await withTenant(tenantId, (db) => materializeSourceRecord(db, {
      ...record!, provenance: { ...object(record!.provenance), providerEventId },
    }));

    // Provider event latency should beat polling backoff. Re-run exact waiting
    // operation observers with a fresh idempotency key; settlement itself is idempotent.
    const observations = await withTenant(tenantId, async (db) => {
      const external = await db.select({
        actionId: externalOperations.domainActionId,
        operationKey: externalOperations.operationKey,
      }).from(externalOperations).where(and(
        eq(externalOperations.tenantId, tenantId),
        eq(externalOperations.integrationId, integration.id),
        eq(externalOperations.verificationStatus, "awaiting_observation"),
        sql`(${externalOperations.response}->>'contactId'=${target.id} OR ${externalOperations.response}->>'visitId'=${target.id} OR ${externalOperations.response}->>'appointmentId'=${target.id} OR ${externalOperations.response}->>'messageId'=${target.id})`,
      ));
      const capability = await db.select({ id: integrationOperations.id }).from(integrationOperations).where(and(
        eq(integrationOperations.tenantId, tenantId),
        eq(integrationOperations.integrationId, integration.id),
        eq(integrationOperations.verificationStatus, "awaiting_observation"),
        sql`(${integrationOperations.response}->>'contactId'=${target.id} OR ${integrationOperations.response}->>'visitId'=${target.id} OR ${integrationOperations.response}->>'appointmentId'=${target.id} OR ${integrationOperations.response}->>'messageId'=${target.id})`,
      ));
      return { external, capability };
    });
    for (const operation of observations.external) await enqueueJob(
      "observe_external_effect",
      { tenantId, domainActionId: operation.actionId, externalOperationKey: operation.operationKey, attempt: 99 },
      `observe-webhook:${tenantId}:${providerEventId}:${operation.operationKey}`,
    );
    for (const operation of observations.capability) await enqueueJob(
      "observe_external_effect",
      { tenantId, integrationOperationId: operation.id, attempt: 99 },
      `observe-webhook:${tenantId}:${providerEventId}:${operation.id}`,
    );
  }

  await withTenant(tenantId, (db) => db.update(tenantIntegrations).set({
    webhookStatus: "healthy",
    ...(readbackUnavailable ? {
      health: "degraded" as const,
      syncStatus: "degraded" as const,
      reconciliationStatus: "degraded" as const,
      freshnessState: "unknown" as const,
    } : {}),
    lastObservedAt: record ? new Date(record.observedAt) : new Date(),
    lastError: readbackUnavailable ? "Provider event received; exact source read-back unavailable" : null,
    updatedAt: new Date(),
  }).where(and(eq(tenantIntegrations.tenantId, tenantId), eq(tenantIntegrations.id, integration.id))));
  await ingestIntegrationEvent({
    tenantId,
    source: "ghl",
    provider: "ghl",
    sourceEventId: providerEventId,
    eventType: `ghl.${type.toLowerCase().replace(/[^a-z0-9_.-]+/g, "_").slice(0, 180)}`,
    occurredAt: record ? new Date(record.observedAt) : new Date(),
    providerConversationId: typeof payload.contactId === "string" ? payload.contactId : null,
    applicationRef: integration.id,
    correlationId: target?.id ?? null,
    payload: { type, locationId, objectType: target?.objectType ?? null, externalId: target?.id ?? null },
    trustClass: "untrusted_external",
  });
  logWithTrace({ traceId: payload._correlationId as string | undefined }).info({ ghlEventType: type, materialized: Boolean(record) }, "[reconciliation] reconciled GHL event");
};
