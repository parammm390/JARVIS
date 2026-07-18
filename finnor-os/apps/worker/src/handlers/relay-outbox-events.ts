// relay_outbox_events job: delivers pending outbox_events for a tenant, exercising
// relayOutboxEvents()'s claim/retry-then-dead-letter machinery (§2.3). No concrete
// external delivery target is defined for outbox events yet — this stub honestly logs
// rather than faking a destination that doesn't exist, matching the existing
// apps/worker/src/handlers/reconciliation.ts stub's own convention.

import { relayOutboxEvents, type OutboxDeliverer } from "@finnor/workflow-runtime";
import type { JobHandler } from "../queue";

const deliverer: OutboxDeliverer = {
  async deliver(eventType, payload, opts) {
    console.log(`[relay_outbox_events] would deliver "${eventType}" (idempotencyKey=${opts.idempotencyKey})`, payload);
  },
};

export const relayOutboxEventsHandler: JobHandler = async (payload) => {
  const tenantId = String(payload.tenantId ?? "");
  if (!tenantId) throw new Error("relay_outbox_events requires tenantId");
  await relayOutboxEvents(tenantId, deliverer);
};
