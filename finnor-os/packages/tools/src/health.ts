// Shared integration health-check helpers — factored out of the /api/integrations/status
// route so /api/setup/status can reuse the exact same checks without duplicating them.

import { connectVapi } from "./mcp-client";

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

export function ghlIntegrationStatus(): HealthEntry {
  // Intentionally not connected in the default topology — the native business layer
  // (households/inventory_items/invoices) is the system of record; GHL is optional,
  // not a required integration this build depends on. Never reported as "unhealthy."
  if (!process.env.GOHIGHLEVEL_API_KEY) {
    return { configured: false, healthy: null, note: "native business layer is the system of record — GHL is optional" };
  }
  return { configured: true, healthy: null, note: "configured but not actively self-tested here (native layer still primary)" };
}
