// Shared integration health-check helpers — factored out of the /api/integrations/status
// route so /api/setup/status can reuse the exact same checks without duplicating them.

import { connectVapi } from "./mcp-client";
import { VOICE_PERSONAS, agentKeyForPersona, type VoiceAgentKey, type VoicePersona } from "./voice-personas";

export interface HealthEntry {
  configured: boolean;
  healthy: boolean | null;
  error?: string;
  note?: string;
}

export async function testVapiConnection(): Promise<HealthEntry> {
  if (!process.env.VAPI_API_KEY) return { configured: false, healthy: null };
  try {
    const conn = await connectVapi();
    await conn.close().catch(() => undefined);
    return { configured: true, healthy: true };
  } catch (err) {
    return { configured: true, healthy: false, error: (err as Error).message };
  }
}

export interface VoiceAssistantHealth extends HealthEntry {
  agentKey: VoiceAgentKey;
  personaKey: VoicePersona;
}

/** Verifies each bounded assistant binding without exposing provider assistant IDs.
 * Vapi documents GET /assistant/:id as the authoritative existence/read check. */
export async function testVapiAssistants(): Promise<VoiceAssistantHealth[]> {
  const apiKey = process.env.VAPI_API_KEY;
  return Promise.all((Object.entries(VOICE_PERSONAS) as Array<[VoicePersona, string | undefined]>).map(async ([personaKey, assistantId]) => {
    const agentKey = agentKeyForPersona(personaKey)!;
    if (!assistantId) return { agentKey, personaKey, configured: false, healthy: null };
    if (!apiKey) return { agentKey, personaKey, configured: true, healthy: null, note: "Vapi provider key is not configured" };
    try {
      const response = await fetch(`https://api.vapi.ai/assistant/${encodeURIComponent(assistantId)}`, {
        headers: { authorization: `Bearer ${apiKey}` },
        signal: AbortSignal.timeout(5_000),
      });
      return response.ok
        ? { agentKey, personaKey, configured: true, healthy: true }
        : { agentKey, personaKey, configured: true, healthy: false, error: `Assistant verification failed (${response.status})` };
    } catch {
      return { agentKey, personaKey, configured: true, healthy: false, error: "Assistant verification request failed" };
    }
  }));
}

export function ghlIntegrationStatus(): HealthEntry {
  // Intentionally not connected in the default topology — the native business layer
  // (households/inventory_items/invoices) is the system of record; GHL is optional,
  // not a required integration this build depends on. Never reported as "unhealthy."
  if (!process.env.GOHIGHLEVEL_API_KEY) {
    return { configured: false, healthy: null, note: "native business layer is the system of record — GHL is optional" };
  }
  return { configured: true, healthy: null, note: "configured but not actively self-tested here (native layer still primary)" };
}
