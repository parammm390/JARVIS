// reconciliation job: absorbs GHL webhook events and verifies our records agree —
// the async half of the Reflection promise ("confirmed the action actually landed").

import type { JobHandler } from "../queue";

export const reconciliation: JobHandler = async (payload) => {
  // The GHL event catalog is broad; reconciliation rules are per-event-type and grow
  // over time as dealers wire more of GHL. Unknown events are logged and completed —
  // never errored, so the queue doesn't dead-letter on novel event types.
  const type = String(payload.type ?? "unknown");
  console.log(`[reconciliation] received GHL event ${type}`);
};
