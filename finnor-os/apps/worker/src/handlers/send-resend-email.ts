import { resolveTenantResendContext, sendResendEmail } from "@finnor/tools";
import type { JobHandler } from "../queue";

/** B7.T3: the queue owns retry/backoff for provider trouble. A blocked allowlist or
 * budget result is a terminal honest non-send; an adapter/circuit failure throws so
 * JobQueue applies its bounded retry window and eventually records a dead letter. */
export const sendResendEmailJob: JobHandler = async (payload) => {
  const tenantId = String(payload.tenantId ?? "");
  if (!tenantId) throw new Error("send_resend_email requires tenantId");
  const result = await sendResendEmail({
    tenantId, to: String(payload.to ?? ""),
    subject: String(payload.subject ?? ""), html: String(payload.html ?? ""),
  }, await resolveTenantResendContext(tenantId));
  if (!result.sent && !result.blocked) throw new Error("Resend delivery did not produce a terminal result");
};
