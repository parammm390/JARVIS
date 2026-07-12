// Vapi REST client for outbound calls (voice confirmations + spoken failure alerts).
// Wrapped like every other integration: timeout, retry, typed errors — no bare fetch.

import { wrappedCall, type ToolCallResult } from "./wrap";
import { IntegrationError } from "./errors";

export interface OutboundCallOpts {
  /** E.164 number to call (the dealer owner, or a customer). */
  customerNumber: string;
  /** What the assistant says the moment the call connects. */
  firstMessage: string;
  /** Carried on the call object; comes back in the end-of-call webhook. */
  metadata?: Record<string, unknown>;
  assistantId?: string;
}

export async function placeVapiCall(opts: OutboundCallOpts): Promise<ToolCallResult> {
  return wrappedCall("vapi", async () => {
    const apiKey = process.env.VAPI_API_KEY;
    const phoneNumberId = process.env.VAPI_PHONE_NUMBER_ID;
    const assistantId = opts.assistantId ?? process.env.VAPI_ASSISTANT_ID;
    if (!apiKey) throw new IntegrationError("vapi", "VAPI_API_KEY is not set", false);
    if (!phoneNumberId || phoneNumberId === "PLACEHOLDER_NEEDS_REAL_VALUE") {
      throw new IntegrationError(
        "vapi",
        "VAPI_PHONE_NUMBER_ID is not set — create/import a number in the Vapi dashboard and set its id",
        false,
      );
    }
    if (!assistantId) throw new IntegrationError("vapi", "VAPI_ASSISTANT_ID is not set", false);

    const res = await fetch("https://api.vapi.ai/call", {
      method: "POST",
      headers: { authorization: `Bearer ${apiKey}`, "content-type": "application/json" },
      body: JSON.stringify({
        assistantId,
        phoneNumberId,
        customer: { number: opts.customerNumber },
        metadata: opts.metadata ?? {},
        assistantOverrides: { firstMessage: opts.firstMessage },
      }),
    });
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      throw new IntegrationError("vapi", `create call failed (${res.status}): ${body.slice(0, 300)}`, res.status >= 500);
    }
    return (await res.json()) as Record<string, unknown>;
  });
}
