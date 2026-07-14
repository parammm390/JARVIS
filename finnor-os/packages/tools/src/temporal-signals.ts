// Best-effort Temporal signal sender — the single, explicit, named seam between the
// gated-action pipeline (packages/orchestration) and the AMC renewal Temporal Workflow
// (apps/temporal-worker). Never a hard dependency: if TEMPORAL_ADDRESS isn't
// configured, this silently no-ops, matching the {configured, healthy, error} honesty
// pattern every other integration in this file follows — never fabricates success,
// never throws into a caller that isn't expecting Temporal to exist at all.

import { IntegrationError } from "./errors";

function temporalConfigured(): boolean {
  return Boolean(process.env.TEMPORAL_ADDRESS);
}

export function temporalProviderStatus(): { configured: boolean } {
  return { configured: temporalConfigured() };
}

/** Signals the AMC renewal workflow for this agreement that the customer responded —
 *  a no-op (not an error) if Temporal isn't configured, or if no such workflow is running
 *  (e.g. this agreement was never enrolled in the sequence). */
export async function signalAmcRenewalResponded(agreementId: string): Promise<void> {
  if (!temporalConfigured()) return;
  try {
    const { Client, Connection } = await import("@temporalio/client");
    const connection = await Connection.connect({
      address: process.env.TEMPORAL_ADDRESS,
      tls: process.env.TEMPORAL_API_KEY ? {} : undefined,
      apiKey: process.env.TEMPORAL_API_KEY,
    });
    try {
      const client = new Client({ connection, namespace: process.env.TEMPORAL_NAMESPACE ?? "default" });
      const handle = client.workflow.getHandle(`amc-renewal:${agreementId}`);
      await handle.signal("customerResponded");
    } finally {
      connection.close();
    }
  } catch (err) {
    // Workflow may have already completed/lapsed, or never existed — neither is this
    // caller's problem to solve, so this stays best-effort rather than an
    // IntegrationError thrown up the stack. Kept as a distinct type for future callers
    // that DO want to distinguish "not configured" from "configured but failed."
    if ((err as { name?: string }).name === "WorkflowNotFoundError") return;
    throw new IntegrationError("temporal", `Could not signal AMC renewal workflow for ${agreementId}: ${(err as Error).message}`, true);
  }
}
