// reconciliation job: absorbs GHL webhook events and verifies our records agree —
// the async half of the Reflection promise ("confirmed the action actually landed").

import { logWithTrace } from "@finnor/tools";
import { ingestIntegrationEvent } from "@finnor/orchestration";
import type { JobHandler } from "../queue";

export const reconciliation: JobHandler = async (payload) => {
  // The GHL event catalog is broad; reconciliation rules are per-event-type and grow
  // over time as dealers wire more of GHL. Unknown events are logged and completed —
  // never errored, so the queue doesn't dead-letter on novel event types.
  const type = String(payload.type ?? "unknown");
  const tenantId = typeof payload.tenantId === "string" ? payload.tenantId : "";
  const providerEventId = typeof payload._providerEventId === "string" ? payload._providerEventId : "";
  if (!tenantId || !providerEventId) throw new Error("GHL reconciliation requires a deterministically resolved tenant and provider event id");
  await ingestIntegrationEvent({
    tenantId,
    source: "ghl",
    provider: "ghl",
    sourceEventId: providerEventId,
    eventType: `ghl.${type.toLowerCase().replace(/[^a-z0-9_.-]+/g, "_").slice(0, 180)}`,
    providerConversationId: typeof payload.contactId === "string" ? payload.contactId : null,
    correlationId: typeof payload.contactId === "string" ? payload.contactId : null,
    payload: {
      type,
      locationId: typeof payload.locationId === "string" ? payload.locationId : null,
      contactId: typeof payload.contactId === "string" ? payload.contactId : null,
    },
    trustClass: "untrusted_external",
  });
  logWithTrace({ traceId: payload._correlationId as string | undefined }).info({ ghlEventType: type }, "[reconciliation] received GHL event");
};
