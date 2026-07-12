// voice_confirm_request job: no live call was active when the gate fired, so place an
// outbound Vapi call to the OWNER, read the draft, and let the end-of-call webhook
// parse the spoken yes/no. The action stays pending until that decision arrives.

import { getPool } from "@finnor/db";
import { placeVapiCall } from "@finnor/tools";
import type { JobHandler } from "../queue";

export const voiceConfirmRequest: JobHandler = async (payload) => {
  const tenantId = String(payload.tenantId ?? "");
  const actionId = String(payload.actionId ?? "");
  const script = String(payload.script ?? "");
  if (!tenantId || !actionId || !script) throw new Error("voice_confirm_request requires tenantId, actionId, script");

  // Only call if the action is still pending — a console click may have beaten us.
  const { rows } = await getPool().query(
    `SELECT da.status, t.owner_phone FROM domain_actions da JOIN tenants t ON t.id = da.tenant_id WHERE da.id = $1`,
    [actionId],
  );
  const row = rows[0];
  if (!row || row.status !== "pending") return; // already decided — nothing to speak
  const ownerPhone = row.owner_phone as string | null;
  if (!ownerPhone || ownerPhone === "PLACEHOLDER_NEEDS_REAL_VALUE") {
    throw new Error("Tenant owner_phone is not set — add the owner's number to the tenants row for voice confirmations");
  }

  const result = await placeVapiCall({
    customerNumber: ownerPhone,
    firstMessage: `Hi, this is Finnor with something that needs your approval. ${script}`,
    metadata: { pendingActionId: actionId, tenantId },
  });
  if (!result.ok) throw new Error(result.error ?? "Vapi call failed");
};
