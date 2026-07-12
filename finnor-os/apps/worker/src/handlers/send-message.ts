// send_message job: outbound SMS through the tool registry (wrapped, retried, typed).

import { createDefaultRegistry } from "@finnor/tools";
import type { JobHandler } from "../queue";

const tools = createDefaultRegistry();

export const sendMessage: JobHandler = async (payload) => {
  const contactId = String(payload.contactId ?? "");
  const message = String(payload.message ?? "");
  if (!contactId || !message) throw new Error("send_message requires contactId and message");
  const result = await tools.call("ghl_send_sms", { contactId, message });
  if (!result.ok) throw new Error(result.error ?? "send failed");
};
