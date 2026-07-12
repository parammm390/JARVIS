// Single source of truth for every Vapi voice-assistant persona this system dials
// out with. Previously scattered across three locations (bulk-notify's own map,
// accounting's own hardcoded constant, the bare VAPI_ASSISTANT_ID env var used
// implicitly wherever no assistantId override was passed) — one place now, so a
// persona's id is never duplicated or drifted between call sites.
//
// Each of these is a REAL, separately-created Vapi assistant (verify bindings in the
// Vapi dashboard, not just here — this file only records which id is which persona,
// not what tools/system prompt that assistant actually has configured on Vapi's side).

export type VoicePersona = "main" | "payment_collector" | "winback" | "service_reminder" | "install_followup";

export const VOICE_PERSONAS: Record<VoicePersona, string | undefined> = {
  // The general-purpose Finnor ops assistant — full finnor_instruct/finnor_confirm
  // access, used for inbound owner calls/browser sessions and as the fallback when
  // no more specific persona applies.
  main: process.env.VAPI_ASSISTANT_ID,
  payment_collector: "359a7dfe-4cb3-4ccb-9055-5d0cbc5b2e2c",
  winback: "787ec013-a44f-474d-a719-c5d37c0372ae",
  service_reminder: "33dbdbfb-cf60-4bf8-8f58-2f9a1c37b0aa",
  install_followup: "5c1a88a9-1a9b-4ed0-a2c0-6089422ca9c0",
};

/** Resolve a persona name to its Vapi assistant id, or undefined if unset/unknown —
 *  callers fall back to the account's default assistant (main) when this is undefined. */
export function personaAssistantId(persona: string | undefined): string | undefined {
  if (!persona) return undefined;
  return VOICE_PERSONAS[persona as VoicePersona];
}
